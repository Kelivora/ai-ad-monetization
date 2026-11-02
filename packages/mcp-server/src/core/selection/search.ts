import type { KnowledgeBase } from '../../knowledge/loader.js';
import type { AdFormat, Framework } from '../../knowledge/schema.js';

export interface SearchResult {
  platformId: string;
  displayName: string;
  vendor: string;
  type: 'network' | 'mediation';
  formats: AdFormat[];
  support?: { framework: Framework; level: string; package?: string | undefined; note?: string | undefined } | undefined;
  summary: string;
}

export interface SearchInput {
  query?: string | undefined;
  framework?: Framework | undefined;
  format?: AdFormat | undefined;
  market?: string | undefined;
}

export function searchPlatforms(kb: KnowledgeBase, input: SearchInput): SearchResult[] {
  const results: SearchResult[] = [];
  const q = input.query?.trim().toLowerCase();

  for (const entry of kb.index.platforms) {
    const platform = kb.getPlatform(entry.id);
    if (
      q &&
      ![platform.id, platform.displayName, platform.vendor].some((field) => field.toLowerCase().includes(q))
    ) {
      continue;
    }
    if (input.format && !platform.formats.includes(input.format)) continue;
    if (input.market) {
      try {
        const resolved = kb.resolveMarket(input.market);
        const fit = platform.editorial.selection.marketFit[resolved];
        if (fit !== undefined && fit <= 1) continue; // 该市场基本不可用则不展示
      } catch {
        // 未知市场不过滤
      }
    }
    const support = input.framework ? platform.frameworks[input.framework] : undefined;
    results.push({
      platformId: platform.id,
      displayName: platform.displayName,
      vendor: platform.vendor,
      type: platform.type,
      formats: platform.formats,
      support: support
        ? { framework: input.framework!, level: support.support, package: support.package, note: support.note }
        : undefined,
      summary: entry.summary,
    });
  }
  return results;
}
