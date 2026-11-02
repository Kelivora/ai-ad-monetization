import { z } from 'zod';
import type { GuideInput, IntegrationGuide, PlatformAdapter, SupportInfo } from '../types.js';
import type { KnowledgeBase } from '../../knowledge/loader.js';
import type { AdFormat, Framework, OfficialSkillRef } from '../../knowledge/schema.js';
import { toSourceRefs } from '../../knowledge/freshness.js';
import { AppError } from '../../lib/errors.js';

/** Unity LevelPlay 适配器：knowledge-only；Unity 引擎项目委派官方 Skill。 */
export class UnityLevelPlayAdapter implements PlatformAdapter {
  readonly id = 'unity-levelplay' as const;
  readonly displayName: string;
  readonly optionsSchema = z.object({});

  constructor(private readonly kb: KnowledgeBase) {
    this.displayName = kb.getPlatform('unity-levelplay').displayName;
  }

  supportFor(framework: Framework): SupportInfo {
    const support = this.kb.getPlatform('unity-levelplay').frameworks[framework];
    return { level: support.support, ...(support.officialSkill ? { officialSkill: support.officialSkill } : {}), ...(support.note ? { note: support.note } : {}) };
  }

  formats(framework: Framework): AdFormat[] {
    void framework;
    return this.kb.getPlatform('unity-levelplay').formats;
  }

  getIntegrationGuide(input: GuideInput): IntegrationGuide {
    const platform = this.kb.getPlatform('unity-levelplay');
    const support = platform.frameworks[input.framework];
    const sources = toSourceRefs(platform.sources, platform.reviewIntervalDays, new Date());

    if (input.framework === 'unity' && support.officialSkill) {
      const skill = support.officialSkill as OfficialSkillRef;
      return {
        strategy: 'delegate-official-skill',
        officialSkill: skill,
        prerequisites: [
          `安装官方 Skill: ${skill.install}`,
          'LevelPlay Unity 包/SDK >= 9.4.0（官方 Skill 要求）',
        ],
        steps: [
          { id: 'install-skill', title: '安装并使用官方 Skill', detail: `运行 ${skill.install}，按官方流程接入（${skill.docsUrl}）`, manual: true },
          { id: 'compare', title: '平台选型对比', detail: '仍可用我们的知识库做平台对比与合规清单', tool: 'compare_ad_platforms', manual: false },
          { id: 'placements', title: '广告位规划', detail: '基于启发式规则规划广告位', tool: 'plan_ad_placements', manual: false },
          { id: 'revenue', title: '收益分析', detail: '接入后可用导出报表做收益分析', tool: 'get_ad_revenue', manual: false },
        ],
        sources,
      };
    }

    if (support.support === 'unsupported') {
      throw new AppError('UNSUPPORTED_COMBINATION', `Unity LevelPlay 不支持 ${input.framework}`);
    }

    return {
      strategy: support.support,
      prerequisites: ['LevelPlay 控制台账号与应用配置（人工完成）', 'MVP 不自动接入 LevelPlay'],
      steps: [
        { id: 'compare', title: '平台对比', detail: '与 AdMob/MAX 按支持级别、格式、聚合能力对比', tool: 'compare_ad_platforms', manual: false },
        { id: 'placements', title: '广告位规划', detail: '基于启发式规则规划广告位', tool: 'plan_ad_placements', manual: false },
        {
          id: 'manual',
          title: '按官方文档手动接入',
          detail: `接入 ${support.package ?? 'LevelPlay SDK'}（${platform.reporting.consoleUrl ?? 'https://platform.ironsrc.com/'}）`,
          manual: true,
        },
      ],
      sources,
    };
  }
}
