import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { READ } from '../lib/annotations.js';
import { fail, ok } from '../lib/envelope.js';
import { toToolError } from '../lib/errors.js';
import { loadKnowledge } from '../knowledge/loader.js';
import { getAdapter } from '../adapters/registry.js';
import type { AdFormat, Framework, PlatformId } from '../knowledge/schema.js';

export function register(server: McpServer): void {
  server.registerTool(
    'get_integration_guide',
    {
      title: '获取接入指南',
      description: '按平台与框架给出有序接入步骤；strategy=delegate-official-skill 时返回官方 Skill 安装命令，guided/unsupported 如实说明。',
      inputSchema: {
        platformId: z.enum(['admob', 'applovin-max', 'unity-levelplay']),
        framework: z.enum(['flutter', 'android', 'ios', 'react-native', 'unity']),
        formats: z
          .array(z.enum(['banner', 'interstitial', 'rewarded', 'rewarded_interstitial', 'native', 'app_open']))
          .optional()
          .describe('要接入的广告格式'),
      },
      annotations: READ,
    },
    async (args) => {
      try {
        const kb = loadKnowledge();
        const adapter = getAdapter(kb, args.platformId as PlatformId);
        const guide = adapter.getIntegrationGuide({
          framework: args.framework as Framework,
          formats: (args.formats ?? []) as AdFormat[],
        });
        return ok({
          summary: `${adapter.displayName} × ${args.framework}: 策略 ${guide.strategy}`,
          data: guide,
          nextSteps:
            guide.strategy === 'automated'
              ? ['按 steps 顺序执行；写操作工具会先返回 plan 供确认']
              : guide.officialSkill
                ? [`安装官方 Skill: ${guide.officialSkill.install}`]
                : ['按引导式步骤手动接入'],
        });
      } catch (err) {
        return fail(toToolError(err).error);
      }
    },
  );
}
