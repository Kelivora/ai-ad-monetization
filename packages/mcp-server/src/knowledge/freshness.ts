import type { SourceRef } from '../lib/envelope.js';
import type { Source } from './schema.js';

const DAY_MS = 86_400_000;

/** 超过 reviewIntervalDays 未复核即视为 stale；日期非法时保守视为 stale。 */
export function isStale(retrievedAt: string, reviewIntervalDays: number, now: Date): boolean {
  const retrieved = new Date(`${retrievedAt}T00:00:00Z`).getTime();
  if (Number.isNaN(retrieved)) return true;
  return now.getTime() - retrieved > reviewIntervalDays * DAY_MS;
}

export function toSourceRefs(
  sources: Source[],
  reviewIntervalDays: number,
  now: Date,
): SourceRef[] {
  return sources.map((s) => ({
    title: s.title,
    url: s.url,
    retrievedAt: s.retrievedAt,
    ...(s.verifiedVersion != null ? { verifiedVersion: s.verifiedVersion } : {}),
    stale: isStale(s.retrievedAt, reviewIntervalDays, now),
  }));
}
