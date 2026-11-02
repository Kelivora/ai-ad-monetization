import type { KnowledgeBase } from '../../knowledge/loader.js';
import type { Framework, PlatformId } from '../../knowledge/schema.js';

export interface CompareRow {
  platformId: PlatformId;
  displayName: string;
  supportLevel: string;
  supportNote?: string | undefined;
  package?: string | undefined;
  type: 'network' | 'mediation';
  formats: string[];
  reportingApi: string;
  officialSkill?: { name: string; install: string; repo: string; docsUrl: string } | undefined;
  editorialScores: Record<string, number>;
  marketFit: Record<string, number>;
}

export interface CompareResult {
  framework: Framework;
  markets: string[];
  rows: CompareRow[];
}

export function comparePlatforms(
  kb: KnowledgeBase,
  platformIds: PlatformId[],
  framework: Framework,
  markets: string[],
  now: Date,
): CompareResult {
  void now;
  const rows: CompareRow[] = [];
  for (const id of platformIds) {
    const platform = kb.getPlatform(id);
    const support = platform.frameworks[framework];
    rows.push({
      platformId: platform.id,
      displayName: platform.displayName,
      supportLevel: support.support,
      supportNote: support.note,
      package: support.package,
      type: platform.type,
      formats: platform.formats,
      reportingApi: platform.reporting.available
        ? (platform.reporting.api ?? platform.reporting.url ?? '见控制台')
        : '不可用',
      officialSkill: support.officialSkill,
      editorialScores: platform.editorial.selection.scores,
      marketFit: Object.fromEntries(
        markets.map((m) => [m, platform.editorial.selection.marketFit[m] ?? platform.editorial.selection.marketFit['global'] ?? 0]),
      ),
    });
  }
  return { framework, markets, rows };
}
