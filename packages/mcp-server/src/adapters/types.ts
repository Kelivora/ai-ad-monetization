import type { z } from 'zod';
import type { SourceRef } from '../lib/envelope.js';
import type { AdFormat, Framework, OfficialSkillRef, PlatformId, SupportLevel } from '../knowledge/schema.js';
import type { ProjectAnalysis } from '../core/project/types.js';

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

/** 以下三类能力 T2 只声明不实现（architecture.md 3.2 / 3.4 / 3.5 / 3.6），后续任务补齐。 */
export interface PlanInput {
  formats: AdFormat[];
  options?: Record<string, unknown>;
}

export interface IntegrationPlan {
  platform: PlatformId;
  framework: Framework;
  formats: AdFormat[];
  usesTestIds: true;
  changes: Array<{ path: string; action: 'create' | 'modify' | 'skip' }>;
  manualSteps: string[];
  planHash: string;
}

export interface ValidationRule {
  id: string;
  title: string;
  category: 'config' | 'code' | 'compliance' | 'release';
}

export interface RevenueQuery {
  startDate: string;
  endDate: string;
  dimensions?: string[];
}

export interface RevenueRows {
  rows: Array<Record<string, string | number>>;
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
