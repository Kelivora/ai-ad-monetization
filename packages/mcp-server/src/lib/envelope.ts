import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export interface SourceRef {
  title: string;
  url: string;
  retrievedAt: string; // ISO 日期
  verifiedVersion?: string; // 例如 "google_mobile_ads 9.2.0"
  stale: boolean; // 超过 reviewIntervalDays 未复核
}

export type ErrorCode =
  | 'INVALID_INPUT'
  | 'PROJECT_NOT_FOUND'
  | 'UNSUPPORTED_FRAMEWORK'
  | 'UNSUPPORTED_COMBINATION'
  | 'DIRTY_WORKTREE'
  | 'CONFIRMATION_REQUIRED'
  | 'PLAN_MISMATCH'
  | 'TOOLCHAIN_MISSING'
  | 'COMMAND_FAILED'
  | 'AUTH_REQUIRED'
  | 'KNOWLEDGE_MISSING'
  | 'INTERNAL';

export interface ToolResult<T> {
  ok: true;
  summary: string;
  data: T;
  warnings: string[];
  sources: SourceRef[];
  nextSteps: string[];
}

export interface ToolErrorEnvelope {
  ok: false;
  error: { code: ErrorCode; message: string; hint?: string; details?: unknown };
}

export type ToolEnvelope<T> = ToolResult<T> | ToolErrorEnvelope;

export interface OkInput<T> {
  summary: string;
  data: T;
  warnings?: string[];
  sources?: SourceRef[];
  nextSteps?: string[];
}

export function ok<T>(input: OkInput<T>): CallToolResult {
  const envelope: ToolResult<T> = {
    ok: true,
    summary: input.summary,
    data: input.data,
    warnings: input.warnings ?? [],
    sources: input.sources ?? [],
    nextSteps: input.nextSteps ?? [],
  };
  return {
    content: [{ type: 'text', text: input.summary }],
    structuredContent: envelope as unknown as Record<string, unknown>,
  };
}

export function fail(error: ToolErrorEnvelope['error']): CallToolResult {
  const envelope: ToolErrorEnvelope = { ok: false, error };
  const text = error.hint ? `${error.message} (hint: ${error.hint})` : error.message;
  return {
    content: [{ type: 'text', text }],
    structuredContent: envelope as unknown as Record<string, unknown>,
    isError: true,
  };
}
