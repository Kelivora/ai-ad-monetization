import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AdFormat } from '../../../knowledge/schema.js';
import type { KnowledgeBase } from '../../../knowledge/loader.js';
import type { ProjectAnalysis } from '../../../core/project/types.js';
import { AppError } from '../../../lib/errors.js';
import { sha256, sha256Stable } from '../../../lib/hash.js';
import { readTextIfExists } from '../../../lib/fs.js';
import { hashableChanges, type PlannedFileChange, type PlannedIntegrationPlan } from '../../../core/patch/types.js';
import { unifiedDiff } from '../../../core/patch/diff.js';
import { patchPubspec } from '../../../core/patch/pubspec.js';
import { patchAndroidManifest } from '../../../core/patch/android-manifest.js';
import { patchPlist } from '../../../core/patch/plist.js';
import { patchGradle } from '../../../core/patch/gradle.js';
import { patchPodfile } from '../../../core/patch/podfile.js';
import { patchDartMain } from '../../../core/patch/dart-main.js';
import {
  renderAdUnitIds,
  renderAdsConsent,
  renderAdsInitializer,
} from './templates/options.js';
import {
  renderAdsBarrel,
  renderAnchoredBannerAd,
  renderInterstitialAdController,
  renderRewardedAdController,
} from './templates/ads_widgets.js';

/** 生成器支持的格式子集（MVP）。 */
export const GENERATABLE_FORMATS: readonly AdFormat[] = ['banner', 'interstitial', 'rewarded'];

export interface PlanFlutterInput {
  formats: AdFormat[];
  wireMain?: boolean; // 默认 true
  childDirected?: boolean; // 默认 false
  /** 已通过 optionsSchema 校验的适配器参数 */
  options?: Record<string, unknown>;
}

function parseMajor(constraint: string): number | undefined {
  const m = /(\d+)\./.exec(constraint);
  return m ? Number(m[1]) : undefined;
}

const MANUAL_STEPS = [
  '在 AdMob 后台创建应用，并为所选格式各创建一个广告单元（banner/interstitial/rewarded）。',
  '在 AdMob 后台 Privacy & messaging 创建并发布 GDPR（面向 EEA/UK/CH）与美国州法规合规消息。',
  '发布前把 AndroidManifest.xml 的 com.google.android.gms.ads.APPLICATION_ID 与 Info.plist 的 GADApplicationIdentifier 替换为真实 App ID（当前为 Google 示例 ID）。',
  '用 --dart-define=ADMOB_ANDROID_BANNER_ID=...（等）注入生产广告单元 ID，并在 release 口径下重新跑 validate_ad_config。',
  '在你的域名下发布 app-ads.txt（登记 AdMob 发布者 ID ca-app-pub-XXXXXXXXXXXXXXXX）。',
  '在应用的隐私/设置页面放置"隐私选项"入口：AdsConsent.isPrivacyOptionsRequired() 为 true 时展示，点击调用 AdsConsent.showPrivacyOptionsForm()。',
];

/**
 * AdMob × Flutter 集成计划（architecture.md 3.4）。
 * 变更按固定顺序排列；planHash 只覆盖 path/action/reason/beforeHash/content。
 */
