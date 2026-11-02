import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { READ } from '../lib/annotations.js';
import { fail, ok } from '../lib/envelope.js';
import { toToolError } from '../lib/errors.js';
import { loadKnowledge } from '../knowledge/loader.js';
import { placementRulesSources, planPlacements } from '../core/planning/placements.js';
import type { AdFormat } from '../knowledge/schema.js';

export function register(server: McpServer): void {
  server.registerTool(
    'plan_ad_placements',
    {
      title: '规划广告位',
      description: '基于启发式规则（knowledge/common/placement-rules.json，editorial）规划广告位：格式、位置、触发时机、频控、Banner 类型（anchored/inline）。',
      inputSchema: {
        appCategory: z.string().describe('应用类别，如 game / news / utility'),
        goal: z.enum(['revenue', 'ux', 'balanced']).describe('优化目标'),
        formats: z
          .array(z.enum(['banner', 'interstitial', 'rewarded', 'rewarded_interstitial', 'native', 'app_open']))
          .optional()
          .describe('不传则按 goal 策略的格式优先级'),
        screens: z
          .array(
            z.object({
              file: z.string().optional(),
              widget: z.string().optional(),
              scrollable: z.boolean().optional(),
            }),
          )
          .optional()
          .describe('屏幕列表（可来自 analyze_project 的 screens）'),
      },
      annotations: READ,
    },
    async (args) => {
      try {
        const kb = loadKnowledge();
        const plan = planPlacements(kb, {
          appCategory: args.appCategory,
          goal: args.goal,
          formats: args.formats as AdFormat[] | undefined,
          screens: args.screens,
        });
        return ok({
          summary: `按 ${plan.policyLabel}（${args.goal}）规划了 ${plan.placements.length} 个广告位（启发式）`,
          data: plan,
          warnings: [
            '广告位方案为启发式（heuristic/editorial）建议，需结合产品形态人工确认',
            ...plan.assumptions,
          ],
          sources: placementRulesSources(kb, new Date()),
          nextSteps: ['把方案展示给用户确认', '用 get_integration_guide / generate_ad_integration 进入接入流程'],
        });
      } catch (err) {
        return fail(toToolError(err).error);
      }
    },
  );
}
