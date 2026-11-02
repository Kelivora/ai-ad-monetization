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
  /** 测试注入的 HOME 目录（默认 os.homedir()） */
  homeDir?: string;
}

/** Android SDK 目录必须实际装了东西（platform-tools 或 platforms），空目录不算。 */
function looksLikeAndroidSdk(dir: string): boolean {
  return existsSync(join(dir, 'platform-tools')) || existsSync(join(dir, 'platforms'));
}

/**
 * 解析 `flutter config --list` 的输出，提取 jdk-dir / android-sdk。
 * 兼容 `jdk-dir: /path` 与 `jdk-dir: "/path"` 两种写法。
 */
export function parseFlutterConfig(output: string): { jdkDir?: string; androidSdk?: string } {
  const result: { jdkDir?: string; androidSdk?: string } = {};
  for (const line of output.split('\n')) {
    const m = /^\s*(jdk-dir|android-sdk)\s*:\s*"?([^"#\n]+?)"?\s*$/.exec(line);
    if (!m) continue;
    const value = m[2]!.trim();
    if (value.length === 0) continue;
    if (m[1] === 'jdk-dir') result.jdkDir = value;
    else result.androidSdk = value;
  }
  return result;
}

/**
 * 探测 build 级验证需要的工具链（architecture.md 3.6：缺工具链绝不报告通过）。
 *
 * macOS 上 /usr/bin/java 是存根，未装 JDK 时直接运行会失败，因此 Java 按
 * JAVA_HOME → flutter config 的 jdk-dir → `java -version` 顺序判定；
 * `flutter config --list` 整个探测过程只调用一次。
 */
export async function detectVerifyToolchain(options: ToolchainDetectOptions = {}): Promise<VerifyToolchain> {
  const runner = options.runner ?? defaultRunner;
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const home = options.homeDir ?? homedir();

  const flutter = await runner('flutter', ['--version'], { timeoutMs: 30_000 });

  // flutter config 只查一次，结果同时供 java 与 androidSdk 判定使用
  let config: { jdkDir?: string; androidSdk?: string } = {};
  if (flutter.exitCode === 0 && !flutter.timedOut) {
    const listed = await runner('flutter', ['config', '--list'], { timeoutMs: 30_000 });
    if (listed.exitCode === 0 && !listed.timedOut) {
      config = parseFlutterConfig(`${listed.stdout}\n${listed.stderr}`);
    }
  }

  // Java：JAVA_HOME/bin/java → flutter config jdk-dir/bin/java → java -version
  const javaHome = env['JAVA_HOME'];
  const javaFromEnv = Boolean(javaHome) && existsSync(join(javaHome!, 'bin', 'java'));
  const javaFromConfig = Boolean(config.jdkDir) && existsSync(join(config.jdkDir!, 'bin', 'java'));
  let java = javaFromEnv || javaFromConfig;
  if (!java) {
    const javaCheck = await runner('java', ['-version'], { timeoutMs: 15_000 });
    java = javaCheck.exitCode === 0 && !javaCheck.timedOut;
  }

  // Android SDK：ANDROID_HOME → ANDROID_SDK_ROOT → flutter config android-sdk → ~/Library/Android/sdk
  // 目录必须包含 platform-tools 或 platforms 才算有效
  const sdkCandidates = [env['ANDROID_HOME'], env['ANDROID_SDK_ROOT'], config.androidSdk, join(home, 'Library', 'Android', 'sdk')];
  let androidSdk = false;
  for (const candidate of sdkCandidates) {
    if (candidate && existsSync(candidate) && looksLikeAndroidSdk(candidate)) {
      androidSdk = true;
      break;
    }
  }

  const xcodebuild = platform === 'darwin' ? await runner('xcodebuild', ['-version'], { timeoutMs: 15_000 }) : undefined;

  return {
    flutter: flutter.exitCode === 0 && !flutter.timedOut,
    java,
    androidSdk,
    macos: platform === 'darwin',
    xcodebuild: xcodebuild?.exitCode === 0 && !xcodebuild.timedOut,
  };
}

/** 人类可读的缺失说明（写进 skipped 步骤的 reason）。 */
export function describeMissing(toolchain: VerifyToolchain): string[] {
  const missing: string[] = [];
  if (!toolchain.flutter) missing.push('flutter 命令不可用（安装: https://docs.flutter.dev/get-started/install）');
  if (!toolchain.java) missing.push('java 不可用（安装 JDK 17+，或用 flutter config --jdk-dir 指向已有 JDK）');
  if (!toolchain.androidSdk) {
    missing.push('未找到 Android SDK（安装 Android Studio，或设置 ANDROID_HOME/ANDROID_SDK_ROOT / flutter config --android-sdk 指向 SDK 目录）');
  }
  if (!toolchain.macos) missing.push('iOS 构建仅支持 macOS');
  if (!toolchain.xcodebuild) missing.push('xcodebuild 不可用（安装 Xcode 与 Command Line Tools）');
  return missing;
}
