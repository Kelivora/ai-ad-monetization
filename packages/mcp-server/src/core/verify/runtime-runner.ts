import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { run as defaultRun } from '../../lib/exec.js';
import type { KnowledgeBase } from '../../knowledge/loader.js';
import type { CommandRunner } from './toolchain.js';
import { buildRuntimeChecklist, type RuntimeChecklistItem } from './runtime-checklist.js';

/**
 * runtime 级自动化验证（architecture.md 3.6）：
 * 在指定设备上串行执行冷烟测试 integration_test/ads_smoke_test.dart，
 * 解析 AI_AD_SMOKE 结果行与退出码；仍返回未被自动化覆盖的人工核对清单。
 */

export const SMOKE_TEST_RELATIVE_PATH = 'integration_test/ads_smoke_test.dart';
const LOG_TAIL_LINES = 60;
/**
 * 仅匹配 flutter 自身的"设备不存在"报错文案。判定还要求日志里没有任何
 * AI_AD_SMOKE 行：冒烟失败信息或 SDK 日志里出现 "not found" 不算设备缺失。
 */
const DEVICE_MISSING = /No devices found|No supported devices (?:found|connected)|No devices found with name or id matching|Unable to locate a device/i;

export interface SmokeCheck {
  check: string;
  ok: boolean;
  ms?: number | undefined;
  detail?: string | undefined;
  skipped?: boolean | undefined;
}

export interface RuntimeDeviceRun {
  device: string;
  command: string;
  status: 'passed' | 'failed' | 'skipped';
  exitCode?: number | undefined;
  durationMs?: number | undefined;
  /** flutter devices --machine 查到的 targetPlatform（如 ios / android-arm64），查不到为 unknown */
  targetPlatform?: string | undefined;
  checks: SmokeCheck[];
  logTail: string[];
  reason?: string | undefined;
  /** 失败的 *_loaded 检查的启发式诊断（中文） */
  diagnosis?: RuntimeDiagnosis[] | undefined;
}

export interface RuntimeDiagnosis {
  check: string;
  code?: number | undefined;
  domain?: string | undefined;
  cause: string;
  fix: string;
  /** 查看平台广告日志的命令 */
  logCommand?: string | undefined;
}

export interface RuntimeLevelResult {
  status: 'passed' | 'failed' | 'skipped';
  smokeTestFile: string;
  runs: RuntimeDeviceRun[];
  /** 未被自动化覆盖、仍需人工核对的清单项 */
  manualItems: RuntimeChecklistItem[];
  recommendedCommand: string;
  warnings: string[];
  reason?: string | undefined;
  summary: string;
}

export interface RuntimeLevelInput {
  cwd: string;
  devices: string[];
  showFullscreen?: boolean | undefined;
  targets: { android: boolean; ios: boolean };
  runner?: CommandRunner;
  timeoutMs?: number; // 每台设备的命令超时，默认 15 分钟
  kb?: KnowledgeBase; // 加载失败诊断用（缺省只用内置启发式）
}

function tail(text: string, lines: number): string[] {
  const all = text
    .split('\n')
    .map((l) => l.replace(/\r$/, ''));
  while (all.length > 0 && all[all.length - 1] === '') all.pop();
  return all.filter((_, i) => i >= all.length - lines);
}

/** 从日志中解析所有 AI_AD_SMOKE {json} 行（坏行忽略）。 */
export function parseSmokeChecks(log: string): SmokeCheck[] {
  const checks: SmokeCheck[] = [];
  for (const match of log.matchAll(/AI_AD_SMOKE (\{[^\r\n]*\})/g)) {
    try {
      const parsed = JSON.parse(match[1]!) as Record<string, unknown>;
      if (typeof parsed['check'] !== 'string' || typeof parsed['ok'] !== 'boolean') continue;
      const check: SmokeCheck = { check: parsed['check'], ok: parsed['ok'] };
      if (typeof parsed['ms'] === 'number') check.ms = parsed['ms'];
      if (typeof parsed['detail'] === 'string') check.detail = parsed['detail'];
      if (parsed['skipped'] === true) check.skipped = true;
      checks.push(check);
    } catch {
      // 非法 JSON 行忽略
    }
  }
  return checks;
}

/** flutter devices --machine 的 id/name → targetPlatform 映射（查不到返回空 Map）。 */
async function lookupDevicePlatforms(runner: CommandRunner, cwd: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const result = await runner('flutter', ['devices', '--machine'], { cwd, timeoutMs: 60_000 });
  if (result.exitCode !== 0 || result.timedOut) return map;
  const text = result.stdout;
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) return map;
  try {
    const devices = JSON.parse(text.slice(start, end + 1)) as Array<
      { id?: unknown; name?: unknown; targetPlatform?: unknown }
    >;
    for (const device of devices) {
      if (typeof device?.id !== 'string' || typeof device.targetPlatform !== 'string') continue;
      map.set(device.id, device.targetPlatform);
      if (typeof device.name === 'string') map.set(device.name, device.targetPlatform);
    }
  } catch {
    // 输出不是合法 JSON：targetPlatform 记 unknown
  }
  return map;
}

