import type { PatchResult } from './types.js';

export interface AndroidManifestPatchOptions {
  /** 测试用 AdMob App ID（ca-app-pub-...~...） */
  appId: string;
}

const APPLICATION_ID_NAME = 'com.google.android.gms.ads.APPLICATION_ID';

/**
 * 在 <application ...> 开始标签后插入带注释的 AdMob APPLICATION_ID meta-data。
 * 已有 APPLICATION_ID → skip（绝不覆盖真实 App ID）。
 */
export function patchAndroidManifest(originalText: string, opts: AndroidManifestPatchOptions): PatchResult {
  if (originalText.includes(APPLICATION_ID_NAME)) {
    return {
      action: 'skip',
      newText: originalText,
      reason: 'AndroidManifest.xml 已有 AdMob APPLICATION_ID，保留现有 App ID',
    };
  }
  const appTag = /<[?]?application\b/.exec(originalText);
  const applicationMatch = /<application\b[^>]*>/.exec(originalText);
  if (!applicationMatch || !appTag) {
    return { action: 'skip', newText: originalText, reason: 'AndroidManifest.xml 中未找到 <application> 标签' };
  }
  // <application 开始标签所在行的缩进决定子节点缩进
  const tagStart = applicationMatch.index;
  const lineStart = originalText.lastIndexOf('\n', tagStart) + 1;
  const indentMatch = /^[ \t]*/.exec(originalText.slice(lineStart, tagStart));
  const baseIndent = indentMatch ? indentMatch[0] : '';
  const childIndent = `${baseIndent}    `;
  const attrIndent = `${childIndent}    `;
  const insertAt = tagStart + applicationMatch[0].length;
  const snippet = [
    `${childIndent}<!-- ai-ad-monetization: Google sample AdMob app ID for testing. Replace before release. -->`,
    `${childIndent}<meta-data`,
    `${attrIndent}android:name="${APPLICATION_ID_NAME}"`,
    `${attrIndent}android:value="${opts.appId}" />`,
  ].join('\n');
  const newText = `${originalText.slice(0, insertAt)}\n${snippet}${originalText.slice(insertAt)}`;
  return {
    action: 'modify',
    newText,
    reason: `AndroidManifest.xml 添加 Google 示例 AdMob App ID（${opts.appId}）`,
  };
}
