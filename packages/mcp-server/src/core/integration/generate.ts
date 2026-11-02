import { loadKnowledge } from '../../knowledge/loader.js';
import type { AdFormat, PlatformId } from '../../knowledge/schema.js';
import { AppError } from '../../lib/errors.js';
import { analyzeProject } from '../project/analyze.js';
import { getAdapter } from '../../adapters/registry.js';
import type { IntegrationPlan } from '../../adapters/types.js';
import { applyPlan, type ApplyResult } from '../patch/apply.js';
import type { PlannedIntegrationPlan } from '../patch/types.js';
import { GENERATABLE_FORMATS } from '../../adapters/admob/flutter/plan.js';

export const MAX_CONTENT_PREVIEW = 4000;

export interface GenerateIntegrationInput {
  projectPath: string;
  platformId?: PlatformId | undefined; // 默认 admob
  formats: AdFormat[];
  mode?: 'plan' | 'apply' | undefined; // 默认 plan
  confirm?: boolean | undefined;
  expectedPlanHash?: string | undefined;
  allowDirty?: boolean | undefined;
  wireMain?: boolean | undefined; // 默认 true
  childDirected?: boolean | undefined; // 默认 false
  /** 平台专属参数（用适配器 optionsSchema 校验） */
  platformOptions?: unknown;
}

export interface GenerateIntegrationResult {
  plan: IntegrationPlan; // 输出用（plan 模式下超长 content 会截断）
  applied?: ApplyResult;
  warnings: string[];
  truncated: string[];
}

function parsePlatformOptions(adapterOptionsSchema: { parse: (v: unknown) => unknown }, raw: unknown): Record<string, unknown> {
  const result = adapterOptionsSchema.parse(raw ?? {});
  if (result === null || typeof result !== 'object' || Array.isArray(result)) {
    throw new AppError('INVALID_INPUT', 'platformOptions 必须是对象');
  }
  return result as Record<string, unknown>;
}

