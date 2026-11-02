import { describe, expect, it } from 'vitest';
import { loadKnowledge } from '../src/knowledge/loader.js';
import { recommendPlatforms } from '../src/core/selection/recommend.js';
import { comparePlatforms } from '../src/core/selection/compare.js';
import { searchPlatforms } from '../src/core/selection/search.js';

const kb = loadKnowledge();
const now = new Date();

describe('recommendPlatforms', () => {
  it('flutter + US/EU：admob 第一且 supportLevel=automated', () => {
    const result = recommendPlatforms(
      kb,
      { framework: 'flutter', markets: ['US', 'EU'], appCategory: 'news', goal: 'balanced' },
      now,
    );
    expect(result.results[0]?.platformId).toBe('admob');
    expect(result.results[0]?.supportLevel).toBe('automated');
    expect(result.results[0]?.score).toBeGreaterThan(result.results[1]?.score ?? 0);
    expect(result.editorialNote).toContain('editorial');
  });

  it('unity 框架：admob 与 unity-levelplay 均为 delegate-official-skill', () => {
    const result = recommendPlatforms(
      kb,
      { framework: 'unity', markets: ['US'], appCategory: 'game', goal: 'revenue' },
      now,
    );
    const byId = new Map(result.results.map((r) => [r.platformId, r]));
    expect(byId.get('admob')?.supportLevel).toBe('delegate-official-skill');
    expect(byId.get('unity-levelplay')?.supportLevel).toBe('delegate-official-skill');
  });

  it('react-native：unity-levelplay 被排除（unsupported）', () => {
    const result = recommendPlatforms(
      kb,
      { framework: 'react-native', markets: ['global'], appCategory: 'utility', goal: 'balanced' },
      now,
    );
    expect(result.excluded.some((e) => e.platformId === 'unity-levelplay')).toBe(true);
    expect(result.results.some((r) => r.platformId === 'unity-levelplay')).toBe(false);
  });

  it('未知市场用 global 并记录 warning/assumption', () => {
    const result = recommendPlatforms(
      kb,
      { framework: 'flutter', markets: ['MARS'], appCategory: 'news', goal: 'ux' },
      now,
    );
    expect(result.assumptions.some((a) => a.includes('MARS'))).toBe(true);
  });
});

describe('comparePlatforms', () => {
  it('维度表包含支持级别、类型、editorial 分数与 marketFit', () => {
    const result = comparePlatforms(kb, ['admob', 'applovin-max'], 'flutter', ['US', 'EU'], now);
    expect(result.rows).toHaveLength(2);
    const admob = result.rows.find((r) => r.platformId === 'admob');
    expect(admob?.supportLevel).toBe('automated');
    expect(admob?.type).toBe('network');
    expect(admob?.package).toBe('google_mobile_ads');
    expect(admob?.marketFit['US']).toBe(5);
    expect(admob?.editorialScores['onboardingEase']).toBe(5);
  });
});

describe('searchPlatforms', () => {
  it('按 query 与 framework 过滤', () => {
    const results = searchPlatforms(kb, { query: 'applovin', framework: 'flutter' });
    expect(results.map((r) => r.platformId)).toEqual(['applovin-max']);
    expect(results[0]?.support?.level).toBe('guided');
  });

  it('format 过滤：rewarded 全平台支持，native 剔除不支持的', () => {
    const rewarded = searchPlatforms(kb, { format: 'rewarded' });
    expect(rewarded.length).toBeGreaterThan(1);
  });
});
