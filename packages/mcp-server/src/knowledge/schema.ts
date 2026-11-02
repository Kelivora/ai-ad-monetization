import { z } from 'zod';

export const PLATFORM_IDS = ['admob', 'applovin-max', 'unity-levelplay'] as const;
export const FRAMEWORKS = ['flutter', 'android', 'ios', 'react-native', 'unity'] as const;
export const AD_FORMATS = [
  'banner',
  'interstitial',
  'rewarded',
  'rewarded_interstitial',
  'native',
  'app_open',
] as const;
export const SUPPORT_LEVELS = [
  'automated',
  'delegate-official-skill',
  'guided',
  'unsupported',
] as const;

export type PlatformId = (typeof PLATFORM_IDS)[number];
export type Framework = (typeof FRAMEWORKS)[number];
export type AdFormat = (typeof AD_FORMATS)[number];
export type SupportLevel = (typeof SUPPORT_LEVELS)[number];

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '必须是 YYYY-MM-DD 日期');

export const SourceSchema = z.object({
  title: z.string().min(1),
  url: z.url(),
  retrievedAt: dateStr,
  verifiedVersion: z.string().nullable().optional(),
});
export type Source = z.infer<typeof SourceSchema>;

/** 每个知识文件共有的信封字段 */
const envelope = {
  schemaVersion: z.number().int().positive(),
  retrievedAt: dateStr,
  reviewIntervalDays: z.number().int().positive().default(120),
  sources: z.array(SourceSchema).min(1),
};

const withEnvelope = <T extends z.ZodRawShape>(shape: T) => z.object({ ...envelope, ...shape });

export const IndexSchema = withEnvelope({
  platforms: z
    .object({
      id: z.enum(PLATFORM_IDS),
      path: z.string().min(1),
      status: z.enum(['automated', 'knowledge-only']),
      summary: z.string().min(1),
    })
    .array(),
});
export type KnowledgeIndex = z.infer<typeof IndexSchema>;

export const OfficialSkillSchema = z.object({
  name: z.string().min(1),
  repo: z.url(),
  install: z.string().min(1),
  docsUrl: z.url(),
});
export type OfficialSkillRef = z.infer<typeof OfficialSkillSchema>;

export const FrameworkSupportSchema = z.object({
  support: z.enum(SUPPORT_LEVELS),
  package: z.string().optional(),
  verified: z.boolean().optional(),
  officialSkill: OfficialSkillSchema.optional(),
  note: z.string().optional(),
});
export type FrameworkSupport = z.infer<typeof FrameworkSupportSchema>;

export const PlatformSchema = withEnvelope({
  id: z.enum(PLATFORM_IDS),
  displayName: z.string().min(1),
  vendor: z.string().min(1),
  type: z.enum(['network', 'mediation']),
  status: z.enum(['automated', 'knowledge-only']),
  formats: z.enum(AD_FORMATS).array().min(1),
  frameworks: z.record(z.enum(FRAMEWORKS), FrameworkSupportSchema),
  reporting: z.object({
    available: z.boolean(),
    api: z.string().optional(),
    url: z.string().optional(),
    endpoint: z.string().optional(),
    consoleUrl: z.string().optional(),
    requiresOAuth: z.boolean().optional(),
    note: z.string().optional(),
  }),
  editorial: z.object({
    selection: z.object({
      scores: z.record(z.string(), z.number().int().min(1).max(5)),
      marketFit: z.record(z.string(), z.number().int().min(1).max(5)),
      rationale: z.string().min(1),
    }),
  }),
});
export type PlatformFile = z.infer<typeof PlatformSchema>;

export const SdkSchema = withEnvelope({
  platformId: z.enum(PLATFORM_IDS),
  framework: z.enum(FRAMEWORKS),
  plugin: z.object({
    name: z.string().min(1),
    version: z.string().nullable(),
    pubUrl: z.string().optional(),
  }),
  constraints: z.record(z.string(), z.string()),
  supportedTargets: z.record(z.string(), z.boolean()),
  android: z
    .object({
      minSdk: z.number().int().nonnegative(),
      compileSdk: z.number().int().nonnegative(),
      playServicesAds: z.string().optional(),
      nextGenSdk: z
        .object({
          optional: z.boolean(),
          dependency: z.string(),
          version: z.string().nullable(),
        })
        .optional(),
      ump: z.string().optional(),
    })
    .optional(),
  ios: z
    .object({
      deploymentTarget: z.string(),
      googleMobileAdsSdk: z.string().optional(),
      ump: z.string().optional(),
      packageManagers: z.string().array().optional(),
    })
    .optional(),
});
export type SdkFile = z.infer<typeof SdkSchema>;

