import type { KnowledgeBase } from '../../knowledge/loader.js';
import { run as defaultRun, type ExecResult, type RunOptions } from '../../lib/exec.js';
import { describeMissing, type CommandRunner, type VerifyToolchain } from './toolchain.js';

export type BuildStepId = 'pub_get' | 'analyze' | 'build_android' | 'build_ios';
export type StepStatus = 'passed' | 'failed' | 'skipped';

export interface DiagnosedError {
  name: string;
  symptom: string;
  cause: string;
  fix: string;
  sourceUrl?: string | undefined;
}

export interface BuildStep {
  id: BuildStepId;
  command: string;
  status: StepStatus;
  exitCode?: number | undefined;
  durationMs?: number | undefined;
  reason?: string | undefined;
  logTail: string[]; // stdout+stderr 的最后 60 行
  diagnosis?: DiagnosedError[] | undefined;
}

export interface BuildLevelResult {
  status: 'passed' | 'failed' | 'skipped';
  steps: BuildStep[];
  warnings: string[];
  reason?: string | undefined;
  summary: string;
}

export interface BuildLevelInput {
  cwd: string;
  targets: { android: boolean; ios: boolean };
  toolchain: VerifyToolchain;
  kb: KnowledgeBase;
  runner?: CommandRunner;
  timeoutMs?: number; // 每条命令的超时，默认 15 分钟
}

const LOG_TAIL_LINES = 60;

function tail(text: string, lines: number): string[] {
  const all = text
    .split('\n')
    .map((l) => l.replace(/\r$/, ''));
  while (all.length > 0 && all[all.length - 1] === '') all.pop();
  return all.filter((_, i) => i >= all.length - lines);
}

// ---- 日志诊断：errors.json symptom 关键字 + 内置正则 ----

interface BuiltinPattern {
  regex: RegExp;
  error: DiagnosedError;
}

const BUILTIN_PATTERNS: BuiltinPattern[] = [
  {
    // 只匹配报错语句；单纯出现 minSdkVersion 字样（如配置回显）不算
    regex: /uses-sdk:minSdkVersion[^\n]*cannot be smaller than|Manifest merger failed/i,
    error: {
      name: 'MIN_SDK_TOO_LOW',
      symptom: '构建报 uses-sdk:minSdkVersion / manifest merger 错误',
      cause: '工程 minSdk 低于插件要求（google_mobile_ads 需要 24）。',
      fix: '在 android/app/build.gradle(.kts) 中把 minSdkVersion 提升到 24 及以上。',
      sourceUrl: 'https://developers.google.com/admob/flutter/quick-start',
    },
  },
  {
    // 只在报"部署目标不满足/范围不支持"类错误语句时匹配；iOS 构建日志总会回显 IPHONEOS_DEPLOYMENT_TARGET
    regex: /higher minimum deployment target|required a higher minimum|is set to [^\n]*but the range of supported deployment target/i,
    error: {
      name: 'IOS_DEPLOYMENT_TARGET_TOO_LOW',
      symptom: 'iOS 构建或 pod install 报部署目标不满足',
      cause: '工程 iOS 部署目标低于插件要求的 13.0。',
      fix: '在 ios/Podfile 中把平台部署目标提升到 13.0 及以上（Xcode 项目设置同步修改）。',
      sourceUrl: 'https://developers.google.com/admob/flutter/quick-start',
    },
  },
  {
    // 只匹配失败信号；正常流程总会打印 "Running pod install..."
    regex: /CocoaPods not installed|CocoaPods'? (?:specs repository is too out-of-date|could not find compatible versions)|Error running pod install|pod install[^\n]*(?:failed|error)|pod: command not found/i,
    error: {
      name: 'COCOAPODS_ISSUE',
      symptom: 'CocoaPods / pod install 相关错误',
      cause: 'CocoaPods 依赖解析或安装失败（版本过旧、规格仓库未更新等）。',
      fix: '运行 pod repo update 后重试；必要时 gem 更新 cocoapods；也可尝试 flutter clean && flutter pub get。',
      sourceUrl: 'https://developers.google.com/admob/flutter/quick-start',
    },
  },
  {
    regex: /version solving failed/i,
    error: {
      name: 'DART_VERSION_SOLVING_FAILED',
      symptom: 'pub 依赖解析失败（version solving failed）',
      cause: '依赖版本约束与当前 Dart/Flutter SDK 或其他依赖冲突。',
      fix: '按错误信息调整 pubspec.yaml 的版本约束（或升级 Flutter SDK），然后 flutter pub get。',
      sourceUrl: 'https://dart.dev/tools/pub/dependencies',
    },
  },
  {
    regex: /No such module/i,
    error: {
      name: 'NO_SUCH_MODULE',
      symptom: 'Swift 编译报 No such module',
      cause: 'Pods 未安装或模块产物缺失。',
      fix: '在 ios/ 目录执行 pod install（或 flutter build ios 重新触发），必要时 flutter clean 后重来。',
      sourceUrl: 'https://developers.google.com/admob/flutter/quick-start',
    },
  },
];

