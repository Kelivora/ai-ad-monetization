import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSmokeChecks, runRuntimeLevel, SMOKE_TEST_RELATIVE_PATH, type RuntimeLevelInput } from '../src/core/verify/runtime-runner.js';
import { loadKnowledge } from '../src/knowledge/loader.js';
import type { CommandRunner } from '../src/core/verify/toolchain.js';
import type { ExecResult } from '../src/lib/exec.js';

function exec(overrides: Partial<ExecResult>): ExecResult {
  return { exitCode: 0, stdout: '', stderr: '', timedOut: false, durationMs: 10, ...overrides };
}

function fakeRunner(behavior: Record<string, ExecResult>): CommandRunner {
  return (cmd, args) => {
    const key = `${cmd} ${args.join(' ')}`;
    const result = behavior[key];
    if (!result) throw new Error(`假 runner 未配置命令: ${key}`);
    return Promise.resolve(result);
  };
}

const DEVICES_JSON = JSON.stringify([
  { id: 'sim-1', name: 'iPhone 17', targetPlatform: 'ios' },
  { id: 'emul-1', name: 'Pixel 9', targetPlatform: 'android-arm64' },
]);

function smokeLine(check: string, ok: boolean, extra = ''): string {
  return `AI_AD_SMOKE {"check":"${check}","ok":${ok}${extra}}`;
}

const ALL_OK_LOG = [
  smokeLine('consent_eea', true, ',"ms":800,"detail":"status=required formAvailable=true"'),
  smokeLine('sdk_initialized', true, ',"ms":50'),
  smokeLine('banner_loaded', true, ',"ms":3000'),
  smokeLine('rewarded_reward_callback', true, ',"ms":10000'),
].join('\n');

describe('parseSmokeChecks', () => {
  it('解析 AI_AD_SMOKE 行，忽略坏行与多余文本', () => {
    const checks = parseSmokeChecks(
      `some log line\n${smokeLine('consent_eea', true, ',"ms":12')}\nAI_AD_SMOKE {bad json}\n${smokeLine('banner_loaded', false)}\ntrailing`,
    );
    expect(checks).toHaveLength(2);
    expect(checks[0]).toMatchObject({ check: 'consent_eea', ok: true, ms: 12 });
    expect(checks[1]).toMatchObject({ check: 'banner_loaded', ok: false });
  });
});

