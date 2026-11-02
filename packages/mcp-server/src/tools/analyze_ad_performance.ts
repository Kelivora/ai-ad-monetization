import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { READ } from '../lib/annotations.js';
import { fail, ok } from '../lib/envelope.js';
import { toToolError, AppError } from '../lib/errors.js';
import { loadKnowledge } from '../knowledge/loader.js';
import { importRevenueRows } from '../core/revenue/import.js';
import { computeMetrics, type GroupByField } from '../core/revenue/metrics.js';
import { buildInsights } from '../core/revenue/insights.js';
import type { RevenueRow } from '../core/revenue/types.js';

const GROUP_BY = ['format', 'country', 'adUnit', 'date', 'platform'] as const;

export function register(server: McpServer): void {
  server.registerTool(
    'analyze_ad_performance',
    {
      title: '分析广告收益表现',
      description:
        '对归一化收益行计算 eCPM、填充率（match rate）、展示率（show rate）、CTR，按维度分组与总体汇总；并按 benchmarks.json 的启发式阈值给出洞察与建议（标注 heuristic，不保证收益，建议均符合 AdMob 政策）。',
      inputSchema: {
        rows: z.array(z.record(z.string(), z.unknown())).optional().describe('RevenueRow[]（与 filePath 二选一）'),
        filePath: z.string().optional().describe('收益文件路径 CSV/JSON（与 rows 二选一）'),
        groupBy: z.array(z.enum(GROUP_BY)).optional().default(['format', 'country']).describe('分组维度，默认 [format, country]'),
      },
      annotations: READ,
    },
    async (args) => {
      try {
        if ((args.rows ? 1 : 0) + (args.filePath ? 1 : 0) !== 1) {
          throw new AppError('INVALID_INPUT', 'rows 与 filePath 必须二选一（恰好提供一个）');
        }
        const rows: RevenueRow[] = args.rows
          ? (args.rows as unknown as RevenueRow[])
          : importRevenueRows({ filePath: args.filePath! });

        const metrics = computeMetrics(rows, args.groupBy as GroupByField[]);
        const kb = loadKnowledge();
        const insights = buildInsights(kb, metrics);

        const fmt = (v: number | null) => (v === null ? '—' : v.toFixed(4));
        return ok({
          summary: `${rows.length} 行数据，总体 eCPM ${fmt(metrics.overall.ecpm)} / matchRate ${fmt(metrics.overall.matchRate)} / showRate ${fmt(metrics.overall.showRate)} / CTR ${fmt(metrics.overall.ctr)}；${insights.length} 条启发式洞察`,
          data: {
            groupBy: metrics.groupBy,
            overall: metrics.overall,
            groups: metrics.groups,
            insights,
            heuristicNote: '以上指标洞察均基于启发式经验阈值（knowledge/common/benchmarks.json），不保证收益效果。',
          },
          warnings: insights.filter((i) => i.severity === 'warning').map((i) => `${i.group ? `${i.group}: ` : ''}${i.message}`),
          sources: [],
          nextSteps: insights.slice(0, 5).map((i) => i.suggestion),
        });
      } catch (err) {
        return fail(toToolError(err).error);
      }
    },
  );
}
