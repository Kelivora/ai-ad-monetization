import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { run, type ExecResult, type RunOptions } from '../../lib/exec.js';

/** 可注入的命令执行器（测试用假 runner 替换）。 */
export type CommandRunner = (cmd: string, args: string[], options?: RunOptions) => Promise<ExecResult>;

export const defaultRunner: CommandRunner = (cmd, args, options) => run(cmd, args, options ?? {});

export interface VerifyToolchain {
  flutter: boolean;
  java: boolean;
  androidSdk: boolean;
  macos: boolean;
  xcodebuild: boolean;
}

export interface ToolchainDetectOptions {
  runner?: CommandRunner;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

function hasAndroidSdk(env: NodeJS.ProcessEnv): boolean {
  const fromEnv = env['ANDROID_HOME'] ?? env['ANDROID_SDK_ROOT'];
  if (fromEnv && existsSync(fromEnv)) return true;
  return existsSync(join(homedir(), 'Library', 'Android', 'sdk'));
}

/** 探测 build 级验证需要的工具链（architecture.md 3.6：缺工具链绝不报告通过）。 */
export async function detectVerifyToolchain(options: ToolchainDetectOptions = {}): Promise<VerifyToolchain> {
  const runner = options.runner ?? defaultRunner;
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;

  const flutter = await runner('flutter', ['--version'], { timeoutMs: 30_000 });
  const java = await runner('java', ['-version'], { timeoutMs: 15_000 });
  const xcodebuild = platform === 'darwin' ? await runner('xcodebuild', ['-version'], { timeoutMs: 15_000 }) : undefined;

  return {
    flutter: flutter.exitCode === 0 && !flutter.timedOut,
    java: java.exitCode === 0 && !java.timedOut,
    androidSdk: hasAndroidSdk(env),
    macos: platform === 'darwin',
    xcodebuild: xcodebuild?.exitCode === 0 && !xcodebuild.timedOut,
  };
}

/** 人类可读的缺失说明（写进 skipped 步骤的 reason）。 */
export function describeMissing(toolchain: VerifyToolchain): string[] {
  const missing: string[] = [];
  if (!toolchain.flutter) missing.push('flutter 命令不可用（安装: https://docs.flutter.dev/get-started/install）');
  if (!toolchain.java) missing.push('java 命令不可用（安装 JDK 17+，或安装 Android Studio 自带的 JDK）');
  if (!toolchain.androidSdk) {
    missing.push('未找到 Android SDK（安装 Android Studio，或设置 ANDROID_HOME/ANDROID_SDK_ROOT 指向 SDK 目录）');
  }
  if (!toolchain.macos) missing.push('iOS 构建仅支持 macOS');
  if (!toolchain.xcodebuild) missing.push('xcodebuild 不可用（安装 Xcode 与 Command Line Tools）');
  return missing;
}
