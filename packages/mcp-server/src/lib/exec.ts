import { spawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';

export interface ExecResult {
  exitCode: number; // 命令不存在时为 -1，超时时为 -2
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export interface RunOptions {
  cwd?: string;
  timeoutMs?: number;
}

/** 运行外部命令；绝不抛异常（命令不存在 exitCode=-1，超时 timedOut=true 且 exitCode=-2）。 */
export function run(cmd: string, args: string[], options: RunOptions = {}): Promise<ExecResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, {
        cwd: options.cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      resolve({
        exitCode: -1,
        stdout: '',
        stderr: `无法启动命令: ${cmd}`,
        timedOut: false,
        durationMs: Date.now() - started,
      });
      return;
    }
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, options.timeoutMs ?? 10_000);

    const finish = (exitCode: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode,
        stdout,
        stderr,
        timedOut,
        durationMs: Date.now() - started,
      });
    };

    child.on('error', (err) => {
      stderr += err.message;
      finish(-1);
    });
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      if (stdout.length > 1_000_000) child.kill('SIGKILL');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > 1_000_000) child.kill('SIGKILL');
    });
    child.on('close', (code) => {
      finish(timedOut ? -2 : (code ?? -1));
    });
  });
}

/** 同步探测命令是否存在于 PATH（用于 which 类场景）。 */
export function whichSync(cmd: string): string | undefined {
  const pathVar = process.env['PATH'] ?? '';
  for (const dir of pathVar.split(':')) {
    if (!dir) continue;
    const candidate = `${dir.endsWith('/') ? dir : `${dir}/`}${cmd}`;
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // 继续找下一个目录
    }
  }
  return undefined;
}
