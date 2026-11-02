import type { PatchResult } from './types.js';

export interface DartMainPatchOptions {
  /** lib/ads 统一导出的相对 import */
  adsImportPath?: string; // 默认 'ads/ads.dart'
}

export const BEGIN_MARKER = '// ai-ad-monetization:begin';
export const END_MARKER = '// ai-ad-monetization:end';
export const RUNAPP_NOT_FOUND_REASON = 'lib/main.dart 中未找到 runApp 调用，无法安全插入初始化代码';

/**
 * main.dart 补丁：在 main 函数里第一个 runApp 之前插入带标记的初始化片段
 * （缺 WidgetsFlutterBinding.ensureInitialized 时一并插入；AdsInitializer 不 await）。
 * 已有 begin 标记 / 找不到 runApp / 无法安全改写箭头函数 → skip（plan 层转 manualStep）。
 */
export function patchDartMain(originalText: string, opts: DartMainPatchOptions = {}): PatchResult {
  const adsImport = `import '${opts.adsImportPath ?? 'ads/ads.dart'}';`;

  if (originalText.includes(BEGIN_MARKER)) {
    return { action: 'skip', newText: originalText, reason: 'lib/main.dart 已有 ai-ad-monetization 标记片段' };
  }
  if (!/runApp\s*\(/.test(originalText)) {
    return { action: 'skip', newText: originalText, reason: RUNAPP_NOT_FOUND_REASON };
  }

  let text = originalText;
  let changed = false;

  // 箭头函数写法：void main() => runApp(const MyApp()); → 改写为块函数体
  const arrow = /^([ \t]*(?:[A-Za-z_<>, \t]+\s+)?main\s*\([^)]*\))[ \t]*=>[ \t]*(runApp\(.+\));[ \t]*$/m.exec(text);
  if (arrow) {
    const block = `${arrow[1]} {\n${' '.repeat(arrow[1]!.startsWith(' ') ? arrow[1]!.length - arrow[1]!.trimStart().length + 2 : 2)}}`;
    text = text.replace(arrow[0], `${block}  ${arrow[2]};\n}`);
    changed = true;
  }

  const lines = text.split('\n');
  const runAppIdx = lines.findIndex((line) => /runApp\s*\(/.test(line));
  if (runAppIdx < 0) {
    return { action: 'skip', newText: originalText, reason: RUNAPP_NOT_FOUND_REASON };
  }
  const indentMatch = /^([ \t]*)/.exec(lines[runAppIdx]!);
  const indent = indentMatch ? indentMatch[1]! : '';

  const snippet: string[] = [`${indent}${BEGIN_MARKER}`];
  if (!originalText.includes('WidgetsFlutterBinding.ensureInitialized()')) {
    snippet.push(`${indent}WidgetsFlutterBinding.ensureInitialized();`);
  }
  snippet.push(`${indent}AdsInitializer.instance.initialize(); // not awaited: do not block startup`, `${indent}${END_MARKER}`);
  lines.splice(runAppIdx, 0, ...snippet);
  changed = true;
  text = lines.join('\n');

  // import 区末尾追加 ads 导出（已有则不加）
  if (!text.includes(adsImport)) {
    const importLines = text.split('\n');
    let lastImport = -1;
    for (let i = 0; i < importLines.length; i++) {
      if (/^import\s+/.test(importLines[i]!)) lastImport = i;
    }
    if (lastImport >= 0) {
      importLines.splice(lastImport + 1, 0, adsImport);
      text = importLines.join('\n');
    } else {
      // 没有 import：插到文件开头
      text = `${adsImport}\n${text}`;
    }
  }

  if (!changed) {
    return { action: 'skip', newText: originalText, reason: 'lib/main.dart 无需改动' };
  }
  return {
    action: 'modify',
    newText: text,
    reason: 'lib/main.dart 在 runApp 前插入 AdsInitializer 初始化（带 ai-ad-monetization 标记）',
  };
}
