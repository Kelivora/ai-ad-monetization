import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectVerifyToolchain, parseFlutterConfig, type CommandRunner } from '../src/core/verify/toolchain.js';
import type { ExecResult } from '../src/lib/exec.js';

function exec(overrides: Partial<ExecResult>): ExecResult {
  return { exitCode: 0, stdout: '', stderr: '', timedOut: false, durationMs: 10, ...overrides };
}

/** 按命令分发假结果的 runner（未配置的命令返回失败）。 */
function fakeRunner(behavior: Record<string, ExecResult>, calls: string[] = []): CommandRunner {
  return (cmd, args) => {
    const key = `${cmd} ${args.join(' ')}`;
    calls.push(key);
    return Promise.resolve(behavior[key] ?? exec({ exitCode: 1, stderr: `not configured: ${key}` }));
  };
}

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), 'admon-toolchain-'));
}

function makeJdk(dir: string): string {
  mkdirSync(join(dir, 'bin'), { recursive: true });
  writeFileSync(join(dir, 'bin', 'java'), '#!/bin/sh\n', 'utf8');
  return dir;
}

function makeAndroidSdk(dir: string, withContent = true): string {
  mkdirSync(dir, { recursive: true });
  if (withContent) mkdirSync(join(dir, 'platform-tools'), { recursive: true });
  return dir;
}

describe('parseFlutterConfig', () => {
  it('兼容带引号与不带引号的 jdk-dir / android-sdk 写法', () => {
    const parsed = parseFlutterConfig(
      ['jdk-dir: /opt/jdk17', 'android-sdk: "/opt/android-sdk"', 'analytics: true', 'jdk-dir-bogus: /x'].join('\n'),
    );
    expect(parsed.jdkDir).toBe('/opt/jdk17');
    expect(parsed.androidSdk).toBe('/opt/android-sdk');
  });
});

describe('detectVerifyToolchain（假 runner + 临时目录）', () => {
  it('flutter config 的 jdk-dir 可用 → java=true（macOS java 存根场景）', async () => {
    const home = tempHome();
    const jdk = makeJdk(join(home, 'jdk'));
    try {
      const toolchain = await detectVerifyToolchain({
        runner: fakeRunner({
          'flutter --version': exec({ stdout: 'Flutter 3.38' }),
          'flutter config --list': exec({ stdout: `jdk-dir: ${jdk}\nanalytics: true` }),
          'java -version': exec({ exitCode: 1, stderr: 'stub error' }),
        }),
        env: {},
        platform: 'linux',
        homeDir: home,
      });
      expect(toolchain.java).toBe(true);
      expect(toolchain.flutter).toBe(true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('JAVA_HOME/bin/java 存在 → java=true（且不再调用 java -version）', async () => {
    const home = tempHome();
    const jdk = makeJdk(join(home, 'jdk'));
    const calls: string[] = [];
    try {
      const toolchain = await detectVerifyToolchain({
        runner: fakeRunner(
          {
            'flutter --version': exec({ stdout: 'Flutter 3.38' }),
            'flutter config --list': exec({ stdout: 'analytics: true' }),
          },
          calls,
        ),
        env: { JAVA_HOME: jdk },
        platform: 'linux',
        homeDir: home,
      });
      expect(toolchain.java).toBe(true);
      expect(calls).not.toContain('java -version');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('JDK 目录为空壳（无 bin/java）→ 回退 java -version；两者都不可用 → java=false', async () => {
    const home = tempHome();
    mkdirSync(join(home, 'empty-jdk', 'bin'), { recursive: true }); // 有 bin 但没有 java
    try {
      const toolchain = await detectVerifyToolchain({
        runner: fakeRunner({
          'flutter --version': exec({ stdout: 'Flutter 3.38' }),
          'flutter config --list': exec({ stdout: `jdk-dir: "${join(home, 'empty-jdk')}"` }),
          'java -version': exec({ exitCode: 1, stderr: 'Unable to locate a Java Runtime' }),
        }),
        env: {},
        platform: 'linux',
        homeDir: home,
      });
      expect(toolchain.java).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('flutter 缺失 → 不调用 flutter config --list', async () => {
    const home = tempHome();
    const calls: string[] = [];
    try {
      const toolchain = await detectVerifyToolchain({
        runner: fakeRunner(
          {
            'flutter --version': exec({ exitCode: 1, stderr: 'command not found' }),
            'java -version': exec({ stdout: 'openjdk 17' }),
          },
          calls,
        ),
        env: {},
        platform: 'linux',
        homeDir: home,
      });
      expect(toolchain.flutter).toBe(false);
      expect(calls).not.toContain('flutter config --list');
      expect(toolchain.java).toBe(true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('Android SDK：空目录不算，回落到 flutter config 的 android-sdk', async () => {
    const home = tempHome();
    const empty = makeAndroidSdk(join(home, 'empty-sdk'), false);
    const real = makeAndroidSdk(join(home, 'real-sdk'), true);
    try {
      const toolchain = await detectVerifyToolchain({
        runner: fakeRunner({
          'flutter --version': exec({ stdout: 'Flutter 3.38' }),
          'flutter config --list': exec({ stdout: `android-sdk: ${real}` }),
          'java -version': exec({ stdout: 'openjdk 17' }),
        }),
        env: { ANDROID_HOME: empty },
        platform: 'linux',
        homeDir: home,
      });
      expect(toolchain.androidSdk).toBe(true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('所有来源都缺失 → androidSdk=false（~/Library/Android/sdk 也用注入 homeDir 隔离）', async () => {
    const home = tempHome();
    try {
      const toolchain = await detectVerifyToolchain({
        runner: fakeRunner({
          'flutter --version': exec({ stdout: 'Flutter 3.38' }),
          'flutter config --list': exec({ stdout: 'analytics: true' }),
          'java -version': exec({ stdout: 'openjdk 17' }),
        }),
        env: {},
        platform: 'linux',
        homeDir: home,
      });
      expect(toolchain.androidSdk).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