/** generate_ad_integration 的核心实现（MCP 工具与 CLI 共用，architecture.md 3.4 写入规则）。 */
export async function generateIntegration(input: GenerateIntegrationInput): Promise<GenerateIntegrationResult> {
  const kb = loadKnowledge();
  const platformId = input.platformId ?? 'admob';
  const adapter = getAdapter(kb, platformId);

  // formats 校验：非空 + MVP 支持子集
  if (!Array.isArray(input.formats) || input.formats.length === 0) {
    throw new AppError('INVALID_INPUT', 'formats 必须是非空的广告格式数组（banner/interstitial/rewarded）');
  }
  const unsupported = input.formats.filter((f) => !GENERATABLE_FORMATS.includes(f));
  if (unsupported.length > 0) {
    throw new AppError(
      'UNSUPPORTED_COMBINATION',
      `MVP 暂不支持自动生成格式: ${unsupported.join(', ')}（支持 banner/interstitial/rewarded）`,
    );
  }

  // 平台专属参数校验（zod，由适配器自己定义）
  let options: Record<string, unknown>;
  try {
    options = parsePlatformOptions(adapter.optionsSchema, input.platformOptions);
  } catch (err) {
    throw new AppError('INVALID_INPUT', 'platformOptions 校验失败', {
      details: err instanceof Error ? err.message : String(err),
    });
  }

  // 门禁：先 analyze
  const analysis = await analyzeProject(input.projectPath, { skipToolchain: true });
  if (analysis.framework !== 'flutter') {
    throw new AppError('UNSUPPORTED_COMBINATION', `自动接入目前仅支持 Flutter 工程（当前: ${analysis.framework}）`, {
      hint: '原生 Android/iOS/Unity 请使用 Google 官方 skill: npx skills add google/skills/skills/ads',
    });
  }
  const support = adapter.supportFor('flutter');
  if (support.level !== 'automated') {
    const opts: { hint?: string } = {};
    if (support.officialSkill) opts.hint = `官方 skill: ${support.officialSkill.install}`;
    throw new AppError('UNSUPPORTED_COMBINATION', `平台 ${platformId} 在 flutter 下不支持自动接入（${support.level}）`, opts);
  }
  if (!adapter.planIntegration) {
    throw new AppError('UNSUPPORTED_COMBINATION', `平台 ${platformId} 未实现 planIntegration`);
  }

  const fullPlan = await adapter.planIntegration(analysis, {
    formats: input.formats,
    wireMain: input.wireMain ?? true,
    childDirected: input.childDirected ?? false,
    options,
  });

  if ((input.mode ?? 'plan') === 'plan') {
    return toDisplayPlan(fullPlan);
  }

  // apply 模式：确认 → 哈希 → 干净工作区 → 落盘
  if (input.confirm !== true) {
    throw new AppError('CONFIRMATION_REQUIRED', 'apply 模式需要用户确认（confirm: true）', {
      hint: '先以 mode=plan 展示 diff，征得用户同意后再携带 expectedPlanHash 重试',
    });
  }
  if (!input.expectedPlanHash) {
    throw new AppError('CONFIRMATION_REQUIRED', 'apply 模式需要 expectedPlanHash（防止确认内容与写入内容不一致）', {
      hint: '先以 mode=plan 获取 planHash',
    });
  }
  if (input.expectedPlanHash !== fullPlan.planHash) {
    throw new AppError('PLAN_MISMATCH', '计划哈希不一致：工程内容可能与确认时不同', {
      details: { expected: input.expectedPlanHash, actual: fullPlan.planHash },
    });
  }
  if (analysis.git.isRepo && input.allowDirty !== true) {
    const dirty = new Set(analysis.git.dirtyFiles);
    const affected = fullPlan.changes.filter((c) => dirty.has(c.path)).map((c) => c.path);
    if (affected.length > 0) {
      throw new AppError('DIRTY_WORKTREE', '计划涉及的文件在 git 中有未提交改动', {
        details: { files: affected },
        hint: '提交这些改动后重试，或确认接受后传 allowDirty: true',
      });
    }
  }

  const sdk = kb.getSdk(platformId, 'flutter');
  if (!sdk.plugin.version) {
    throw new AppError('KNOWLEDGE_MISSING', '知识库缺少插件版本号（plugin.version）');
  }
  const applied = applyPlan(analysis.root, fullPlan, { pluginName: sdk.plugin.name, pluginVersion: sdk.plugin.version });

  const display = toDisplayPlan(fullPlan);
  return { ...display, applied, warnings: [...display.warnings, `已写入 ${applied.changedFiles.length} 个文件，备份在 ${applied.backupDir}`] };
}

/** 转成输出用计划：去掉内部字段，plan 预览截断超长 content。 */
function toDisplayPlan(fullPlan: PlannedIntegrationPlan): GenerateIntegrationResult {
  const truncated: string[] = [];
  const changes = fullPlan.changes.map((c) => {
    const display: Record<string, unknown> = { path: c.path, action: c.action, reason: c.reason };
    if (c.beforeHash !== undefined) display.beforeHash = c.beforeHash;
    if (c.diff !== undefined) display.diff = c.diff;
    if (c.content !== undefined) {
      if (c.content.length > MAX_CONTENT_PREVIEW) {
        truncated.push(c.path);
        display.content = `${c.content.slice(0, MAX_CONTENT_PREVIEW)}\n// ... (truncated; apply 模式会写入完整内容)`;
      } else {
        display.content = c.content;
      }
    }
    return display as unknown as IntegrationPlan['changes'][number];
  });
  return {
    plan: {
      platform: fullPlan.platform,
      framework: fullPlan.framework,
      formats: fullPlan.formats,
      usesTestIds: fullPlan.usesTestIds,
      changes,
      manualSteps: fullPlan.manualSteps,
      warnings: fullPlan.warnings,
      planHash: fullPlan.planHash,
    },
    warnings: [...fullPlan.warnings],
    truncated,
  };
}
