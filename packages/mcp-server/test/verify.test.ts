import { describe, expect, it } from 'vitest';
import { loadKnowledge } from '../src/knowledge/loader.js';
import { runBuildLevel } from '../src/core/verify/build-runner.js';
import type { CommandRunner, VerifyToolchain } from '../src/core/verify/toolchain.js';
import type { ExecResult } from '../src/lib/exec.js';

const FULL_TOOLCHAIN: VerifyToolchain = { flutter: true, java: true, androidSdk: true, macos: true, xcodebuild: true };
const NO_ANDROID: VerifyToolchain = { flutter: true, java: false, androidSdk: false, macos: true, xcodebuild: true };

function exec(overrides: Partial<ExecResult>): ExecResult {
  return { exitCode: 0, stdout: '', stderr: '', timedOut: false, durationMs: 10, ...overrides };
}

/** 按命令分发假结果的 runner。 */
function fakeRunner(behavior: Record<string, ExecResult>): CommandRunner {
  return (cmd, args) => {
    const key = `${cmd} ${args.join(' ')}`;
    const result = behavior[key];
    if (!result) throw new Error(`假 runner 未配置命令: ${key}`);
    return Promise.resolve(result);
  };
}

const base = (toolchain: VerifyToolchain, runner: CommandRunner) => ({
  cwd: '/tmp/project',
  targets: { android: true, ios: true },
  toolchain,
  kb: loadKnowledge(),
  runner,
});

