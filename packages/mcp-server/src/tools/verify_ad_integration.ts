import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { EXEC } from '../lib/annotations.js';
import { fail, ok } from '../lib/envelope.js';
import { toToolError } from '../lib/errors.js';
import { verifyAdIntegration } from '../core/verify/run.js';

export function register(server: McpServer): void {
  server.registerTool(
    'verify_ad_integration',
    {
      title: '三级验证广告集成',
      description:
        'static 跑静态校验规则；build 执行 flutter pub get / analyze / build apk / build ios（缺工具链则 skipped 并说明，绝不报告通过）；runtime 不给 devices 时返回人工核对清单，给 devices 时在指定设备上自动执行冷烟测试 integration_test/ads_smoke_test.dart 并解析逐项检查结果。结论分级返回，构建成功不代表广告能真实投放。',
      inputSchema: {
        projectPath: z.string().describe('工程根目录'),
        levels: z.array(z.enum(['static', 'build', 'runtime'])).optional().default(['static', 'build']).describe('要执行的验证级别子集，默认 [static, build]'),
        targets: z.array(z.enum(['android', 'ios'])).optional().describe('构建目标平台（默认按工程声明的 targets）'),
        markets: z.array(z.string()).optional().describe('目标市场（透传给 static 级校验）'),
        profile: z.enum(['development', 'release']).optional().default('development').describe('static 级校验口径'),
        timeoutSec: z.number().int().positive().optional().default(900).describe('build 级每条命令的超时秒数'),
        devices: z.array(z.string()).optional().describe('flutter 设备 id（flutter devices 查看）；提供且 levels 含 runtime 时自动执行冷烟测试'),
        showFullscreen: z.boolean().optional().describe('冷烟测试中展示激励全屏广告并等待 onReward 回调（需要人工关闭广告）'),
      },
      annotations: EXEC,
    },
    async (args) => {
      try {
        const result = await verifyAdIntegration({
          projectPath: args.projectPath,
          levels: args.levels,
          targets: args.targets,
          markets: args.markets,
          profile: args.profile,
          timeoutSec: args.timeoutSec,
          devices: args.devices,
          showFullscreen: args.showFullscreen,
        });
        const { levels, verdict, statement, warnings, nextSteps } = result;
        const parts: string[] = [];
        if (verdict.static !== 'not_requested') parts.push(`static=${verdict.static}`);
        if (verdict.build !== 'not_requested') parts.push(`build=${verdict.build}`);
        if (verdict.runtime !== 'not_requested') parts.push(`runtime=${verdict.runtime}`);
        return ok({
          summary: `三级验证: ${parts.join(' ')}；${statement}`,
          data: { levels, verdict, statement },
          warnings,
          sources: [],
          nextSteps,
        });
      } catch (err) {
        return fail(toToolError(err).error);
      }
    },
  );
}
