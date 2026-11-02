import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { WRITE, REQUIRES_INTERACTION_META } from '../lib/annotations.js';
import { fail, ok } from '../lib/envelope.js';
import { toToolError } from '../lib/errors.js';
import { PLATFORM_IDS } from '../knowledge/schema.js';
import { generateIntegration } from '../core/integration/generate.js';

export function register(server: McpServer): void {
  server.registerTool(
    'generate_ad_integration',
    {
      title: '生成广告集成（plan/apply）',
      description:
        '为 Flutter 工程生成 AdMob 自动接入计划（pubspec / AndroidManifest / Info.plist / lib/ads/* 代码）。默认 mode=plan 只返回 diff 与 planHash 不落盘；mode=apply 必须携带 confirm: true 与 expectedPlanHash，哈希不一致或工作区不干净会拒绝写入。写入前备份到 .ai-ad-monetization/backups/。',
      inputSchema: {
        projectPath: z.string().describe('工程根目录'),
        platformId: z.enum(PLATFORM_IDS).optional().default('admob').describe('广告平台（MVP 仅 admob 支持 automated）'),
        formats: z.array(z.enum(['banner', 'interstitial', 'rewarded'])).min(1).describe('要接入的广告格式（MVP 子集）'),
        mode: z.enum(['plan', 'apply']).optional().default('plan').describe('plan 只返回计划；apply 落盘写入'),
        confirm: z.boolean().optional().describe('apply 模式必须为 true（用户已确认 diff）'),
        expectedPlanHash: z.string().optional().describe('apply 模式必填：plan 模式返回的 planHash'),
        allowDirty: z.boolean().optional().describe('允许计划涉及的 git 文件有未提交改动'),
        wireMain: z.boolean().optional().default(true).describe('是否改写 main.dart 接线初始化（已有广告初始化代码时自动关闭）'),
        childDirected: z.boolean().optional().default(false).describe('面向儿童：生成的初始化会设置 tagForChildDirectedTreatment'),
        platformOptions: z.record(z.string(), z.unknown()).optional().describe('平台专属参数（AdMob: useNextGenSdk, interstitialMinIntervalSeconds）'),
      },
      annotations: WRITE,
      _meta: REQUIRES_INTERACTION_META,
    },
    async (args) => {
      try {
        const result = await generateIntegration({
          projectPath: args.projectPath,
          platformId: args.platformId,
          formats: args.formats,
          mode: args.mode,
          confirm: args.confirm,
          expectedPlanHash: args.expectedPlanHash,
          allowDirty: args.allowDirty,
          wireMain: args.wireMain,
          childDirected: args.childDirected,
          platformOptions: args.platformOptions,
        });
        const { plan, applied } = result;
        const warnings = [...result.warnings];
        for (const path of result.truncated) warnings.push(`${path} 内容超过 4000 字符，plan 输出中已截断`);

        if (!applied) {
          return ok({
            summary: `${plan.platform} × ${plan.framework} 集成计划：${plan.changes.filter((c) => c.action === 'modify').length} 修改 / ${plan.changes.filter((c) => c.action === 'create').length} 新建 / ${plan.changes.filter((c) => c.action === 'skip').length} 跳过；planHash=${plan.planHash}`,
            data: { plan },
            warnings,
            nextSteps: [
              '把 diff 与手动步骤展示给用户确认',
              `确认后以 mode=apply + expectedPlanHash=${plan.planHash} + confirm=true 写入`,
            ],
          });
        }

        return ok({
          summary: `已写入 ${applied.changedFiles.length} 个文件（新建 ${applied.createdFiles.length} / 修改 ${applied.modifiedFiles.length}，跳过 ${applied.skippedFiles.length}）；备份: ${applied.backupDir}`,
          data: { plan, applied },
          warnings,
          nextSteps: [
            'flutter pub get',
            'validate_ad_config（markets 与 profile 按需）',
            'verify_ad_integration(levels=[static, build])',
            ...plan.manualSteps,
          ],
        });
      } catch (err) {
        return fail(toToolError(err).error);
      }
    },
  );
}
