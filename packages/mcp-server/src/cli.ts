#!/usr/bin/env node
/**
 * ad-monetization CLI（无 Agent 场景，供 CI 与 e2e 使用）。
 * 与 MCP 工具共用 core 实现，不复制业务逻辑。
 *
 * 退出码：成功 0；工具错误 2；validate overall=fail 1。
 */
import { analyzeProject } from './core/project/analyze.js';
import { generateIntegration } from './core/integration/generate.js';
import { validateAdConfig } from './core/validation/engine.js';
import { AppError, toToolError } from './lib/errors.js';
import type { AdFormat } from './knowledge/schema.js';
import type { ToolEnvelope } from './lib/envelope.js';

const USAGE = `ad-monetization — AI Ad Monetization CLI (MVP: AdMob x Flutter)

用法:
  ad-monetization analyze <path>
  ad-monetization plan <path> --formats banner,interstitial,rewarded [--no-wire-main] [--child-directed] [--platform-options-json '{"interstitialMinIntervalSeconds":60}']
  ad-monetization apply <path> --formats ... --yes [--allow-dirty] [--no-wire-main] [--child-directed]
  ad-monetization validate <path> [--profile development|release] [--markets US,EEA] [--child-directed]

通用:
  --json    以 MCP 信封 JSON 输出

退出码: 0 成功；2 工具错误；1 validate overall=fail
`;

interface CliArgs {
  command?: string | undefined;
  path?: string | undefined;
  formats?: AdFormat[] | undefined;
  yes?: boolean | undefined;
  allowDirty?: boolean | undefined;
  wireMain?: boolean | undefined;
  childDirected?: boolean | undefined;
  profile?: 'development' | 'release' | undefined;
  markets?: string[] | undefined;
  json?: boolean | undefined;
  platformOptions?: Record<string, unknown> | undefined;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--formats') {
      const value = argv[++i];
      if (!value) throw new AppError('INVALID_INPUT', '--formats 需要值，如 banner,interstitial');
      args.formats = value.split(',').map((s) => s.trim()).filter(Boolean) as AdFormat[];
    } else if (a === '--yes') {
      args.yes = true;
    } else if (a === '--allow-dirty') {
      args.allowDirty = true;
    } else if (a === '--no-wire-main') {
      args.wireMain = false;
    } else if (a === '--child-directed') {
      args.childDirected = true;
    } else if (a === '--json') {
      args.json = true;
    } else if (a === '--profile') {
      const value = argv[++i];
      if (value !== 'development' && value !== 'release') {
        throw new AppError('INVALID_INPUT', `--profile 只接受 development|release，收到: ${value}`);
      }
      args.profile = value;
    } else if (a === '--markets') {
      const value = argv[++i];
      if (!value) throw new AppError('INVALID_INPUT', '--markets 需要值，如 US,EEA');
      args.markets = value.split(',').map((s) => s.trim()).filter(Boolean);
    } else if (a === '--platform-options-json') {
      const value = argv[++i];
      try {
        args.platformOptions = JSON.parse(value ?? '{}') as Record<string, unknown>;
      } catch {
        throw new AppError('INVALID_INPUT', '--platform-options-json 不是合法 JSON');
      }
    } else if (a === '--help' || a === '-h') {
      process.stdout.write(USAGE);
      process.exit(0);
    } else if (a.startsWith('--')) {
      throw new AppError('INVALID_INPUT', `未知参数: ${a}\n\n${USAGE}`);
    } else {
      positional.push(a);
    }
  }
  args.command = positional[0];
  args.path = positional[1];
  return args;
}

function emitEnvelope(args: CliArgs, envelope: ToolEnvelope<unknown>): void {
  process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
}

