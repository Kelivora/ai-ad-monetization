import { AppError } from '../../lib/errors.js';
import type { RevenueRow } from '../../core/revenue/types.js';

/**
 * AdMob API 收益报表（admob.report v1 networkReport:generate）。
 * 只读取用户自行获取的环境变量 ADMOB_ACCESS_TOKEN（scope:
 * https://www.googleapis.com/auth/admob.readonly）；绝不记录或返回令牌。
 */

export const ADMOB_TOKEN_ENV = 'ADMOB_ACCESS_TOKEN';
const API_BASE = 'https://admob.googleapis.com/v1/accounts';
export const ADMOB_DIMENSIONS = ['DATE', 'COUNTRY', 'FORMAT', 'AD_UNIT', 'APP', 'PLATFORM'] as const;
export type AdMobDimension = (typeof ADMOB_DIMENSIONS)[number];

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export interface AdMobApiInput {
  publisherId: string; // pub-xxxxxxxxxxxxxxxx
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  dimensions?: AdMobDimension[] | undefined; // 默认 [DATE, COUNTRY, FORMAT]
  fetchImpl?: FetchLike | undefined; // 测试注入
  env?: NodeJS.ProcessEnv | undefined; // 测试注入
}

export interface AdMobApiResult {
  rows: RevenueRow[];
  currency: string;
  matchingRowCount: number;
}

interface ApiMetricValue {
  integerValue?: string | undefined;
  microsValue?: string | undefined;
  doubleValue?: number | undefined;
}

interface ApiReportRow {
  row?: {
    dimensionValues?: Record<string, { value?: string | undefined }> | undefined;
    metricValues?: Record<string, ApiMetricValue | undefined> | undefined;
  } | undefined;
}

function toDateStr(value: string): string {
  if (/^\d{8}$/.test(value)) return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  return value;
}

function metricNumber(value: ApiMetricValue | undefined): number | undefined {
  if (!value) return undefined;
  if (value.integerValue !== undefined) return Number(value.integerValue);
  if (value.microsValue !== undefined) return Number(value.microsValue) / 1_000_000;
  if (value.doubleValue !== undefined) return value.doubleValue;
  return undefined;
}

function splitDate(date: string): { year: number; month: number; day: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new AppError('INVALID_INPUT', `日期必须是 YYYY-MM-DD: ${date}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/** 拉取 AdMob networkReport 并归一化为 RevenueRow[]。 */
export async function fetchAdMobApiRevenue(input: AdMobApiInput): Promise<AdMobApiResult> {
  const env = input.env ?? process.env;
  const token = env[ADMOB_TOKEN_ENV];
  if (!token) {
    throw new AppError(
      'AUTH_REQUIRED',
      `缺少 ${ADMOB_TOKEN_ENV} 环境变量（不代用户做 OAuth）`,
      {
        hint: '自行用 Google OAuth（scope https://www.googleapis.com/auth/admob.readonly）获取访问令牌后设置环境变量；或在 AdMob 后台导出 CSV/JSON 改用 source=file；社区 AdMob MCP 亦可: https://github.com/jerry2247/admob-mcp',
      },
    );
  }
  if (!/^pub-\d{10,20}$/.test(input.publisherId)) {
    throw new AppError('INVALID_INPUT', `publisherId 格式应为 pub-xxxxxxxxxxxxxxxx，收到: ${input.publisherId}`);
  }

  const dimensions = input.dimensions ?? ['DATE', 'COUNTRY', 'FORMAT'];
  const invalid = dimensions.filter((d) => !ADMOB_DIMENSIONS.includes(d));
  if (invalid.length > 0) {
    throw new AppError('INVALID_INPUT', `不支持的维度: ${invalid.join(', ')}（可选 ${ADMOB_DIMENSIONS.join('/')}）`);
  }

  const body = {
    reportSpec: {
      dateRange: { startDate: splitDate(input.startDate), endDate: splitDate(input.endDate) },
      dimensions: [...dimensions],
      metrics: ['ESTIMATED_EARNINGS', 'AD_REQUESTS', 'MATCHED_REQUESTS', 'IMPRESSIONS', 'CLICKS'],
      localizationSettings: { currencyCode: 'USD' },
    },
  };

  const url = `${API_BASE}/${input.publisherId}/networkReport:generate`;
  const fetchImpl = input.fetchImpl ?? (fetch as unknown as FetchLike);
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new AppError('COMMAND_FAILED', 'AdMob API 请求失败（网络错误）', {
      details: err instanceof Error ? err.message : String(err),
    });
  }

  const text = await response.text();
  if (response.status === 401 || response.status === 403) {
    throw new AppError('AUTH_REQUIRED', `AdMob API 拒绝访问（HTTP ${response.status}）`, {
      hint: '检查令牌是否有效、是否过期，以及 AdMob 账号权限（只读报表 scope）',
      details: { status: response.status, body: text.slice(0, 500) },
    });
  }
  if (!response.ok) {
    throw new AppError('COMMAND_FAILED', `AdMob API 请求失败（HTTP ${response.status}）`, {
      details: { status: response.status, body: text.slice(0, 500) },
    });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new AppError('COMMAND_FAILED', 'AdMob API 返回的不是合法 JSON');
  }
  if (!Array.isArray(payload)) {
    throw new AppError('COMMAND_FAILED', 'AdMob API 返回格式不符合 networkReport 约定（应为 JSON 数组）');
  }

  const header = payload[0] as { header?: { localizationSettings?: { currencyCode?: string } } };
  const currency = header?.header?.localizationSettings?.currencyCode ?? 'USD';
  const footer = payload[payload.length - 1] as { footer?: { matchingRowCount?: number } };
  const matchingRowCount = footer?.footer?.matchingRowCount ?? payload.length - 2;

  const rows: RevenueRow[] = [];
  for (const item of payload.slice(1, -1) as ApiReportRow[]) {
    const dims = item.row?.dimensionValues ?? {};
    const metrics = item.row?.metricValues ?? {};
    const row: RevenueRow = {
      earnings: metricNumber(metrics['ESTIMATED_EARNINGS']) ?? 0,
      currency,
    };
    if (dims['DATE']?.value) row.date = toDateStr(dims['DATE'].value);
    if (dims['COUNTRY']?.value) row.country = dims['COUNTRY'].value;
    if (dims['FORMAT']?.value) row.format = dims['FORMAT'].value.toLowerCase();
    if (dims['AD_UNIT']?.value) row.adUnit = dims['AD_UNIT'].value;
    if (dims['APP']?.value) row.app = dims['APP'].value;
    if (dims['PLATFORM']?.value) row.platform = dims['PLATFORM'].value.toLowerCase();
    const requests = metricNumber(metrics['AD_REQUESTS']);
    const matched = metricNumber(metrics['MATCHED_REQUESTS']);
    const impressions = metricNumber(metrics['IMPRESSIONS']);
    const clicks = metricNumber(metrics['CLICKS']);
    if (requests !== undefined) row.requests = requests;
    if (matched !== undefined) row.matchedRequests = matched;
    if (impressions !== undefined) row.impressions = impressions;
    if (clicks !== undefined) row.clicks = clicks;
    rows.push(row);
  }
  return { rows, currency, matchingRowCount };
}
