import { describe, expect, it } from 'vitest';
import { fetchAdMobApiRevenue, type FetchLike } from '../src/adapters/admob/revenue-api.js';
import { AppError } from '../src/lib/errors.js';

const TOKEN = 'secret-token-do-not-leak';
const ENV = { ADMOB_ACCESS_TOKEN: TOKEN };

const okPayload = JSON.stringify([
  { header: { localizationSettings: { currencyCode: 'USD' } } },
  {
    row: {
      dimensionValues: {
        DATE: { value: '20261001' },
        COUNTRY: { value: 'US' },
        FORMAT: { value: 'BANNER' },
      },
      metricValues: {
        ESTIMATED_EARNINGS: { microsValue: '1234567' },
        AD_REQUESTS: { integerValue: '1000' },
        MATCHED_REQUESTS: { integerValue: '800' },
        IMPRESSIONS: { integerValue: '700' },
        CLICKS: { integerValue: '7' },
      },
    },
  },
  { footer: { matchingRowCount: 1 } },
]);

const fakeFetch = (status: number, body: string): FetchLike =>
  async () => ({ ok: status >= 200 && status < 300, status, text: async () => body });

async function reject(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (err) {
    return err as AppError;
  }
  throw new Error('应当抛出异常');
}

describe('admob_api（假 fetch）', () => {
  const input = {
    publisherId: 'pub-1234567890123456',
    startDate: '2026-10-01',
    endDate: '2026-10-31',
    env: ENV,
  };

  it('成功：microsValue/1e6、DATE 转 YYYY-MM-DD、FORMAT 小写、currency 取 header', async () => {
    const result = await fetchAdMobApiRevenue({ ...input, fetchImpl: fakeFetch(200, okPayload) });
    expect(result.currency).toBe('USD');
    expect(result.matchingRowCount).toBe(1);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      date: '2026-10-01',
      country: 'US',
      format: 'banner',
      earnings: 1.234567,
      requests: 1000,
      matchedRequests: 800,
      impressions: 700,
      clicks: 7,
      currency: 'USD',
    });
  });

  it('HTTP 401 → AUTH_REQUIRED（附响应信息）', async () => {
    const err = await reject(
      fetchAdMobApiRevenue({ ...input, fetchImpl: fakeFetch(401, '{"error": "invalid token"}') }),
    );
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('AUTH_REQUIRED');
    expect(err.message).toContain('401');
  });

  it('HTTP 500 → COMMAND_FAILED', async () => {
    const err = await reject(
      fetchAdMobApiRevenue({ ...input, fetchImpl: fakeFetch(500, 'internal error') }),
    );
    expect((err as AppError).code).toBe('COMMAND_FAILED');
  });

  it('缺少 ADMOB_ACCESS_TOKEN → AUTH_REQUIRED 且提示获取方式', async () => {
    const err = await reject(
      fetchAdMobApiRevenue({ ...input, env: {}, fetchImpl: fakeFetch(200, okPayload) }),
    );
    expect((err as AppError).code).toBe('AUTH_REQUIRED');
    expect((err as AppError).hint).toContain('admob.readonly');
  });

  it('任何输出与错误都不包含令牌字符串', async () => {
    const result = await fetchAdMobApiRevenue({ ...input, fetchImpl: fakeFetch(200, okPayload) });
    expect(JSON.stringify(result)).not.toContain(TOKEN);

    const err = await reject(
      fetchAdMobApiRevenue({ ...input, fetchImpl: fakeFetch(403, '{"error": "forbidden"}') }),
    );
    expect(JSON.stringify({ message: err.message, hint: err.hint, details: err.details })).not.toContain(TOKEN);
  });

  it('publisherId 缺失/格式错误 → INVALID_INPUT', async () => {
    const err = await reject(
      fetchAdMobApiRevenue({ ...input, publisherId: 'not-a-pub-id', fetchImpl: fakeFetch(200, okPayload) }),
    );
    expect((err as AppError).code).toBe('INVALID_INPUT');
  });
});
