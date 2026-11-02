import type { PatchResult } from './types.js';

export interface PubspecPatchOptions {
  /** 依赖名，如 google_mobile_ads / integration_test */
  dependency: string;
  /** 版本约束，如 ^9.2.0（与 insertLines 二选一） */
  version?: string;
  /** 写入哪个依赖段，默认 dependencies */
  section?: 'dependencies' | 'dev_dependencies';
  /** 自定义插入的行（已含缩进），如 sdk 依赖的两行写法；默认 `${dependency}: ${version}` */
  insertLines?: string[];
}

/**
 * 在指定依赖块末尾追加一行依赖，效果与 `flutter pub add` 一致（保留注释与空行）。
 * 已有该依赖（任意段、单值或 sdk: flutter 写法）→ skip（不覆盖，尤其是用户固定过的版本）。
 * section=dev_dependencies 且工程没有该段时新建（紧跟 dependencies 块之后）。
 */
export function patchPubspec(originalText: string, opts: PubspecPatchOptions): PatchResult {
  const { dependency, version, section = 'dependencies' } = opts;
  const defaultLine = version !== undefined ? `  ${dependency}: ${version}` : undefined;
  const insertLines = opts.insertLines ?? (defaultLine !== undefined ? [defaultLine] : undefined);
  if (!insertLines || insertLines.length === 0) {
    return { action: 'skip', newText: originalText, reason: `patchPubspec 缺少 version 或 insertLines（${dependency}）` };
  }

  // 单行写法 `dep: ^1.0` 时带出已有约束；sdk: flutter 等多行写法只判存在
  const existingSameLine = new RegExp(`^(\\s*)${dependency}\\s*:\\s*(\\S+)`, 'm').exec(originalText);
  const existingAny = new RegExp(`^\\s*${dependency}\\s*:\\s*(\\S|$)`, 'm').exec(originalText);
  if (existingAny) {
    const constraint = existingSameLine?.[2];
    return {
      action: 'skip',
      newText: originalText,
      reason: constraint
        ? `pubspec.yaml 已有 ${dependency} ${constraint}，未改动`
        : `pubspec.yaml 已有 ${dependency} 依赖，未改动`,
    };
  }

  const lines = originalText.split('\n');
  const header = section === 'dev_dependencies' ? 'dev_dependencies' : 'dependencies';
  const sectionStart = lines.findIndex((line) => new RegExp(`^${header}\\s*:\\s*(#.*)?$`).test(line));
  if (sectionStart < 0) {
    if (section === 'dependencies') {
      return { action: 'skip', newText: originalText, reason: 'pubspec.yaml 中未找到 dependencies 块' };
    }
    // 没有 dev_dependencies 段 → 新建：插在 dependencies 块结束（下一个顶层键）之后
    const depStart = lines.findIndex((line) => /^dependencies\s*:\s*(#.*)?$/.test(line));
    let insertAt = lines.length;
    if (depStart >= 0) {
      insertAt = lines.length;
      for (let i = depStart + 1; i < lines.length; i++) {
        if (/^[^\s#].*:/.test(lines[i]!)) {
          insertAt = i;
          break;
        }
      }
    }
    lines.splice(insertAt, 0, '', `${header}:`, ...insertLines);
    return {
      action: 'modify',
      newText: lines.join('\n'),
      reason: `pubspec.yaml 添加 ${header}: ${dependency}`,
    };
  }

  // 块结束：下一个顶层的非注释非空行
  let sectionEnd = lines.length;
  for (let i = sectionStart + 1; i < lines.length; i++) {
    if (/^[^\s#].*:/.test(lines[i]!)) {
      sectionEnd = i;
      break;
    }
  }
  // 块内最后一个非空非注释行之后插入
  let insertAt = sectionStart + 1;
  for (let i = sectionStart + 1; i < sectionEnd; i++) {
    const trimmed = lines[i]!.trim();
    if (trimmed.length > 0 && !trimmed.startsWith('#')) insertAt = i + 1;
  }
  lines.splice(insertAt, 0, ...insertLines);
  return {
    action: 'modify',
    newText: lines.join('\n'),
    reason: `pubspec.yaml 添加 ${dependency}（${header}）`,
  };
}
