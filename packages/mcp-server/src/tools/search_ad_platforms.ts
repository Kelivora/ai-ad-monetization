import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { READ } from '../lib/annotations.js';
import { fail, ok } from '../lib/envelope.js';
import { toToolError } from '../lib/errors.js';
import { loadKnowledge } from '../knowledge/loader.js';
import { searchPlatforms } from '../core/selection/search.js';

export function register(server: McpServer): void {
  server.registerTool(
    'search_ad_platforms',
    {
      title: '搜索广告平台',
      description: '按关键词/框架/广告格式/市场过滤知识库中的广告平台，返回各平台在该框架下的支持级别。',
      inputSchema: {
        query: z.string().optional().describe('匹配平台 id / displayName / vendor 的关键词'),
        framework: z.enum(['flutter', 'android', 'ios', 'react-native', 'unity']).optional(),
        format: z
          .enum(['banner', 'interstitial', 'rewarded', 'rewarded_interstitial', 'native', 'app_open'])
          .optional(),
        market: z.string().optional().describe('市场 id 或别名（US/EU/JP…）'),
      },
      annotations: READ,
    },
    async (args) => {
      try {
        const kb = loadKnowledge();
        const results = searchPlatforms(kb, args);
        return ok({
          summary: `匹配 ${results.length} 个广告平台`,
          data: { results },
          nextSteps: results.length > 0 ? ['用 compare_ad_platforms 对比候选平台', '用 recommend_ad_platform 获取排序推荐'] : [],
        });
      } catch (err) {
        return fail(toToolError(err).error);
      }
    },
  );
}
