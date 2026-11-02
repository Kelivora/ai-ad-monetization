import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';

/**
 * 三种工具注解（architecture.md 第 4 节）：
 * - READ：只读，readOnlyHint: true
 * - WRITE：修改用户工程，destructiveHint: true 且必须人工确认
 * - EXEC：执行本地命令但不改源码
 */
export const READ: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export const WRITE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
};

export const EXEC: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

/** 写工具的 _meta 标记：强制客户端在调用前与用户确认 */
export const REQUIRES_INTERACTION_META = { 'anthropic/requiresUserInteraction': true } as const;