function printAnalysis(analysis: Awaited<ReturnType<typeof analyzeProject>>, args: CliArgs): void {
  if (args.json) {
    emitEnvelope(args, {
      ok: true,
      summary: `${analysis.framework}`,
      data: analysis,
      warnings: analysis.issues,
      sources: [],
      nextSteps: [],
    });
    return;
  }
  const lines = [
    `框架: ${analysis.framework}（${analysis.frameworkEvidence.join('; ')}）`,
    `目标: ${['android', 'ios', 'web', 'desktop'].filter((t) => analysis.targets[t as keyof typeof analysis.targets]).join('+') || '未知'}`,
    `应用: ${analysis.appName ?? '未知'}${analysis.identifiers.androidApplicationId ? ` (${analysis.identifiers.androidApplicationId})` : ''}`,
    `已有广告 SDK: ${analysis.existingAdSdks.length === 0 ? '无' : analysis.existingAdSdks.map((s) => `${s.name}@${s.version ?? '?'}(${s.location})`).join(', ')}`,
    `已有广告代码: ${analysis.existingAdCode.length === 0 ? '无' : analysis.existingAdCode.map((c) => c.file).join(', ')}`,
    `git: ${analysis.git.isRepo ? (analysis.git.dirtyFiles.length > 0 ? `${analysis.git.dirtyFiles.length} 个未提交改动` : '干净') : '非 git 仓库'}`,
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

function printPlan(
  result: Awaited<ReturnType<typeof generateIntegration>>,
  args: CliArgs,
  envelope: ToolEnvelope<unknown>,
): void {
  if (args.json) {
    emitEnvelope(args, envelope);
    return;
  }
  const { plan, applied } = result;
  const out: string[] = [
    `平台: ${plan.platform} × ${plan.framework}；格式: ${plan.formats.join(', ')}；usesTestIds: ${plan.usesTestIds}`,
    '',
    '变更:',
    ...plan.changes.map((c) => `  [${c.action}] ${c.path} — ${c.reason}`),
    '',
    `planHash: ${plan.planHash}`,
  ];
  if (plan.warnings.length > 0) {
    out.push('', '警告:', ...plan.warnings.map((w) => `  ! ${w}`));
  }
  out.push('', '手动步骤:', ...plan.manualSteps.map((s, i) => `  ${i + 1}. ${s}`));
  if (applied) {
    out.push(
      '',
      `已写入: ${applied.changedFiles.join(', ') || '（无）'}`,
      `已跳过: ${applied.skippedFiles.join(', ') || '（无）'}`,
      `备份目录: ${applied.backupDir}`,
      `集成记录: ${applied.integrationFile}`,
    );
  }
  process.stdout.write(`${out.join('\n')}\n`);
}

function printValidation(
  output: Awaited<ReturnType<typeof validateAdConfig>>,
  args: CliArgs,
  envelope: ToolEnvelope<unknown>,
): void {
  if (args.json) {
    emitEnvelope(args, envelope);
    return;
  }
  const statusMark: Record<string, string> = { pass: '✔', warning: '⚠', fail: '✘', na: '·' };
  const lines = output.findings.map(
    (f) => `${statusMark[f.status] ?? '?'} [${f.status.toUpperCase().padEnd(7)}] ${f.ruleId}: ${f.message}${f.file ? ` (${f.file})` : ''}`,
  );
  process.stdout.write(
    `${lines.join('\n')}\n\n汇总: pass ${output.summary.pass} / warning ${output.summary.warning} / fail ${output.summary.fail} / na ${output.summary.na}\noverall: ${output.overall}\n`,
  );
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const { command, path } = args;

  try {
    if (!command || !path) {
      process.stdout.write(USAGE);
      return command ? 2 : 0;
    }
    switch (command) {
      case 'analyze': {
        const analysis = await analyzeProject(path, {});
        printAnalysis(analysis, args);
        return 0;
      }
      case 'plan':
      case 'apply': {
        if (!args.formats) throw new AppError('INVALID_INPUT', 'plan/apply 需要 --formats banner,interstitial,rewarded');
        if (command === 'apply' && args.yes !== true) {
          throw new AppError('CONFIRMATION_REQUIRED', 'apply 会写入文件，必须带 --yes 显式确认（建议先看 plan 输出的 diff）');
        }
        if (command === 'plan') {
          const result = await generateIntegration({
            projectPath: path,
            formats: args.formats,
            mode: 'plan',
            wireMain: args.wireMain ?? true,
            childDirected: args.childDirected ?? false,
            platformOptions: args.platformOptions,
          });
          const envelope: ToolEnvelope<unknown> = {
            ok: true,
            summary: `plan: ${result.plan.planHash}`,
            data: result.plan,
            warnings: result.warnings,
            sources: [],
            nextSteps: [],
          };
          printPlan(result, args, envelope);
          return 0;
        }
        // apply：先 plan 拿 planHash，再用它 apply
        const pre = await generateIntegration({
          projectPath: path,
          formats: args.formats,
          mode: 'plan',
          wireMain: args.wireMain ?? true,
          childDirected: args.childDirected ?? false,
          platformOptions: args.platformOptions,
        });
        const result = await generateIntegration({
          projectPath: path,
          formats: args.formats,
          mode: 'apply',
          confirm: true,
          expectedPlanHash: pre.plan.planHash,
          allowDirty: args.allowDirty,
          wireMain: args.wireMain ?? true,
          childDirected: args.childDirected ?? false,
          platformOptions: args.platformOptions,
        });
        const envelope: ToolEnvelope<unknown> = {
          ok: true,
          summary: `applied: ${result.plan.planHash}`,
          data: { plan: result.plan, applied: result.applied },
          warnings: result.warnings,
          sources: [],
          nextSteps: [],
        };
        printPlan(result, args, envelope);
        return 0;
      }
      case 'validate': {
        const output = await validateAdConfig({
          projectPath: path,
          profile: args.profile ?? 'development',
          markets: args.markets ?? [],
          childDirected: args.childDirected ?? false,
        });
        const envelope: ToolEnvelope<unknown> = {
          ok: true,
          summary: `overall=${output.overall}`,
          data: output,
          warnings: output.findings.filter((f) => f.status === 'warning').map((f) => f.message),
          sources: [],
          nextSteps: [],
        };
        printValidation(output, args, envelope);
        return output.overall === 'fail' ? 1 : 0;
      }
      default:
        process.stdout.write(`未知命令: ${command}\n\n${USAGE}`);
        return 2;
    }
  } catch (err) {
    const { error } = toToolError(err);
    if (args.json) {
      emitEnvelope(args, { ok: false, error });
    } else {
      const hint = error.hint ? ` (hint: ${error.hint})` : '';
      const details = error.details ? `\ndetails: ${JSON.stringify(error.details)}` : '';
      process.stderr.write(`错误 [${error.code}]: ${error.message}${hint}${details}\n`);
    }
    return 2;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`未捕获异常: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exit(2);
  });
