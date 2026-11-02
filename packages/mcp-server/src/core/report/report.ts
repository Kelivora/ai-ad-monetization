import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadKnowledge } from '../../knowledge/loader.js';
import { toSourceRefs } from '../../knowledge/freshness.js';
import { readTextIfExists } from '../../lib/fs.js';
import { AppError } from '../../lib/errors.js';
import { analyzeProject } from '../project/analyze.js';
import { validateAdConfig, type ValidationOutput } from '../validation/engine.js';

/**
 * build_integration_report 核心：把前面工具的结果拼成中文 Markdown 报告。
 * 未提供的部分按规格自动重算（analysis / validation），verification 未提供写"未执行"。
 */

interface IntegrationRecord {
  platform?: string;
  framework?: string;
  formats?: string[];
  usesTestIds?: boolean;
  plugin?: { name?: string; version?: string };
  planHash?: string;
  appliedAt?: string;
  changedFiles?: string[];
}

export interface ReportInput {
  projectPath: string;
  recommendation?: unknown;
  placements?: unknown;
  plan?: unknown;
  validation?: unknown;
  verification?: unknown;
  markets?: unknown;
  assumptions?: unknown;
}

export interface ReportOutput {
  markdown: string;
  integrationRecordFound: boolean;
}

function fmtPct(value: number | null | undefined): string {
  return typeof value === 'number' ? `${(value * 100).toFixed(1)}%` : '—';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function renderFindings(output: ValidationOutput): string[] {
  const mark: Record<string, string> = { pass: '✔', warning: '⚠', fail: '✘', na: '·' };
  if (output.findings.length === 0) return ['（无 findings）'];
  return output.findings.map(
    (f) => `- ${mark[f.status] ?? '?'} **${f.status}** \`${f.ruleId}\`: ${f.message}${f.file ? `（${f.file}）` : ''}`,
  );
}

function renderVerification(verification: unknown): string[] {
  const record = asRecord(verification);
  if (Object.keys(record).length === 0) {
    return ['**未执行**（可用 verify_ad_integration 获取 static/build/runtime 三级结果后重新生成报告）'];
  }
  const verdict = asRecord(record['verdict']);
  const levels = asRecord(record['levels']);
  const lines: string[] = [];
  const levelNames: Array<[string, string]> = [
    ['static', 'static（静态校验）'],
    ['build', 'build（构建验证）'],
    ['runtime', 'runtime（运行时核对）'],
  ];
  for (const [key, label] of levelNames) {
    const status = verdict[key];
    if (status === undefined) {
      lines.push(`- ${label}: 未请求`);
      continue;
    }
    lines.push(`- ${label}: **${String(status)}**`);
    const level = asRecord(levels[key]);
    if (key === 'build' && Array.isArray(level['steps'])) {
      for (const step of level['steps'] as Array<Record<string, unknown>>) {
        const reason = step['reason'] ? `（${String(step['reason'])}）` : '';
        lines.push(`  - ${String(step['id'])}: ${String(step['status'])}${reason}`);
      }
      const buildWarnings = Array.isArray(level['warnings']) ? (level['warnings'] as unknown[]).map(String) : [];
      // 明确写出一方平台构建未验证（例如 Java/Android SDK 缺失时 android skipped）；与 build 级 warnings 去重
      for (const step of level['steps'] as Array<Record<string, unknown>>) {
        const platform = step['id'] === 'build_android' ? 'Android' : step['id'] === 'build_ios' ? 'iOS' : undefined;
        if (!platform || step['status'] !== 'skipped') continue;
        const derived = `${platform} 构建未验证`;
        if (buildWarnings.some((w) => w.includes(derived))) {
          buildWarnings.splice(
            buildWarnings.findIndex((w) => w.includes(derived)),
            1,
          );
        }
        lines.push(`  - ⚠ ${derived}${step['reason'] ? `（${String(step['reason'])}）` : ''}`);
      }
      for (const w of buildWarnings) lines.push(`  - ⚠ ${w}`);
    }
    if (key === 'runtime' && status === 'requires_manual_verification' && Array.isArray(level['items'])) {
      for (const item of level['items'] as Array<Record<string, unknown>>) {
        lines.push(`  - 待人工核对: ${String(item['title'])}`);
      }
    }
  }
  return lines;
}

/** 生成集成报告 Markdown（不写文件；写文件由调用方/用户决定）。 */
export async function buildIntegrationReport(input: ReportInput): Promise<ReportOutput> {
  const kb = loadKnowledge();
  const analysis = await analyzeProject(input.projectPath, { skipToolchain: true });
  if (analysis.framework !== 'flutter') {
    throw new AppError('UNSUPPORTED_COMBINATION', `build_integration_report 目前仅支持 Flutter 工程（当前: ${analysis.framework}）`);
  }

  // integration.json（generate_ad_integration apply 后存在）
  const integrationPath = join(analysis.root, '.ai-ad-monetization', 'integration.json');
  const integration: IntegrationRecord = existsSync(integrationPath)
    ? (JSON.parse(readTextIfExists(integrationPath) ?? '{}') as IntegrationRecord)
    : {};

  // validation：未提供时自动按 development 口径重算
  const validationProvided = asRecord(input.validation);
  const validation: ValidationOutput =
    Object.keys(validationProvided).length > 0 && 'findings' in validationProvided
      ? (validationProvided as unknown as ValidationOutput)
      : await validateAdConfig({ projectPath: input.projectPath, profile: 'development', markets: [] });

  // release 口径（第 8 节 "上线前必须完成" 需要 fail 项）
  const releaseValidation = await validateAdConfig({ projectPath: input.projectPath, profile: 'release', markets: [] });
  const releaseFails = releaseValidation.findings.filter((f) => f.status === 'fail');

  const markets = Array.isArray(input.markets) ? (input.markets as string[]).map((m) => String(m)) : [];

  const out: string[] = [];
  out.push('# 广告集成报告');
  out.push('');

  // 1 概览
  out.push('## 1. 概览');
  const plugin = integration.plugin;
  out.push(
    `- 平台 / 框架: ${integration.platform ?? 'admob'} × ${integration.framework ?? analysis.framework}`,
    `- 广告格式: ${(integration.formats ?? []).join(', ') || '未生成（未找到集成记录）'}`,
    `- 插件版本: ${plugin?.name && plugin.version ? `${plugin.name} ${plugin.version}` : '未知'}`,
    `- 是否测试 ID: ${integration.usesTestIds === undefined ? '未知（无集成记录）' : integration.usesTestIds ? '是（开发口径）' : '否'}`,
    `- 目标平台: ${['android', 'ios'].filter((t) => analysis.targets[t as 'android' | 'ios']).join(' + ') || '未知'}`,
    `- 集成时间: ${integration.appliedAt ?? '—'}；planHash: ${integration.planHash ?? '—'}`,
  );
  out.push('');

  // 2 项目分析
  out.push('## 2. 项目分析');
  out.push(
    `- 工程根: \`${analysis.root}\`；判定依据: ${analysis.frameworkEvidence.join('; ')}`,
    `- 应用名: ${analysis.appName ?? '未知'}；Android ID: ${analysis.identifiers.androidApplicationId ?? '—'}；iOS Bundle ID: ${analysis.identifiers.iosBundleId ?? '—'}`,
    `- 已有广告 SDK: ${analysis.existingAdSdks.length === 0 ? '无' : analysis.existingAdSdks.map((s) => `${s.name}@${s.version ?? '?'} (${s.location})`).join(', ')}`,
    `- 已有广告代码: ${analysis.existingAdCode.length === 0 ? '无' : analysis.existingAdCode.map((c) => c.file).join(', ')}`,
    `- git: ${analysis.git.isRepo ? (analysis.git.dirtyFiles.length > 0 ? `${analysis.git.dirtyFiles.length} 个未提交改动` : '干净') : '非 git 仓库'}`,
  );
  if (analysis.issues.length > 0) out.push(`- 注意: ${analysis.issues.join('；')}`);
  out.push('');

  // 3 平台选择与理由
  out.push('## 3. 平台选择与理由');
  const recommendation = asRecord(input.recommendation);
  const results = Array.isArray(recommendation['results']) ? (recommendation['results'] as Array<Record<string, unknown>>) : [];
  if (results.length > 0) {
    for (const [i, r] of results.entries()) {
      out.push(
        `- ${i + 1}. **${String(r['displayName'] ?? r['platformId'])}**（score ${String(r['score'])}, ${String(r['supportLevel'])}）`,
      );
      const reasons = Array.isArray(r['reasons']) ? (r['reasons'] as unknown[]).map(String) : [];
      if (reasons.length > 0) out.push(`   - 理由: ${reasons.join('；')}`);
      const cautions = Array.isArray(r['cautions']) ? (r['cautions'] as unknown[]).map(String) : [];
      if (cautions.length > 0) out.push(`   - 注意: ${cautions.join('；')}`);
    }
  } else {
    out.push('未提供 recommend_ad_platform 结果（可先运行该工具再生成报告）。');
  }
  out.push('');

  // 4 广告位规划
  out.push('## 4. 广告位规划');
  const placements = asRecord(input.placements);
  const placementList = Array.isArray(placements['placements']) ? (placements['placements'] as Array<Record<string, unknown>>) : [];
  if (placementList.length > 0) {
    out.push(`策略: ${String(placements['policyLabel'] ?? '—')}（启发式规划，heuristic）`);
    for (const p of placementList) {
      const cap = p['frequencyCapSeconds'] !== undefined ? `，频控 ${String(p['frequencyCapSeconds'])}s` : '';
      out.push(`- **${String(p['id'])}** ${String(p['format'])} @ ${String(p['location'])}（${String(p['trigger'])}${cap}）`);
    }
  } else {
    out.push('未提供 plan_ad_placements 结果（可先运行该工具再生成报告）。');
  }
  out.push('');

  // 5 变更文件
  out.push('## 5. 变更文件');
  const plan = asRecord(input.plan);
  const planChanges = Array.isArray(plan['changes']) ? (plan['changes'] as Array<Record<string, unknown>>) : [];
  const changed = integration.changedFiles ?? planChanges.map((c) => String(c['path']));
  if (changed.length > 0) {
    out.push(`来源: ${integration.changedFiles ? '`.ai-ad-monetization/integration.json`' : '传入的 plan'}`);
    for (const file of changed) out.push(`- \`${file}\``);
  } else {
    out.push('未找到变更记录（无 `.ai-ad-monetization/integration.json`，也未传入 plan）。');
  }
  out.push('');

  // 6 合规与隐私
  out.push('## 6. 合规与隐私');
  const privacy = kb.getPrivacy('admob');
  out.push(`- ${privacy.disclaimer}`);
  const relevantMarkets = markets.length > 0 ? markets : ['EEA', 'US'];
  for (const req of privacy.requirements) {
    const hits = req.markets.some((m) => relevantMarkets.some((rm) => rm.toUpperCase() === m.toUpperCase()));
    if (!hits) continue;
    out.push(`- **${req.markets.join('/')} — ${req.topic}**: ${req.requirement}`);
    for (const step of req.implementation) out.push(`  - ${step}`);
  }
  if (analysis.ios) {
    out.push(`- iOS SKAdNetwork 条目: ${analysis.ios.skAdNetworkCount} 个；ATT 用途说明: ${analysis.ios.hasAttDescription ? '已配置' : '缺失（需要 ATT 追踪时必须补）'}`);
  }
  out.push('');

  // 7 验证结果
  out.push('## 7. 验证结果');
  out.push(...renderVerification(input.verification));
  out.push('', '### 静态校验（validate_ad_config）');
  out.push(
    `overall: **${validation.overall}**（pass ${validation.summary.pass} / warning ${validation.summary.warning} / fail ${validation.summary.fail} / na ${validation.summary.na}）`,
    ...renderFindings(validation),
  );
  out.push('');

  // 8 上线前必须由你完成的事项
  out.push('## 8. 上线前必须由你完成的事项');
  const planManual = Array.isArray(plan['manualSteps']) ? (plan['manualSteps'] as unknown[]).map(String) : [];
  const manualSteps = planManual.length > 0 ? planManual : [
    '在 AdMob 后台创建应用与真实广告单元 ID（工具不代登录）',
    '在 AdMob 后台 Privacy & messaging 创建并发布 GDPR / 美国州合规消息（面向 EEA/UK/CH/US 时必须）',
    '替换真实广告单元 ID（--dart-define 覆盖测试 ID），并在真机注册测试设备',
    '准备隐私政策文案（说明广告 SDK 数据使用），商店上架材料自查',
  ];
  manualSteps.forEach((step, i) => out.push(`${i + 1}. ${step}`));
  if (releaseFails.length > 0) {
    out.push('', 'release 口径下仍会拦截的项（替换真实 ID / 完成合规前无法通过发布校验）:');
    for (const f of releaseFails) out.push(`- ✘ \`${f.ruleId}\`: ${f.message}${f.fix ? `（修复: ${f.fix}）` : ''}`);
  } else {
    out.push('', 'release 口径校验: 无 fail 项。');
  }
  out.push('');

  // 9 来源与知识时效
  out.push('## 9. 来源与知识时效');
  const now = new Date();
  const sdk = kb.getSdk('admob', 'flutter');
  const sourceGroups: Array<[string, ReturnType<typeof toSourceRefs>]> = [
    ['SDK 知识（platforms/admob/sdk/flutter.json）', toSourceRefs(sdk.sources, sdk.reviewIntervalDays, now)],
    ['隐私合规（platforms/admob/privacy.json）', toSourceRefs(privacy.sources, privacy.reviewIntervalDays, now)],
  ];
  for (const [label, refs] of sourceGroups) {
    for (const ref of refs) {
      out.push(`- ${label}: [${ref.title}](${ref.url})（抓取 ${ref.retrievedAt}${ref.verifiedVersion ? `，验证版本 ${ref.verifiedVersion}` : ''}）${ref.stale ? ' ⚠ 超过复核周期，建议复核' : ''}`);
    }
  }
  out.push(
    '',
    '> 知识库按 reviewIntervalDays 定期复核；标 ⚠ 的来源超过周期未复核，结论可能过期。报告中的启发式建议（广告位、洞察）不保证收益效果。',
  );

  return { markdown: out.join('\n') + '\n', integrationRecordFound: existsSync(integrationPath) };
}