describe('build-runner（假 runner）', () => {
  it('flutter 缺失 → 整个 build 级 skipped，reason TOOLCHAIN_MISSING', async () => {
    const result = await runBuildLevel(
      base({ ...FULL_TOOLCHAIN, flutter: false }, fakeRunner({})),
    );
    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('TOOLCHAIN_MISSING');
    expect(result.steps).toHaveLength(4);
    for (const step of result.steps) {
      expect(step.status).toBe('skipped');
      expect(step.reason).toContain('TOOLCHAIN_MISSING');
    }
  });

  it('无 Java/Android SDK → build_android skipped 而 ios passed，级别 passed 且警告 Android 未验证', async () => {
    const result = await runBuildLevel(
      base(NO_ANDROID, fakeRunner({
        'flutter pub get': exec({ stdout: 'Resolving dependencies... OK' }),
        'flutter analyze --no-fatal-infos': exec({ stdout: 'No issues found!' }),
        'flutter build ios --simulator --debug --no-codesign': exec({ stdout: 'Building... done' }),
      })),
    );
    expect(result.status).toBe('passed');
    const android = result.steps.find((s) => s.id === 'build_android')!;
    expect(android.status).toBe('skipped');
    expect(android.reason).toContain('Android SDK');
    const ios = result.steps.find((s) => s.id === 'build_ios')!;
    expect(ios.status).toBe('passed');
    expect(result.warnings.join('\n')).toContain('Android 构建未验证');
  });

  it('analyze 报 error → failed 且后续构建 skipped（previous step failed），级别 failed', async () => {
    const result = await runBuildLevel(
      base(FULL_TOOLCHAIN, fakeRunner({
        'flutter pub get': exec({ stdout: 'OK' }),
        'flutter analyze --no-fatal-infos': exec({
          exitCode: 1,
          stdout: [
            'Analyzing lib...',
            '  error • Unused import • lib/main.dart:1:8 • unused_import',
            '  warning • Prefer const • lib/ads/ads.dart:5:3 • prefer_const_constructors',
            '2 issues found.',
          ].join('\n'),
        }),
      })),
    );
    expect(result.status).toBe('failed');
    const analyze = result.steps.find((s) => s.id === 'analyze')!;
    expect(analyze.status).toBe('failed');
    expect(analyze.reason).toContain('1 个 error');
    for (const id of ['build_android', 'build_ios'] as const) {
      const step = result.steps.find((s) => s.id === id)!;
      expect(step.status).toBe('skipped');
      expect(step.reason).toContain('previous step failed');
    }
  });

  it('diagnosis 能从含 minSdkVersion 的日志得出修复建议（提升到 24）', async () => {
    const result = await runBuildLevel(
      base(FULL_TOOLCHAIN, fakeRunner({
        'flutter pub get': exec({ stdout: 'OK' }),
        'flutter analyze --no-fatal-infos': exec({ stdout: 'No issues found!' }),
        'flutter build apk --debug': exec({
          exitCode: 1,
          stderr: [
            'Execution failed for task \':app:processDebugManifest\'.',
            '> Manifest merger failed : uses-sdk:minSdkVersion 16 cannot be smaller than version 24 declared in library.',
          ].join('\n'),
        }),
        'flutter build ios --simulator --debug --no-codesign': exec({ stdout: 'done' }),
      })),
    );
    expect(result.status).toBe('failed');
    const android = result.steps.find((s) => s.id === 'build_android')!;
    expect(android.status).toBe('failed');
    const names = (android.diagnosis ?? []).map((d) => d.name);
    expect(names).toContain('MIN_SDK_TOO_LOW');
    const diag = android.diagnosis!.find((d) => d.name === 'MIN_SDK_TOO_LOW')!;
    expect(diag.fix).toContain('24');
  });

  it('analyze 只有 warning → passed 但记 warning', async () => {
    const result = await runBuildLevel(
      base(FULL_TOOLCHAIN, fakeRunner({
        'flutter pub get': exec({ stdout: 'OK' }),
        'flutter analyze --no-fatal-infos': exec({
          exitCode: 1, // --no-fatal-infos 不处理 warning，仍有退出码
          stdout: '  warning • Prefer const • lib/ads/ads.dart:5:3 • prefer_const_constructors\n1 issue found.',
        }),
        'flutter build apk --debug': exec({ stdout: 'built' }),
        'flutter build ios --simulator --debug --no-codesign': exec({ stdout: 'built' }),
      })),
    );
    expect(result.status).toBe('passed');
    expect(result.warnings.join('\n')).toContain('1 个 warning');
  });

  it('logTail 只保留最后 60 行', async () => {
    const manyLines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join('\n');
    const result = await runBuildLevel(
      base(NO_ANDROID, fakeRunner({
        'flutter pub get': exec({ stdout: manyLines }),
        'flutter analyze --no-fatal-infos': exec({ stdout: 'No issues found!' }),
        'flutter build ios --simulator --debug --no-codesign': exec({ stdout: 'done' }),
      })),
    );
    const pubGet = result.steps.find((s) => s.id === 'pub_get')!;
    expect(pubGet.logTail).toHaveLength(60);
    expect(pubGet.logTail[0]).toBe('line 41');
    expect(pubGet.logTail[59]).toBe('line 100');
  });

  it('analyze 计数对完整 stdout 计数：error 在第 5 行（logTail 之外）仍判 failed', async () => {
    const lines = Array.from({ length: 100 }, (_, i) =>
      i === 4 ? '  error • Target of URI doesn\'t exist • lib/main.dart:1:8 • uri_does_not_exist' : `info line ${i + 1}`,
    ).join('\n');
    const result = await runBuildLevel(
      base(NO_ANDROID, fakeRunner({
        'flutter pub get': exec({ stdout: 'OK' }),
        'flutter analyze --no-fatal-infos': exec({ exitCode: 1, stdout: lines }),
        'flutter build ios --simulator --debug --no-codesign': exec({ stdout: 'done' }),
      })),
    );
    const analyze = result.steps.find((s) => s.id === 'analyze')!;
    expect(analyze.status).toBe('failed');
    expect(analyze.reason).toContain('1 个 error');
    // logTail 本身不含第 5 行（验证计数的确来自完整日志）
    expect(analyze.logTail.join('\n')).not.toContain('error •');
  });

  it('analyze 退出码非 0 且解析不到任何问题行 → failed，reason 说明可能是分析器自身异常', async () => {
    const result = await runBuildLevel(
      base(NO_ANDROID, fakeRunner({
        'flutter pub get': exec({ stdout: 'OK' }),
        'flutter analyze --no-fatal-infos': exec({ exitCode: 1, stdout: 'Waiting for another flutter command to release the startup lock...' }),
        'flutter build ios --simulator --debug --no-codesign': exec({ stdout: 'done' }),
      })),
    );
    const analyze = result.steps.find((s) => s.id === 'analyze')!;
    expect(analyze.status).toBe('failed');
    expect(analyze.reason).toContain('退出码 1');
    expect(analyze.reason).toContain('未能解析出问题行');
    expect(result.status).toBe('failed');
  });

  it('analyze 只有 warning（在 logTail 之外的长输出）→ passed 但记 warning', async () => {
    const lines = Array.from({ length: 100 }, (_, i) =>
      i === 4 ? '  warning • Prefer const • lib/ads/ads.dart:5:3 • prefer_const_constructors' : `info line ${i + 1}`,
    ).join('\n');
    const result = await runBuildLevel(
      base(NO_ANDROID, fakeRunner({
        'flutter pub get': exec({ stdout: 'OK' }),
        'flutter analyze --no-fatal-infos': exec({ exitCode: 1, stdout: lines }),
        'flutter build ios --simulator --debug --no-codesign': exec({ stdout: 'done' }),
      })),
    );
    expect(result.status).toBe('passed');
    expect(result.warnings.join('\n')).toContain('1 个 warning');
  });

  it('诊断正则收紧："Running pod install..." 等正常回显不产生 COCOAPODS_ISSUE（真实原因是 Dart 编译错误）', async () => {
    const result = await runBuildLevel(
      base(FULL_TOOLCHAIN, fakeRunner({
        'flutter pub get': exec({ stdout: 'OK' }),
        'flutter analyze --no-fatal-infos': exec({ stdout: 'No issues found!' }),
        'flutter build apk --debug': exec({ stdout: 'built' }),
        'flutter build ios --simulator --debug --no-codesign': exec({
          exitCode: 1,
          stdout: [
            'Running pod install...',
            'CocoaPods\' output: ↳',
            'Preparing...',
            'Note: IPHONEOS_DEPLOYMENT_TARGET is set to 12.0 in the Runner project.',
            "Error: Couldn't read as Binary file" ,
            'lib/ads/ads.dart:10:3: Error: Method not found — compile error here.',
            'Failed to build iOS app.',
          ].join('\n'),
        }),
      })),
    );
    const ios = result.steps.find((s) => s.id === 'build_ios')!;
    expect(ios.status).toBe('failed');
    const names = (ios.diagnosis ?? []).map((d) => d.name);
    expect(names).not.toContain('COCOAPODS_ISSUE');
    expect(names).not.toContain('IOS_DEPLOYMENT_TARGET_TOO_LOW');
  });

  it('诊断正则收紧："Error running pod install" 产生 COCOAPODS_ISSUE；部署目标报错语句产生对应诊断', async () => {
    const result = await runBuildLevel(
      base(FULL_TOOLCHAIN, fakeRunner({
        'flutter pub get': exec({ stdout: 'OK' }),
        'flutter analyze --no-fatal-infos': exec({ stdout: 'No issues found!' }),
        'flutter build apk --debug': exec({ stdout: 'built' }),
        'flutter build ios --simulator --debug --no-codesign': exec({
          exitCode: 1,
          stderr: 'Error running pod install\nCocoaPods could not find compatible versions for pod "google_mobile_ads"',
        }),
      })),
    );
    const ios = result.steps.find((s) => s.id === 'build_ios')!;
    const names = (ios.diagnosis ?? []).map((d) => d.name);
    expect(names).toContain('COCOAPODS_ISSUE');

    const targetResult = await runBuildLevel(
      base(FULL_TOOLCHAIN, fakeRunner({
        'flutter pub get': exec({ stdout: 'OK' }),
        'flutter analyze --no-fatal-infos': exec({ stdout: 'No issues found!' }),
        'flutter build apk --debug': exec({ stdout: 'built' }),
        'flutter build ios --simulator --debug --no-codesign': exec({
          exitCode: 1,
          stderr: "The pod 'Google-Mobile-Ads-SDK' required a higher minimum deployment target than specified",
        }),
      })),
    );
    const names2 = (targetResult.steps.find((s) => s.id === 'build_ios')!.diagnosis ?? []).map((d) => d.name);
    expect(names2).toContain('IOS_DEPLOYMENT_TARGET_TOO_LOW');
  });

  it('errors.json 关键字收紧：普通英文词（merger）不再触发误匹配', async () => {
    const result = await runBuildLevel(
      base(FULL_TOOLCHAIN, fakeRunner({
        'flutter pub get': exec({ stdout: 'OK' }),
        'flutter analyze --no-fatal-infos': exec({ stdout: 'No issues found!' }),
        'flutter build apk --debug': exec({
          exitCode: 1,
          stderr: 'Some unrelated merger of resources happened during the build.',
        }),
        'flutter build ios --simulator --debug --no-codesign': exec({ stdout: 'built' }),
      })),
    );
    const android = result.steps.find((s) => s.id === 'build_android')!;
    expect((android.diagnosis ?? []).map((d) => d.name)).not.toContain('MIN_SDK_TOO_LOW');
  });
});
