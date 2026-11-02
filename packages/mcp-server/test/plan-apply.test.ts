import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateIntegration } from '../src/core/integration/generate.js';
import { renderAdsSmokeTest } from '../src/adapters/admob/flutter/templates/smoke-test.js';
import { AppError } from '../src/lib/errors.js';

const fixtures = (name: string) => join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', name);

/** 把 fixture 复制到 os.tmpdir 下的临时目录（测试写文件一律在临时副本上进行）。 */
function copyFixture(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `admon-${name}-`));
  cpSync(fixtures(name), dir, { recursive: true });
  return dir;
}

function gitInit(root: string): void {
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: root });
}

const FORMATS = ['banner', 'interstitial', 'rewarded'] as const;

describe('generateIntegration（plan/apply 流程）', () => {
  let basic: string;
  beforeAll(() => {
    basic = copyFixture('flutter_basic');
  });
  afterAll(() => {
    rmSync(basic, { recursive: true, force: true });
  });

  it('plan 模式：不落盘，返回 diff 与 planHash', async () => {
    const result = await generateIntegration({ projectPath: basic, formats: [...FORMATS], mode: 'plan' });
    expect(result.plan.platform).toBe('admob');
    expect(result.plan.usesTestIds).toBe(true);
    const paths = result.plan.changes.map((c) => c.path);
    expect(paths).toContain('pubspec.yaml');
    expect(paths).toContain('lib/ads/ads_initializer.dart');
    expect(paths).toContain('lib/ads/anchored_banner_ad.dart');
    expect(result.plan.changes.find((c) => c.path === 'pubspec.yaml')?.diff).toContain('+  google_mobile_ads:');
    expect(result.plan.planHash).toMatch(/^[0-9a-f]{64}$/);
    // 未落盘
    expect(existsSync(join(basic, 'lib/ads/ads.dart'))).toBe(false);
  });

  it('plan 确定：同样输入两次 planHash 相同', async () => {
    const a = await generateIntegration({ projectPath: basic, formats: [...FORMATS], mode: 'plan' });
    const b = await generateIntegration({ projectPath: basic, formats: [...FORMATS], mode: 'plan' });
    expect(a.plan.planHash).toBe(b.plan.planHash);
  });

  it('apply 缺 confirm → CONFIRMATION_REQUIRED', async () => {
    await expect(
      generateIntegration({ projectPath: basic, formats: [...FORMATS], mode: 'apply', expectedPlanHash: 'x'.repeat(64) }),
    ).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
  });

  it('apply 缺 expectedPlanHash → CONFIRMATION_REQUIRED（hint 提示先用 plan）', async () => {
    const err = await generateIntegration({
      projectPath: basic,
      formats: [...FORMATS],
      mode: 'apply',
      confirm: true,
    }).catch((e: unknown) => e as AppError);
    expect(err).toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    expect((err as AppError & { hint?: string }).hint).toContain('plan');
  });

  it('apply 哈希不一致 → PLAN_MISMATCH', async () => {
    await expect(
      generateIntegration({ projectPath: basic, formats: [...FORMATS], mode: 'apply', confirm: true, expectedPlanHash: '0'.repeat(64) }),
    ).rejects.toMatchObject({ code: 'PLAN_MISMATCH' });
  });

  it('apply：写入文件、写备份与 integration.json，之后幂等（再 plan 全部 skip）', async () => {
    const plan = await generateIntegration({ projectPath: basic, formats: [...FORMATS], mode: 'plan' });
    const applied = await generateIntegration({
      projectPath: basic,
      formats: [...FORMATS],
      mode: 'apply',
      confirm: true,
      expectedPlanHash: plan.plan.planHash,
    });
    const result = applied.applied!;
    expect(result.createdFiles).toContain('lib/ads/ads.dart');
    expect(result.modifiedFiles).toContain('pubspec.yaml');
    expect(result.modifiedFiles).toContain('lib/main.dart');
    expect(existsSync(join(result.backupDir, 'pubspec.yaml'))).toBe(true);
    const integration = JSON.parse(readFileSync(result.integrationFile, 'utf8')) as { planHash: string; changedFiles: string[]; platform: string };
    expect(integration.planHash).toBe(plan.plan.planHash);
    expect(integration.changedFiles.length).toBeGreaterThan(0);
    expect(integration.platform).toBe('admob');

    // main.dart 被接线
    const main = readFileSync(join(basic, 'lib/main.dart'), 'utf8');
    expect(main).toContain('// ai-ad-monetization:begin');
    expect(main).toContain("import 'ads/ads.dart';");

    // 幂等：对已 apply 的工程再 plan，所有变更均为 skip
    const rePlan = await generateIntegration({ projectPath: basic, formats: [...FORMATS], mode: 'plan' });
    expect(rePlan.plan.changes.every((c) => c.action === 'skip')).toBe(true);
    // 而且可以直接用新 planHash 再次 apply（无写入文件）
    const reApply = await generateIntegration({
      projectPath: basic,
      formats: [...FORMATS],
      mode: 'apply',
      confirm: true,
      expectedPlanHash: rePlan.plan.planHash,
    });
    expect(reApply.applied!.changedFiles).toHaveLength(0);
  });

  it('formats 为空 → INVALID_INPUT；不支持格式 → UNSUPPORTED_COMBINATION', async () => {
    await expect(generateIntegration({ projectPath: basic, formats: [] })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(generateIntegration({ projectPath: basic, formats: ['native'] })).rejects.toMatchObject({
      code: 'UNSUPPORTED_COMBINATION',
    });
  });

  it('platformOptions 校验失败 → INVALID_INPUT', async () => {
    await expect(
      generateIntegration({ projectPath: basic, formats: [...FORMATS], platformOptions: { interstitialMinIntervalSeconds: -1 } }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('非 Flutter 工程 → UNSUPPORTED_COMBINATION（hint 指向官方 skill）', async () => {
    const native = copyFixture('native_android');
    try {
      const err = await generateIntegration({ projectPath: native, formats: [...FORMATS] }).catch((e: unknown) => e as AppError);
      expect(err).toMatchObject({ code: 'UNSUPPORTED_COMBINATION' });
      expect((err as AppError & { hint?: string }).hint).toContain('google/skills');
    } finally {
      rmSync(native, { recursive: true, force: true });
    }
  });
});

describe('generateIntegration（git 工作区检查）', () => {
  it('plan 涉及文件有未提交改动 → DIRTY_WORKTREE；allowDirty 放行', async () => {
    const root = copyFixture('flutter_basic');
    try {
      gitInit(root);
      // 先制造未提交改动，再 plan / apply（plan 与 apply 之间内容一致，触发的是脏工作区检查而非哈希不一致）
      writeFileSync(join(root, 'pubspec.yaml'), readFileSync(join(root, 'pubspec.yaml'), 'utf8') + '\n# dirty\n', 'utf8');
      const plan = await generateIntegration({ projectPath: root, formats: [...FORMATS], mode: 'plan' });
      const err = await generateIntegration({
        projectPath: root,
        formats: [...FORMATS],
        mode: 'apply',
        confirm: true,
        expectedPlanHash: plan.plan.planHash,
      }).catch((e: unknown) => e as AppError);
      expect(err).toMatchObject({ code: 'DIRTY_WORKTREE' });
      expect(JSON.stringify((err as AppError & { details?: unknown }).details)).toContain('pubspec.yaml');

      // allowDirty: true → 放行
      const applied = await generateIntegration({
        projectPath: root,
        formats: [...FORMATS],
        mode: 'apply',
        confirm: true,
        expectedPlanHash: plan.plan.planHash,
        allowDirty: true,
      });
      expect(applied.applied!.modifiedFiles).toContain('pubspec.yaml');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('git 仓库但改动不在 plan 涉及文件内 → 不阻塞', async () => {
    const root = copyFixture('flutter_basic');
    try {
      gitInit(root);
      writeFileSync(join(root, 'README.md'), '# dirty but unrelated\n', 'utf8');
      const plan = await generateIntegration({ projectPath: root, formats: [...FORMATS], mode: 'plan' });
      const applied = await generateIntegration({
        projectPath: root,
        formats: [...FORMATS],
        mode: 'apply',
        confirm: true,
        expectedPlanHash: plan.plan.planHash,
      });
      expect(applied.applied!.changedFiles.length).toBeGreaterThan(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('写入文件在确认后被外部修改 → apply 时 PLAN_MISMATCH', async () => {
    const root = copyFixture('flutter_basic');
    try {
      const plan = await generateIntegration({ projectPath: root, formats: [...FORMATS], mode: 'plan' });
      // 确认后用户改了 main.dart（plan 里的 beforeHash 已过期）
      const mainFile = join(root, 'lib/main.dart');
      writeFileSync(mainFile, readFileSync(mainFile, 'utf8') + '\n// changed after confirm\n', 'utf8');
      // 重新 plan 得到新 hash，但用户提交的是旧 hash
      await expect(
        generateIntegration({ projectPath: root, formats: [...FORMATS], mode: 'apply', confirm: true, expectedPlanHash: plan.plan.planHash }),
      ).rejects.toMatchObject({ code: 'PLAN_MISMATCH' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('generateIntegration（已有 AdMob 的工程）', () => {
  it('不覆盖真实 App ID / 已有约束 <9 给 warning / 已有广告代码 → 不接线 main', async () => {
    const root = copyFixture('flutter_with_admob');
    try {
      const result = await generateIntegration({ projectPath: root, formats: [...FORMATS], mode: 'plan' });
      const manifest = result.plan.changes.find((c) => c.path.endsWith('AndroidManifest.xml'))!;
      expect(manifest.action).toBe('skip');
      expect(manifest.reason).toContain('已有 AdMob APPLICATION_ID');

      const pubspec = result.plan.changes.find((c) => c.path === 'pubspec.yaml')!;
      // 已有 google_mobile_ads 不动；modify 只为追加冷烟测试的 integration_test dev 依赖
      expect(pubspec.action).toBe('modify');
      expect(pubspec.diff).toContain('+  integration_test:');
      expect(pubspec.diff).not.toContain('+  google_mobile_ads:');
      expect(result.warnings.join('\n')).toContain('低于 9.x');

      const mainChange = result.plan.changes.find((c) => c.path === 'lib/main.dart');
      expect(mainChange).toBeUndefined(); // wireMain 被自动关闭
      expect(result.plan.manualSteps.join('\n')).toContain('合并');

      // 真实 App ID 仍在（apply 后也不变）
      const applied = await generateIntegration({
        projectPath: root,
        formats: [...FORMATS],
        mode: 'apply',
        confirm: true,
        expectedPlanHash: result.plan.planHash,
        allowDirty: true,
      });
      void applied;
      const manifestText = readFileSync(
        join(root, 'android/app/src/main/AndroidManifest.xml'),
        'utf8',
      );
      expect(manifestText).toContain('ca-app-pub-1234567890123456~1234567890');
      expect(manifestText).not.toContain('ca-app-pub-3940256099942544~3347511713');
      const mainText = readFileSync(join(root, 'lib/main.dart'), 'utf8');
      expect(mainText).not.toContain('ai-ad-monetization:begin');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('生成的 Dart 代码', () => {
  let basic: string;
  beforeAll(() => {
    basic = copyFixture('flutter_basic');
  });
  afterAll(() => {
    rmSync(basic, { recursive: true, force: true });
  });

  it('模板包含知识库测试 ID 与统一头注释；广告单元 ID 来自知识库', async () => {
    const result = await generateIntegration({ projectPath: basic, formats: [...FORMATS], mode: 'plan' });
    const content = (path: string) =>
      result.plan.changes.find((c) => c.path === path)!.content ?? '';
    expect(content('lib/ads/ad_unit_ids.dart')).toContain('ca-app-pub-3940256099942544/9214589741'); // banner android 测试 ID
    expect(content('lib/ads/ad_unit_ids.dart')).toContain('String.fromEnvironment');
    expect(content('lib/ads/ads_initializer.dart')).toContain('AdsConsent.canRequestAds()');
    expect(content('lib/ads/anchored_banner_ad.dart')).toContain('getLargeAnchoredAdaptiveBannerAdSize');
    for (const path of ['lib/ads/ad_unit_ids.dart', 'lib/ads/ads_consent.dart', 'lib/ads/ads_initializer.dart', 'lib/ads/ads.dart']) {
      expect(content(path)).toContain('// Generated by ai-ad-monetization (google_mobile_ads ^9.2.0). Safe to edit.');
    }
    // 只生成所选格式
    const bannerOnly = await generateIntegration({ projectPath: basic, formats: ['banner'], mode: 'plan' });
    const bannerPaths = bannerOnly.plan.changes.map((c) => c.path);
    expect(bannerPaths).toContain('lib/ads/anchored_banner_ad.dart');
    expect(bannerPaths).not.toContain('lib/ads/rewarded_ad_controller.dart');
  });

  it('childDirected=true 时初始化模板包含 tagForChildDirectedTreatment', async () => {
    const result = await generateIntegration({ projectPath: basic, formats: ['banner'], mode: 'plan', childDirected: true });
    const content = result.plan.changes.find((c) => c.path === 'lib/ads/ads_initializer.dart')!.content ?? '';
    expect(content).toContain('tagForChildDirectedTreatment');
  });

  it('控制器加载/展示失败时打印错误码并暴露 lastLoadError；banner 支持 onAdFailedToLoad', async () => {
    const result = await generateIntegration({ projectPath: basic, formats: [...FORMATS], mode: 'plan' });
    const content = (path: string) => result.plan.changes.find((c) => c.path === path)!.content ?? '';
    for (const [path, format] of [
      ['lib/ads/interstitial_ad_controller.dart', 'interstitial'],
      ['lib/ads/rewarded_ad_controller.dart', 'rewarded'],
    ] as const) {
      expect(content(path)).toContain('LoadAdError? get lastLoadError');
      expect(content(path)).toContain(`ai-ad-monetization: ${format} failed to load`);
      expect(content(path)).toContain('(attempt \${_retryCount + 1})');
      expect(content(path)).toContain('code=\${error.code} domain=\${error.domain}');
      expect(content(path)).toContain(`ai-ad-monetization: ${format} failed to show`);
      expect(content(path)).toContain('_lastLoadError = null;');
    }
    const banner = content('lib/ads/anchored_banner_ad.dart');
    expect(banner).toContain('final void Function(LoadAdError error)? onAdFailedToLoad;');
    expect(banner).toContain('ai-ad-monetization: banner failed to load');
    expect(banner).toContain('widget.onAdFailedToLoad?.call(error)');
  });
});

describe('lib/ads 同名文件已存在', () => {
  it('create → skip，不覆盖用户文件', async () => {
    const root = copyFixture('flutter_basic');
    try {
      mkdirSync(join(root, 'lib/ads'), { recursive: true });
      writeFileSync(join(root, 'lib/ads/ads.dart'), '// user file\n', 'utf8');
      const result = await generateIntegration({ projectPath: root, formats: [...FORMATS], mode: 'plan' });
      const change = result.plan.changes.find((c) => c.path === 'lib/ads/ads.dart')!;
      expect(change.action).toBe('skip');
      // spawnSync 引用保持（避免未用告警）
      void spawnSync;
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('冷烟测试（includeSmokeTest，默认 true）', () => {
  let basic: string;
  beforeAll(() => {
    basic = copyFixture('flutter_basic');
  });
  afterAll(() => {
    rmSync(basic, { recursive: true, force: true });
  });

  it('plan 默认包含冷烟测试文件与 integration_test dev 依赖', async () => {
    const result = await generateIntegration({ projectPath: basic, formats: [...FORMATS], mode: 'plan' });
    const smoke = result.plan.changes.find((c) => c.path === 'integration_test/ads_smoke_test.dart')!;
    expect(smoke.action).toBe('create');
    // plan 输出的 content 会截断到 4000 字符，这里只断言文件头部分
    expect(smoke.content).toContain("import 'package:demo_news_app/ads/ads.dart';");
    expect(smoke.content).toContain('AI_AD_SMOKE');
    expect(smoke.content).toContain('flutter test integration_test/ads_smoke_test.dart -d <device>');
    // pubspec 追加 integration_test dev 依赖
    const pubspec = result.plan.changes.find((c) => c.path === 'pubspec.yaml')!;
    expect(pubspec.diff).toContain('+  integration_test:');
    expect(pubspec.diff).toContain('+    sdk: flutter');
    // manualSteps 说明冷烟测试用途与命令
    expect(result.plan.manualSteps.join('\n')).toContain('ads_smoke_test.dart');
  });

  it('模板：全格式包含各项检查、全英文、banner-only 无 interstitial/rewarded 检查', () => {
    const full = renderAdsSmokeTest({ packageName: 'demo_news_app', formats: [...FORMATS] });
    expect(full).toContain("'consent_eea'");
    expect(full).toContain("'banner_loaded'");
    expect(full).toContain("'interstitial_loaded'");
    expect(full).toContain("'rewarded_loaded'");
    expect(full).toContain("'rewarded_reward_callback'");
    expect(full).toContain('ADS_SMOKE_TEST_DEVICE_ID');
    expect(full).toContain('ADS_SMOKE_SHOW_FULLSCREEN');
    // 全屏期间禁止 tester.pump：rewarded show 之后只用 Future.delayed 轮询
    expect(full).toContain('_delayUntil');
    // *_loaded 失败 detail 携带 lastLoadError 的 code/domain/message
    expect(full).toContain('_loadErrorDetail');
    expect(full).toContain('no load error reported (still loading or timed out)');
    // 内容全英文（无中文字符）
    expect(full).not.toMatch(/[一-鿿]/);

    const bannerOnly = renderAdsSmokeTest({ packageName: 'demo_news_app', formats: ['banner'] });
    expect(bannerOnly).toContain("'banner_loaded'");
    expect(bannerOnly).not.toContain("'interstitial_loaded'");
    expect(bannerOnly).not.toContain("'rewarded_loaded'");
    expect(bannerOnly).not.toContain("'rewarded_reward_callback'");
    expect(bannerOnly).not.toContain('InterstitialAdController');
    expect(bannerOnly).not.toContain('RewardedAdController');
  });

  it('已存在时 skip，绝不覆盖', async () => {
    mkdirSync(join(basic, 'integration_test'), { recursive: true });
    writeFileSync(join(basic, 'integration_test/ads_smoke_test.dart'), '// user smoke test\n', 'utf8');
    const result = await generateIntegration({ projectPath: basic, formats: [...FORMATS], mode: 'plan' });
    const smoke = result.plan.changes.find((c) => c.path === 'integration_test/ads_smoke_test.dart')!;
    expect(smoke.action).toBe('skip');
    expect(smoke.reason).toContain('已存在');
  });

  it('includeSmokeTest=false → 不含冷烟测试文件，pubspec 不加 integration_test', async () => {
    const root = copyFixture('flutter_basic');
    try {
      const result = await generateIntegration({
        projectPath: root,
        formats: [...FORMATS],
        mode: 'plan',
        platformOptions: { includeSmokeTest: false },
      });
      expect(result.plan.changes.map((c) => c.path)).not.toContain('integration_test/ads_smoke_test.dart');
      const pubspec = result.plan.changes.find((c) => c.path === 'pubspec.yaml')!;
      expect(pubspec.diff ?? '').not.toContain('integration_test');
      expect(result.plan.manualSteps.join('\n')).not.toContain('冷烟测试已生成');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('formats 只有 banner → 生成的冷烟测试只含 banner 检查', async () => {
    const root = copyFixture('flutter_basic');
    try {
      const plan = await generateIntegration({ projectPath: root, formats: ['banner'], mode: 'plan' });
      const applied = await generateIntegration({
        projectPath: root,
        formats: ['banner'],
        mode: 'apply',
        confirm: true,
        expectedPlanHash: plan.plan.planHash,
      });
      void applied;
      const content = readFileSync(join(root, 'integration_test/ads_smoke_test.dart'), 'utf8');
      expect(content).toContain("'banner_loaded'");
      expect(content).not.toContain("'interstitial_loaded'");
      expect(content).not.toContain("'rewarded_loaded'");
      expect(content).not.toContain("'rewarded_reward_callback'");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
