import type { ErrorCode, ToolErrorEnvelope } from './envelope.js';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly hint?: string;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, options?: { hint?: string; details?: unknown }) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    if (options?.hint !== undefined) this.hint = options.hint;
    if (options?.details !== undefined) this.details = options.details;
  }
}

/** 把任意异常归一为 ToolError 信封；未知异常不外泄内部细节。 */
export function toToolError(err: unknown): ToolErrorEnvelope {
  if (err instanceof AppError) {
    const error: ToolErrorEnvelope['error'] = { code: err.code, message: err.message };
    if (err.hint !== undefined) error.hint = err.hint;
    if (err.details !== undefined) error.details = err.details;
    return { ok: false, error };
  }
  if (err instanceof Error) {
    return { ok: false, error: { code: 'INTERNAL', message: err.message } };
  }
  return { ok: false, error: { code: 'INTERNAL', message: String(err) } };
}