describe('runRuntimeLevel（假 runner）', () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'admon-runtime-'));
    mkdirSync(join(cwd, 'integration_test'), { recursive: true });
    writeFileSync(join(cwd, SMOKE_TEST_RELATIVE_PATH), '// smoke test\n', 'utf8');
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  const base = (runner: CommandRunner, overrides: Partial<RuntimeLevelInput> = {}): RuntimeLevelInput => ({
    cwd,
    devices: ['sim-1'],
    targets: { android: true, ios: true },
    runner,
    kb: loadKnowledge(),
    ...overrides,
  });

  it('无冷烟测试文件 → 整级 skipped，reason 提示重新 plan/apply', async () => {
    rmSync(join(cwd, 'integration_test'), { recursive: true, force: true });
    const result = await runRuntimeLevel(base(fakeRunner({
      'flutter devices --machine': exec({ stdout: DEVICES_JSON }),
    })));
    expect(result.status).toBe('skipped');
    expect(result.runs).toHaveLength(0);
    expect(result.reason).toContain('includeSmokeTest');
  });

  it('全部检查 ok 且退出 0 → run/级别 passed；裁剪 init-log 与（showFullscreen 时）rewarded-callback', async () => {
    const result = await runRuntimeLevel(
      base(fakeRunner({
        'flutter devices --machine': exec({ stdout: DEVICES_JSON }),
        'flutter test integration_test/ads_smoke_test.dart -d sim-1 --dart-define=ADS_SMOKE_SHOW_FULLSCREEN=true': exec({ stdout: ALL_OK_LOG }),
      }), { showFullscreen: true }),
    );
    expect(result.status).toBe('passed');
    const run = result.runs[0]!;
    expect(run.status).toBe('passed');
    expect(run.targetPlatform).toBe('ios');
    expect(run.checks).toHaveLength(4);
    expect(result.manualItems.map((i) => i.id)).not.toContain('init-log');
    expect(result.manualItems.map((i) => i.id)).not.toContain('rewarded-callback');
    // 视觉核对 / 频控 / UMP 交互 / 飞行模式 / 真实 ID 仍需人工
    expect(result.manualItems.map((i) => i.id)).toContain('banner-test-label');
    expect(result.manualItems.map((i) => i.id)).toContain('ump-eea-form');
    expect(result.warnings.join('\n')).toContain('runtime 自动化只覆盖了');
  });

  it('未开 showFullscreen → rewarded-callback 保留在人工清单（自动化未覆盖）', async () => {
    const result = await runRuntimeLevel(base(fakeRunner({
      'flutter devices --machine': exec({ stdout: DEVICES_JSON }),
      'flutter test integration_test/ads_smoke_test.dart -d sim-1': exec({
        stdout: `${smokeLine('consent_eea', true)}\n${smokeLine('sdk_initialized', true)}`,
      }),
    })));
    expect(result.status).toBe('passed');
    expect(result.manualItems.map((i) => i.id)).toContain('rewarded-callback');
  });

  it('某 check ok=false → run 与级别 failed，reason 列出未通过检查', async () => {
    const result = await runRuntimeLevel(base(fakeRunner({
      'flutter devices --machine': exec({ stdout: DEVICES_JSON }),
      'flutter test integration_test/ads_smoke_test.dart -d sim-1': exec({
        exitCode: 1,
        stdout: `${smokeLine('consent_eea', true)}\n${smokeLine('banner_loaded', false, ',"detail":"AdWidget not rendered within 45s"')}`,
        stderr: '00:05 +1: banner_loaded [E]',
      }),
    })));
    expect(result.status).toBe('failed');
    const run = result.runs[0]!;
    expect(run.status).toBe('failed');
    expect(run.reason).toContain('banner_loaded');
    // 失败的 run 不算覆盖：init-log 保留
    expect(result.manualItems.map((i) => i.id)).toContain('init-log');
  });

  it('退出 0 但没有解析到任何 check → failed（不能当作通过）', async () => {
    const result = await runRuntimeLevel(base(fakeRunner({
      'flutter devices --machine': exec({ stdout: DEVICES_JSON }),
      'flutter test integration_test/ads_smoke_test.dart -d sim-1': exec({ stdout: 'All tests passed!' }),
    })));
    expect(result.runs[0]!.status).toBe('failed');
    expect(result.runs[0]!.reason).toContain('AI_AD_SMOKE');
    expect(result.status).toBe('failed');
  });

  it('设备不存在 → 该 run skipped，reason 提示 flutter devices；全部 skipped → 级别 skipped', async () => {
    const result = await runRuntimeLevel(base(fakeRunner({
      'flutter devices --machine': exec({ stdout: DEVICES_JSON }),
      'flutter test integration_test/ads_smoke_test.dart -d nope': exec({
        exitCode: 1,
        stderr: 'No supported devices connected.',
      }),
    }), { devices: ['nope'] }));
    expect(result.runs[0]!.status).toBe('skipped');
    expect(result.runs[0]!.reason).toContain('flutter devices');
    expect(result.status).toBe('skipped');
  });

  it('有 check 失败且日志含 "not found" → 仍是 failed，不误判为设备不存在', async () => {
    const result = await runRuntimeLevel(base(fakeRunner({
      'flutter devices --machine': exec({ stdout: DEVICES_JSON }),
      'flutter test integration_test/ads_smoke_test.dart -d emul-1': exec({
        exitCode: 1,
        stdout: `${smokeLine('banner_loaded', false, ',"detail":"load error: code=3 domain=com.google message=no ad source found"}')}`,
        stderr: 'W/Ads: ad source not found in mediation response',
      }),
    }), { devices: ['emul-1'] }));
    expect(result.runs[0]!.status).toBe('failed');
    expect(result.status).toBe('failed');
  });

  it('skipped 标记的检查（ok=true + skipped=true）不影响 run passed', async () => {
    const result = await runRuntimeLevel(base(fakeRunner({
      'flutter devices --machine': exec({ stdout: DEVICES_JSON }),
      'flutter test integration_test/ads_smoke_test.dart -d sim-1': exec({
        stdout: [
          smokeLine('consent_eea', true),
          smokeLine('sdk_initialized', true),
          smokeLine('rewarded_reward_callback', true, ',"skipped":true,"detail":"set --dart-define=ADS_SMOKE_SHOW_FULLSCREEN=true to enable"'),
        ].join('\n'),
      }),
    })));
    const run = result.runs[0]!;
    expect(run.status).toBe('passed');
    expect(run.checks.find((c) => c.check === 'rewarded_reward_callback')?.skipped).toBe(true);
    expect(result.status).toBe('passed');
  });

  it('rewarded 加载失败 code=0 而 banner/interstitial 成功 → 追加网络环境诊断（含平台日志命令）', async () => {
    const result = await runRuntimeLevel(base(fakeRunner({
      'flutter devices --machine': exec({ stdout: DEVICES_JSON }),
      'flutter test integration_test/ads_smoke_test.dart -d emul-1': exec({
        exitCode: 1,
        stdout: [
          smokeLine('consent_eea', true),
          smokeLine('sdk_initialized', true),
          smokeLine('banner_loaded', true),
          smokeLine('interstitial_loaded', true),
          smokeLine('rewarded_loaded', false, ',"detail":"load error: code=0 domain=com.google message=internal error"'),
        ].join('\n'),
      }),
    }), { devices: ['emul-1'] }));
    const run = result.runs[0]!;
    expect(run.status).toBe('failed');
    const diagnosis = run.diagnosis!;
    expect(diagnosis).toHaveLength(2);
    // code=0 命中 errors.json（INTERNAL_ERROR）
    expect(diagnosis[0]).toMatchObject({ check: 'rewarded_loaded', code: 0 });
    expect(diagnosis[0]!.fix).toContain('重试');
    expect(diagnosis[0]!.logCommand).toContain('adb logcat -s Ads');
    // 网络环境启发式（Android 平台）
    expect(diagnosis[1]!.cause).toContain('asset.gvt1-cn.com');
    expect(diagnosis[1]!.cause).toContain('CORS');
    expect(diagnosis[1]!.fix).toContain('换网络');
  });

  it('banner 加载失败 code=3（iOS 设备）→ 匹配 NO_FILL 诊断，日志命令用 Xcode/log stream', async () => {
    const result = await runRuntimeLevel(base(fakeRunner({
      'flutter devices --machine': exec({ stdout: DEVICES_JSON }),
      'flutter test integration_test/ads_smoke_test.dart -d sim-1': exec({
        exitCode: 1,
        stdout: [
          smokeLine('banner_loaded', false, ',"detail":"load error: code=3 domain=com.google message=no fill"'),
        ].join('\n'),
      }),
    })));
    const diag = result.runs[0]!.diagnosis!;
    expect(diag).toHaveLength(1);
    expect(diag[0]!.code).toBe(3);
    expect(diag[0]!.fix).toContain('测试 ID');
    expect(diag[0]!.logCommand).toContain('xcrun simctl spawn booted log stream');
  });

  it('加载失败但无错误码（超时仍在加载）→ 通用诊断', async () => {
    const result = await runRuntimeLevel(base(fakeRunner({
      'flutter devices --machine': exec({ stdout: DEVICES_JSON }),
      'flutter test integration_test/ads_smoke_test.dart -d sim-1': exec({
        exitCode: 1,
        stdout: smokeLine('banner_loaded', false, ',"detail":"no load error reported (still loading or timed out)"'),
      }),
    })));
    const diag = result.runs[0]!.diagnosis!;
    expect(diag).toHaveLength(1);
    expect(diag[0]).toMatchObject({ check: 'banner_loaded' });
    expect(diag[0]!.cause).toContain('no load error reported');
    expect(diag[0]!.fix).toContain('平台日志');
  });

  it('targets 里的平台未被任何设备覆盖 → warning 指出该平台运行时未验证', async () => {
    const result = await runRuntimeLevel(base(fakeRunner({
      'flutter devices --machine': exec({ stdout: DEVICES_JSON }),
      'flutter test integration_test/ads_smoke_test.dart -d sim-1': exec({ stdout: ALL_OK_LOG }),
    })));
    expect(result.status).toBe('passed');
    expect(result.warnings.join('\n')).toMatch(/android.*运行时未验证|运行时未验证.*android/);
  });

  it('多设备串行：一失败一通过 → 级别 failed', async () => {
    const result = await runRuntimeLevel(base(fakeRunner({
      'flutter devices --machine': exec({ stdout: DEVICES_JSON }),
      'flutter test integration_test/ads_smoke_test.dart -d sim-1': exec({ stdout: ALL_OK_LOG }),
      'flutter test integration_test/ads_smoke_test.dart -d emul-1': exec({
        exitCode: 1,
        stdout: smokeLine('consent_eea', false),
      }),
    }), { devices: ['sim-1', 'emul-1'] }));
    expect(result.runs).toHaveLength(2);
    expect(result.status).toBe('failed');
  });

  it('logTail 只保留最后 60 行', async () => {
    const manyLines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join('\n');
    const result = await runRuntimeLevel(base(fakeRunner({
      'flutter devices --machine': exec({ stdout: DEVICES_JSON }),
      'flutter test integration_test/ads_smoke_test.dart -d sim-1': exec({
        exitCode: 1,
        stdout: `${manyLines}\n${smokeLine('consent_eea', true)}\n${smokeLine('banner_loaded', false)}`,
      }),
    })));
    const logTail = result.runs[0]!.logTail;
    expect(logTail).toHaveLength(60);
    expect(logTail[logTail.length - 1]).toContain('banner_loaded');
  });
});
