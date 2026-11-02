import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { AppError } from '../lib/errors.js';
import {
  BenchmarksSchema,
  type BenchmarksFile,
  type ErrorsFile,
  ErrorsSchema,
  type Framework,
  IndexSchema,
  type KnowledgeIndex,
  MarketsSchema,
  type MarketsFile,
  type PlatformFile,
  type PlatformId,
  PlatformSchema,
  PlacementRulesSchema,
  type PlacementRulesFile,
  type PrivacyFile,
  PrivacySchema,
  type SdkFile,
  SdkSchema,
  type SkadnetworkFile,
  SkadnetworkSchema,
  type TestIdsFile,
  TestIdsSchema,
} from './schema.js';

export interface DocEntry {
  file: string; // 相对知识库根
  topic: string;
  framework: string;
  source: string;
  retrievedAt: string;
  verifiedVersion?: string;
  body: string;
}

function readJson(dir: string, rel: string): unknown {
  const file = join(dir, rel);
  if (!existsSync(file)) {
    throw new AppError('KNOWLEDGE_MISSING', `知识文件缺失: ${rel}`);
  }
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new AppError('KNOWLEDGE_MISSING', `知识文件不是合法 JSON: ${rel}`, {
      details: err instanceof Error ? err.message : String(err),
    });
  }
}

/** 定位知识库根目录：优先环境变量 AD_MONETIZATION_KB，否则从本模块位置逐级向上找 knowledge/index.json。 */
export function findKnowledgeDir(startDir?: string): string {
  const fromEnv = process.env['AD_MONETIZATION_KB'];
  if (fromEnv) {
    const dir = resolve(fromEnv);
    if (!existsSync(join(dir, 'index.json'))) {
      throw new AppError('KNOWLEDGE_MISSING', `AD_MONETIZATION_KB 指向的目录没有 index.json: ${dir}`);
    }
    return dir;
  }
  let dir = startDir ?? dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(dir, 'knowledge', 'index.json'))) return join(dir, 'knowledge');
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new AppError('KNOWLEDGE_MISSING', '未找到知识库（向上查找 knowledge/index.json 失败）');
}

export class KnowledgeBase {
  readonly dir: string;
  readonly index: KnowledgeIndex;
  private readonly platforms: Map<string, PlatformFile>;
  private readonly sdks: Map<string, SdkFile>; // key: `${platformId}/${framework}`
  private readonly testIds: Map<string, TestIdsFile>;
  private readonly privacy: Map<string, PrivacyFile>;
  private readonly errors: Map<string, ErrorsFile>;
  private readonly skadnetwork: Map<string, SkadnetworkFile>;
  private readonly placementRules: PlacementRulesFile | undefined;
  private readonly markets: MarketsFile | undefined;
  private readonly benchmarks: BenchmarksFile | undefined;

  constructor(dir: string) {
    this.dir = dir;
    this.index = IndexSchema.parse(readJson(dir, 'index.json'));

    this.platforms = new Map();
    for (const p of this.index.platforms) {
      const parsed = PlatformSchema.parse(readJson(dir, join(p.path, 'platform.json')));
      if (parsed.id !== p.id) {
        throw new AppError('KNOWLEDGE_MISSING', `platform.json 的 id (${parsed.id}) 与 index.json 不一致: ${p.id}`);
      }
      this.platforms.set(p.id, parsed);
    }

    const maybe = <T>(rel: string, parse: (v: unknown) => T): T | undefined =>
      existsSync(join(dir, rel)) ? parse(readJson(dir, rel)) : undefined;

    this.sdks = new Map();
    this.testIds = new Map();
    this.privacy = new Map();
    this.errors = new Map();
    this.skadnetwork = new Map();
    for (const p of this.index.platforms) {
      const sdk = maybe(join(p.path, 'sdk/flutter.json'), (v) => SdkSchema.parse(v));
      if (sdk) this.sdks.set(`${p.id}/flutter`, sdk);
      const t = maybe(join(p.path, 'test-ids.json'), (v) => TestIdsSchema.parse(v));
      if (t) this.testIds.set(p.id, t);
      const pr = maybe(join(p.path, 'privacy.json'), (v) => PrivacySchema.parse(v));
      if (pr) this.privacy.set(p.id, pr);
      const er = maybe(join(p.path, 'errors.json'), (v) => ErrorsSchema.parse(v));
      if (er) this.errors.set(p.id, er);
      const sk = maybe(join(p.path, 'skadnetwork.json'), (v) => SkadnetworkSchema.parse(v));
      if (sk) this.skadnetwork.set(p.id, sk);
    }

    this.placementRules = maybe('common/placement-rules.json', (v) => PlacementRulesSchema.parse(v));
    this.markets = maybe('common/markets.json', (v) => MarketsSchema.parse(v));
    this.benchmarks = maybe('common/benchmarks.json', (v) => BenchmarksSchema.parse(v));
  }

