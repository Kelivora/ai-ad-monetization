import { z } from 'zod';
import type { GuideInput, IntegrationGuide, PlatformAdapter, SupportInfo } from '../types.js';
import type { KnowledgeBase } from '../../knowledge/loader.js';
import type { AdFormat, Framework } from '../../knowledge/schema.js';
import { toSourceRefs } from '../../knowledge/freshness.js';

/** AppLovin MAX 适配器：knowledge-only，MVP 不做自动接入。 */
export class AppLovinMaxAdapter implements PlatformAdapter {
  readonly id = 'applovin-max' as const;
  readonly displayName: string;
  readonly optionsSchema = z.object({});

  constructor(private readonly kb: KnowledgeBase) {
    this.displayName = kb.getPlatform('applovin-max').displayName;
  }

  supportFor(framework: Framework): SupportInfo {
    const support = this.kb.getPlatform('applovin-max').frameworks[framework];
    return { level: support.support, ...(support.officialSkill ? { officialSkill: support.officialSkill } : {}), ...(support.note ? { note: support.note } : {}) };
  }

  formats(framework: Framework): AdFormat[] {
    void framework;
    return this.kb.getPlatform('applovin-max').formats;
  }

  getIntegrationGuide(input: GuideInput): IntegrationGuide {
    const platform = this.kb.getPlatform('applovin-max');
    const support = platform.frameworks[input.framework];
    return {
      strategy: support.support,
      prerequisites: [
        'AppLovin 后台账号与应用配置（人工完成）',
        'MVP 不自动接入 MAX：Flutter 只有社区插件（版本未核实）',
      ],
      steps: [
        { id: 'compare', title: '平台对比', detail: '与 AdMob/LevelPlay 按支持级别、格式、聚合能力对比', tool: 'compare_ad_platforms', manual: false },
        { id: 'placements', title: '广告位规划', detail: '基于启发式规则规划广告位', tool: 'plan_ad_placements', manual: false },
        {
          id: 'manual',
          title: '按官方文档手动接入',
          detail: `接入 ${support.package ?? 'AppLovin MAX SDK'}（${platform.reporting.url ?? 'https://developers.applovin.com/'}）；后台配置广告单元与聚合网络均需人工完成`,
          manual: true,
        },
      ],
      sources: toSourceRefs(platform.sources, platform.reviewIntervalDays, new Date()),
    };
  }
}
