import { describe, expect, it } from 'vitest';
import { loadKnowledge } from '../src/knowledge/loader.js';
import { computeMetrics } from '../src/core/revenue/metrics.js';
import { buildInsights } from '../src/core/revenue/insights.js';
import type { RevenueRow } from '../src/core/revenue/types.js';

describe('metrics', () => {
  const rows: RevenueRow[] = [
    { date: '2026-10-01', format: 'banner', requests: 1000, matchedRequests: 800, impressions: 600, clicks: 6, earnings: 3 },
    { date: '2026-10-02', format: 'banner', requests: 1000, matchedRequests: 600, impressions: 300, clicks: 3, earnings: 1.5 },
  ];

  it('总体与分组指标：eCPM / matchRate / showRate / CTR', () => {
    const result = computeMetrics(rows, ['format']);
    expect(result.overall).toMatchObject({
      requests: 2000,
      matchedRequests: 1400,
      impressions: 900,
      clicks: 9,
      earnings: 4.5,
      ecpm: 5, // 4.5 / 900 * 1000
      matchRate: 0.7,
      showRate: 0.6429,
      ctr: 0.01,
    });
    const banner = result.groups.find((g) => g.key === 'banner')!;
    expect(banner.metrics.ecpm).toBe(5);
    expect(banner.metrics.matchRate).toBe(0.7);
  });

  it('分母为 0 或缺失 → null，不抛异常', () => {
    const sparse: RevenueRow[] = [
      { format: 'native', requests: 0, matchedRequests: 0, impressions: 0, clicks: 0, earnings: 0 },
      { format: 'app_open' },
    ];
    const result = computeMetrics(sparse, ['format']);
    expect(result.overall.ecpm).toBeNull();
    expect(result.overall.matchRate).toBeNull();
    expect(result.overall.showRate).toBeNull();
    expect(result.overall.ctr).toBeNull();
    expect(result.overall.earnings).toBe(0);
  });

  it('默认分组 [format, country]', () => {
    const rows2: RevenueRow[] = [
      { format: 'banner', country: 'US', earnings: 1 },
      { format: 'rewarded', country: 'DE', earnings: 2 },
    ];
    const result = computeMetrics(rows2);
    expect(result.groupBy).toEqual(['format', 'country']);
    expect(result.groups.filter((g) => g.groupBy === 'format')).toHaveLength(2);
    expect(result.groups.filter((g) => g.groupBy === 'country')).toHaveLength(2);
  });
});

describe('insights', () => {
  it('matchRate 低于阈值 → warning 且标注 heuristic', () => {
    const rows: RevenueRow[] = [
      { format: 'banner', requests: 1000, matchedRequests: 100, impressions: 90, clicks: 1, earnings: 0.5 },
    ];
    const metrics = computeMetrics(rows, ['format']);
    const insights = buildInsights(loadKnowledge(), metrics);
    const lowMatch = insights.find((i) => i.metric === 'matchRate' && i.group === 'format=banner');
    expect(lowMatch).toBeDefined();
    expect(lowMatch!.severity).toBe('warning');
    expect(lowMatch!.heuristic).toBe(true);
    expect(lowMatch!.group).toBe('format=banner');
    expect(lowMatch!.suggestion.length).toBeGreaterThan(0);
  });

  it('CTR 异常偏高 → warning（政策风险方向的建议）', () => {
    const rows: RevenueRow[] = [
      { format: 'interstitial', requests: 1000, matchedRequests: 900, impressions: 800, clicks: 200, earnings: 5 },
    ];
    const insights = buildInsights(loadKnowledge(), computeMetrics(rows, ['format']));
    const ctr = insights.find((i) => i.metric === 'ctr');
    expect(ctr?.severity).toBe('warning');
    expect(ctr?.suggestion).toContain('误点');
  });

  it('激励 eCPM 低于插屏 → ecpm 排序 insight', () => {
    const rows: RevenueRow[] = [
      { format: 'rewarded', impressions: 1000, clicks: 5, earnings: 5 }, // eCPM 5
      { format: 'interstitial', impressions: 1000, clicks: 5, earnings: 20 }, // eCPM 20
      { format: 'banner', impressions: 1000, clicks: 5, earnings: 2 }, // eCPM 2
    ];
    const insights = buildInsights(loadKnowledge(), computeMetrics(rows, ['format']));
    const ecpm = insights.find((i) => i.metric === 'ecpm' && i.group?.includes('rewarded'));
    expect(ecpm).toBeDefined();
    expect(ecpm!.heuristic).toBe(true);
  });

  it('所有 insights 都标注 heuristic 且 severity 只在 info|warning', () => {
    const rows: RevenueRow[] = [
      { format: 'banner', requests: 100, matchedRequests: 10, impressions: 5, clicks: 5, earnings: 0.1, country: 'US' },
    ];
    for (const insight of buildInsights(loadKnowledge(), computeMetrics(rows, ['format', 'country']))) {
      expect(insight.heuristic).toBe(true);
      expect(['info', 'warning']).toContain(insight.severity);
    }
  });
});
