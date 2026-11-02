import type { AdFormat, PlatformId } from '../../knowledge/schema.js';
import type { Framework } from '../../knowledge/schema.js';

/** 单个 patcher 的纯函数结果：modify 表示 newText 为改后的完整文件内容。 */
export interface PatchResult {
  action: 'modify' | 'skip';
  newText: string;
  reason: string;
  warnings?: string[];
}

/** architecture.md 3.4 FileChange；diff 与 content 只在输出时填充。 */
export interface FileChange {
  path: string; // 相对工程根
  action: 'create' | 'modify' | 'skip';
  reason: string;
  beforeHash?: string; // modify/skip 时原文件 sha256
  diff?: string; // unified diff
  content?: string; // create 时的完整内容（plan 输出时可截断）
}

/** apply 阶段使用的内部结构：modify 变更需要改后的完整文本。 */
export interface PlannedFileChange extends FileChange {
  newText?: string;
}

export interface PlannedIntegrationPlan {
  platform: PlatformId;
  framework: Framework;
  formats: AdFormat[];
  usesTestIds: true; // MVP 恒为 true
  changes: PlannedFileChange[];
  manualSteps: string[];
  warnings: string[];
  planHash: string; // sha256(稳定序列化的 changes，去掉 diff/newText)
}

/** 参与 planHash 的稳定投影（diff 与内部字段不进哈希）。 */
export function hashableChanges(changes: PlannedFileChange[]): Array<Record<string, unknown>> {
  return changes.map((c) => {
    const base: Record<string, unknown> = { path: c.path, action: c.action, reason: c.reason };
    if (c.beforeHash !== undefined) base.beforeHash = c.beforeHash;
    if (c.content !== undefined) base.content = c.content;
    return base;
  });
}
