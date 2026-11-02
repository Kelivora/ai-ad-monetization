import type { z } from 'zod';
import type { SourceRef } from '../lib/envelope.js';
import type { AdFormat, Framework, OfficialSkillRef, PlatformId, SupportLevel } from '../knowledge/schema.js';
import type { ProjectAnalysis } from '../core/project/types.js';
import type { RevenueRow } from '../core/revenue/types.js';
import type { KnowledgeBase } from '../knowledge/loader.js';

export interface SupportInfo {
  level: SupportLevel;
  officialSkill?: OfficialSkillRef;
  note?: string;
}

export interface GuideInput {
  framework: Framework;
  formats: AdFormat[];
}

export interface GuideStep {
  id: string;
  title: string;
  detail: string;
  tool?: string; // 对应的 MCP 工具名
  manual: boolean;
}

export interface IntegrationGuide {
  strategy: SupportLevel;
  steps: GuideStep[];
  officialSkill?: OfficialSkillRef;
  prerequisites: string[];
  sources: SourceRef[];
}

/** 集成计划 / 校验规则接口（architecture.md 3.4 / 3.5）；MVP 中由 AdMob × Flutter 实现。 */
export interface PlanInput {
  formats: AdFormat[];
  /** 是否改写 main.dart 接线初始化（默认 true） */
  wireMain?: boolean;
  /** 声明应用面向儿童（COPPA） */
  childDirected?: boolean;
  /** 已通过适配器 optionsSchema 校验的专属参数 */
  options?: Record<string, unknown>;
}

/** architecture.md 3.4 FileChange */
export interface FileChange {
  path: string; // 相对工程根
  action: 'create' | 'modify' | 'skip';
  reason: string;
  beforeHash?: string; // modify/skip 时原文件 sha256
  diff?: string; // unified diff
  content?: string; // create 时的完整内容（plan 输出时可截断）
}

export interface IntegrationPlan {
  platform: PlatformId;
  framework: Framework;
  formats: AdFormat[];
  usesTestIds: true;
  changes: FileChange[];
  manualSteps: string[];
  warnings: string[];
  planHash: string; // sha256(稳定序列化的 changes，不含 diff)
}

export type CheckStatus = 'pass' | 'warning' | 'fail' | 'na';

/** architecture.md 3.5 ValidationFinding / ValidationRule */
export interface ValidationFinding {
  ruleId: string;
  title: string;
  status: CheckStatus;
  message: string;
  file?: string | undefined;
  line?: number | undefined;
  fix?: string | undefined;
  source?: SourceRef | undefined;
}

export interface RuleContext {
  analysis: ProjectAnalysis;
  /** 读工程内相对路径文件（如 lib/main.dart） */
  readFile: (rel: string) => string | undefined;
  profile: 'development' | 'release';
  /** 已归一化的市场 ID（如 EEA / UK / CH / US） */
  markets: string[];
  childDirected: boolean;
  /** 知识库（规则中引用官方事实与测试 ID） */
  kb: KnowledgeBase;
}

export interface ValidationRule {
  id: string;
  title: string;
  category: 'config' | 'code' | 'compliance' | 'release';
  check(ctx: RuleContext): ValidationFinding | ValidationFinding[];
}

export interface RevenueQuery {
  publisherId?: string | undefined; // admob_api 源需要（pub-xxxxxxxxxxxxxxxx）
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  dimensions?: string[] | undefined;
}

export interface RevenueRows {
  rows: RevenueRow[];
  currency?: string | undefined;
}

export interface PlatformAdapter {
  readonly id: PlatformId;
  readonly displayName: string;
  supportFor(framework: Framework): SupportInfo;
  formats(framework: Framework): AdFormat[];
  /** 平台专属参数（例如 AdMob 的 useNextGenSdk），由适配器自己校验 */
  readonly optionsSchema: z.ZodTypeAny;
  getIntegrationGuide(input: GuideInput): IntegrationGuide;
  planIntegration?(project: ProjectAnalysis, input: PlanInput): Promise<IntegrationPlan>;
  validationRules?(framework: Framework): ValidationRule[];
  fetchRevenue?(query: RevenueQuery): Promise<RevenueRows>;
}
