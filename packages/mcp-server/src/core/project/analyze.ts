import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { PlatformId } from '../../knowledge/schema.js';
import { isDirectory, listDartFiles, readTextIfExists } from '../../lib/fs.js';
import { run, whichSync } from '../../lib/exec.js';
import { AppError } from '../../lib/errors.js';
import { detectAndroid } from './detectors/android.js';
import { detectFlutter } from './detectors/flutter.js';
import { detectIos } from './detectors/ios.js';
import { detectReactNative } from './detectors/react-native.js';
import { detectUnity } from './detectors/unity.js';
import type { AnalyzeOptions, ProjectAnalysis } from './types.js';

// ---- 已知广告 SDK 识别表 ----
const FLUTTER_AD_SDKS: Record<string, PlatformId | 'other'> = {
  google_mobile_ads: 'admob',
  applovin_max: 'applovin-max',
  unity_levelplay_mediation: 'unity-levelplay',
  ironsource_mediation: 'unity-levelplay',
  facebook_audience_network: 'other',
  easy_ads_flutter: 'other',
};
const GRADLE_AD_DEPS: Record<string, PlatformId | 'other'> = {
  'play-services-ads': 'admob',
  'applovin-sdk': 'applovin-max',
  mediationsdk: 'unity-levelplay',
};
const PODFILE_AD_DEPS: Record<string, PlatformId | 'other'> = {
  'Google-Mobile-Ads-SDK': 'admob',
  AppLovinSDK: 'applovin-max',
  IronSourceSDK: 'unity-levelplay',
};
const AD_CODE_SYMBOLS = [
  'MobileAds.instance',
  'BannerAd',
  'InterstitialAd',
  'RewardedAd',
  'AdWidget',
  'ConsentInformation',
];
const SCROLLABLE_WIDGETS = ['ListView', 'GridView', 'CustomScrollView', 'SingleChildScrollView', 'PageView'];