// ---- 加载失败诊断（中文启发式） ----

const LOAD_ERROR_PATTERN = /code=(\d+)\s+domain=(\S+)\s+message=(.*)/s;

/** 平台广告日志查看命令（按 targetPlatform 前缀判断）。 */
function platformLogCommand(targetPlatform: string): string {
  if (targetPlatform.startsWith('android')) return 'adb logcat -s Ads';
  return "Xcode 控制台，或 `xcrun simctl spawn booted log stream --predicate 'subsystem contains \"Google\"'`";
}

/**
 * 对失败的 *_loaded 检查生成启发式诊断：
 * detail 里的 code 匹配 knowledge errors.json（code 0/1/2/3）给出 cause/fix；
 * 只有 rewarded 失败而 banner/interstitial 成功且 code=0 时追加网络环境提示。
 */
function buildDiagnosis(run: RuntimeDeviceRun, kb?: KnowledgeBase): RuntimeDiagnosis[] {
  const logCommand = platformLogCommand(run.targetPlatform ?? 'unknown');
  const diagnosis: RuntimeDiagnosis[] = [];

  interface KnowledgeError {
    code?: number | string;
    cause?: unknown;
    fix?: unknown;
  }
  let knowledgeErrors: KnowledgeError[] = [];
  try {
    knowledgeErrors = (kb?.getErrors('admob').errors ?? []) as unknown as KnowledgeError[];
  } catch {
    knowledgeErrors = [];
  }

  for (const check of run.checks.filter((c) => !c.ok && c.check.endsWith('_loaded'))) {
    const match = LOAD_ERROR_PATTERN.exec(check.detail ?? '');
    const code = match ? Number(match[1]) : undefined;
    const domain = match ? match[2] : undefined;
    const entry = code !== undefined
      ? knowledgeErrors.find((e) => e.code === code)
      : undefined;
    diagnosis.push({
      check: check.check,
      code,
      domain,
      cause: entry && typeof entry.cause === 'string'
        ? entry.cause
        : `广告加载失败（${check.detail ?? '未知错误'}）`,
      fix: entry && typeof entry.fix === 'string' ? entry.fix : '用平台日志确认错误码后处理',
      logCommand,
    });
  }

  // 视频类（rewarded）单独失败 + banner/interstitial 成功 + code=0 → 大概率网络环境问题
  const rewardedFailed = run.checks.find(
    (c) => !c.ok && c.check.startsWith('rewarded') && LOAD_ERROR_PATTERN.exec(c.detail ?? '')?.[1] === '0',
  );
  const othersOk = run.checks
    .filter((c) => c.check === 'banner_loaded' || c.check === 'interstitial_loaded')
    .every((c) => c.ok);
  if (rewardedFailed && othersOk) {
    diagnosis.push({
      check: rewardedFailed.check,
      code: 0,
      cause: '可能是网络环境导致视频素材无法加载（实测：中国大陆出口会被分配 asset.gvt1-cn.com，Android WebView 因缺少 CORS 头加载失败）',
      fix: '换网络重试，并用平台日志确认',
      logCommand,
    });
  }
  return diagnosis;
}

