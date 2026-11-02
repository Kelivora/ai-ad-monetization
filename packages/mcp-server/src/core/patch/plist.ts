import type { PatchResult } from './types.js';

export interface PlistPatchOptions {
  /** 测试用 iOS AdMob App ID */
  appId: string;
  /** 知识库 SKAdNetwork ID 全集 */
  skadnetworkIds: string[];
}

function skadEntry(indent: string, id: string): string[] {
  return [
    `${indent}<dict>`,
    `${indent}\t<key>SKAdNetworkIdentifier</key>`,
    `${indent}\t<string>${id}</string>`,
    `${indent}</dict>`,
  ];
}

/** 找到 SKAdNetworkItems 数组的 [keyIndex, closeIndex)（找不到返回 null）。 */
function findSkadArray(lines: string[]): { arrayEnd: number; entryIndent: string } | null {
  const keyIdx = lines.findIndex((line) => line.includes('<key>SKAdNetworkItems</key>'));
  if (keyIdx < 0) return null;
  const openIdx = lines.findIndex((line, i) => i > keyIdx && line.includes('<array>'));
  if (openIdx < 0) return null;
  const closeIdx = lines.findIndex((line, i) => i >= openIdx && line.includes('</array>'));
  if (closeIdx < 0) return null;
  const dictIdx = lines.findIndex((line, i) => i > openIdx && i < closeIdx && line.includes('<dict>'));
  const entryIndent = dictIdx > 0 ? /^[ \t]*/.exec(lines[dictIdx]!)![0] : '\t\t';
  return { arrayEnd: closeIdx, entryIndent };
}

/**
 * Info.plist 补丁：
 * - GADApplicationIdentifier：已有 → 保留；
 * - SKAdNetworkItems：已有 → 只补缺失项（无缺失则整体 skip）；没有 → 插入知识库全集。
 */
export function patchPlist(originalText: string, opts: PlistPatchOptions): PatchResult {
  const hasGad = originalText.includes('<key>GADApplicationIdentifier</key>');
  const lines = originalText.split('\n');
  const skad = findSkadArray(lines);
  const existingIds = skad
    ? lines
        .slice(0, skad.arrayEnd)
        .map((line) => /<string>([a-z0-9.]+\.skadnetwork)<\/string>/.exec(line)?.[1])
        .filter((id): id is string => id !== undefined)
    : [];
  const missing = skad ? opts.skadnetworkIds.filter((id) => !existingIds.includes(id)) : opts.skadnetworkIds;

  if (hasGad && skad && missing.length === 0) {
    return {
      action: 'skip',
      newText: originalText,
      reason: 'Info.plist 已有 GADApplicationIdentifier 与完整 SKAdNetworkItems',
    };
  }

  let newText = originalText;
  if (skad && missing.length > 0) {
    // 在现有 SKAdNetworkItems 数组末尾补缺失项
    const entryLines = missing.flatMap((id) => skadEntry(skad.entryIndent, id));
    const before = lines.slice(0, skad.arrayEnd);
    const after = lines.slice(skad.arrayEnd);
    newText = [...before, ...entryLines, ...after].join('\n');
  }
  if (!hasGad || !skad) {
    // 最外层 </dict> 前插入缺失部分
    const closeIdx = newText.lastIndexOf('</dict>');
    if (closeIdx < 0) {
      return { action: 'skip', newText: originalText, reason: 'Info.plist 中未找到 </dict>' };
    }
    const parts: string[] = [];
    if (!hasGad) {
      parts.push('\t<key>GADApplicationIdentifier</key>', `\t<string>${opts.appId}</string>`);
    }
    if (!skad) {
      parts.push('\t<key>SKAdNetworkItems</key>', '\t<array>');
      for (const id of opts.skadnetworkIds) parts.push(...skadEntry('\t\t', id));
      parts.push('\t</array>');
    }
    newText = `${newText.slice(0, closeIdx)}${parts.join('\n')}\n${newText.slice(closeIdx)}`;
  }
  const reasons: string[] = [];
  if (!hasGad) reasons.push('GADApplicationIdentifier（Google 示例 iOS App ID）');
  if (missing.length > 0 || !skad) reasons.push(`SKAdNetworkItems（补 ${skad ? missing.length : opts.skadnetworkIds.length} 个 Google ID）`);
  return { action: 'modify', newText, reason: `Info.plist 插入 ${reasons.join('、')}` };
}
