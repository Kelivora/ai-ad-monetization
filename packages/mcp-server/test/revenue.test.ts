import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { importRevenueRows, parseRevenueCsv, parseNumber, splitCsvLine } from '../src/core/revenue/import.js';

const fixtures = (name: string) =>
  join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', name);

describe('CSV 解析', () => {
  it('splitCsvLine 支持引号内逗号与转义引号', () => {
    expect(splitCsvLine('"Sample, ""GB"" unit",US,1')).toEqual(['Sample, "GB" unit', 'US', '1']);
  });

  it('parseNumber 去千分位逗号、货币符号与百分号', () => {
    expect(parseNumber('1,234.56')).toBe(1234.56);
    expect(parseNumber('$45.20')).toBe(45.2);
    expect(parseNumber('12%')).toBe(12);
    expect(parseNumber('')).toBeUndefined();
  });

  it('解析 BOM、别名表头、货币括号与引号字段', () => {
    const csv =
      '﻿Date,Country,Ad format,Ad requests,Matched requests,Impressions,Clicks,Estimated earnings (USD)\n' +
      '2026-10-01,US,Banner,"1,234","1,000",900,5,"$12.50"\n' +
      '2026-10-02,DE,Interstitial,"40,000",30000,27000,400,45.2\n';
    const rows = parseRevenueCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      date: '2026-10-01',
      country: 'US',
      format: 'banner',
      requests: 1234,
      matchedRequests: 1000,
      impressions: 900,
      clicks: 5,
      earnings: 12.5,
      currency: 'USD',
    });
    expect(rows[1]!.requests).toBe(40000);
    expect(rows[1]!.format).toBe('interstitial');
    expect(rows[1]!.currency).toBe('USD');
  });

  it('缺少收益列表头 → INVALID_INPUT', () => {
    expect(() => parseRevenueCsv('Date,Country\n2026-10-01,US')).toThrowError(/收益列/);
  });

  it('按 startDate/endDate 过滤有 date 的行', () => {
    const rows = importRevenueRows({
      filePath: fixtures('revenue/admob_export.csv'),
      startDate: '2026-10-02',
      endDate: '2026-10-02',
    });
    expect(rows.length).toBe(6);
    expect(rows.every((r) => r.date === '2026-10-02')).toBe(true);
  });

  it('fixture（含 # 注释行）全部行可读', () => {
    const rows = importRevenueRows({ filePath: fixtures('revenue/admob_export.csv') });
    expect(rows.length).toBeGreaterThanOrEqual(12);
    const countries = new Set(rows.map((r) => r.country));
    expect(countries).toEqual(new Set(['US', 'DE', 'GB']));
    const formats = new Set(rows.map((r) => r.format));
    expect(formats).toEqual(new Set(['banner', 'interstitial', 'rewarded']));
  });

  it('JSON（{rows:[...]} 与数组两种形态）', () => {
    const array = importRevenueRows({ filePath: fixtures('revenue/admob_export.json') });
    expect(array).toHaveLength(2);
    expect(array[0]).toMatchObject({ date: '2026-10-01', format: 'banner', earnings: 1.5 });
  });
});
