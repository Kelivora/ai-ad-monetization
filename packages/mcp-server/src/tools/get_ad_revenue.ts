import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { READ } from '../lib/annotations.js';
import { fail, ok } from '../lib/envelope.js';
import { toToolError } from '../lib/errors.js';
import { loadKnowledge } from '../knowledge/loader.js';
import { toSourceRefs } from '../knowledge/freshness.js';
import { PLATFORM_IDS } from '../knowledge/schema.js';
import { getAdapter } from '../adapters/registry.js';
import { importRevenueRows } from '../core/revenue/import.js';
import type { RevenueRow } from '../core/revenue/types.js';
import { AppError } from '../lib/errors.js';

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '必须是 YYYY-MM-DD');

export function register(server: McpServer): void {
  server.registerTool(
    'get_ad_revenue',
    {
      title: '读取广告收益数据',
      description:
        '把 AdMob 收益数据归一化为 RevenueRow[]：source=file 解析后台导出的 CSV/JSON；source=admob_api 调 networkReport API（需要用户自行获取的环境变量 ADMOB_ACCESS_TOKEN，缺令牌返回 AUTH_REQUIRED）。不代用户做 OAuth。',
      inputSchema: {
        platformId: z.enum(PLATFORM_IDS).default('admob').describe('广告平台（MVP 仅 admob 有收益数据源）'),
        source: z.enum(['file', 'admob_api']).describe('file=后台导出文件；admob_api=报表 API'),
        filePath: z.string().optional().describe('source=file 时的 CSV/JSON 文件路径'),
        publisherId: z.string().optional().describe('source=admob_api 时的发布商 ID（pub-xxxxxxxxxxxxxxxx）'),
        startDate: DATE.describe('起始日期（含端点）'),
        endDate: DATE.describe('结束日期（含端点）'),
        dimensions: z.array(z.enum(['DATE', 'COUNTRY', 'FORMAT', 'AD_UNIT', 'APP', 'PLATFORM'])).optional().default(['DATE', 'COUNTRY', 'FORMAT']).describe('admob_api 报表维度'),
      },
      annotations: READ,
    },
    async (args) => {
      try {
        if (args.platformId !== 'admob') {
          throw new AppError('UNSUPPORTED_COMBINATION', `get_ad_revenue 目前仅支持 admob（收到: ${args.platformId}）`);
        }
        const kb = loadKnowledge();
        const platform = kb.getPlatform('admob');

        let rows: RevenueRow[];
        let currencyNote: string | undefined;
        if (args.source === 'file') {
          if (!args.filePath) {
            throw new AppError('INVALID_INPUT', 'source=file 需要 filePath（AdMob 后台 Reports 导出的 CSV 或 JSON）');
          }
          rows = importRevenueRows({ filePath: args.filePath, startDate: args.startDate, endDate: args.endDate });
        } else {
          const adapter = getAdapter(kb, 'admob');
          if (!adapter.fetchRevenue) throw new AppError('UNSUPPORTED_COMBINATION', 'admob 适配器未实现 fetchRevenue');
          const result = await adapter.fetchRevenue({
            publisherId: args.publisherId,
            startDate: args.startDate,
            endDate: args.endDate,
            dimensions: args.dimensions,
          });
          rows = result.rows;
          currencyNote = result.currency;
        }

        const totalEarnings = rows.reduce((sum, r) => sum + (r.earnings ?? 0), 0);
        const currencies = new Set(rows.map((r) => r.currency).filter((c): c is string => Boolean(c)));
        const currency = currencyNote ?? [...currencies][0] ?? 'USD';
        return ok({
          summary: `读取 ${rows.length} 行收益数据（${args.source}），合计 ${totalEarnings.toFixed(2)} ${currency}`,
          data: {
            source: args.source,
            startDate: args.startDate,
            endDate: args.endDate,
            dimensions: args.dimensions,
            currency,
            rowCount: rows.length,
            totalEarnings: Math.round(totalEarnings * 1e6) / 1e6,
            rows,
          },
          warnings: rows.length === 0 ? ['没有命中的数据行（检查日期范围与文件内容）'] : [],
          sources: platform.reporting.url ? toSourceRefs(platform.sources, platform.reviewIntervalDays, new Date()) : [],
          nextSteps: ['把 rows 传给 analyze_ad_performance 做指标与洞察分析'],
        });
      } catch (err) {
        return fail(toToolError(err).error);
      }
    },
  );
}
