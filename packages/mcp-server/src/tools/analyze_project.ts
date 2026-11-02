import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { READ } from '../lib/annotations.js';
import { fail, ok } from '../lib/envelope.js';
import { toToolError } from '../lib/errors.js';
import { analyzeProject } from '../core/project/analyze.js';

export function register(server: McpServer): void {
  server.registerTool(
    'analyze_project',
    {
      title: '分析工程',
      description: '探测项目框架（RN/Flutter/Unity/原生 Android/iOS）、平台目标、标识符、已有广告 SDK 与代码、屏幕列表、git 状态与本地工具链。',
      inputSchema: {
        projectPath: z.string().describe('工程根目录'),
        detectToolchain: z.boolean().optional().default(true).describe('是否检测本机工具链（flutter/xcodebuild/java），测试可关闭提速'),
      },
      annotations: READ,
    },
    async (args) => {
      try {
        const analysis = await analyzeProject(args.projectPath, {
          skipToolchain: args.detectToolchain === false,
        });
        const summaryParts = [
          `框架: ${analysis.framework}`,
          `目标: ${[
            analysis.targets.android ? 'android' : null,
            analysis.targets.ios ? 'ios' : null,
            analysis.targets.web ? 'web' : null,
            analysis.targets.desktop ? 'desktop' : null,
          ]
            .filter(Boolean)
            .join('+') || '未知'}`,
          `已有广告 SDK: ${analysis.existingAdSdks.length} 个`,
          `git: ${analysis.git.isRepo ? (analysis.git.dirtyFiles.length > 0 ? `${analysis.git.dirtyFiles.length} 个未提交改动` : '干净') : '非 git 仓库'}`,
        ];
        const nextSteps: string[] = [];
        if (analysis.framework === 'flutter') {
          nextSteps.push('用 recommend_ad_platform 选择平台', '用 get_sdk_compatibility(projectPath) 做兼容性对比');
        } else if (analysis.framework !== 'unknown') {
          nextSteps.push('用 get_integration_guide 查看该框架的接入策略（可能委派官方 Skill）');
        }
        return ok({
          summary: summaryParts.join('；'),
          data: analysis,
          warnings: analysis.issues,
          nextSteps,
        });
      } catch (err) {
        return fail(toToolError(err).error);
      }
    },
  );
}