/**
 * 从 errors.json 的 symptom 中抽取代码类关键字：
 * 只保留引号内容与"含大写字母/点/冒号"的代码型 token（如 GADInvalidInitializationException、
 * uses-sdk:minSdkVersion），过滤 merger 这类普通英文词，避免误匹配。
 */
function symptomKeywords(symptom: string): string[] {
  const quoted = [...symptom.matchAll(/"([^"]{4,})"/g)].map((m) => m[1]!);
  const tokens = [...symptom.matchAll(/[A-Za-z][A-Za-z0-9_.:$/-]{4,}/g)]
    .map((m) => m[0]!)
    .filter((t) => /[A-Z]/.test(t) || /[.:]/.test(t));
  return [...new Set([...quoted, ...tokens])];
}

/** 用知识库 errors.json 与内置正则匹配日志，给出可能原因与修复建议（最多 3 条）。 */
export function diagnoseBuildLog(log: string, kb: KnowledgeBase): DiagnosedError[] {
  const found: DiagnosedError[] = [];
  const push = (error: DiagnosedError) => {
    if (found.length >= 3) return;
    if (found.some((f) => f.name === error.name)) return;
    found.push(error);
  };

  for (const { regex, error } of BUILTIN_PATTERNS) {
    if (regex.test(log)) push(error);
  }

  try {
    for (const entry of kb.getErrors('admob').errors) {
      const haystack = `${entry.symptom} ${entry.name}`;
      const hit = symptomKeywords(haystack).some((kw) => log.includes(kw));
      if (hit) {
        push({
          name: typeof entry.code === 'number' ? entry.name : String(entry.code),
          symptom: entry.symptom,
          cause: entry.cause,
          fix: entry.fix,
          sourceUrl: entry.sourceUrl,
        });
      }
    }
  } catch {
    // 知识缺失时只用内置正则
  }
  return found;
}

// ---- build 级执行 ----

function countAnalyzeIssues(output: string): { errors: number; warnings: number } {
  const errors = (output.match(/^\s*error\s*•/gm) ?? []).length;
  const warnings = (output.match(/^\s*warning\s*•/gm) ?? []).length;
  return { errors, warnings };
}

