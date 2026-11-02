/** 简单基于 LCS 的 unified diff（3 行上下文），不引入外部依赖。 */

type Op = { type: 'eq' | 'del' | 'ins'; line: string };

function diffOps(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  // dp[i][j] = LCS(a[i:], b[j:])；补丁文件行数不大，O(n*m) 可接受
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: 'eq', line: a[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push({ type: 'del', line: a[i]! });
      i++;
    } else {
      ops.push({ type: 'ins', line: b[j]! });
      j++;
    }
  }
  while (i < n) {
    ops.push({ type: 'del', line: a[i]! });
    i++;
  }
  while (j < m) {
    ops.push({ type: 'ins', line: b[j]! });
    j++;
  }
  return ops;
}

export function unifiedDiff(oldText: string, newText: string, path: string, context = 3): string {
  if (oldText === newText) return '';
  const a = oldText.endsWith('\n') ? oldText.slice(0, -1).split('\n') : oldText.split('\n');
  const b = newText.endsWith('\n') ? newText.slice(0, -1).split('\n') : newText.split('\n');
  const ops = diffOps(a, b);

  const changeIdx = ops.map((op, idx) => (op.type === 'eq' ? -1 : idx)).filter((idx) => idx >= 0);
  if (changeIdx.length === 0) return '';

  // 变更分组：相邻变更之间 eq 间隔 <= 2*context 时合并为一个 hunk
  const groups: Array<[number, number]> = [];
  let groupStart = changeIdx[0]!;
  let groupEnd = changeIdx[0]!;
  for (const idx of changeIdx.slice(1)) {
    if (idx - groupEnd - 1 <= 2 * context) {
      groupEnd = idx;
    } else {
      groups.push([groupStart, groupEnd]);
      groupStart = idx;
      groupEnd = idx;
    }
  }
  groups.push([groupStart, groupEnd]);

  const lines: string[] = [`--- a/${path}`, `+++ b/${path}`];
  for (const [gs, ge] of groups) {
    const from = Math.max(0, gs - context);
    const to = Math.min(ops.length - 1, ge + context);
    let oldStart = 1;
    let newStart = 1;
    for (let k = 0; k < from; k++) {
      if (ops[k]!.type !== 'ins') oldStart++;
      if (ops[k]!.type !== 'del') newStart++;
    }
    let oldCount = 0;
    let newCount = 0;
    for (let k = from; k <= to; k++) {
      if (ops[k]!.type !== 'ins') oldCount++;
      if (ops[k]!.type !== 'del') newCount++;
    }
    lines.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    for (let k = from; k <= to; k++) {
      const op = ops[k]!;
      lines.push(`${op.type === 'eq' ? ' ' : op.type === 'del' ? '-' : '+'}${op.line}`);
    }
  }
  return `${lines.join('\n')}\n`;
}
