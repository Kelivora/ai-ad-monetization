import type { BenchmarksFile } from '../../knowledge/schema.js';
import type { KnowledgeBase } from '../../knowledge/loader.js';
import type { MetricsResult } from './metrics.js';

export interface PerformanceInsight {
  severity: 'info' | 'warning';
  metric: string;
  group?: string | undefined; // 如 "format=banner" / "country=US"
  message: string;
  suggestion: string;
  heuristic: true;
}

/** 阈值建议映射（与 AdMob 政策不冲突的排查方向）。 */
const SUGGESTIONS: Record<string, string> = {
  'match-rate-low': '检查广告单元状态（是否新建未生效/未过审）；新单元等待数小时；受众过窄时可考虑接入聚合（mediation）。',
  'show-rate-low': '检查广告预加载时机（是否加载过早导致过期）；展示入口是否太少；缩短加载到展示的间隔并复用未过期缓存。',
  'ctr-abnormal': '检查广告位设计是否存在误点诱导（紧贴按钮/关闭即弹），按 AdMob 政策调整位置与频控。',
};

function groupLabel(groupBy: string, key: string): string {
  return `${groupBy}=${key}`;
}

/**
 * 用 knowledge/common/benchmarks.json 的启发式阈值产生洞察。
 * 所有建议均为启发式经验判断，不保证收益，也不得违反 AdMob 政策。
 */
export function buildInsights(kb: KnowledgeBase, metrics: MetricsResult): PerformanceInsight[] {
  const benchmarks: BenchmarksFile = kb.getBenchmarks();
  const insights: PerformanceInsight[] = [];
  const push = (insight: PerformanceInsight) => {
    if (insights.length >= 20) return;
    insights.push(insight);
  };

  const checkThreshold = (label: string, metric: string, summary: MetricsResult['overall']): void => {
    for (const threshold of benchmarks.thresholds) {
      if (threshold.metric !== metric) continue;
      const value = summary[metric as keyof typeof summary];
      if (typeof value !== 'number') continue;
      const triggered =
        threshold.direction === 'below' ? value < threshold.value : value > threshold.value;
      if (!triggered) continue;
      push({
        severity: threshold.severity === 'critical' ? 'warning' : threshold.severity,
        metric,
        group: label || undefined,
        message: `${label ? `${label}: ` : ''}${threshold.message}（当前值 ${value}，阈值 ${threshold.direction} ${threshold.value}）`,
        suggestion: SUGGESTIONS[threshold.id] ?? '对照 AdMob 报表指标定义排查该维度的配置。',
        heuristic: true,
      });
    }
  };

  // 1. 阈值检查：总体 + 每个分组
  checkThreshold('', 'matchRate', metrics.overall);
  checkThreshold('', 'showRate', metrics.overall);
  checkThreshold('', 'ctr', metrics.overall);
  for (const group of metrics.groups) {
    checkThreshold(groupLabel(group.groupBy, group.key), 'matchRate', group.metrics);
    checkThreshold(groupLabel(group.groupBy, group.key), 'showRate', group.metrics);
    checkThreshold(groupLabel(group.groupBy, group.key), 'ctr', group.metrics);
  }

  // 2. eCPM 排序启发式：rewarded ≥ interstitial ≥ banner
  const formatEcpm = new Map(
    metrics.groups
      .filter((g) => g.groupBy === 'format' && g.metrics.ecpm !== null)
      .map((g) => [g.key.toLowerCase(), g.metrics.ecpm as number]),
  );
  const expected = benchmarks.ecpmOrdering.expected; // [rewarded, interstitial, banner]
  for (let i = 0; i < expected.length - 1; i++) {
    const higher = formatEcpm.get(expected[i]!);
    const lower = formatEcpm.get(expected[i + 1]!);
    if (higher === undefined || lower === undefined) continue;
    if (higher < lower) {
      push({
        severity: 'info',
        metric: 'ecpm',
        group: `format=${expected[i]!} vs ${expected[i + 1]!}`,
        message: `${expected[i]!} 的 eCPM（${higher}）低于 ${expected[i + 1]!}（${lower}），违反经验排序（${expected.join(' ≥ ')}）。`,
        suggestion: '检查该格式的广告位设置（单元 ID、竞价）与奖励配置；确认两个格式面向相似受众与国家。',
        heuristic: true,
      });
    }
  }

  // 3. 收入集中但 eCPM 偏低的国家
  const countryGroups = metrics.groups.filter((g) => g.groupBy === 'country');
  const totalEarnings = metrics.overall.earnings;
  for (const group of countryGroups) {
    if (totalEarnings <= 0 || group.metrics.earnings <= 0) continue;
    const share = group.metrics.earnings / totalEarnings;
    const overallEcpm = metrics.overall.ecpm;
    if (share > 0.5 && overallEcpm !== null && group.metrics.ecpm !== null && group.metrics.ecpm < overallEcpm) {
      push({
        severity: 'info',
        metric: 'ecpm',
        group: groupLabel(group.groupBy, group.key),
        message: `${group.key} 贡献 ${(share * 100).toFixed(1)}% 的收入，但 eCPM（${group.metrics.ecpm}）低于整体（${overallEcpm}）。`,
        suggestion: '检查该国家的广告单元配置与竞价；确认 UMP 同意率没有拖累填充；不要用政策禁止的手段强行提升展示。',
        heuristic: true,
      });
      break; // 只报占比最高的一个（分组按行数排序，已覆盖主要国家）
    }
  }

  return insights;
}