export const TestIdsSchema = withEnvelope({
  platformId: z.enum(PLATFORM_IDS),
  prefix: z.string().min(1),
  regex: z.object({ appId: z.string().min(1), adUnit: z.string().min(1) }),
  appId: z.object({ android: z.string(), ios: z.string() }),
  adUnits: z
    .object({
      format: z.enum(AD_FORMATS),
      label: z.string().optional(),
      android: z.string(),
      ios: z.string(),
    })
    .array()
    .min(1),
});
export type TestIdsFile = z.infer<typeof TestIdsSchema>;

export const PrivacySchema = withEnvelope({
  platformId: z.enum(PLATFORM_IDS),
  disclaimer: z.string().min(1),
  requirements: z
    .object({
      markets: z.string().array().min(1),
      topic: z.string().min(1),
      requirement: z.string().min(1),
      implementation: z.string().array(),
      sourceUrl: z.url(),
    })
    .array()
    .min(1),
  testing: z.record(z.string(), z.string()).optional(),
});
export type PrivacyFile = z.infer<typeof PrivacySchema>;

export const SkadnetworkSchema = withEnvelope({
  platformId: z.enum(PLATFORM_IDS),
  note: z.string().optional(),
  ids: z.string().regex(/^[a-z0-9]+\.skadnetwork$/).array().min(1),
});
export type SkadnetworkFile = z.infer<typeof SkadnetworkSchema>;

export const ErrorsSchema = withEnvelope({
  platformId: z.enum(PLATFORM_IDS),
  errors: z
    .object({
      code: z.union([z.number().int(), z.string().min(1)]),
      name: z.string().min(1),
      symptom: z.string().min(1),
      cause: z.string().min(1),
      fix: z.string().min(1),
      sourceUrl: z.url(),
    })
    .array()
    .min(1),
});
export type ErrorsFile = z.infer<typeof ErrorsSchema>;

export const PlacementRulesSchema = withEnvelope({
  editorial: z.literal(true),
  note: z.string().optional(),
  banner: z.object({
    rule: z.string(),
    scrollable: z.object({ placement: z.string(), rationale: z.string() }),
    nonScrollable: z.object({ placement: z.string(), rationale: z.string() }),
    api: z.string().optional(),
  }),
  interstitial: z.object({
    rule: z.string(),
    naturalBreakPoints: z.string().array().min(1),
    rationale: z.string(),
  }),
  rewarded: z.object({ rule: z.string(), rationale: z.string() }),
  policies: z
    .object({
      id: z.enum(['revenue', 'ux', 'balanced']),
      label: z.string(),
      formatPriority: z.string().array().min(1),
      interstitialFrequencySeconds: z.number().int().nonnegative(),
      notes: z.string(),
    })
    .array()
    .min(1),
});
export type PlacementRulesFile = z.infer<typeof PlacementRulesSchema>;

export const MarketsSchema = withEnvelope({
  markets: z
    .object({
      id: z.string().min(1),
      displayName: z.string().min(1),
      aliases: z.string().array(),
      countries: z.string().array().optional(),
      regions: z.string().array().optional(),
      regulation: z.string().optional(),
      summary: z.string().optional(),
      editorial: z.boolean().optional(),
      note: z.string().optional(),
    })
    .array()
    .min(1),
});
export type MarketsFile = z.infer<typeof MarketsSchema>;

export const BenchmarksSchema = withEnvelope({
  heuristic: z.literal(true),
  note: z.string().optional(),
  thresholds: z
    .object({
      id: z.string().min(1),
      metric: z.string().min(1),
      direction: z.enum(['below', 'above']),
      value: z.number(),
      severity: z.enum(['info', 'warning', 'critical']),
      message: z.string().min(1),
    })
    .array()
    .min(1),
  ecpmOrdering: z.object({
    expected: z.string().array().min(2),
    note: z.string().optional(),
  }),
});
export type BenchmarksFile = z.infer<typeof BenchmarksSchema>;

/** 按文件相对路径选择 schema；未知文件返回 undefined。 */
export function schemaForFile(relPath: string): z.ZodTypeAny | undefined {
  const normalized = relPath.replaceAll('\\', '/');
  if (normalized === 'index.json') return IndexSchema;
  switch (normalized) {
    case 'common/placement-rules.json':
      return PlacementRulesSchema;
    case 'common/markets.json':
      return MarketsSchema;
    case 'common/benchmarks.json':
      return BenchmarksSchema;
  }
  const m = /^platforms\/([^/]+)\/(.+)$/.exec(normalized);
  if (!m) return undefined;
  const [, platformId, rest] = m as unknown as [string, string, string];
  if (!PLATFORM_IDS.includes(platformId as PlatformId)) return undefined;
  if (rest === 'platform.json') return PlatformSchema;
  if (platformId !== 'admob') return undefined;
  switch (rest) {
    case 'sdk/flutter.json':
      return SdkSchema;
    case 'test-ids.json':
      return TestIdsSchema;
    case 'privacy.json':
      return PrivacySchema;
    case 'skadnetwork.json':
      return SkadnetworkSchema;
    case 'errors.json':
      return ErrorsSchema;
  }
  return undefined;
}
