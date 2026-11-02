import { describe, expect, it } from 'vitest';
import { loadKnowledge } from '../src/knowledge/loader.js';
import { planPlacements } from '../src/core/planning/placements.js';

const kb = loadKnowledge();

describe('planPlacements', () => {
  it('可滚动屏幕给 inline-adaptive，不可滚动给 large-anchored-adaptive', () => {
    const plan = planPlacements(kb, {
      appCategory: 'news',
      goal: 'balanced',
      screens: [
        { file: 'lib/feed_page.dart', widget: 'FeedPage', scrollable: true },
        { file: 'lib/settings_page.dart', widget: 'SettingsPage', scrollable: false },
      ],
    });
    const banners = plan.placements.filter((p) => p.format === 'banner');
    expect(banners).toHaveLength(2);
    expect(banners.find((b) => b.location.includes('FeedPage'))?.bannerType).toBe('inline-adaptive');
    expect(banners.find((b) => b.location.includes('SettingsPage'))?.bannerType).toBe('large-anchored-adaptive');
    expect(plan.placements.every((p) => p.heuristic)).toBe(true);
  });

  it('激励广告 userInitiated=true，插屏带频控', () => {
    const plan = planPlacements(kb, { appCategory: 'game', goal: 'revenue' });
    const rewarded = plan.placements.find((p) => p.format === 'rewarded');
    expect(rewarded?.userInitiated).toBe(true);
    const interstitial = plan.placements.find((p) => p.format === 'interstitial');
    expect(interstitial?.frequencyCapSeconds).toBe(180);
  });

  it('没有 screens 时使用通用占位并写进 assumptions', () => {
    const plan = planPlacements(kb, { appCategory: 'utility', goal: 'ux' });
    const banner = plan.placements.find((p) => p.format === 'banner');
    expect(banner?.location).toBe('main screen bottom');
    expect(plan.assumptions.some((a) => a.includes('analyze_project'))).toBe(true);
  });
});