/** 查找拥有构建的最外层工程：从 path 逐级向上找 Flutter/RN/Unity 工程根。 */
function findOwningProject(path: string): { root: string; kind: 'flutter' | 'react-native' | 'unity' } | null {
  let dir = resolve(path);
  for (;;) {
    if (detectFlutter(dir)) return { root: dir, kind: 'flutter' };
    if (detectReactNative(dir)) return { root: dir, kind: 'react-native' };
    if (detectUnity(dir)) return { root: dir, kind: 'unity' };
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function detectGitState(root: string): ProjectAnalysis['git'] {
  const status = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
  if (status.error || status.status !== 0) return { isRepo: false, dirtyFiles: [] };
  const prefix = spawnSync('git', ['rev-parse', '--show-prefix'], { cwd: root, encoding: 'utf8' });
  const prefixStr = prefix.status === 0 ? (prefix.stdout ?? '').trim() : '';
  const files = (status.stdout ?? '')
    .split('\n')
    .map((line) => line.slice(3).trim())
    .filter((f) => f.length > 0)
    .map((f) => f.replace(/^"|"$/g, ''));
  const dirtyFiles = prefixStr ? files.filter((f) => f.startsWith(prefixStr)).map((f) => f.slice(prefixStr.length)) : files;
  return { isRepo: true, dirtyFiles };
}

// ---- 工具链检测（进程内缓存） ----
const toolchainCache = new Map<string, { flutter?: string; dart?: string; xcode?: string; java?: string }>();

async function detectToolchain(): Promise<ProjectAnalysis['toolchain']> {
  const cached = toolchainCache.get('all');
  if (cached) return { ...cached, androidSdk: detectAndroidSdk() };
  const result: { flutter?: string; dart?: string; xcode?: string; java?: string } = {};

  const flutter = await run('flutter', ['--version', '--machine'], { timeoutMs: 20_000 });
  if (flutter.exitCode === 0 && !flutter.timedOut) {
    try {
      // 输出可能带非 JSON 前缀，取第一个 { 到最后一个 }
      const text = flutter.stdout.slice(flutter.stdout.indexOf('{'), flutter.stdout.lastIndexOf('}') + 1);
      const info = JSON.parse(text) as { frameworkVersion?: string; dartSdkVersion?: string };
      if (info.frameworkVersion) result.flutter = info.frameworkVersion;
      if (info.dartSdkVersion) result.dart = info.dartSdkVersion;
    } catch {
      // 解析失败则留空
    }
  }
  const xcode = await run('xcodebuild', ['-version'], { timeoutMs: 10_000 });
  if (xcode.exitCode === 0) {
    const firstLine = xcode.stdout.split('\n').map((l) => l.trim()).find((l) => l.length > 0);
    if (firstLine) result.xcode = firstLine;
  }
  const java = await run('java', ['-version'], { timeoutMs: 10_000 });
  if (java.exitCode === 0 || java.stderr.includes('version')) {
    const m = /version "([^"]+)"/.exec(java.stderr) ?? /version "([^"]+)"/.exec(java.stdout);
    if (m?.[1]) result.java = m[1];
  }
  toolchainCache.set('all', result);
  return { ...result, androidSdk: detectAndroidSdk() };
}

function detectAndroidSdk(): boolean {
  if (process.env['ANDROID_HOME'] && existsSync(process.env['ANDROID_HOME'])) return true;
  if (process.env['ANDROID_SDK_ROOT'] && existsSync(process.env['ANDROID_SDK_ROOT'])) return true;
  return isDirectory(join(homedir(), 'Library', 'Android', 'sdk'));
}

/** 解析 Flutter SDK 默认 minSdk/compileSdk（FlutterExtension.kt）。 */
function resolveFlutterDefaults(root: string): { minSdk?: number | undefined; compileSdk?: number | undefined } {
  const sdkRoot = process.env['FLUTTER_ROOT'] ? resolve(process.env['FLUTTER_ROOT']) : flutterSdkRootFromPath();
  if (!sdkRoot) return {};
  const kt = readTextIfExists(
    join(sdkRoot, 'packages', 'flutter_tools', 'gradle', 'src', 'main', 'kotlin', 'FlutterExtension.kt'),
  );
  if (!kt) return {};
  const result: { minSdk?: number | undefined; compileSdk?: number | undefined } = {
    minSdk: Number(/val minSdkVersion:\s*Int\s*=\s*(\d+)/.exec(kt)?.[1] ?? Number.NaN) || undefined,
    compileSdk: Number(/val compileSdkVersion:\s*Int\s*=\s*(\d+)/.exec(kt)?.[1] ?? Number.NaN) || undefined,
  };
  return result;
}

function flutterSdkRootFromPath(): string | undefined {
  const bin = whichSync('flutter');
  if (!bin) return undefined;
  try {
    const real = realpathSync(bin); // .../flutter/bin/flutter
    return dirname(dirname(real));
  } catch {
    return undefined;
  }
}

// ---- 广告 SDK / 广告代码 / 屏幕启发式 ----
function collectExistingAdSdks(root: string, flutterDeps: Record<string, string> | undefined): ProjectAnalysis['existingAdSdks'] {
  const found: ProjectAnalysis['existingAdSdks'] = [];
  if (flutterDeps) {
    for (const [name, version] of Object.entries(flutterDeps)) {
      const platform = FLUTTER_AD_SDKS[name];
      if (platform && !version.includes('sdk:')) {
        found.push({ platform, name, version, location: 'pubspec.yaml' });
      }
    }
  }
  const android = detectAndroid(root);
  if (android?.gradleFile) {
    const gradle = readTextIfExists(`${root}/${android.gradleFile}`) ?? '';
    for (const [dep, platform] of Object.entries(GRADLE_AD_DEPS)) {
      if (gradle.includes(dep)) found.push({ platform, name: dep, location: android.gradleFile });
    }
  }
  const podfile = readTextIfExists(`${root}/ios/Podfile`) ?? readTextIfExists(`${root}/Podfile`);
  if (podfile) {
    for (const [dep, platform] of Object.entries(PODFILE_AD_DEPS)) {
      if (podfile.includes(dep)) found.push({ platform, name: dep, location: 'ios/Podfile' });
    }
  }
  return found;
}

function collectAdCodeAndScreens(root: string): {
  existingAdCode: ProjectAnalysis['existingAdCode'];
  screens: ProjectAnalysis['screens'];
} {
  const existingAdCode: ProjectAnalysis['existingAdCode'] = [];
  const screens: ProjectAnalysis['screens'] = [];
  const dartFiles = existsSync(`${root}/lib`) ? listDartFiles(`${root}/lib`, ['ads']) : [];
  for (const rel of dartFiles) {
    const text = readTextIfExists(`${root}/lib/${rel}`);
    if (!text) continue;
    // 符号匹配忽略注释（注释里的示例代码不算已有集成）
    const code = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const symbols = AD_CODE_SYMBOLS.filter((sym) => usesAdSymbol(code, sym));
    if (symbols.length > 0) existingAdCode.push({ file: `lib/${rel}`, symbols });
    if (screens.length >= 50) continue;
    const scrollSource = code;
    const scrollable = SCROLLABLE_WIDGETS.some((w) => new RegExp(`\\b${w}\\b`).test(scrollSource));
    for (const m of text.matchAll(/class\s+(\w+)\s+extends\s+(?:StatelessWidget|StatefulWidget)/g)) {
      if (screens.length >= 50) break;
      screens.push({ file: `lib/${rel}`, widget: m[1]!, scrollable });
    }
  }
  return { existingAdCode, screens };
}

/** 单词边界匹配广告符号：`AnchoredBannerAd` 不会命中 `BannerAd`。 */
function usesAdSymbol(code: string, symbol: string): boolean {
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9_])${escaped}`).test(code);
}

/** 项目分析主入口（architecture.md 3.3）。 */
export async function analyzeProject(projectPath: string, options: AnalyzeOptions = {}): Promise<ProjectAnalysis> {
  const root = resolve(projectPath);
  if (!existsSync(root)) {
    throw new AppError('PROJECT_NOT_FOUND', `路径不存在: ${root}`);
  }

  const evidence: string[] = [];
  const issues: string[] = [];
  let analysisRoot = root;

  // 框架探测（顺序：RN → Flutter → Unity → 原生；多命中取最外层拥有构建的工程）
  const rn = detectReactNative(analysisRoot);
  const flutter = detectFlutter(analysisRoot);
  const unity = detectUnity(analysisRoot);
  let framework: ProjectAnalysis['framework'] = 'unknown';
  let nativeAndroid = false;
  let nativeIos = false;

  if (rn) {
    framework = 'react-native';
    evidence.push('package.json 依赖 react-native');
  } else if (flutter) {
    framework = 'flutter';
    evidence.push('pubspec.yaml 依赖 flutter sdk');
  } else if (unity) {
    framework = 'unity';
    evidence.push('存在 Assets/ 与 ProjectSettings/ 目录');
  } else {
    const android = detectAndroid(analysisRoot);
    const ios = detectIos(analysisRoot, '');
    if (android?.isNativeAppModule) {
      nativeAndroid = true;
      framework = 'android';
      evidence.push(`${android.gradleFile} 应用 com.android.application`);
    } else if (ios) {
      nativeIos = true;
      framework = 'ios';
      evidence.push('根目录存在 *.xcodeproj / Podfile / Package.swift');
    } else if (android) {
      // 有 gradle 但看不出应用模块
      framework = 'android';
      evidence.push(`存在 ${android.gradleFile}`);
      issues.push('未能确认 gradle 工程应用 com.android.application，按原生 Android 处理');
    }
  }

  // 原生目录可能属于外层 Flutter/RN/Unity 工程：取最外层拥有构建的工程
  if (nativeAndroid || nativeIos) {
    const owner = findOwningProject(dirname(analysisRoot));
    if (owner && owner.root !== analysisRoot) {
      issues.push(`给定的路径位于 ${owner.kind} 工程的子目录，已改按外层工程分析: ${owner.root}`);
      analysisRoot = owner.root;
      framework = owner.kind;
      nativeAndroid = false;
      nativeIos = false;
      evidence.push(`外层 ${owner.kind} 工程拥有构建（${analysisRoot}）`);
    }
  }

  const targets = { android: false, ios: false, web: false, desktop: false };
  let appName: string | undefined;
  let flutterSection: ProjectAnalysis['flutter'] | undefined;
  const identifiers: ProjectAnalysis['identifiers'] = {};

  if (framework === 'flutter') {
    const info = detectFlutter(analysisRoot)!;
    Object.assign(targets, info.targets);
    appName = info.appName;
    flutterSection = {
      dartSdkConstraint: info.dartSdkConstraint,
      entryFile: info.entryFile,
      hasMainRunApp: info.hasMainRunApp,
      dependencies: info.dependencies,
    };
  } else if (framework === 'react-native') {
    const info = detectReactNative(analysisRoot)!;
    appName = info.appName;
    targets.android = isDirectory(`${analysisRoot}/android`);
    targets.ios = isDirectory(`${analysisRoot}/ios`);
  } else if (framework === 'unity') {
    // Unity：targets 由 il2cpp 构建设置决定，MVP 不深入解析
  } else {
    targets.android = framework === 'android' || isDirectory(`${analysisRoot}/android`);
    targets.ios = framework === 'ios' || isDirectory(`${analysisRoot}/ios`);
  }

  // Android / iOS 平台信息
  let androidSection: ProjectAnalysis['android'] | undefined;
  let iosSection: ProjectAnalysis['ios'] | undefined;
  if (framework === 'flutter') {
    const android = detectAndroid(analysisRoot);
    if (android) {
      androidSection = {
        manifestPath: android.manifestPath,
        gradleFile: android.gradleFile,
        minSdk: android.minSdk,
        compileSdk: android.compileSdk,
        admobAppId: android.admobAppId,
      };
      identifiers.androidApplicationId = android.applicationId;
      if (android.minSdk === 'flutter-default' || android.compileSdk === 'flutter-default') {
        const defaults = resolveFlutterDefaults(analysisRoot);
        if (defaults.minSdk !== undefined && defaults.compileSdk !== undefined && androidSection) {
          androidSection.resolvedMinSdk = defaults.minSdk;
          androidSection.resolvedCompileSdk = defaults.compileSdk;
        } else {
          issues.push('未能解析 Flutter 默认 minSdk（未找到 Flutter SDK 或 FlutterExtension.kt）');
        }
      }
    }
    const ios = detectIos(analysisRoot, 'ios');
    if (ios) {
      iosSection = {
        infoPlistPath: ios.infoPlistPath,
        podfilePath: ios.podfilePath,
        deploymentTarget: ios.deploymentTarget,
        admobAppId: ios.admobAppId,
        skAdNetworkCount: ios.skAdNetworkCount,
        hasAttDescription: ios.hasAttDescription,
        pbxprojPath: ios.pbxprojPath,
      };
      identifiers.iosBundleId = ios.bundleId;
    }
  } else if (framework === 'android') {
    const android = detectAndroid(analysisRoot);
    if (android) {
      androidSection = {
        manifestPath: android.manifestPath,
        gradleFile: android.gradleFile,
        minSdk: android.minSdk,
        compileSdk: android.compileSdk,
        admobAppId: android.admobAppId,
      };
      identifiers.androidApplicationId = android.applicationId;
    }
  } else if (framework === 'ios') {
    const ios = detectIos(analysisRoot, '');
    if (ios) {
      iosSection = {
        infoPlistPath: ios.infoPlistPath,
        podfilePath: ios.podfilePath,
        deploymentTarget: ios.deploymentTarget,
        admobAppId: ios.admobAppId,
        skAdNetworkCount: ios.skAdNetworkCount,
        hasAttDescription: ios.hasAttDescription,
        pbxprojPath: ios.pbxprojPath,
      };
      identifiers.iosBundleId = ios.bundleId;
    }
  }

  const { existingAdCode, screens } = collectAdCodeAndScreens(analysisRoot);
  const existingAdSdks = collectExistingAdSdks(analysisRoot, flutterSection?.dependencies);

  const toolchain = options.skipToolchain ? {} : await detectToolchain();

  if (framework === 'unknown') {
    issues.push('未能识别项目框架（未命中 React Native / Flutter / Unity / 原生 Android / 原生 iOS 的判定条件）');
  }

  const analysis: ProjectAnalysis = {
    root: analysisRoot,
    framework,
    frameworkEvidence: evidence,
    targets,
    identifiers,
    existingAdSdks,
    existingAdCode,
    screens,
    git: detectGitState(analysisRoot),
    toolchain,
    issues,
  };
  if (appName !== undefined) analysis.appName = appName;
  if (flutterSection) analysis.flutter = flutterSection;
  if (androidSection) analysis.android = androidSection;
  if (iosSection) analysis.ios = iosSection;
  return analysis;
}