export function planFlutterIntegration(
  analysis: ProjectAnalysis,
  input: PlanFlutterInput,
  kb: KnowledgeBase,
): PlannedIntegrationPlan {
  const formats = input.formats;
  if (formats.length === 0) {
    throw new AppError('INVALID_INPUT', 'formats 不能为空');
  }
  const unsupported = formats.filter((f) => !GENERATABLE_FORMATS.includes(f));
  if (unsupported.length > 0) {
    throw new AppError(
      'UNSUPPORTED_COMBINATION',
      `MVP 暂不支持自动生成格式: ${unsupported.join(', ')}（支持 banner/interstitial/rewarded）`,
    );
  }

  const sdk = kb.getSdk('admob', 'flutter');
  const testIds = kb.getTestIds('admob');
  if (!sdk.plugin.version) {
    throw new AppError('KNOWLEDGE_MISSING', '知识库缺少 google_mobile_ads 版本号（sdk/flutter.json plugin.version）');
  }
  const requiredMinSdk = sdk.android?.minSdk ?? 24;
  const requiredDeploymentTarget = sdk.ios?.deploymentTarget ?? '13.0';
  const versionConstraint = `^${sdk.plugin.version}`;
  const options = {
    childDirected: input.childDirected ?? false,
    interstitialMinIntervalSeconds:
      typeof input.options?.['interstitialMinIntervalSeconds'] === 'number'
        ? (input.options!['interstitialMinIntervalSeconds'] as number)
        : 180,
  };

  const warnings: string[] = [];
  const manualSteps: string[] = [];

  // 已有其他平台 SDK → 冲突提示
  for (const existing of analysis.existingAdSdks) {
    if (existing.platform !== 'admob') {
      warnings.push(`检测到其他广告 SDK ${existing.name}（${existing.platform}，${existing.location}），可能与 AdMob 冲突，请确认是否先移除。`);
    }
  }
  // 已有广告初始化代码 → 不动 main.dart
  let wireMain = input.wireMain ?? true;
  if (wireMain && analysis.existingAdCode.length > 0) {
    wireMain = false;
    manualSteps.push(
      `工程已有广告初始化代码（${analysis.existingAdCode.map((c) => c.file).join(', ')}），未改写 main.dart：请把 AdsInitializer.instance.initialize() 替换/合并到现有初始化处，避免重复初始化。`,
    );
  }

  const changes: PlannedFileChange[] = [];
  const root = analysis.root;

  /** modify/skip：读原文 → patcher → diff。 */
  const pushPatch = (
    rel: string | undefined,
    patch: (text: string) => ReturnType<typeof patchPubspec>,
  ): void => {
    if (!rel) return;
    const original = readTextIfExists(join(root, rel));
    if (original === undefined) {
      changes.push({ path: rel, action: 'skip', reason: `未找到 ${rel}` });
      return;
    }
    const result = patch(original);
    if (result.warnings) warnings.push(...result.warnings);
    const change: PlannedFileChange = {
      path: rel,
      action: result.action,
      reason: result.reason,
      beforeHash: sha256(original),
    };
    if (result.action === 'modify') {
      change.newText = result.newText;
      change.diff = unifiedDiff(original, result.newText, rel);
    }
    changes.push(change);
  };

  // 1. pubspec.yaml
  pushPatch('pubspec.yaml', (text) => {
    const result = patchPubspec(text, { dependency: sdk.plugin.name, version: versionConstraint });
    if (result.action === 'skip') {
      const existing = new RegExp(`${sdk.plugin.name}\\s*:\\s*(\\S+)`).exec(text)?.[1];
      if (existing) {
        const major = parseMajor(existing);
        if (major !== undefined && major < 9) {
          warnings.push(`已有 google_mobile_ads ${existing} 低于 9.x，建议升级到 ${versionConstraint}（工具不自动改已有约束）。`);
        }
      }
    }
    return result;
  });

  // 2. AndroidManifest.xml
  if (analysis.targets.android) {
    pushPatch(analysis.android?.manifestPath, (text) =>
      patchAndroidManifest(text, { appId: testIds.appId.android ?? '' }),
    );
  }

  // 3. Info.plist
  if (analysis.targets.ios) {
    pushPatch(analysis.ios?.infoPlistPath, (text) =>
      patchPlist(text, { appId: testIds.appId.ios ?? '', skadnetworkIds: kb.getSkadnetworkIds('admob') }),
    );
  }

  // 4. Android build.gradle(.kts) minSdk
  if (analysis.targets.android) {
    pushPatch(analysis.android?.gradleFile, (text) =>
      patchGradle(text, {
        minSdk: analysis.android?.minSdk,
        resolvedMinSdk: analysis.android?.resolvedMinSdk,
        requiredMinSdk,
      }),
    );
  }

  // 5. iOS Podfile（不存在则不创建）
  if (analysis.targets.ios && analysis.ios?.podfilePath) {
    pushPatch(analysis.ios.podfilePath, (text) =>
      patchPodfile(text, { minDeploymentTarget: requiredDeploymentTarget }),
    );
  }

  // 6. lib/main.dart 初始化接线
  if (wireMain) {
    pushPatch(analysis.flutter?.entryFile, (text) => patchDartMain(text));
    const last = changes[changes.length - 1];
    if (last && last.action === 'skip' && last.reason.includes('未找到 runApp')) {
      manualSteps.push('未能安全改写 lib/main.dart：请在 main() 的 runApp 之前手动加入 `AdsInitializer.instance.initialize();`（以及缺失时的 `WidgetsFlutterBinding.ensureInitialized();`）与 `import \'ads/ads.dart\';`。');
    }
  }

  // 7. lib/ads/ 代码文件（同名已存在 → skip）
  const templateOptions = {
    pluginVersion: sdk.plugin.version!,
    versionConstraint,
    testIds,
    childDirected: options.childDirected,
    interstitialMinIntervalSeconds: options.interstitialMinIntervalSeconds,
    formats,
  };
  const generated: Array<[string, string]> = [
    ['lib/ads/ad_unit_ids.dart', renderAdUnitIds(templateOptions)],
    ['lib/ads/ads_consent.dart', renderAdsConsent(templateOptions)],
    ['lib/ads/ads_initializer.dart', renderAdsInitializer(templateOptions)],
  ];
  if (formats.includes('banner')) {
    generated.push(['lib/ads/anchored_banner_ad.dart', renderAnchoredBannerAd(templateOptions)]);
  }
  if (formats.includes('interstitial')) {
    generated.push(['lib/ads/interstitial_ad_controller.dart', renderInterstitialAdController(templateOptions)]);
  }
  if (formats.includes('rewarded')) {
    generated.push(['lib/ads/rewarded_ad_controller.dart', renderRewardedAdController(templateOptions)]);
  }
  generated.push(['lib/ads/ads.dart', renderAdsBarrel(templateOptions, formats)]);
  for (const [rel, content] of generated) {
    const existing = readTextIfExists(join(root, rel));
    if (existing !== undefined) {
      changes.push({ path: rel, action: 'skip', reason: `${rel} 已存在，不覆盖`, beforeHash: sha256(existing) });
    } else {
      changes.push({ path: rel, action: 'create', reason: `生成 ${rel}`, content });
    }
  }

  // pbxproj 部署目标低于要求 → 只提示不改
  if (analysis.targets.ios && analysis.ios?.deploymentTarget) {
    const target = Number.parseFloat(analysis.ios.deploymentTarget);
    const required = Number.parseFloat(requiredDeploymentTarget);
    if (Number.isFinite(target) && Number.isFinite(required) && target < required) {
      warnings.push(`iOS 部署目标 ${analysis.ios.deploymentTarget} 低于 google_mobile_ads 要求的 ${requiredDeploymentTarget}，请自行在 Xcode 工程设置中提升（工具不改 project.pbxproj）。`);
      manualSteps.push(`把 Xcode 工程（Runner.xcodeproj）的 IPHONEOS_DEPLOYMENT_TARGET 从 ${analysis.ios.deploymentTarget} 提升到 ${requiredDeploymentTarget}。`);
    }
  }

  manualSteps.push(...MANUAL_STEPS);

  return {
    platform: 'admob',
    framework: 'flutter',
    formats,
    usesTestIds: true,
    changes,
    manualSteps,
    warnings,
    planHash: sha256Stable(hashableChanges(changes)),
  };
}
