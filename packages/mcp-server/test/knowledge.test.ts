import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isStale } from '../src/knowledge/freshness.js';
import { findKnowledgeDir, loadKnowledge } from '../src/knowledge/loader.js';
import {
  FRAMEWORKS,
  PLATFORM_IDS,
  schemaForFile,
  type PlatformFile,
  type TestIdsFile,
} from '../src/knowledge/schema.js';

const kbDir = findKnowledgeDir();

function walkJson(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walkJson(full));
    else if (entry.endsWith('.json')) out.push(full);
  }
  return out;
}

const jsonFiles = walkJson(kbDir).map((f) => relative(kbDir, f));

describe('知识文件 schema', () => {
  it('每个 JSON 文件都有对应 schema 且通过校验', () => {
    const known = [
      'index.json',
      'common/placement-rules.json',
      'common/markets.json',
      'common/benchmarks.json',
      'platforms/admob/platform.json',
      'platforms/admob/sdk/flutter.json',
      'platforms/admob/test-ids.json',
      'platforms/admob/privacy.json',
      'platforms/admob/skadnetwork.json',
      'platforms/admob/errors.json',
      'platforms/applovin-max/platform.json',
      'platforms/unity-levelplay/platform.json',
    ];
    expect(new Set(jsonFiles)).toEqual(new Set(known));

    for (const rel of jsonFiles) {
      const schema = schemaForFile(rel);
      expect(schema, `${rel} 应有 schema`).toBeDefined();
      const data = JSON.parse(readFileSync(join(kbDir, rel), 'utf8'));
      const result = schema!.safeParse(data);
      expect(result.success, `${rel} schema 校验失败: ${result.success ? '' : JSON.stringify(result.error.issues)}`).toBe(true);
    }
  });

  it('loader 能加载整个知识库并读取关键条目', () => {
    const kb = loadKnowledge();
    expect(kb.getPlatform('admob').status).toBe('automated');
    const sdk = kb.getSdk('admob', 'flutter');
    expect(sdk.plugin.version).toBe('9.2.0');
    expect(kb.getDoc('admob', 'init').body).toContain('MobileAds.instance.initialize()');
    expect(kb.getDoc('admob', 'banner', 'flutter').topic).toBe('banner');
    expect(kb.getBenchmarks().heuristic).toBe(true);
    expect(kb.getPlacementRules().policies.length).toBeGreaterThan(0);
  });
});

describe('测试 ID', () => {
  const kb = loadKnowledge();
  const testIds: TestIdsFile = kb.getTestIds('admob');
  const appIdRegex = new RegExp(testIds.regex.appId);
  const adUnitRegex = new RegExp(testIds.regex.adUnit);

  it('App ID 与广告单元都匹配正则且以测试前缀开头', () => {
    for (const id of [testIds.appId.android, testIds.appId.ios]) {
      expect(id.startsWith(testIds.prefix)).toBe(true);
      expect(appIdRegex.test(id)).toBe(true);
      expect(adUnitRegex.test(id)).toBe(false);
    }
    for (const unit of testIds.adUnits) {
      for (const id of [unit.android, unit.ios]) {
        expect(id.startsWith(testIds.prefix)).toBe(true);
        expect(adUnitRegex.test(id)).toBe(true);
        expect(appIdRegex.test(id)).toBe(false);
      }
    }
  });

  it('Android 与 iOS 测试 ID 不混用', () => {
    const androidIds = new Set([testIds.appId.android, ...testIds.adUnits.map((u) => u.android)]);
    const iosIds = new Set([testIds.appId.ios, ...testIds.adUnits.map((u) => u.ios)]);
    expect(testIds.appId.android).not.toBe(testIds.appId.ios);
    for (const u of testIds.adUnits) expect(u.android).not.toBe(u.ios);
    for (const id of androidIds) expect(iosIds.has(id)).toBe(false);
  });
});

describe('SKAdNetwork', () => {
  it('ID 非空且都以 .skadnetwork 结尾', () => {
    const ids = loadKnowledge().getSkadnetworkIds('admob');
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length); // 无重复
    for (const id of ids) expect(id.endsWith('.skadnetwork')).toBe(true);
  });
});

describe('freshness', () => {
  it('stale 计算（固定 now）', () => {
    const retrievedAt = '2026-11-02';
    expect(isStale(retrievedAt, 120, new Date('2026-12-01T00:00:00Z'))).toBe(false);
    expect(isStale(retrievedAt, 120, new Date('2027-03-03T00:00:00Z'))).toBe(true); // 超过 120 天
    expect(isStale(retrievedAt, 120, new Date('2027-03-01T00:00:00Z'))).toBe(false); // 恰好 120 天，不算超过
    expect(isStale('not-a-date', 120, new Date())).toBe(true);
  });
});

describe('市场解析', () => {
  it("resolveMarket('EU') === 'EEA'", () => {
    const kb = loadKnowledge();
    expect(kb.resolveMarket('EU')).toBe('EEA');
    expect(kb.resolveMarket('Europe')).toBe('EEA');
    expect(kb.resolveMarket('us')).toBe('US');
    expect(() => kb.resolveMarket('ATLANTIS')).toThrow();
  });
});

describe('platform 框架支持', () => {
  const kb = loadKnowledge();

  it('每个平台的每个框架都有合法支持级别', () => {
    for (const id of PLATFORM_IDS) {
      const platform: PlatformFile = kb.getPlatform(id);
      for (const fw of FRAMEWORKS) {
        const support = platform.frameworks[fw];
        expect(support, `${id}/${fw}`).toBeDefined();
      }
    }
  });

  it('automated / delegate-official-skill 框架有必要字段', () => {
    for (const id of PLATFORM_IDS) {
      const platform = kb.getPlatform(id);
      for (const fw of FRAMEWORKS) {
        const support = platform.frameworks[fw]!;
        if (support.support === 'automated') {
          expect(support.package, `${id}/${fw} automated 需要包名`).toBeTruthy();
        }
        if (support.support === 'delegate-official-skill') {
          expect(support.officialSkill, `${id}/${fw} delegate 需要 officialSkill`).toBeDefined();
          const skill = support.officialSkill!;
          expect(skill.name).toBeTruthy();
          expect(skill.repo).toMatch(/^https?:\/\//);
          expect(skill.install).toBeTruthy();
          expect(skill.docsUrl).toMatch(/^https?:\/\//);
        }
      }
    }
  });

  it('AdMob：flutter automated，android/ios/unity delegate，react-native guided；LevelPlay unity delegate', () => {
    const admob = kb.getPlatform('admob');
    expect(admob.frameworks['flutter']?.support).toBe('automated');
    expect(admob.frameworks['android']?.support).toBe('delegate-official-skill');
    expect(admob.frameworks['ios']?.support).toBe('delegate-official-skill');
    expect(admob.frameworks['unity']?.support).toBe('delegate-official-skill');
    expect(admob.frameworks['react-native']?.support).toBe('guided');
    const levelplay = kb.getPlatform('unity-levelplay');
    expect(levelplay.frameworks['unity']?.support).toBe('delegate-official-skill');
  });
});
