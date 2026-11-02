import { readFileSync } from 'node:fs';
import { AppError } from '../../lib/errors.js';
import type { RevenueRow } from './types.js';

// ---- 表头别名映射（大小写不敏感）----
const HEADER_ALIASES: Record<string, keyof RevenueRow> = {
  date: 'date',
  country: 'country',
  'ad format': 'format',
  format: 'format',
  'ad unit': 'adUnit',
  app: 'app',
  platform: 'platform',
  'ad requests': 'requests',
  requests: 'requests',
  'matched requests': 'matchedRequests',
  impressions: 'impressions',
  clicks: 'clicks',
  'estimated earnings': 'earnings',
  earnings: 'earnings',
};

const NUMERIC_FIELDS: ReadonlySet<keyof RevenueRow> = new Set(['requests', 'matchedRequests', 'impressions', 'clicks', 'earnings']);

/** 解析带引号的 CSV 行（支持引号内逗号与转义引号 ""）。 */
export function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields.map((f) => f.trim());
}

/** 数字解析：去掉千分位逗号、货币符号、百分号与空白。 */
export function parseNumber(raw: string): number | undefined {
  const cleaned = raw.replace(/[\s,$€£¥%]/g, '').replace(/,(?=\d{3}\b)/g, '');
  if (cleaned === '' || cleaned === '-') return undefined;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : undefined;
}

function normalizeDate(raw: string): string | undefined {
  const value = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (/^\d{8}$/.test(value)) return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  return undefined;
}

/** 解析 AdMob 导出 CSV（支持 BOM、引号、注释行 `#`、千分位与货币符号）。 */
export function parseRevenueCsv(text: string): RevenueRow[] {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0 && !l.trimStart().startsWith('#'));
  if (lines.length < 2) return [];

  const header = splitCsvLine(lines[0]!).map((h) => h.toLowerCase().replace(/\s+/g, ' '));
  const columns: Array<{ index: number; field: keyof RevenueRow; currency?: string | undefined }> = [];
  header.forEach((name, index) => {
    // "estimated earnings (usd)" → earnings + currency=usd
    const currencyMatch = /^(.*?)\s*\((\s*([A-Za-z]{3})\s*)\)$/.exec(name);
    const base = (currencyMatch?.[1] ?? name).trim();
    const field = HEADER_ALIASES[base];
    if (!field) return;
    columns.push({ index, field, currency: currencyMatch?.[3]?.toUpperCase() });
  });
  if (!columns.some((c) => c.field === 'earnings')) {
    throw new AppError('INVALID_INPUT', 'CSV 缺少收益列（需要 Estimated earnings / Earnings 表头）');
  }

  const rows: RevenueRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const row: Record<string, unknown> = {};
    for (const col of columns) {
      const cell = cells[col.index] ?? '';
      if (col.field === 'date') {
        const date = normalizeDate(cell);
        if (date !== undefined) row['date'] = date;
      } else if (NUMERIC_FIELDS.has(col.field)) {
        const value = parseNumber(cell);
        if (value !== undefined) row[col.field] = value;
      } else if (cell !== '') {
        row[col.field] = col.field === 'format' ? cell.toLowerCase() : cell;
      }
      if (col.currency) row['currency'] = col.currency;
    }
    rows.push(row as RevenueRow);
  }
  return rows;
}

export interface ImportRevenueInput {
  filePath: string;
  startDate?: string | undefined; // YYYY-MM-DD，含端点
  endDate?: string | undefined;
}

function withinRange(date: string | undefined, start?: string, end?: string): boolean {
  if (!date) return true; // 没有 date 的行不按日期过滤
  if (start && date < start) return false;
  if (end && date > end) return false;
  return true;
}

/** 从 CSV/JSON 导出文件读取并归一化收益行。 */
export function importRevenueRows(input: ImportRevenueInput): RevenueRow[] {
  let text: string;
  try {
    text = readFileSync(input.filePath, 'utf8');
  } catch (err) {
    throw new AppError('INVALID_INPUT', `无法读取收益文件: ${input.filePath}`, {
      details: err instanceof Error ? err.message : String(err),
    });
  }

  let rows: RevenueRow[];
  const trimmed = text.replace(/^\uFEFF/, '').trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const list = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object' && Array.isArray((parsed as { rows?: unknown }).rows)
          ? ((parsed as { rows: unknown[] }).rows)
          : undefined;
      if (!list) throw new Error('既不是数组也不是 { rows: [...] }');
      rows = list as RevenueRow[];
    } catch (err) {
      throw new AppError('INVALID_INPUT', '收益 JSON 解析失败（需要 RevenueRow[] 或 { rows: [...] }）', {
        details: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    rows = parseRevenueCsv(text);
  }

  if (input.startDate || input.endDate) {
    rows = rows.filter((r) => withinRange(typeof r.date === 'string' ? r.date : undefined, input.startDate, input.endDate));
  }
  return rows;
}
