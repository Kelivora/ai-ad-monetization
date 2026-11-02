import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { READ } from '../lib/annotations.js';
import { fail, ok } from '../lib/envelope.js';
import { toToolError } from '../lib/errors.js';
import { loadKnowledge } from '../knowledge/loader.js';
import { toSourceRefs } from '../knowledge/freshness.js';
import { recommendPlatforms, type Goal } from '../core/selection/recommend.js';
import type { AdFormat, Framework, PlatformId } from '../knowledge/schema.js';

export function register(server: McpServer): void {
  server.registerTool(
    'recommend_ad_platform',
    {
      title: '推荐广告平台',
      description: '基于知识库的支持级别、格式覆盖与编辑评估（editorial），对候选广告平台打分排序；评分来自编辑评估而非官方数据。',
      inputSchema: {
        framework: z.enum(['flutter', 'android', 'ios', 'react-native', 'unity']),
        targets: z.array(z.string()).optional().describe('目标平台（android/ios），保留字段'),
        markets: z.array(z.string()).describe('市场 id 或别名（US/EU/JP…）'),
        appCategory: z.string().describe('应用类别，如 game / news / utility'),
        goal: z.enum(['revenue', 'ux', 'balanced']),
        formats: z
          .array(z.enum(['banner', 'interstitial', 'rewarded', 'rewarded_interstitial', 'native', 'app_open']))
          .optional(),
        needMediation: z.boolean().optional().describe('是否需要聚合（mediation）能力'),
        existingSdks: z.array(z.string()).optional().describe('项目已安装的广告平台 id'),
      },
      annotations: READ,
    },
    async (args) => {
      try {
        const kb = loadKnowledge();
        const now = new Date();
        const result = recommendPlatforms(
          kb,
          {
            framework: args.framework as Framework,
            markets: args.markets,
            appCategory: args.appCategory,
            goal: args.goal as Goal,
            formats: args.formats as AdFormat[] | undefined,
            needMediation: args.needMediation,
            existingSdks: args.existingSdks,
          },
          now,
        );
        const sources = kb.index.platforms.flatMap((entry) => {
          const p = kb.getPlatform(entry.id);
          return toSourceRefs(p.sources, p.reviewIntervalDays, now);
        });
        const top = result.results[0];
        return ok({
          summary: top
            ? `推荐: ${top.displayName}（${top.supportLevel}，${top.score} 分）`
            : '没有可推荐的平台（全部被排除）',
          data: result,
          warnings: [result.editorialNote],
          sources,
          nextSteps: top
            ? [`用 get_sdk_compatibility 检查 ${top.platformId} 与你工程的兼容性`, '用 plan_ad_placements 规划广告位']
            : [],
        });
      } catch (err) {
        return fail(toToolError(err).error);
      }
    },
  );
}
