import type { PatchResult } from './types.js';

export interface PodfilePatchOptions {
  /** 要求的最低部署目标，如 '13.0' */
  minDeploymentTarget: string;
}

function parseVersion(v: string): number[] {
  return v.split('.').map((p) => Number(p) || 0);
}

function lessThan(a: string, b: string): boolean {
  const av = parseVersion(a);
  const bv = parseVersion(b);
  for (let i = 0; i < Math.max(av.length, bv.length); i++) {
    const x = av[i] ?? 0;
    const y = bv[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

/**
 * Podfile 补丁：未注释的 platform :ios 低于要求 → 提升到要求值。
 * 注意：Podfile 不存在时 plan 层不会调用本函数（不创建 Podfile，Flutter 会自行生成或用 SPM）。
 */
export function patchPodfile(originalText: string, opts: PodfilePatchOptions): PatchResult {
  const platform = /^([ \t]*)platform[ \t]*:[ \t]*ios,[ \t]*['"]([^'"]+)['"][ \t]*$/m.exec(originalText);
  if (!platform) {
    return {
      action: 'skip',
      newText: originalText,
      reason: 'Podfile 中未找到 platform :ios 声明，未改动',
    };
  }
  const current = platform[2]!;
  if (lessThan(current, opts.minDeploymentTarget)) {
    const newText = originalText.replace(platform[0], `${platform[1]}platform :ios, '${opts.minDeploymentTarget}'`);
    return {
      action: 'modify',
      newText,
      reason: `Podfile platform :ios ${current} 低于 google_mobile_ads 要求，改为 ${opts.minDeploymentTarget}`,
    };
  }
  return {
    action: 'skip',
    newText: originalText,
    reason: `Podfile platform :ios ${current}，已满足 >= ${opts.minDeploymentTarget}`,
  };
}
