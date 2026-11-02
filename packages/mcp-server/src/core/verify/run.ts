import { loadKnowledge } from '../../knowledge/loader.js';
import { AppError } from '../../lib/errors.js';
import { analyzeProject } from '../project/analyze.js';
import { validateAdConfig, type ValidationOutput } from '../validation/engine.js';
import { detectVerifyToolchain, defaultRunner } from './toolchain.js';
import { runBuildLevel, type BuildLevelResult } from './build-runner.js';
import { buildRuntimeChecklist, type RuntimeChecklist } from './runtime-checklist.js';
import { runRuntimeLevel, type RuntimeLevelResult } from './runtime-runner.js';

export const VERIFY_STATEMENT =
  '构建成功不代表广告能真实投放：静态/构建级只证明配置与编译正确，广告请求、展示与回调必须按 runtime 清单在模拟器/真机上人工核对；自动化运行时验证只证明测试广告能在所选设备上加载，真实广告单元 ID 的填充与收益无法由工具验证。';

export type LevelStatus = 'passed' | 'failed' | 'skipped' | 'requires_manual_verification' | 'not_requested';

export interface VerifyLevelStatic {
  overall: ValidationOutput['overall'];
  summary: ValidationOutput['summary'];
  findings: ValidationOutput['findings'];
}

export interface VerifyData {
  levels: {
    static?: VerifyLevelStatic | undefined;
    build?: BuildLevelResult | undefined;
    runtime?: RuntimeChecklist | RuntimeLevelResult | undefined;
  };
  verdict: { static: LevelStatus; build: LevelStatus; runtime: LevelStatus };
  statement: string;
}

export interface VerifyInput {
  projectPath: string;
  levels?: string[] | undefined; // 默认 [static, build]
  targets?: string[] | undefined; // 默认按 analysis.targets
  markets?: string[] | undefined;
  profile?: 'development' | 'release' | undefined;
  timeoutSec?: number | undefined;
  /** flutter 设备 id：提供时 runtime 级在指定设备上自动执行冷烟测试 */
  devices?: string[] | undefined;
  /** 冷烟测试中是否展示激励全屏广告并等待 onReward 回调 */
  showFullscreen?: boolean | undefined;
  runner?: typeof defaultRunner | undefined; // 测试注入
}

export interface VerifyResult extends VerifyData {
  warnings: string[];
  nextSteps: string[];
}

/** verify_ad_integration 的核心实现（MCP 工具与 CLI 共用，architecture.md 3.6）。 */
export async function verifyAdIntegration(input: VerifyInput): Promise<VerifyResult> {
  const requested = new Set(input.levels ?? ['static', 'build']);
  for (const level of requested) {
    if (!['static', 'build', 'runtime'].includes(level)) {
      throw new AppError('INVALID_INPUT', `未知验证级别: ${level}（可选 static/build/runtime）`);
    }
  }

  const kb = loadKnowledge();
  const analysis = await analyzeProject(input.projectPath, { skipToolchain: true });
  if (analysis.framework !== 'flutter') {
    throw new AppError('UNSUPPORTED_COMBINATION', `verify_ad_integration 目前仅支持 Flutter 工程（当前: ${analysis.framework}）`);
  }
  const targets = input.targets ?? ['android', 'ios'].filter((t) => analysis.targets[t as 'android' | 'ios']);

  const verdict: VerifyData['verdict'] = { static: 'not_requested', build: 'not_requested', runtime: 'not_requested' };
  const levels: VerifyData['levels'] = {};
  const warnings: string[] = [];

  if (requested.has('static')) {
    const output = await validateAdConfig({
      projectPath: input.projectPath,
      profile: input.profile ?? 'development',
      markets: input.markets ?? [],
    });
    levels.static = { overall: output.overall, summary: output.summary, findings: output.findings };
    verdict.static = output.overall === 'fail' ? 'failed' : 'passed';
    for (const f of output.findings.filter((f) => f.status === 'warning')) {
      warnings.push(`[static/${f.ruleId}] ${f.message}`);
    }
  }

  if (requested.has('build')) {
    const toolchain = await detectVerifyToolchain(input.runner ? { runner: input.runner } : {});
    const build = await runBuildLevel({
      cwd: analysis.root,
      targets: { android: targets.includes('android'), ios: targets.includes('ios') },
      toolchain,
      kb,
      runner: input.runner ?? defaultRunner,
      timeoutMs: (input.timeoutSec ?? 900) * 1000,
    });
    levels.build = build;
    verdict.build = build.status;
    warnings.push(...build.warnings.map((w) => `[build] ${w}`));
  }

  if (requested.has('runtime')) {
    if (!input.devices || input.devices.length === 0) {
      // 未给 devices：行为不变，返回人工核对清单
      levels.runtime = buildRuntimeChecklist();
      verdict.runtime = 'requires_manual_verification';
    } else {
      const runtime = await runRuntimeLevel({
        cwd: analysis.root,
        devices: input.devices,
        showFullscreen: input.showFullscreen,
        targets: { android: targets.includes('android'), ios: targets.includes('ios') },
        runner: input.runner ?? defaultRunner,
        timeoutMs: (input.timeoutSec ?? 900) * 1000,
        kb,
      });
      levels.runtime = runtime;
      verdict.runtime = runtime.status;
      warnings.push(...runtime.warnings.map((w) => `[runtime] ${w}`));
    }
  }

  const parts: string[] = [];
  if (verdict.static !== 'not_requested') parts.push(`static=${verdict.static}`);
  if (verdict.build !== 'not_requested') parts.push(`build=${verdict.build}`);
  if (verdict.runtime !== 'not_requested') parts.push(`runtime=${verdict.runtime}`);

  const nextSteps: string[] = [];
  if (verdict.build === 'skipped') nextSteps.push('build 级 skipped：安装缺失的工具链后重跑');
  if (verdict.build === 'failed') nextSteps.push('按各失败步骤的 diagnosis 修复构建问题后重跑 verify');
  if (verdict.runtime === 'requires_manual_verification') {
    const checklist = levels.runtime as RuntimeChecklist;
    nextSteps.push(`按 runtime 清单人工核对（推荐命令: ${checklist.recommendedCommand}）`);
    nextSteps.push('提示：verify_ad_integration 传 devices（flutter 设备 id）可在指定设备上自动执行冷烟测试 integration_test/ads_smoke_test.dart');
  } else if (verdict.runtime === 'skipped' && levels.runtime && 'reason' in levels.runtime) {
    const runtime = levels.runtime as RuntimeLevelResult;
    nextSteps.push(runtime.reason ?? 'runtime 级 skipped');
  } else if (verdict.runtime === 'failed') {
    nextSteps.push('查看 runtime 级各设备 run 的失败检查与 logTail，修复后重跑 verify（真机 EEA 检查需传测试设备 ID）');
  }
  if (levels.runtime && 'manualItems' in levels.runtime && (levels.runtime as RuntimeLevelResult).manualItems.length > 0) {
    const items = (levels.runtime as RuntimeLevelResult).manualItems;
    nextSteps.push(`仍需人工核对（未被自动化覆盖）: ${items.map((i) => i.title).join('；')}`);
  }

  return { levels, verdict, statement: VERIFY_STATEMENT, warnings, nextSteps };
}
