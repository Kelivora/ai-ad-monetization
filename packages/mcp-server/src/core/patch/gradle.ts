import type { PatchResult } from './types.js';

export interface GradlePatchOptions {
  /** analyze 解析出的 minSdk：字面量 / 'flutter-default' / undefined */
  minSdk?: number | 'flutter-default' | undefined;
  /** flutter-default 时解析出的 Flutter 默认值 */
  resolvedMinSdk?: number | undefined;
  /** google_mobile_ads 要求的最低 minSdk */
  requiredMinSdk: number;
}

/**
 * minSdk 补丁：字面量低于要求 → 改为要求值；'flutter-default' 且解析值满足 → skip；
 * 解析不到 → skip 并带 warning（plan 层透出）。
 */
export function patchGradle(originalText: string, opts: GradlePatchOptions): PatchResult {
  const line = /^([ \t]*minSdk[ \t]*=[ \t]*)(.+?)(\/\/.*)?$/m.exec(originalText);
  if (!line) {
    return {
      action: 'skip',
      newText: originalText,
      reason: 'build.gradle 中未找到 minSdk 配置',
      warnings: ['未能定位 minSdk，请人工确认 Android minSdk 满足 google_mobile_ads 要求（>= 24）'],
    };
  }
  const value = line[2]!.trim();

  if (value.startsWith('flutter.')) {
    if (opts.resolvedMinSdk === undefined) {
      return {
        action: 'skip',
        newText: originalText,
        reason: `minSdk = ${value}（Flutter 默认），未能解析默认值，未改动`,
        warnings: ['未能解析 Flutter 默认 minSdk，请人工确认其满足 google_mobile_ads 要求（>= 24）'],
      };
    }
    if (opts.resolvedMinSdk >= opts.requiredMinSdk) {
      return {
        action: 'skip',
        newText: originalText,
        reason: `minSdk 使用 Flutter 默认值（当前 SDK 默认 ${opts.resolvedMinSdk}），已满足 >= ${opts.requiredMinSdk}`,
      };
    }
    const newText = originalText.replace(
      /^([ \t]*minSdk[ \t]*=[ \t]*).+?((\/\/.*)?)$/m,
      `$1${opts.requiredMinSdk}$2`,
    );
    return {
      action: 'modify',
      newText,
      reason: `Flutter 默认 minSdk（${opts.resolvedMinSdk}）低于 google_mobile_ads 要求，显式设为 ${opts.requiredMinSdk}`,
    };
  }

  const literal = Number(value);
  if (!Number.isFinite(literal)) {
    return {
      action: 'skip',
      newText: originalText,
      reason: `minSdk 值 "${value}" 无法解析，未改动`,
      warnings: [`minSdk 值 "${value}" 无法解析，请人工确认满足 >= ${opts.requiredMinSdk}`],
    };
  }
  if (literal >= opts.requiredMinSdk) {
    return {
      action: 'skip',
      newText: originalText,
      reason: `minSdk = ${literal}，已满足 >= ${opts.requiredMinSdk}`,
    };
  }
  const newText = originalText.replace(
    /^([ \t]*minSdk[ \t]*=[ \t]*).+?((\/\/.*)?)$/m,
    `$1${opts.requiredMinSdk}$2`,
  );
  return {
    action: 'modify',
    newText,
    reason: `minSdk ${literal} 低于 google_mobile_ads 要求，改为 ${opts.requiredMinSdk}`,
  };
}
