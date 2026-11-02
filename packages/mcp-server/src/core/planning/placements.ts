import type { SourceRef } from '../../lib/envelope.js';
import type { KnowledgeBase } from '../../knowledge/loader.js';
import type { AdFormat } from '../../knowledge/schema.js';
import { toSourceRefs } from '../../knowledge/freshness.js';
import type { Goal } from '../selection/recommend.js';

export interface ScreenInput {
  file?: string | undefined;
  widget?: string | undefined;
  scrollable?: boolean | undefined;
}

export interface PlacementInput {
  appCategory: string;
  goal: Goal;
  formats?: AdFormat[] | undefined;
  screens?: ScreenInput[] | undefined;
}

export interface Placement {
  id: string;
  format: AdFormat;
  location: string;
  bannerType?: 'inline-adaptive' | 'large-anchored-adaptive' | undefined;
  trigger: string;
  frequencyCapSeconds?: number | undefined;
  userInitiated?: boolean | undefined;
  rationale: string;
  heuristic: true;
}

export interface PlacementPlan {
  goal: Goal;
  policyLabel: string;
  formats: AdFormat[];
  placements: Placement[];
  assumptions: string[];
  heuristic: true;
}

export function planPlacements(kb: KnowledgeBase, input: PlacementInput): PlacementPlan {
  const rules = kb.getPlacementRules();
  const policy = rules.policies.find((p) => p.id === input.goal) ?? rules.policies.find((p) => p.id === 'balanced')!;
  const formats = input.formats && input.formats.length > 0 ? input.formats : (policy.formatPriority as AdFormat[]);
  const assumptions: string[] = [];

  const screens = input.screens && input.screens.length > 0 ? input.screens : undefined;
  if (!screens) {
    assumptions.push('未提供 screens，广告位使用通用占位位置（如 "main screen bottom"）；建议先用 analyze_project 获取真实屏幕列表');
  }

  const placements: Placement[] = [];
  let index = 0;
  const nextId = (format: string) => `${format}-${String(++index).padStart(2, '0')}`;

  for (const format of formats) {
    if (format === 'banner') {
      const targets = screens ?? [{ file: undefined, widget: undefined, scrollable: undefined }];
      for (const screen of targets) {
        const scrollable = screen.scrollable ?? false;
        const bannerType: Placement['bannerType'] = scrollable ? 'inline-adaptive' : 'large-anchored-adaptive';
        const rule = scrollable ? rules.banner.scrollable : rules.banner.nonScrollable;
        placements.push({
          id: nextId('banner'),
          format: 'banner',
          location: screen.widget ? `${screen.widget}${screen.file ? ` (${screen.file})` : ''}` : 'main screen bottom',
          bannerType,
          trigger: scrollable ? '随内容流加载展示' : '页面渲染时加载展示',
          rationale: rule.rationale,
          heuristic: true,
        });
      }
    } else if (format === 'interstitial') {
      placements.push({
        id: nextId('interstitial'),
        format: 'interstitial',
        location: screens?.[0]?.widget ?? '内容自然断点',
        trigger: `自然断点触发（${rules.interstitial.naturalBreakPoints.join(' / ')}）`,
        frequencyCapSeconds: policy.interstitialFrequencySeconds,
        rationale: rules.interstitial.rationale,
        heuristic: true,
      });
    } else if (format === 'rewarded' || format === 'rewarded_interstitial') {
      placements.push({
        id: nextId(format),
        format,
        location: screens?.[0]?.widget ?? '奖励入口（如解锁内容按钮）',
        trigger: '用户主动点击触发',
        userInitiated: true,
        rationale: rules.rewarded.rationale,
        heuristic: true,
      });
    } else {
      placements.push({
        id: nextId(format),
        format,
        location: screens?.[0]?.widget ?? '主界面',
        trigger: '按平台策略展示',
        rationale: '其余格式 MVP 仅提供占位建议，具体位置以平台政策为准',
        heuristic: true,
      });
    }
  }

  return {
    goal: input.goal,
    policyLabel: policy.label,
    formats,
    placements,
    assumptions,
    heuristic: true,
  };
}

export function placementRulesSources(kb: KnowledgeBase, now: Date): SourceRef[] {
  const rules = kb.getPlacementRules();
  return toSourceRefs(rules.sources, rules.reviewIntervalDays, now);
}