  getPlatform(id: PlatformId): PlatformFile {
    const p = this.platforms.get(id);
    if (!p) throw new AppError('KNOWLEDGE_MISSING', `未知平台: ${id}`);
    return p;
  }

  getSdk(platformId: PlatformId, framework: Framework): SdkFile {
    const key = `${platformId}/${framework}`;
    const sdk = this.sdks.get(key);
    if (!sdk) {
      throw new AppError('KNOWLEDGE_MISSING', `平台 ${platformId} 没有框架 ${framework} 的 SDK 知识`);
    }
    return sdk;
  }

  getTestIds(platformId: PlatformId): TestIdsFile {
    return this.require(this.testIds.get(platformId), `test-ids (${platformId})`);
  }

  getPrivacy(platformId: PlatformId): PrivacyFile {
    return this.require(this.privacy.get(platformId), `privacy (${platformId})`);
  }

  getErrors(platformId: PlatformId): ErrorsFile {
    return this.require(this.errors.get(platformId), `errors (${platformId})`);
  }

  getSkadnetworkIds(platformId: PlatformId = 'admob'): string[] {
    return this.require(this.skadnetwork.get(platformId), `skadnetwork (${platformId})`).ids;
  }

  getPlacementRules(): PlacementRulesFile {
    return this.require(this.placementRules, 'common/placement-rules.json');
  }

  getMarkets(): MarketsFile {
    return this.require(this.markets, 'common/markets.json');
  }

  getBenchmarks(): BenchmarksFile {
    return this.require(this.benchmarks, 'common/benchmarks.json');
  }

  /** 别名/大小写不敏感地解析市场（如 "EU" → "EEA"）；解析不了抛 KNOWLEDGE_MISSING。 */
  resolveMarket(alias: string): string {
    const markets = this.getMarkets().markets;
    const key = alias.trim().toUpperCase();
    const byId = markets.find((m) => m.id.toUpperCase() === key);
    if (byId) return byId.id;
    const byAlias = markets.find((m) => m.aliases.some((a) => a.toUpperCase() === key));
    if (byAlias) return byAlias.id;
    throw new AppError('KNOWLEDGE_MISSING', `未知市场别名: ${alias}`);
  }

  /**
   * 读取平台文档。文件命名为 docs/<topic>.md（默认框架）或 docs/<framework>-<topic>.md；
   * frontmatter 的 framework 必须与请求一致。
   */
  getDoc(platformId: PlatformId, topic: string, framework: Framework = 'flutter'): DocEntry {
    this.getPlatform(platformId); // 确认平台存在
    const candidates =
      framework === 'flutter' ? [`${topic}.md`, `flutter-${topic}.md`] : [`${framework}-${topic}.md`, `${topic}.md`];
    for (const name of candidates) {
      const file = join(this.dir, 'platforms', platformId, 'docs', name);
      if (!existsSync(file)) continue;
      const entry = parseDoc(file, `platforms/${platformId}/docs/${name}`);
      if (entry.framework !== framework) continue;
      return entry;
    }
    throw new AppError('KNOWLEDGE_MISSING', `没有文档: ${platformId}/${framework}/${topic}`);
  }

  /** 列出平台可用文档 topic（docs/*.md 文件名，去掉框架前缀与扩展名）。 */
  listDocTopics(platformId: PlatformId): string[] {
    this.getPlatform(platformId);
    const dir = join(this.dir, 'platforms', platformId, 'docs');
    if (!existsSync(dir)) return [];
    try {
      return readdirSync(dir)
        .filter((name) => name.endsWith('.md'))
        .map((name) => name.replace(/\.md$/, '').replace(/^(flutter|android|ios|unity|react-native)-/, ''))
        .filter((topic, index, all) => all.indexOf(topic) === index)
        .sort();
    } catch {
      return [];
    }
  }

  private require<T>(value: T | undefined, what: string): T {
    if (value === undefined) throw new AppError('KNOWLEDGE_MISSING', `知识缺失: ${what}`);
    return value;
  }
}

function parseDoc(file: string, rel: string): DocEntry {
  const raw = readFileSync(file, 'utf8');
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw);
  if (!m) throw new AppError('KNOWLEDGE_MISSING', `文档缺少 frontmatter: ${rel}`);
  const fm = parseYaml(m[1]!) as Record<string, unknown>;
  const doc: DocEntry = {
    file: rel,
    topic: String(fm['topic'] ?? ''),
    framework: String(fm['framework'] ?? ''),
    source: String(fm['source'] ?? ''),
    retrievedAt: String(fm['retrievedAt'] ?? ''),
    body: m[2]!.trim(),
  };
  if (fm['verifiedVersion'] != null) doc.verifiedVersion = String(fm['verifiedVersion']);
  return doc;
}

let cached: KnowledgeBase | undefined;

export function loadKnowledge(): KnowledgeBase {
  cached ??= new KnowledgeBase(findKnowledgeDir());
  return cached;
}

/** 仅供测试/工具清除缓存。 */
export function resetKnowledgeCache(): void {
  cached = undefined;
}
