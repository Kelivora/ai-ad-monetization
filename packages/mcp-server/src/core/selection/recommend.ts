import type { SourceRef } from '../../lib/envelope.js';
import type { KnowledgeBase } from '../../knowledge/loader.js';
import type { AdFormat, Framework, PlatformFile, SupportLevel } from '../../knowledge/schema.js';
import { toSourceRefs } from '../../knowledge/freshness.js';

export type Goal = 'revenue' | 'ux' | 'balanced';

export interface RecommendInput {
  framework: Framework;
  markets: string[]; // resolveMarket 归一前的别名也接受
  appCategory: string;
  goal: Goal;
  formats?: AdFormat[] | undefined;
  needMediation?: boolean | undefined;
  existingSdks?: string[] | undefined;
}

export interface Recommendation {
  platformId: string;
  displayName: string;
  score: number; // 0-100
  supportLevel: SupportLevel;
  reasons: string[];
  cautions: string[];
}

export interface RecommendResult {
  formula: string;
  results: Recommendation[];
  excluded: Array<{ platformId: string; reason: string }>;
  assumptions: string[];
  editorialNote: string;
}

// 固定权重（architecture.md / 任务规格）
const WEIGHTS = {
  frameworkFit: 0.25,
  marketFit: 0.25,
  onboardingEase: 0.15,
  goalFit: 0.15,
  categoryFit: 0.1,
  formatCoverage: 0.1,
} as const;

// 非 Flutter 框架没有专属编辑分，用支持级别映射（在 assumptions 里说明）
const LEVEL_SCORE: Record<SupportLevel, number> = {
  automated: 5,
  'delegate-official-skill': 4,
  guided: 3,
  unsupported: 1,
};

export function recommendPlatforms(kb: KnowledgeBase, input: RecommendInput, now: Date): RecommendResult {
  const warnings: string[] = [];
  const assumptions: string[] = [];

  // 市场归一；未知市场用 global 并 warning
  const resolvedMarkets: string[] = [];
  for (const raw of input.markets) {
    try {
      resolvedMarkets.push(kb.resolveMarket(raw));
    } catch {
      warnings.push(`未知市场 "${raw}"，该市场按 global 评估`);
      resolvedMarkets.push('global');
    }
  }

  const results: Recommendation[] = [];
  const excluded: Array<{ platformId: string; reason: string }> = [];

  for (const entry of kb.index.platforms) {
    const platform = kb.getPlatform(entry.id);
    const support = platform.frameworks[input.framework];
    if (support.support === 'unsupported') {
      excluded.push({
        platformId: platform.id,
        reason: support.note ?? `该平台不支持 ${input.framework}`,
      });
      continue;
    }

    const scores = platform.editorial.selection.scores;
    const marketFit = platform.editorial.selection.marketFit;

    // 1. 框架适配
    const frameworkFit =
      input.framework === 'flutter' ? (scores['flutterSupport'] ?? 3) : LEVEL_SCORE[support.support];

    // 2. 市场平均
    const marketScores = resolvedMarkets.map((m) => marketFit[m] ?? marketFit['global'] ?? 3);
    const marketAvg = marketScores.reduce((a, b) => a + b, 0) / Math.max(marketScores.length, 1);

    // 3. 上手难度 / 4. 目标相关
    const onboarding = scores['onboardingEase'] ?? 3;
    const mediation = scores['mediation'] ?? 3;
    const goalFit =
      input.goal === 'revenue' ? mediation : input.goal === 'ux' ? onboarding : (mediation + onboarding) / 2;

    // 5. 类别适配
    const isGame = /game|gaming|游戏/i.test(input.appCategory);
    const categoryFit = isGame ? (scores['gamingFocus'] ?? 3) : (scores['nonGamingFit'] ?? 3);

    // 6. 格式覆盖
    let coverage = 1;
    if (input.formats && input.formats.length > 0) {
      const covered = input.formats.filter((f) => platform.formats.includes(f)).length;
      coverage = covered / input.formats.length;
    }

    const weighted =
      frameworkFit * WEIGHTS.frameworkFit +
      marketAvg * WEIGHTS.marketFit +
      onboarding * WEIGHTS.onboardingEase +
      goalFit * WEIGHTS.goalFit +
      categoryFit * WEIGHTS.categoryFit +
      coverage * 5 * WEIGHTS.formatCoverage;
    let score = Math.round((weighted / 5) * 100);
    const reasons: string[] = [];
    if (support.support === 'automated') {
      score = Math.min(score + 5, 100);
      reasons.push('可全自动接入');
    }

    const cautions: string[] = [];
    if (input.needMediation && platform.type === 'network') {
      cautions.push('该平台是广告网络（network）而非聚合（mediation），单一平台无法自动聚合多家广告源');
    }
    if (support.verified === false) {
      cautions.push('对应框架的插件/包版本未经核实（verified: false）');
    }
    if (resolvedMarkets.some((m) => (marketFit[m] ?? 5) <= 1)) {
      cautions.push('目标市场中该平台可用性差（编辑评估 marketFit ≤ 1）');
    }
    if (input.existingSdks?.includes(platform.id)) {
      reasons.push('项目已安装该平台 SDK，沿用可减少迁移成本');
    }

    results.push({
      platformId: platform.id,
      displayName: platform.displayName,
      score,
      supportLevel: support.support,
      reasons,
      cautions,
    });
  }

  if (input.framework !== 'flutter') {
    assumptions.push('非 Flutter 框架的"框架适配"分由支持级别映射（automated=5 / delegate-official-skill=4 / guided=3）');
  }
  if (!input.formats || input.formats.length === 0) {
    assumptions.push('未指定广告格式，formatCoverage 按全覆盖计');
  }
  if (input.markets.length === 0) {
    assumptions.push('未指定市场，marketFit 按 global 评估');
    warnings.push('未指定市场，marketFit 按 global 评估');
  }

  results.sort((a, b) => b.score - a.score || a.platformId.localeCompare(b.platformId));

  return {
    formula:
      'score = (框架适配×0.25 + marketFit均值×0.25 + onboardingEase×0.15 + 目标相关×0.15 + 类别适配×0.10 + formatCoverage×0.10) / 5 × 100，' +
      'supportLevel=automated 的平台额外 +5（上限 100）。目标相关：revenue→mediation，ux→onboardingEase，balanced→二者均值；' +
      '类别适配：game→gamingFocus，其他→nonGamingFit。',
    results,
    excluded,
    assumptions: [...assumptions, ...warnings.map((w) => w)],
    editorialNote: '评分来自编辑评估（editorial），不是官方数据',
  };
}

export function platformSources(platform: PlatformFile, now: Date): SourceRef[] {
  return toSourceRefs(platform.sources, platform.reviewIntervalDays, now);
}
