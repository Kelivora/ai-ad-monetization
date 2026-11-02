import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { analyzeProject } from '../src/core/project/analyze.js';

const fixtures = (name: string) =>
  join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', name);

describe('analyzeProject', () => {
  it('flutter_basic: 识别 flutter、双平台、flutter-default minSdk、pbxproj bundle id、无广告 SDK', async () => {
    const a = await analyzeProject(fixtures('flutter_basic'), { skipToolchain: true });
    expect(a.framework).toBe('flutter');
    expect(a.frameworkEvidence.some((e) => e.includes('flutter'))).toBe(true);
    expect(a.targets.android).toBe(true);
    expect(a.targets.ios).toBe(true);
    expect(a.targets.web).toBe(false);
    expect(a.android?.minSdk).toBe('flutter-default');
    expect(a.android?.compileSdk).toBe('flutter-default');
    expect(a.android?.applicationId ?? a.identifiers.androidApplicationId).toBe('com.example.demo_news_app');
    expect(a.ios?.deploymentTarget).toBe('15.0');
    expect(a.identifiers.iosBundleId).toBe('com.example.demoNewsApp');
    expect(a.ios?.pbxprojPath).toContain('project.pbxproj');
    expect(a.existingAdSdks).toHaveLength(0);
    expect(a.flutter?.dartSdkConstraint).toBe('^3.13.7');
    expect(a.flutter?.hasMainRunApp).toBe(true);
    // 本机有 Flutter SDK 时应解析出默认值（24/36），没有则记录 issue
    if (a.android?.resolvedMinSdk === undefined) {
      expect(a.issues.some((i) => i.includes('Flutter 默认 minSdk'))).toBe(true);
    } else {
      expect(a.android.resolvedMinSdk).toBe(24);
      expect(a.android.resolvedCompileSdk).toBe(36);
    }
  });

  it('flutter_with_admob: 识别 google_mobile_ads、已有广告代码、feed_page 可滚动', async () => {
    const a = await analyzeProject(fixtures('flutter_with_admob'), { skipToolchain: true });
    expect(a.framework).toBe('flutter');
    const sdk = a.existingAdSdks.find((s) => s.name === 'google_mobile_ads');
    expect(sdk?.platform).toBe('admob');
    expect(sdk?.version).toBe('^5.1.0');
    expect(sdk?.location).toBe('pubspec.yaml');
    expect(a.android?.admobAppId).toBe('ca-app-pub-1234567890123456~1234567890');
    expect(a.existingAdCode.some((c) => c.symbols.includes('MobileAds.instance'))).toBe(true);
    const feed = a.screens.find((s) => s.widget === 'FeedPage');
    expect(feed?.scrollable).toBe(true);
  });

  it('react_native_app: 识别 react-native', async () => {
    const a = await analyzeProject(fixtures('react_native_app'), { skipToolchain: true });
    expect(a.framework).toBe('react-native');
  });

  it('unity_project: 识别 unity', async () => {
    const a = await analyzeProject(fixtures('unity_project'), { skipToolchain: true });
    expect(a.framework).toBe('unity');
  });

  it('native_android: 识别原生 Android 与字面量 minSdk/compileSdk', async () => {
    const a = await analyzeProject(fixtures('native_android'), { skipToolchain: true });
    expect(a.framework).toBe('android');
    expect(a.android?.minSdk).toBe(24);
    expect(a.android?.compileSdk).toBe(36);
    expect(a.identifiers.androidApplicationId).toBe('com.example.nativedemoapp');
  });

  it('不存在的路径抛 PROJECT_NOT_FOUND', async () => {
    await expect(analyzeProject(fixtures('no_such_project'))).rejects.toMatchObject({
      code: 'PROJECT_NOT_FOUND',
    });
  });
});
