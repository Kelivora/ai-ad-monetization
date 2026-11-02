import type { SourceRef } from '../../../lib/envelope.js';
import { listDartFiles, readTextIfExists } from '../../../lib/fs.js';
import { join } from 'node:path';
import { toSourceRefs } from '../../../knowledge/freshness.js';
import type { RuleContext, ValidationFinding, ValidationRule } from '../../types.js';

export type { RuleContext, ValidationFinding, ValidationRule };

// ---- 工具函数 ----

function parseVersion(v: string): number[] {
  return v.split(/[.+-]/).map((p) => Number(p) || 0);
}

function compareVersion(a: string, b: string): number {
  const av = parseVersion(a);
  const bv = parseVersion(b);
  for (let i = 0; i < Math.max(av.length, bv.length); i++) {
    const x = av[i] ?? 0;
    const y = bv[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** ^3.13.7 / >=3.10.0 / 3.10.0 → 下界版本号。 */
function constraintLowerBound(constraint: string): string | undefined {
  const m = /(>=|\^)?\s*(\d+\.\d+(\.\d+)?)/.exec(constraint);
  return m?.[2];
}

const GDPR_MARKETS = ['EEA', 'UK', 'CH'];

/** 收集 lib 下所有 .dart 文件（含 lib/ads/）。 */
function collectDartSources(ctx: RuleContext): Array<{ file: string; text: string }> {
  const libDir = join(ctx.analysis.root, 'lib');
  return listDartFiles(libDir)
    .map((rel) => ({ file: `lib/${rel}`, text: readTextIfExists(join(libDir, rel)) ?? '' }))
    .filter((entry) => entry.text.length > 0);
}

function testIdSource(ctx: RuleContext): SourceRef | undefined {
  return toSourceRefs(ctx.kb.getTestIds('admob').sources, ctx.kb.getTestIds('admob').reviewIntervalDays, new Date())[0];
}

function sdkSource(ctx: RuleContext): SourceRef | undefined {
  const sdk = ctx.kb.getSdk('admob', 'flutter');
  return toSourceRefs(sdk.sources, sdk.reviewIntervalDays, new Date())[0];
}

// ---- 规则 ----

export function admobFlutterRules(): ValidationRule[] {
  return [
    {
      id: 'ADMOB_PLUGIN_PRESENT',
      title: 'google_mobile_ads 插件已安装',
      category: 'config',
      check: (ctx) => {
        const deps = ctx.analysis.flutter?.dependencies ?? {};
        if (deps['google_mobile_ads'] !== undefined) {
          return { ruleId: 'ADMOB_PLUGIN_PRESENT', title: 'google_mobile_ads 插件已安装', status: 'pass', message: `pubspec.yaml 依赖 google_mobile_ads ${deps['google_mobile_ads']}` };
        }
        return {
          ruleId: 'ADMOB_PLUGIN_PRESENT',
          title: 'google_mobile_ads 插件已安装',
          status: 'fail',
          message: 'pubspec.yaml 中没有 google_mobile_ads 依赖',
          fix: '运行 generate_ad_integration 或 flutter pub add google_mobile_ads',
        };
      },
    },
    {
      id: 'ADMOB_PLUGIN_VERSION',
      title: 'google_mobile_ads 主版本 >= 9',
      category: 'config',
      check: (ctx) => {
        const constraint = ctx.analysis.flutter?.dependencies?.['google_mobile_ads'];
        if (constraint === undefined) {
          return { ruleId: 'ADMOB_PLUGIN_VERSION', title: 'google_mobile_ads 主版本 >= 9', status: 'na', message: '未安装 google_mobile_ads' };
        }
        const required = String(ctx.kb.getSdk('admob', 'flutter').plugin.version).split('.')[0]!;
        const bound = constraintLowerBound(constraint);
        if (bound === undefined) {
          return { ruleId: 'ADMOB_PLUGIN_VERSION', title: 'google_mobile_ads 主版本 >= 9', status: 'warning', message: `无法解析版本约束 ${constraint}` };
        }
        const major = parseVersion(bound)[0] ?? 0;
        if (major >= Number(required)) {
          return { ruleId: 'ADMOB_PLUGIN_VERSION', title: 'google_mobile_ads 主版本 >= 9', status: 'pass', message: `版本约束 ${constraint} 满足 ${required}.x` };
        }
        return {
          ruleId: 'ADMOB_PLUGIN_VERSION',
          title: 'google_mobile_ads 主版本 >= 9',
          status: 'warning',
          message: `版本约束 ${constraint} 低于 ${required}.x，可能缺少最新 API/合规能力`,
          fix: `flutter pub upgrade --major-versions google_mobile_ads`,
        };
      },
    },
    {
      id: 'DART_SDK_CONSTRAINT',
      title: 'Dart SDK 约束满足插件要求',
      category: 'config',
      check: (ctx) => {
        const constraint = ctx.analysis.flutter?.dartSdkConstraint;
        const required = ctx.kb.getSdk('admob', 'flutter').constraints.dart ?? '>=3.10.0'; // 如 ">=3.10.0"
        if (constraint === undefined) {
          return { ruleId: 'DART_SDK_CONSTRAINT', title: 'Dart SDK 约束满足插件要求', status: 'na', message: 'pubspec.yaml 未声明 environment.sdk' };
        }
        const lower = constraintLowerBound(constraint);
        const reqVersion = required.replace(/[>=<^]/g, '');
        if (lower === undefined || compareVersion(lower, reqVersion) < 0) {
          return {
            ruleId: 'DART_SDK_CONSTRAINT',
            title: 'Dart SDK 约束满足插件要求',
            status: 'fail',
            message: `Dart SDK 约束 ${constraint} 低于 google_mobile_ads 要求（${required}）`,
            fix: '提升 environment.sdk 下界或升级 Flutter',
          };
        }
        return { ruleId: 'DART_SDK_CONSTRAINT', title: 'Dart SDK 约束满足插件要求', status: 'pass', message: `Dart SDK 约束 ${constraint} 满足 ${required}` };
      },
    },
    {
      id: 'ANDROID_APP_ID',
      title: 'Android Manifest 配置 AdMob App ID',
      category: 'config',
      check: (ctx) => {
        if (!ctx.analysis.targets.android) {
          return { ruleId: 'ANDROID_APP_ID', title: 'Android Manifest 配置 AdMob App ID', status: 'na', message: '工程不含 Android 目标' };
        }
        const appId = ctx.analysis.android?.admobAppId;
        if (!appId) {
          return {
            ruleId: 'ANDROID_APP_ID',
            title: 'Android Manifest 配置 AdMob App ID',
            status: 'fail',
            message: 'AndroidManifest.xml 缺少 com.google.android.gms.ads.APPLICATION_ID',
            fix: '在 <application> 内添加 APPLICATION_ID meta-data',
          };
        }
        const regex = new RegExp(ctx.kb.getTestIds('admob').regex.appId);
        if (!regex.test(appId)) {
          return { ruleId: 'ANDROID_APP_ID', title: 'Android Manifest 配置 AdMob App ID', status: 'fail', message: `App ID "${appId}" 格式不合法（应为 ca-app-pub-XXX~YYY）`, file: ctx.analysis.android?.manifestPath };
        }
        return { ruleId: 'ANDROID_APP_ID', title: 'Android Manifest 配置 AdMob App ID', status: 'pass', message: `Android App ID: ${appId}`, file: ctx.analysis.android?.manifestPath };
      },
    },
    {
      id: 'IOS_APP_ID',
      title: 'Info.plist 配置 GADApplicationIdentifier',
      category: 'config',
      check: (ctx) => {
        if (!ctx.analysis.targets.ios) {
          return { ruleId: 'IOS_APP_ID', title: 'Info.plist 配置 GADApplicationIdentifier', status: 'na', message: '工程不含 iOS 目标' };
        }
        const appId = ctx.analysis.ios?.admobAppId;
        if (!appId) {
          return {
            ruleId: 'IOS_APP_ID',
            title: 'Info.plist 配置 GADApplicationIdentifier',
            status: 'fail',
            message: 'Info.plist 缺少 GADApplicationIdentifier',
            fix: '在 Info.plist 顶层 dict 添加 GADApplicationIdentifier',
          };
        }
        const regex = new RegExp(ctx.kb.getTestIds('admob').regex.appId);
        if (!regex.test(appId)) {
          return { ruleId: 'IOS_APP_ID', title: 'Info.plist 配置 GADApplicationIdentifier', status: 'fail', message: `App ID "${appId}" 格式不合法（应为 ca-app-pub-XXX~YYY）`, file: ctx.analysis.ios?.infoPlistPath };
        }
        return { ruleId: 'IOS_APP_ID', title: 'Info.plist 配置 GADApplicationIdentifier', status: 'pass', message: `iOS App ID: ${appId}`, file: ctx.analysis.ios?.infoPlistPath };
      },
    },
    {
      id: 'APP_ID_PLATFORM_MISMATCH',
      title: 'App ID 与平台匹配',
      category: 'config',
      check: (ctx) => {
        const testIds = ctx.kb.getTestIds('admob');
        const androidId = ctx.analysis.android?.admobAppId;
        const iosId = ctx.analysis.ios?.admobAppId;
        if (androidId && androidId === testIds.appId.ios) {
          return { ruleId: 'APP_ID_PLATFORM_MISMATCH', title: 'App ID 与平台匹配', status: 'fail', message: 'AndroidManifest.xml 使用了 iOS 的 App ID', file: ctx.analysis.android?.manifestPath, fix: '替换为 Android App ID' };
        }
        if (iosId && iosId === testIds.appId.android) {
          return { ruleId: 'APP_ID_PLATFORM_MISMATCH', title: 'App ID 与平台匹配', status: 'fail', message: 'Info.plist 使用了 Android 的 App ID', file: ctx.analysis.ios?.infoPlistPath, fix: '替换为 iOS App ID' };
        }
        return { ruleId: 'APP_ID_PLATFORM_MISMATCH', title: 'App ID 与平台匹配', status: 'pass', message: '未发现跨平台的 App ID 误用' };
      },
    },
    {
      id: 'TEST_APP_ID',
      title: 'App ID 使用 Google 测试 ID',
      category: 'release',
      check: (ctx) => {
        const prefix = ctx.kb.getTestIds('admob').prefix;
        const findings: ValidationFinding[] = [];
        const ids: Array<[string, string | undefined, string | undefined]> = [
          ['Android', ctx.analysis.android?.admobAppId, ctx.analysis.android?.manifestPath],
          ['iOS', ctx.analysis.ios?.admobAppId, ctx.analysis.ios?.infoPlistPath],
        ];
        for (const [platform, appId, file] of ids) {
          if (!appId || !ctx.analysis.targets[platform.toLowerCase() as 'android' | 'ios']) continue;
          const isTest = appId.startsWith(prefix);
          findings.push({
            ruleId: 'TEST_APP_ID',
            title: 'App ID 使用 Google 测试 ID',
            status: isTest ? (ctx.profile === 'release' ? 'fail' : 'pass') : 'pass',
            message: isTest
              ? ctx.profile === 'release'
                ? `${platform} 正在使用 Google 测试 App ID（${appId}），上线前必须替换为真实 App ID`
                : `${platform} 正在使用 Google 测试 App ID（${appId}），开发阶段可安全请求广告`
              : `${platform} 使用真实 App ID`,
            file,
            fix: isTest ? `在 AdMob 后台创建应用，替换 ${platform} 的 App ID` : undefined,
            source: testIdSource(ctx),
          });
        }
        if (findings.length === 0) {
          findings.push({ ruleId: 'TEST_APP_ID', title: 'App ID 使用 Google 测试 ID', status: 'na', message: '未发现可检查的 App ID' });
        }
        return findings;
      },
    },
    {
      id: 'TEST_AD_UNIT',
      title: '广告单元使用 Google 测试 ID',
      category: 'release',
      check: (ctx) => {
        const prefix = ctx.kb.getTestIds('admob').prefix;
        const sources = collectDartSources(ctx);
        const testHits: string[] = [];
        let anyAdUnit = false;
        for (const { file, text } of sources) {
          for (const m of text.matchAll(/ca-app-pub-[a-zA-Z0-9\-]+[~/][^\s'"`)]*/g)) {
            anyAdUnit = true;
            if (m[0]!.startsWith(prefix)) {
              testHits.push(`${file}: ${m[0]}`);
              break;
            }
          }
        }
        if (!anyAdUnit) {
          return { ruleId: 'TEST_AD_UNIT', title: '广告单元使用 Google 测试 ID', status: 'na', message: 'Dart 代码中未发现广告单元 ID（可能通过 AdUnitIds 常量间接引用）' };
        }
        if (testHits.length === 0) {
          return { ruleId: 'TEST_AD_UNIT', title: '广告单元使用 Google 测试 ID', status: 'pass', message: '未发现硬编码的测试广告单元 ID' };
        }
        return {
          ruleId: 'TEST_AD_UNIT',
          title: '广告单元使用 Google 测试 ID',
          status: ctx.profile === 'release' ? 'fail' : 'pass',
          message:
            ctx.profile === 'release'
              ? `发现 ${testHits.length} 个文件硬编码 Google 测试广告单元 ID，上线前必须用 --dart-define 注入生产 ID`
              : `正在使用 Google 测试广告单元 ID（${testHits.length} 个文件），开发阶段可安全展示测试广告`,
          file: testHits[0]?.split(':')[0],
          fix: '用 --dart-define=ADMOB_ANDROID_BANNER_ID=... 等覆盖默认测试 ID',
          source: testIdSource(ctx),
        };
      },
    },
    {
      id: 'AD_UNIT_FORMAT',
      title: '广告单元 ID 格式合法',
      category: 'code',
      check: (ctx) => {
        const regexes = ctx.kb.getTestIds('admob').regex;
        const appIdRe = new RegExp(regexes.appId);
        const adUnitRe = new RegExp(regexes.adUnit);
        const findings: ValidationFinding[] = [];
        for (const { file, text } of collectDartSources(ctx)) {
          for (const m of text.matchAll(/ca-app-pub-[a-zA-Z0-9\-]+[~/][^\s'"`)]*/g)) {
            const id = m[0]!;
            if (!appIdRe.test(id) && !adUnitRe.test(id)) {
              findings.push({
                ruleId: 'AD_UNIT_FORMAT',
                title: '广告单元 ID 格式合法',
                status: 'fail',
                message: `疑似格式错误的广告 ID: ${id}`,
                file,
                fix: 'App ID 形如 ca-app-pub-XXX~YYY，广告单元形如 ca-app-pub-XXX/YYY',
              });
            }
          }
        }
        if (findings.length > 0) return findings;
        return { ruleId: 'AD_UNIT_FORMAT', title: '广告单元 ID 格式合法', status: 'pass', message: '未发现格式错误的广告 ID' };
      },
    },
    {
      id: 'ANDROID_MIN_SDK',
      title: 'Android minSdk >= 24',
      category: 'config',
      check: (ctx) => {
        if (!ctx.analysis.targets.android) {
          return { ruleId: 'ANDROID_MIN_SDK', title: 'Android minSdk >= 24', status: 'na', message: '工程不含 Android 目标' };
        }
        const required = ctx.kb.getSdk('admob', 'flutter').android?.minSdk ?? 24;
        const raw = ctx.analysis.android?.minSdk;
        const effective = typeof raw === 'number' ? raw : ctx.analysis.android?.resolvedMinSdk;
        if (effective === undefined) {
          return {
            ruleId: 'ANDROID_MIN_SDK',
            title: 'Android minSdk >= 24',
            status: 'warning',
            message: '未能解析 minSdk（可能是 flutter 默认值且未找到 Flutter SDK）',
            fix: `确认 minSdk >= ${required}`,
          };
        }
        if (effective < required) {
          return { ruleId: 'ANDROID_MIN_SDK', title: 'Android minSdk >= 24', status: 'fail', message: `minSdk = ${effective}，低于 google_mobile_ads 要求的 ${required}`, fix: `在 build.gradle 中设置 minSdk = ${required}` };
        }
        return { ruleId: 'ANDROID_MIN_SDK', title: 'Android minSdk >= 24', status: 'pass', message: `minSdk = ${effective}（${raw === 'flutter-default' ? 'Flutter 默认值' : '显式设置'}）` };
      },
    },
    {
      id: 'IOS_DEPLOYMENT_TARGET',
      title: 'iOS 部署目标 >= 13.0',
      category: 'config',
      check: (ctx) => {
        if (!ctx.analysis.targets.ios) {
          return { ruleId: 'IOS_DEPLOYMENT_TARGET', title: 'iOS 部署目标 >= 13.0', status: 'na', message: '工程不含 iOS 目标' };
        }
        const required = ctx.kb.getSdk('admob', 'flutter').ios?.deploymentTarget ?? '13.0';
        const target = ctx.analysis.ios?.deploymentTarget;
        if (!target) {
          return { ruleId: 'IOS_DEPLOYMENT_TARGET', title: 'iOS 部署目标 >= 13.0', status: 'warning', message: '未能解析 iOS 部署目标', fix: `确认 IPHONEOS_DEPLOYMENT_TARGET >= ${required}` };
        }
        if (compareVersion(target, required) < 0) {
          return { ruleId: 'IOS_DEPLOYMENT_TARGET', title: 'iOS 部署目标 >= 13.0', status: 'fail', message: `iOS 部署目标 ${target} 低于 ${required}`, fix: `在 Xcode / Podfile 中提升部署目标到 ${required}` };
        }
        return { ruleId: 'IOS_DEPLOYMENT_TARGET', title: 'iOS 部署目标 >= 13.0', status: 'pass', message: `iOS 部署目标 ${target}` };
      },
    },
    {
      id: 'IOS_SKADNETWORK',
      title: 'Info.plist 含 Google SKAdNetwork ID',
      category: 'config',
      check: (ctx) => {
        if (!ctx.analysis.targets.ios) {
          return { ruleId: 'IOS_SKADNETWORK', title: 'Info.plist 含 Google SKAdNetwork ID', status: 'na', message: '工程不含 iOS 目标' };
        }
        const plistRel = ctx.analysis.ios?.infoPlistPath;
        const text = plistRel ? ctx.readFile(plistRel) : undefined;
        if (!text) {
          return { ruleId: 'IOS_SKADNETWORK', title: 'Info.plist 含 Google SKAdNetwork ID', status: 'warning', message: '未能读取 Info.plist', file: plistRel };
        }
        const existing = new Set(
          [...text.matchAll(/<string>([a-z0-9.]+\.skadnetwork)<\/string>/g)].map((m) => m[1]!),
        );
        const requiredIds = ctx.kb.getSkadnetworkIds('admob');
        const missing = requiredIds.filter((id) => !existing.has(id));
        if (missing.length === 0) {
          return { ruleId: 'IOS_SKADNETWORK', title: 'Info.plist 含 Google SKAdNetwork ID', status: 'pass', message: `SKAdNetworkItems 已包含全部 ${requiredIds.length} 个 Google ID`, file: plistRel };
        }
        return {
          ruleId: 'IOS_SKADNETWORK',
          title: 'Info.plist 含 Google SKAdNetwork ID',
          status: ctx.profile === 'release' ? 'fail' : 'warning',
          message: `SKAdNetworkItems 缺少 ${missing.length}/${requiredIds.length} 个 Google ID（缺失会影响 iOS 广告归因与填充）`,
          file: plistRel,
          fix: '重新运行 generate_ad_integration 补齐，或从 Google 文档复制全集',
        };
      },
    },
    {
      id: 'SDK_INITIALIZED',
      title: 'MobileAds 已初始化',
      category: 'code',
      check: (ctx) => {
        const hit = collectDartSources(ctx).find((s) => s.text.includes('MobileAds.instance.initialize'));
        if (hit) {
          return { ruleId: 'SDK_INITIALIZED', title: 'MobileAds 已初始化', status: 'pass', message: `在 ${hit.file} 中调用 MobileAds.instance.initialize()` };
        }
        return {
          ruleId: 'SDK_INITIALIZED',
          title: 'MobileAds 已初始化',
          status: 'fail',
          message: '未找到 MobileAds.instance.initialize() 调用',
          fix: '在 main() 中使用生成的 AdsInitializer，或手动初始化',
        };
      },
    },
    {
      id: 'CONSENT_FLOW',
      title: 'UMP 同意流程完整',
      category: 'compliance',
      check: (ctx) => {
        const sources = collectDartSources(ctx);
        const hasInfo = sources.some((s) => s.text.includes('requestConsentInfoUpdate'));
        const hasForm = sources.some((s) => s.text.includes('loadAndShowConsentFormIfRequired'));
        if (hasInfo && hasForm) {
          return { ruleId: 'CONSENT_FLOW', title: 'UMP 同意流程完整', status: 'pass', message: 'requestConsentInfoUpdate → loadAndShowConsentFormIfRequired 均存在' };
        }
        const needsGdpr = ctx.markets.some((m) => GDPR_MARKETS.includes(m));
        return {
          ruleId: 'CONSENT_FLOW',
          title: 'UMP 同意流程完整',
          status: needsGdpr ? 'fail' : 'warning',
          message: `缺少 ${[!hasInfo && 'requestConsentInfoUpdate', !hasForm && 'loadAndShowConsentFormIfRequired'].filter(Boolean).join('、')}${needsGdpr ? '（目标市场含 GDPR 管辖区，属强制要求）' : '（建议接入 UMP 以覆盖 EEA/UK/CH 市场）'}`,
          fix: '使用生成的 AdsConsent/AdsInitializer，或按 UMP 文档接入',
        };
      },
    },
    {
      id: 'CAN_REQUEST_ADS_GATE',
      title: '初始化前检查 canRequestAds',
      category: 'compliance',
      check: (ctx) => {
        const hit = collectDartSources(ctx).find((s) => s.text.includes('canRequestAds'));
        if (hit) {
          return { ruleId: 'CAN_REQUEST_ADS_GATE', title: '初始化前检查 canRequestAds', status: 'pass', message: `在 ${hit.file} 中检查 canRequestAds()` };
        }
        const needsGdpr = ctx.markets.some((m) => GDPR_MARKETS.includes(m));
        return {
          ruleId: 'CAN_REQUEST_ADS_GATE',
          title: '初始化前检查 canRequestAds',
          status: needsGdpr ? 'fail' : 'warning',
          message: '初始化前未检查 UMP 的 canRequestAds()（GDPR 市场下未经同意请求广告违反政策）',
          fix: '使用生成的 AdsInitializer',
        };
      },
    },
    {
      id: 'PRIVACY_OPTIONS_ENTRY',
      title: '隐私选项入口',
      category: 'compliance',
      check: (ctx) => {
        const hit = collectDartSources(ctx).find((s) => !s.file.startsWith('lib/ads/') && s.text.includes('showPrivacyOptionsForm'));
        if (hit) {
          return { ruleId: 'PRIVACY_OPTIONS_ENTRY', title: '隐私选项入口', status: 'pass', message: `${hit.file} 中有隐私选项表单入口` };
        }
        const needsGdpr = ctx.markets.some((m) => GDPR_MARKETS.includes(m));
        if (!needsGdpr) {
          return { ruleId: 'PRIVACY_OPTIONS_ENTRY', title: '隐私选项入口', status: 'na', message: '目标市场不含 EEA/UK/CH，UMP 隐私选项入口非强制' };
        }
        return {
          ruleId: 'PRIVACY_OPTIONS_ENTRY',
          title: '隐私选项入口',
          status: 'warning',
          message: 'lib/ads/ 之外没有 showPrivacyOptionsForm 调用：需在隐私/设置页面放置"隐私选项"入口（AdsConsent.isPrivacyOptionsRequired() 为 true 时展示）',
          fix: '在设置页添加入口并调用 AdsConsent.showPrivacyOptionsForm()',
        };
      },
    },
    {
      id: 'BANNER_DISPOSE',
      title: 'BannerAd 使用后释放',
      category: 'code',
      check: (ctx) => {
        const findings: ValidationFinding[] = [];
        for (const { file, text } of collectDartSources(ctx)) {
          if (!text.includes('BannerAd(')) continue;
          findings.push({
            ruleId: 'BANNER_DISPOSE',
            title: 'BannerAd 使用后释放',
            status: text.includes('.dispose()') ? 'pass' : 'fail',
            message: text.includes('.dispose()') ? `${file} 正确释放 BannerAd` : `${file} 创建了 BannerAd 但未调用 dispose()（内存泄漏）`,
            file,
            fix: '在 State.dispose / 广告卸载回调中调用 ad.dispose()',
          });
        }
        if (findings.length === 0) {
          findings.push({ ruleId: 'BANNER_DISPOSE', title: 'BannerAd 使用后释放', status: 'na', message: '未使用 BannerAd' });
        }
        return findings;
      },
    },
    {
      id: 'FULLSCREEN_DISPOSE',
      title: '插屏/激励广告释放',
      category: 'code',
      check: (ctx) => {
        const findings: ValidationFinding[] = [];
        for (const { file, text } of collectDartSources(ctx)) {
          const usesFullscreen = text.includes('InterstitialAd.load') || text.includes('RewardedAd.load');
          if (!usesFullscreen) continue;
          findings.push({
            ruleId: 'FULLSCREEN_DISPOSE',
            title: '插屏/激励广告释放',
            status: text.includes('.dispose()') ? 'pass' : 'fail',
            message: text.includes('.dispose()') ? `${file} 正确释放全屏广告` : `${file} 加载了插屏/激励广告但未调用 dispose()`,
            file,
            fix: '在 onAdDismissedFullScreenContent / onAdFailedToShowFullScreenContent 中 dispose 并重新加载',
          });
        }
        if (findings.length === 0) {
          findings.push({ ruleId: 'FULLSCREEN_DISPOSE', title: '插屏/激励广告释放', status: 'na', message: '未使用插屏/激励广告' });
        }
        return findings;
      },
    },
    {
      id: 'DEPRECATED_BANNER_SIZE_API',
      title: '未使用废弃的自适应横幅 API',
      category: 'code',
      check: (ctx) => {
        const deprecated = ['getAnchoredAdaptiveBannerAdSize(', 'getCurrentOrientationAnchoredAdaptiveBannerAdSize('];
        for (const { file, text } of collectDartSources(ctx)) {
          const api = deprecated.find((a) => text.includes(a) && !text.includes('getLargeAnchoredAdaptiveBannerAdSize('));
          if (api) {
            return {
              ruleId: 'DEPRECATED_BANNER_SIZE_API',
              title: '未使用废弃的自适应横幅 API',
              status: 'warning',
              message: `${file} 使用了已废弃的 ${api.replace('(', '')}，应改用 getLargeAnchoredAdaptiveBannerAdSize`,
              file,
              fix: '改用 AdSize.getLargeAnchoredAdaptiveBannerAdSize(width)',
            };
          }
        }
        return { ruleId: 'DEPRECATED_BANNER_SIZE_API', title: '未使用废弃的自适应横幅 API', status: 'pass', message: '未发现废弃的横幅尺寸 API' };
      },
    },
    {
      id: 'CHILD_DIRECTED_TAG',
      title: '面向儿童应用设置 child-directed 标记',
      category: 'compliance',
      check: (ctx) => {
        if (!ctx.childDirected) {
          return { ruleId: 'CHILD_DIRECTED_TAG', title: '面向儿童应用设置 child-directed 标记', status: 'na', message: '未声明面向儿童（childDirected=false）' };
        }
        const hit = collectDartSources(ctx).find((s) => s.text.includes('tagForChildDirectedTreatment'));
        if (hit) {
          return { ruleId: 'CHILD_DIRECTED_TAG', title: '面向儿童应用设置 child-directed 标记', status: 'pass', message: `${hit.file} 设置了 tagForChildDirectedTreatment（COPPA）` };
        }
        return {
          ruleId: 'CHILD_DIRECTED_TAG',
          title: '面向儿童应用设置 child-directed 标记',
          status: 'fail',
          message: '声明了面向儿童但未设置 tagForChildDirectedTreatment（COPPA 合规要求）',
          fix: '初始化前调用 MobileAds.instance.updateRequestConfiguration(RequestConfiguration(tagForChildDirectedTreatment: TagForChildDirectedTreatment.yes))',
          source: sdkSource(ctx),
        };
      },
    },
  ];
}
