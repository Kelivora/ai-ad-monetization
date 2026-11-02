import type { PatchResult } from './types.js';

export interface PubspecPatchOptions {
  /** 依赖名，如 google_mobile_ads */
  dependency: string;
  /** 版本约束，如 ^9.2.0 */
  version: string;
}

/**
 * 在 dependencies 块末尾追加一行依赖，效果与 `flutter pub add` 一致（保留注释与空行）。
 * 已有该依赖 → skip（不覆盖，尤其是用户固定过的版本）。
 */
export function patchPubspec(originalText: string, opts: PubspecPatchOptions): PatchResult {
  const { dependency, version } = opts;
  const existing = new RegExp(`^(\\s*)${dependency}\\s*:\\s*(\\S+)`, 'm').exec(originalText);
  if (existing) {
    return {
      action: 'skip',
      newText: originalText,
      reason: `pubspec.yaml 已有 ${dependency} ${existing[2]}，未改动`,
    };
  }

  const lines = originalText.split('\n');
  const depStart = lines.findIndex((line) => /^dependencies\s*:\s*(#.*)?$/.test(line));
  if (depStart < 0) {
    return { action: 'skip', newText: originalText, reason: 'pubspec.yaml 中未找到 dependencies 块' };
  }
  // dependencies 块结束：下一个顶层的非注释非空行
  let depEnd = lines.length;
  for (let i = depStart + 1; i < lines.length; i++) {
    if (/^[^\s#].*:/.test(lines[i]!)) {
      depEnd = i;
      break;
    }
  }
  // 块内最后一个非空非注释行之后插入
  let insertAt = depStart + 1;
  for (let i = depStart + 1; i < depEnd; i++) {
    const trimmed = lines[i]!.trim();
    if (trimmed.length > 0 && !trimmed.startsWith('#')) insertAt = i + 1;
  }
  const indent = '  ';
  lines.splice(insertAt, 0, `${indent}${dependency}: ${version}`);
  return {
    action: 'modify',
    newText: lines.join('\n'),
    reason: `pubspec.yaml 添加 ${dependency} ${version}`,
  };
}
