import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { READ } from '../lib/annotations.js';
import { fail, ok } from '../lib/envelope.js';
import { toToolError } from '../lib/errors.js';
import { PLATFORM_IDS } from '../knowledge/schema.js';
import { validateAdConfig } from '../core/validation/engine.js';

export function register(server: McpServer): void {
  server.registerTool(
    'validate_ad_config',
    {
      title: '校验广告配置',
      description:
        '按 architecture.md 3.5 规则集校验 Flutter 工程的广告配置与代码（插件、App ID、测试 ID、同意流程、资源释放等）。development 口径下测试 ID 为 pass；release 口径下为 fail。输出 findings 与汇总计数。',
      inputSchema: {
        projectPath: z.string().describe('工程根目录'),
        platformId: z.enum(PLATFORM_IDS).optional().default('admob').describe('广告平台'),
        profile: z.enum(['development', 'release']).optional().default('development').describe('校验口径：release 下测试 ID 会判为 fail'),
        markets: z.array(z.string()).optional().describe('目标市场（如 US、EEA、UK、CH；EU 会归一化为 EEA）'),
        childDirected: z.boolean().optional().default(false).describe('应用是否面向儿童（COPPA）'),
      },
      annotations: READ,
    },
    async (args) => {
      try {
        const output = await validateAdConfig({
          projectPath: args.projectPath,
          platformId: args.platformId,
          profile: args.profile,
          markets: args.markets,
          childDirected: args.childDirected,
        });
        const failed = output.findings.filter((f) => f.status === 'fail');
        const summaryText = `overall=${output.overall}（pass ${output.summary.pass} / warning ${output.summary.warning} / fail ${output.summary.fail} / na ${output.summary.na}）`;
        const nextSteps = failed.slice(0, 5).map((f) => `${f.ruleId}: ${f.fix ?? f.message}`);
        if (output.overall !== 'fail') nextSteps.push('用 verify_ad_integration 做构建级验证');
        return ok({
          summary: `${args.platformId} × flutter 配置校验: ${summaryText}`,
          data: { ...output, platformId: args.platformId, profile: args.profile, markets: args.markets ?? [] },
          warnings: output.findings.filter((f) => f.status === 'warning').map((f) => `[${f.ruleId}] ${f.message}`),
          sources: [],
          nextSteps,
        });
      } catch (err) {
        return fail(toToolError(err).error);
      }
    },
  );
}