/** 运行 build 级验证（architecture.md 3.6）：pub get → analyze → build apk → build ios。 */
export async function runBuildLevel(input: BuildLevelInput): Promise<BuildLevelResult> {
  const runner: CommandRunner = input.runner ?? ((cmd, args, options) => defaultRun(cmd, args, options));
  const timeoutMs = input.timeoutMs ?? 900_000;
  const steps: BuildStep[] = [];
  const warnings: string[] = [];

  const command = (cmd: string, args: string[]) => `${cmd} ${args.join(' ')}`;
  const skipped = (id: BuildStepId, cmd: string, reason: string): BuildStep => ({
    id,
    command: cmd,
    status: 'skipped',
    reason,
    logTail: [],
  });

  // 前置：flutter 不存在 → 整个 build 级 skipped
  if (!input.toolchain.flutter) {
    const reason = `TOOLCHAIN_MISSING: ${describeMissing(input.toolchain).filter((m) => m.includes('flutter')).join('; ')}`;
    for (const [id, cmd] of [
      ['pub_get', 'flutter pub get'],
      ['analyze', 'flutter analyze --no-fatal-infos'],
      ['build_android', 'flutter build apk --debug'],
      ['build_ios', 'flutter build ios --simulator --debug --no-codesign'],
    ] as const) {
      steps.push(skipped(id, cmd, reason));
    }
    return {
      status: 'skipped',
      steps,
      warnings,
      reason: 'TOOLCHAIN_MISSING',
      summary: 'build 级 skipped：未找到 flutter 工具链',
    };
  }

  /** 执行一步；log 是完整 stdout+stderr（供调用方解析，不放进输出的 step 对象）。 */
  const runStep = async (id: BuildStepId, cmd: string, args: string[]): Promise<{ step: BuildStep; log: string }> => {
    const result: ExecResult = await runner(cmd, args, { cwd: input.cwd, timeoutMs });
    const log = `${result.stdout}\n${result.stderr}`;
    const step: BuildStep = {
      id,
      command: command(cmd, args),
      status: result.exitCode === 0 ? 'passed' : 'failed',
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      logTail: tail(log, LOG_TAIL_LINES),
    };
    if (result.timedOut) step.reason = `命令超时（超过 ${Math.round(timeoutMs / 1000)}s）`;
    if (step.status === 'failed') step.diagnosis = diagnoseBuildLog(log, input.kb);
    return { step, log };
  };

  const pubGet = (await runStep('pub_get', 'flutter', ['pub', 'get'])).step;
  steps.push(pubGet);

  const gateFailed = pubGet.status === 'failed';
  const gateReason = `previous step failed (pub_get)`;

  // analyze：对完整 stdout+stderr 计数（logTail 只有最后 60 行，不够）
  if (gateFailed) {
    steps.push(skipped('analyze', command('flutter', ['analyze', '--no-fatal-infos']), gateReason));
  } else {
    const { step, log } = await runStep('analyze', 'flutter', ['analyze', '--no-fatal-infos']);
    const { errors, warnings: warnCount } = countAnalyzeIssues(log);
    if (errors > 0) {
      step.status = 'failed';
      step.reason = `flutter analyze 报告 ${errors} 个 error`;
      step.diagnosis = step.diagnosis ?? [];
    } else if (step.status === 'failed') {
      if (warnCount > 0) {
        // --no-fatal-infos 下 warning/info 不算失败
        step.status = 'passed';
      } else {
        step.status = 'failed';
        step.reason = `flutter analyze 退出码 ${step.exitCode} 但未能解析出问题行（可能是分析器自身异常）`;
      }
    }
    if (step.status === 'passed' && warnCount > 0) {
      warnings.push(`flutter analyze 有 ${warnCount} 个 warning（不阻塞构建）`);
    }
    steps.push(step);
  }

  const analyzeFailed = steps[steps.length - 1]!.status === 'failed';
  const buildGateFailed = gateFailed || analyzeFailed;
  const buildGateReason = analyzeFailed ? 'previous step failed (analyze)' : gateReason;

  // build_android 与 build_ios 互不影响，但都受 pub_get/analyze 门禁
  const androidCmd = command('flutter', ['build', 'apk', '--debug']);
  if (!input.targets.android) {
    steps.push(skipped('build_android', androidCmd, 'targets 未包含 android'));
  } else if (buildGateFailed) {
    steps.push(skipped('build_android', androidCmd, buildGateReason));
  } else if (!input.toolchain.java || !input.toolchain.androidSdk) {
    const missing = describeMissing(input.toolchain).filter((m) => m.includes('java') || m.includes('Android SDK'));
    steps.push(skipped('build_android', androidCmd, `TOOLCHAIN_MISSING: ${missing.join('; ')}`));
  } else {
    steps.push((await runStep('build_android', 'flutter', ['build', 'apk', '--debug'])).step);
  }

  const iosCmd = command('flutter', ['build', 'ios', '--simulator', '--debug', '--no-codesign']);
  if (!input.targets.ios) {
    steps.push(skipped('build_ios', iosCmd, 'targets 未包含 ios'));
  } else if (buildGateFailed) {
    steps.push(skipped('build_ios', iosCmd, buildGateReason));
  } else if (!input.toolchain.macos || !input.toolchain.xcodebuild) {
    const missing = describeMissing(input.toolchain).filter((m) => m.includes('macOS') || m.includes('xcodebuild'));
    steps.push(skipped('build_ios', iosCmd, `TOOLCHAIN_MISSING: ${missing.join('; ')}`));
  } else {
    steps.push((await runStep('build_ios', 'flutter', ['build', 'ios', '--simulator', '--debug', '--no-codesign'])).step);
  }

  // 级别状态：有 failed → failed；全部执行的步骤 passed 且至少一个平台构建 passed → passed；否则 skipped
  const executed = steps.filter((s) => s.status !== 'skipped');
  const anyFailed = executed.some((s) => s.status === 'failed');
  const buildPassed = steps.filter((s) => s.id === 'build_android' || s.id === 'build_ios').some((s) => s.status === 'passed');

  if (anyFailed) {
    const failed = executed.filter((s) => s.status === 'failed').map((s) => s.id);
    return { status: 'failed', steps, warnings, summary: `build 级 failed：${failed.join(', ')} 未通过` };
  }
  if (executed.length > 0 && buildPassed && executed.every((s) => s.status === 'passed')) {
    // 一个平台 passed 另一个 skipped 时：级别 passed，但必须明确指出未验证的平台
    for (const s of steps) {
      if ((s.id === 'build_android' || s.id === 'build_ios') && s.status === 'skipped') {
        warnings.push(`${s.id === 'build_android' ? 'Android' : 'iOS'} 构建未验证（${s.reason ?? '未知原因'}）`);
      }
    }
    return { status: 'passed', steps, warnings, summary: `build 级 passed：${executed.map((s) => s.id).join(', ')} 通过` };
  }
  const reason = buildPassed ? undefined : '没有实际执行的平台构建（工具链或目标缺失）';
  return { status: 'skipped', steps, warnings, reason, summary: `build 级 skipped：${reason ?? ''}` };
}
