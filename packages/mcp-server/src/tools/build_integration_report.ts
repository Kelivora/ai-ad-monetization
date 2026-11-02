import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { READ } from '../lib/annotations.js';
import { fail, ok } from '../lib/envelope.js';
import { toToolError } from '../lib/errors.js';
import { buildIntegrationReport } from '../core/report/report.js';

export function register(server: McpServer): void {
  server.registerTool(
    'build_integration_report',
    {
      title: '生成集成报告（Markdown）',
      description:
        '把 analyze / recommend / plan / generate / validate / verify 各工具的结果拼成一份中文 Markdown 集成报告（9 个章节）。未提供的 analysis/validation 自动重算，verification 未提供写"未执行"。只返回文本，不写文件。',
      inputSchema: {
        projectPath: z.string().describe('工程根目录'),
        recommendation: z.unknown().optional().describe('recommend_ad_platform 的 data（宽松透传）'),
        placements: z.unknown().optional().describe('plan_ad_placements 的 data'),
        plan: z.unknown().optional().describe('generate_ad_integration 的 data.plan'),
        validation: z.unknown().optional().describe('validate_ad_config 的 data'),
        verification: z.unknown().optional().describe('verify_ad_integration 的 data'),
        markets: z.unknown().optional().describe('目标市场列表'),
        assumptions: z.unknown().optional().describe('要附注的假设/前提'),
      },
      annotations: READ,
    },
    async (args) => {
      try {
        const { markdown, integrationRecordFound } = await buildIntegrationReport({
          projectPath: args.projectPath,
          recommendation: args.recommendation,
          placements: args.placements,
          plan: args.plan,
          validation: args.validation,
          verification: args.verification,
          markets: args.markets,
          assumptions: args.assumptions,
        });
        const sections = (markdown.match(/^## /gm) ?? []).length;
        return ok({
          summary: `集成报告已生成（${sections} 个章节，${integrationRecordFound ? '含变更文件记录' : '未找到 .ai-ad-monetization/integration.json'}）`,
          data: { markdown, integrationRecordFound },
          warnings: integrationRecordFound ? [] : ['工程内没有 .ai-ad-monetization/integration.json，"变更文件"章节依赖传入的 plan 或为空'],
          sources: [],
          nextSteps: ['把报告展示给用户；是否写入文件由用户/Agent 决定（CLI 可用 report --out <file>）'],
        });
      } catch (err) {
        return fail(toToolError(err).error);
      }
    },
  );
}
