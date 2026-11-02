/** 归一化收益行（get_ad_revenue 与 analyze_ad_performance 的公共货币单位行）。 */
export interface RevenueRow {
  date?: string | undefined; // YYYY-MM-DD
  country?: string | undefined; // ISO 国家码（US/DE/GB…）
  format?: string | undefined; // banner/interstitial/rewarded…（统一小写）
  adUnit?: string | undefined;
  app?: string | undefined;
  platform?: string | undefined;
  requests?: number | undefined;
  matchedRequests?: number | undefined;
  impressions?: number | undefined;
  clicks?: number | undefined;
  earnings?: number | undefined; // 数值，货币见 currency
  currency?: string | undefined; // ISO 货币码（USD…）
}