/** 运行 runtime 级：无冷烟测试文件 → 整级 skipped；否则逐设备串行执行。 */
export async function runRuntimeLevel(input: RuntimeLevelInput): Promise<RuntimeLevelResult> {
  const runner: CommandRunner = input.runner ?? ((cmd, args, options) => defaultRun(cmd, args, options));
  const timeoutMs = input.timeoutMs ?? 900_000;
  const smokeFile = join(input.cwd, SMOKE_TEST_RELATIVE_PATH);
  const recommendedCommand = `flutter test ${SMOKE_TEST_RELATIVE_PATH} -d <device>`;
  const base = {
    smokeTestFile: SMOKE_TEST_RELATIVE_PATH,
    recommendedCommand,
  };

  if (!existsSync(smokeFile)) {
    return {
      ...base,
      status: 'skipped',
      runs: [],
      manualItems: buildRuntimeChecklist().items,
      warnings: [],
      reason: `工程没有 ${SMOKE_TEST_RELATIVE_PATH}：请用 generate_ad_integration 的 includeSmokeTest（默认 true）重新 plan/apply 生成后再跑 runtime 级`,
      summary: `runtime 级 skipped：缺少 ${SMOKE_TEST_RELATIVE_PATH}`,
    };
  }

  const platforms = await lookupDevicePlatforms(runner, input.cwd);
  const runs: RuntimeDeviceRun[] = [];

  for (const device of input.devices) {
    const args = ['test', SMOKE_TEST_RELATIVE_PATH, '-d', device];
    if (input.showFullscreen) args.push('--dart-define=ADS_SMOKE_SHOW_FULLSCREEN=true');
    const command = `flutter ${args.join(' ')}`;
    const result = await runner('flutter', args, { cwd: input.cwd, timeoutMs });
    const log = `${result.stdout}\n${result.stderr}`;
    const run: RuntimeDeviceRun = {
      device,
      command,
      status: result.exitCode === 0 ? 'passed' : 'failed',
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      targetPlatform: platforms.get(device) ?? 'unknown',
      checks: parseSmokeChecks(log),
      logTail: tail(log, LOG_TAIL_LINES),
    };

    if (result.timedOut) {
      run.status = 'failed';
      run.reason = `命令超时（超过 ${Math.round(timeoutMs / 1000)}s）`;
    } else if (result.exitCode !== 0 && run.checks.length === 0 && DEVICE_MISSING.test(log)) {
      // 只有 flutter 自身的设备报错文案 + 没有任何 AI_AD_SMOKE 行才算设备缺失；
      // 冒烟失败信息或 SDK 日志里的 "not found" 不算
      run.status = 'skipped';
      run.reason = `设备 ${device} 不存在或未连接（用 flutter devices 查看可用设备 id）`;
    } else if (result.exitCode === 0 && run.checks.length === 0) {
      run.status = 'failed';
      run.reason = '退出码 0 但未解析到任何 AI_AD_SMOKE 检查行，不能当作通过（冷烟测试可能未执行）';
    } else if (result.exitCode === 0 && run.checks.every((c) => c.ok)) {
      // skipped 标记的检查（如未开 showFullscreen 的 rewarded_reward_callback）ok=true，不影响 passed
      run.status = 'passed';
    } else {
      const failedChecks = run.checks.filter((c) => !c.ok).map((c) => c.check);
      run.status = 'failed';
      run.reason = failedChecks.length > 0 ? `未通过的检查: ${failedChecks.join(', ')}` : `退出码 ${result.exitCode}`;
    }
    const diagnosis = buildDiagnosis(run, input.kb);
    if (diagnosis.length > 0) run.diagnosis = diagnosis;
    runs.push(run);
  }

  // 级别状态：任一 failed → failed；至少一个 passed 且无 failed → passed；全部 skipped → skipped
  const anyFailed = runs.some((r) => r.status === 'failed');
  const anyPassed = runs.some((r) => r.status === 'passed');
  const status: RuntimeLevelResult['status'] = anyFailed ? 'failed' : anyPassed ? 'passed' : 'skipped';

  // 人工清单裁剪：去掉已被自动化覆盖的项（初始化、激励回调[需 showFullscreen 且通过]）
  const covered = new Set(
    runs
      .filter((r) => r.status === 'passed')
      .flatMap((r) => r.checks.filter((c) => c.ok && !c.skipped).map((c) => c.check)),
  );
  const manualItems = buildRuntimeChecklist().items.filter((item) => {
    if (item.id === 'init-log') return !covered.has('sdk_initialized');
    if (item.id === 'rewarded-callback') return !(input.showFullscreen && covered.has('rewarded_reward_callback'));
    return true;
  });

  const warnings: string[] = [];
  if (covered.size > 0) {
    warnings.push(
      `runtime 自动化只覆盖了: ${[...covered].join(', ')}；Test Ad 标签与布局的视觉核对、插屏频控在真实交互中的表现、UMP 表单交互与隐私选项入口、飞行模式、真实 ID + 真机测试设备仍需人工核对`,
    );
  }
  const executedPlatforms = runs.filter((r) => r.status !== 'skipped').map((r) => r.targetPlatform ?? 'unknown');
  for (const target of ['android', 'ios'] as const) {
    if (input.targets[target] && !executedPlatforms.some((p) => p.startsWith(target))) {
      warnings.push(
        `targets 包含 ${target}，但 devices 未覆盖该平台（已验证 targetPlatform: ${executedPlatforms.join(', ') || '无'}），${target} 的运行时未验证`,
      );
    }
  }

  const failedDevices = runs.filter((r) => r.status === 'failed').map((r) => r.device);
  const passedDevices = runs.filter((r) => r.status === 'passed').map((r) => r.device);
  const summary = anyFailed
    ? `runtime 级 failed：设备 ${failedDevices.join(', ')} 的冷烟测试未通过`
    : anyPassed
      ? `runtime 级 passed：设备 ${passedDevices.join(', ')} 的冷烟测试全部检查通过`
      : `runtime 级 skipped：没有实际执行的设备`;

  return { ...base, status, runs, manualItems, warnings, summary };
}
