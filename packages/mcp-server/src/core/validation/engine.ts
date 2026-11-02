import { join } from 'node:path';
import { loadKnowledge } from '../../knowledge/loader.js';
import type { PlatformId } from '../../knowledge/schema.js';
import { readTextIfExists } from '../../lib/fs.js';
import { AppError } from '../../lib/errors.js';
import { analyzeProject } from '../project/analyze.js';
import { getAdapter } from '../../adapters/registry.js';
import type { RuleContext, ValidationFinding, ValidationRule } from '../../adapters/types.js';

export interface ValidationSummary {
  pass: number;
  warning: number;
  fail: number;
  na: number;
}

export interface ValidationOutput {
  findings: ValidationFinding[];
  summary: ValidationSummary;
  overall: 'pass' | 'warning' | 'fail';
}

/** 跑一组规则并汇总（architecture.md 3.5）。 */
export function runRules(rules: ValidationRule[], ctx: RuleContext): ValidationOutput {
  const findings: ValidationFinding[] = [];
  for (const rule of rules) {
    try {
      const result = rule.check(ctx);
      findings.push(...(Array.isArray(result) ? result : [result]));
    } catch (err) {
      findings.push({
        ruleId: rule.id,
        title: rule.title,
        status: 'na',
        message: `规则执行失败: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }
  const summary: ValidationSummary = { pass: 0, warning: 0, fail: 0, na: 0 };
  for (const f of findings) summary[f.status] += 1;
  const overall = summary.fail > 0 ? 'fail' : summary.warning > 0 ? 'warning' : 'pass';
  return { findings, summary, overall };
}

export interface ValidateAdConfigInput {
  projectPath: string;
  platformId?: PlatformId | undefined; // 默认 admob
  profile?: 'development' | 'release' | undefined; // 默认 development
  markets?: string[] | undefined; // 别名会归一化（如 EU → EEA）
  childDirected?: boolean | undefined; // 默认 false
}

/** validate_ad_config 的核心实现（MCP 工具与 CLI 共用）。 */
export async function validateAdConfig(input: ValidateAdConfigInput): Promise<ValidationOutput> {
  const kb = loadKnowledge();
  const platformId = input.platformId ?? 'admob';
  const adapter = getAdapter(kb, platformId);
  const analysis = await analyzeProject(input.projectPath, { skipToolchain: true });

  const framework = analysis.framework;
  if (framework !== 'flutter') {
    throw new AppError(
      'UNSUPPORTED_COMBINATION',
      `validate_ad_config 目前仅支持 Flutter 工程（当前: ${framework}）`,
      { hint: '原生 Android/iOS/Unity 请使用 Google 官方 skill: npx skills add google/skills/skills/ads（google-mobile-ads-validate）' },
    );
  }
  const rules = adapter.validationRules?.('flutter');
  if (!rules || rules.length === 0) {
    throw new AppError('UNSUPPORTED_COMBINATION', `平台 ${platformId} 没有可用的 Flutter 校验规则`);
  }

  const markets = (input.markets ?? []).map((alias) => kb.resolveMarket(alias));
  const ctx: RuleContext = {
    analysis,
    readFile: (rel) => readTextIfExists(join(analysis.root, rel)),
    profile: input.profile ?? 'development',
    markets,
    childDirected: input.childDirected ?? false,
    kb,
  };
  return runRules(rules, ctx);
}
