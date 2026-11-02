import type { RevenueRow } from './types.js';

export type GroupByField = 'format' | 'country' | 'adUnit' | 'date' | 'platform';

export interface MetricsSummary {
  requests: number;
  matchedRequests: number;
  impressions: number;
  clicks: number;
  earnings: number;
  ecpm: number | null; // earnings / impressions * 1000
  matchRate: number | null; // matchedRequests / requests
  showRate: number | null; // impressions / matchedRequests
  ctr: number | null; // clicks / impressions
}

export interface MetricsGroup {
  groupBy: GroupByField;
  key: string;
  rowCount: number;
  metrics: MetricsSummary;
}

export interface MetricsResult {
  groupBy: GroupByField[];
  groups: MetricsGroup[];
  overall: MetricsSummary;
  rowCount: number;
}

const round4 = (value: number): number => Math.round(value * 10_000) / 10_000;

const EMPTY: MetricsSummary = {
  requests: 0,
  matchedRequests: 0,
  impressions: 0,
  clicks: 0,
  earnings: 0,
  ecpm: null,
  matchRate: null,
  showRate: null,
  ctr: null,
};

function summarize(rows: RevenueRow[]): MetricsSummary {
  const sums = { ...EMPTY };
  for (const row of rows) {
    sums.requests += row.requests ?? 0;
    sums.matchedRequests += row.matchedRequests ?? 0;
    sums.impressions += row.impressions ?? 0;
    sums.clicks += row.clicks ?? 0;
    sums.earnings += row.earnings ?? 0;
  }
  sums.ecpm = sums.impressions > 0 ? round4((sums.earnings / sums.impressions) * 1000) : null;
  sums.matchRate = sums.requests > 0 ? round4(sums.matchedRequests / sums.requests) : null;
  sums.showRate = sums.matchedRequests > 0 ? round4(sums.impressions / sums.matchedRequests) : null;
  sums.ctr = sums.impressions > 0 ? round4(sums.clicks / sums.impressions) : null;
  return sums;
}

/** 按维度分组汇总并计算 eCPM / matchRate / showRate / CTR（分母为 0 或缺失时为 null）。 */
export function computeMetrics(rows: RevenueRow[], groupBy: GroupByField[] = ['format', 'country']): MetricsResult {
  const groups: MetricsGroup[] = [];
  for (const field of groupBy) {
    const buckets = new Map<string, RevenueRow[]>();
    for (const row of rows) {
      const raw = row[field];
      const key = raw === undefined || raw === '' || raw === null ? '(unknown)' : String(raw);
      const bucket = buckets.get(key);
      if (bucket) bucket.push(row);
      else buckets.set(key, [row]);
    }
    for (const [key, bucket] of [...buckets.entries()].sort((a, b) => b[1].length - a[1].length)) {
      groups.push({ groupBy: field, key, rowCount: bucket.length, metrics: summarize(bucket) });
    }
  }
  return { groupBy, groups, overall: summarize(rows), rowCount: rows.length };
}
