import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { READ } from '../lib/annotations.js';
import { fail, ok } from '../lib/envelope.js';
import { toToolError } from '../lib/errors.js';
import { PLATFORM_IDS, type PlatformId } from '../knowledge/schema.js';
import { loadKnowledge } from '../knowledge/loader.js';
import { comparePlatforms } from '../core/selection/compare.js';
import { toSourceRefs } from '../knowledge/freshness.js';

export function register(server: McpServer): void {
  server.registerTool(
    'compare_ad_platforms',
    {
      title: '对比广告平台',
      description: '按框架与市场对比多个广告平台：支持级别、插件/包名、格式、network/mediation、报表 API、官方 Skill、编辑评分与市场适配。',
      inputSchema: {
        platformIds: z.array(z.enum(PLATFORM_IDS)).min(2).describe('要对比的平台 id 列表'),
        framework: z.enum(['flutter', 'android', 'ios', 'react-native', 'unity']),
        markets: z.array(z.string()).optional().describe('市场 id 或别名'),
      },
      annotations: READ,
    },
    async (args) => {
      try {
        const kb = loadKnowledge();
        const now = new Date();
        const markets = (args.markets ?? []).map((m) => {
          try {
            return kb.resolveMarket(m);
          } catch {
            return m;
          }
        });
        const result = comparePlatforms(kb, args.platformIds as PlatformId[], args.framework, markets, now);
        const sources = args.platformIds.flatMap((id) => {
          const p = kb.getPlatform(id as PlatformId);
          return toSourceRefs(p.sources, p.reviewIntervalDays, now);
        });
        return ok({
          summary: `${args.platformIds.join(' vs ')}（${args.framework}）`,
          data: result,
          warnings: ['对比中的 editorial 评分与 marketFit 来自编辑评估，不是官方数据'],
          sources,
          nextSteps: ['用 recommend_ad_platform 获取针对你应用的排序推荐'],
        });
      } catch (err) {
        return fail(toToolError(err).error);
      }
    },
  );
}
