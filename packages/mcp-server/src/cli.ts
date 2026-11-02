#!/usr/bin/env node
/**
 * ad-monetization CLI（无 Agent 场景，供 CI 与 e2e 使用）。
 * 与 MCP 工具共用 core 实现，不复制业务逻辑。
 *
 * 退出码：成功 0；工具错误 2；validate/verify failed 1；verify 全部 skipped 3。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { analyzeProject } from './core/project/analyze.js';
import { generateIntegration } from './core/integration/generate.js';
import { validateAdConfig } from './core/validation/engine.js';
import { buildIntegrationReport } from './core/report/report.js';
import { verifyAdIntegration, type VerifyData } from './core/verify/run.js';
import { importRevenueRows } from './core/revenue/import.js';
import { computeMetrics, type GroupByField, type MetricsGroup } from './core/revenue/metrics.js';
import { buildInsights } from './core/revenue/insights.js';
import type { RevenueRow } from './core/revenue/types.js';
import { loadKnowledge } from './knowledge/loader.js';
import { AppError, toToolError } from './lib/errors.js';
import type { AdFormat } from './knowledge/schema.js';
import type { ToolEnvelope } from './lib/envelope.js';

const USAGE = `ad-monetization — AI Ad Monetization CLI (MVP: AdMob x Flutter)

用法:
  ad-monetization analyze <path>
  ad-monetization plan <path> --formats banner,interstitial,rewarded [--no-wire-main] [--child-directed] [--platform-options-json '{"interstitialMinIntervalSeconds":60}']
  ad-monetization apply <path> --formats ... --yes [--allow-dirty] [--no-wire-main] [--child-directed]
  ad-monetization validate <path> [--profile development|release] [--markets US,EEA] [--child-directed]
  ad-monetization verify <path> [--levels static,build,runtime] [--targets ios,android] [--profile development] [--markets US,EEA] [--timeout-sec 900] [--json-out file.json]
  ad-monetization report <path> [--out file.md] [--verification-file file.json]
  ad-monetization revenue --file <csv|json> --start 2026-01-01 --end 2026-01-31
  ad-monetization revenue --api --publisher pub-xxxxxxxxxxxxxxxx --start 2026-01-01 --end 2026-01-31 [--dimensions DATE,COUNTRY,FORMAT]
  ad-monetization perf --file <csv|json> [--group-by format,country]

通用:
  --json    以 MCP 信封 JSON 输出

退出码: 0 成功；2 工具错误；1 validate overall=fail / verify failed；3 verify 全部 skipped
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
  levels?: string[] | undefined;
  targets?: string[] | undefined;
  out?: string | undefined;
  file?: string | undefined;
  api?: boolean | undefined;
  publisher?: string | undefined;
  start?: string | undefined;
  end?: string | undefined;
  dimensions?: string[] | undefined;
  groupBy?: string[] | undefined;
  timeoutSec?: number | undefined;
  jsonOut?: string | undefined;
  verificationFile?: string | undefined;
}

function csvOption(name: string, value: string | undefined): string[] | undefined {
  if (!value) throw new AppError('INVALID_INPUT', `${name} 需要值`);
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  const positional: string[] = [];
  let i = 0;
  const next = (flag: string): string => {
    const value = argv[++i];
    if (!value) throw new AppError('INVALID_INPUT', `${flag} 需要值`);
    return value;
  };
  for (; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--formats') {
      const value = next(a);
      args.formats = csvOption('--formats', value) as AdFormat[] | undefined;
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
    } else if (a === '--api') {
      args.api = true;
    } else if (a === '--profile') {
      const value = next(a);
      if (value !== 'development' && value !== 'release') {
        throw new AppError('INVALID_INPUT', `--profile 只接受 development|release，收到: ${value}`);
      }
      args.profile = value;
    } else if (a === '--markets') {
      args.markets = csvOption('--markets', next(a));
    } else if (a === '--levels') {
      args.levels = csvOption('--levels', next(a));
    } else if (a === '--targets') {
      args.targets = csvOption('--targets', next(a));
    } else if (a === '--dimensions') {
      args.dimensions = csvOption('--dimensions', next(a))?.map((d) => d.toUpperCase());
    } else if (a === '--group-by') {
      args.groupBy = csvOption('--group-by', next(a));
    } else if (a === '--out') {
      args.out = next(a);
    } else if (a === '--json-out') {
      args.jsonOut = next(a);
    } else if (a === '--verification-file') {
      args.verificationFile = next(a);
    } else if (a === '--file') {
      args.file = next(a);
    } else if (a === '--publisher') {
      args.publisher = next(a);
    } else if (a === '--start') {
      args.start = next(a);
    } else if (a === '--end') {
      args.end = next(a);
    } else if (a === '--timeout-sec') {
      const value = Number(next(a));
      if (!Number.isInteger(value) || value <= 0) throw new AppError('INVALID_INPUT', '--timeout-sec 需要正整数');
      args.timeoutSec = value;
    } else if (a === '--platform-options-json') {
      const value = next(a);
      try {
        args.platformOptions = JSON.parse(value) as Record<string, unknown>;
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

function emitEnvelope(envelope: ToolEnvelope<unknown>): void {
  process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
}

function printAnalysis(analysis: Awaited<ReturnType<typeof analyzeProject>>, args: CliArgs): void {
  if (args.json) {
    emitEnvelope({
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
    emitEnvelope(envelope);
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
    emitEnvelope(envelope);
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

// ---- verify ----

type VerifyEnvelope = ToolEnvelope<VerifyData>;

async function callVerifyTool(path: string, args: CliArgs): Promise<VerifyEnvelope> {
  // 与 MCP 工具共用同一条 core 路径
  const result = await verifyAdIntegration({
    projectPath: path,
    levels: args.levels,
    targets: args.targets,
    markets: args.markets,
    profile: args.profile,
    timeoutSec: args.timeoutSec,
  });
  return {
    ok: true,
    summary: `三级验证: ${result.statement}`,
    data: { levels: result.levels, verdict: result.verdict, statement: result.statement },
    warnings: result.warnings,
    sources: [],
    nextSteps: result.nextSteps,
  };
}

function printVerify(result: VerifyEnvelope, args: CliArgs): number {
  if (args.json || !result.ok) {
    emitEnvelope(result as ToolEnvelope<unknown>);
    if (!result.ok) return 2;
  }
  const { levels, verdict } = result.data;
  const out: string[] = [];
  if (levels.static) {
    const s = levels.static.summary;
    out.push(`static: ${verdict.static}（pass ${s.pass} / warning ${s.warning} / fail ${s.fail} / na ${s.na}）`);
  }
  if (levels.build) {
    out.push(`build: ${verdict.build}${verdict.build === 'skipped' ? `（${levels.build.summary}）` : ''}`);
    for (const step of levels.build.steps) {
      const secs = step.durationMs !== undefined ? ` ${(step.durationMs / 1000).toFixed(1)}s` : '';
      const reason = step.reason ? ` — ${step.reason}` : '';
      out.push(`  ${step.status.padEnd(7)} ${step.id}${secs}${reason}`);
    }
  }
  if (levels.runtime) {
    out.push(`runtime: ${verdict.runtime}（${levels.runtime.items.length} 项人工核对清单；推荐命令: ${levels.runtime.recommendedCommand}）`);
    for (const item of levels.runtime.items) out.push(`  - ${item.title}`);
  }
  out.push('', result.data.statement);
  if (result.warnings.length > 0) out.push('', '警告:', ...result.warnings.map((w) => `  ! ${w}`));
  process.stdout.write(`${out.join('\n')}\n`);

  // 退出码：static/build failed → 1；全部 skipped → 3；否则 0
  const requested = (args.levels ?? ['static', 'build']).map((l) => l.trim()).filter(Boolean);
  const statuses = requested.map((level) => verdict[level as keyof typeof verdict] ?? 'not_requested');
  if (statuses.every((s) => s === 'skipped')) return 3;
  if (statuses.some((s) => s === 'failed')) return 1;
  return 0;
}

// ---- revenue / perf ----

function printRevenueRows(rows: RevenueRow[], meta: { source: string; currency: string }): void {
  const total = rows.reduce((sum, r) => sum + (r.earnings ?? 0), 0);
  process.stdout.write(`来源: ${meta.source}；行数: ${rows.length}；合计收益: ${total.toFixed(2)} ${meta.currency}\n`);
  for (const row of rows.slice(0, 20)) {
    const dims = [row.date, row.country, row.format, row.adUnit].filter(Boolean).join(' | ');
    process.stdout.write(`  ${dims || '(汇总行)'}: 请求 ${row.requests ?? '—'} / 匹配 ${row.matchedRequests ?? '—'} / 展示 ${row.impressions ?? '—'} / 点击 ${row.clicks ?? '—'} / 收益 ${row.earnings ?? 0} ${row.currency ?? meta.currency}\n`);
  }
  if (rows.length > 20) process.stdout.write(`  ...（其余 ${rows.length - 20} 行略）\n`);
}

function printMetricsTable(groups: MetricsGroup[]): void {
  process.stdout.write('  分组                    eCPM      matchRate  showRate  CTR      earnings\n');
  for (const g of groups.slice(0, 20)) {
    const fmt = (v: number | null) => (v === null ? '—' : v.toFixed(4));
    process.stdout.write(
      `  ${`${g.groupBy}=${g.key}`.padEnd(24)} ${fmt(g.metrics.ecpm).padEnd(9)} ${fmt(g.metrics.matchRate).padEnd(10)} ${fmt(g.metrics.showRate).padEnd(9)} ${fmt(g.metrics.ctr).padEnd(8)} ${g.metrics.earnings.toFixed(2)}\n`,
    );
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const { command, path } = args;

  try {
    if (!command) {
      process.stdout.write(USAGE);
      return 0;
    }
    // revenue/perf 不需要工程路径
    if (command !== 'revenue' && command !== 'perf' && !path) {
      process.stdout.write(USAGE);
      return 2;
    }
    switch (command) {
      case 'analyze': {
        const analysis = await analyzeProject(path!, {});
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
            projectPath: path!,
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
          projectPath: path!,
          formats: args.formats,
          mode: 'plan',
          wireMain: args.wireMain ?? true,
          childDirected: args.childDirected ?? false,
          platformOptions: args.platformOptions,
        });
        const result = await generateIntegration({
          projectPath: path!,
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
          projectPath: path!,
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
      case 'verify': {
        const result = await callVerifyTool(path!, args);
        const code = printVerify(result, args);
        if (args.jsonOut && result.ok) {
          // 与 MCP 工具相同的 data 结构写入文件（用户显式要求的写入，供 report --verification-file 使用）
          writeFileSync(args.jsonOut, `${JSON.stringify(result.data, null, 2)}\n`, 'utf8');
          process.stdout.write(`验证结果已写入: ${args.jsonOut}\n`);
        }
        return code;
      }
      case 'report': {
        let verification: unknown;
        if (args.verificationFile) {
          const text = readFileSync(args.verificationFile, 'utf8');
          try {
            verification = JSON.parse(text) as unknown;
          } catch (err) {
            throw new AppError('INVALID_INPUT', `--verification-file 不是合法 JSON: ${args.verificationFile}`, {
              details: err instanceof Error ? err.message : String(err),
            });
          }
        }
        const { markdown } = await buildIntegrationReport({ projectPath: path!, verification });
        if (args.out) {
          writeFileSync(args.out, markdown, 'utf8'); // --out 是用户显式要求的写入
          process.stdout.write(`报告已写入: ${args.out}（${markdown.split('\n').length} 行）\n`);
        } else {
          process.stdout.write(markdown);
        }
        return 0;
      }
      case 'revenue': {
        const start = args.start;
        const end = args.end;
        if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !end || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
          throw new AppError('INVALID_INPUT', 'revenue 需要 --start 与 --end（YYYY-MM-DD）');
        }
        let rows: RevenueRow[];
        let source: string;
        let currency = 'USD';
        if (args.api) {
          const { getAdapter } = await import('./adapters/registry.js');
          const adapter = getAdapter(loadKnowledge(), 'admob');
          if (!adapter.fetchRevenue) throw new AppError('UNSUPPORTED_COMBINATION', 'admob 适配器未实现 fetchRevenue');
          if (!args.publisher) throw new AppError('INVALID_INPUT', '--api 需要 --publisher pub-xxxxxxxxxxxxxxxx');
          const result = await adapter.fetchRevenue({
            publisherId: args.publisher,
            startDate: start,
            endDate: end,
            dimensions: args.dimensions,
          });
          rows = result.rows;
          currency = result.currency ?? currency;
          source = `admob_api（${args.publisher}）`;
        } else {
          if (!args.file) throw new AppError('INVALID_INPUT', 'revenue 需要 --file <csv|json> 或 --api --publisher ...');
          rows = importRevenueRows({ filePath: args.file, startDate: start, endDate: end });
          source = `file（${args.file}）`;
          const first = rows.find((r) => r.currency)?.currency;
          if (first) currency = first;
        }
        printRevenueRows(rows, { source, currency });
        return 0;
      }
      case 'perf': {
        if (!args.file) throw new AppError('INVALID_INPUT', 'perf 需要 --file <csv|json>（或通过 --json 传 rows 的 MCP 工具）');
        const rows = importRevenueRows({ filePath: args.file });
        const groupBy = (args.groupBy ?? ['format', 'country']) as GroupByField[];
        const metrics = computeMetrics(rows, groupBy);
        const insights = buildInsights(loadKnowledge(), metrics);
        const fmt = (v: number | null) => (v === null ? '—' : v.toFixed(4));
        process.stdout.write(`行数: ${rows.length}；分组: ${groupBy.join(', ')}\n\n`);
        process.stdout.write(`总体: eCPM ${fmt(metrics.overall.ecpm)} / matchRate ${fmt(metrics.overall.matchRate)} / showRate ${fmt(metrics.overall.showRate)} / CTR ${fmt(metrics.overall.ctr)} / earnings ${metrics.overall.earnings.toFixed(2)}\n\n`);
        printMetricsTable(metrics.groups);
        process.stdout.write(`\ninsights（启发式，不保证收益）: ${insights.length} 条\n`);
        for (const insight of insights) {
          process.stdout.write(`  [${insight.severity}] ${insight.group ? `${insight.group}: ` : ''}${insight.message}\n    建议: ${insight.suggestion}\n`);
        }
        return 0;
      }
      default:
        process.stdout.write(`未知命令: ${command}\n\n${USAGE}`);
        return 2;
    }
  } catch (err) {
    const { error } = toToolError(err);
    if (args.json) {
      emitEnvelope({ ok: false, error });
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
