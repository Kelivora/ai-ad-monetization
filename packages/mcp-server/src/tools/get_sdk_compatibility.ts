import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { READ } from '../lib/annotations.js';
import { fail, ok } from '../lib/envelope.js';
import { toToolError } from '../lib/errors.js';
import { loadKnowledge } from '../knowledge/loader.js';
import { toSourceRefs } from '../knowledge/freshness.js';
import { analyzeProject } from '../core/project/analyze.js';
import type { Framework, PlatformId } from '../knowledge/schema.js';

interface CheckItem {
  item: string;
  required: string;
  actual: string;
  status: 'ok' | 'incompatible' | 'unknown';
  fix?: string | undefined;
}

/** 解析 ^x.y.z / >=x.y.z / x.y.z 形式约束的下限版本。 */
function lowerBound(constraint: string | undefined): [number, number, number] | undefined {
  if (!constraint) return undefined;
  const m = />=\s*(\d+)\.(\d+)\.(\d+)/.exec(constraint) ?? /^\^(\d+)\.(\d+)\.(\d+)/.exec(constraint);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  const plain = /^(\d+)\.(\d+)\.(\d+)/.exec(constraint);
  return plain ? [Number(plain[1]), Number(plain[2]), Number(plain[3])] : undefined;
}

function parseVersion(version: string | undefined): [number, number, number] | undefined {
  if (!version) return undefined;
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(version);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
}

function compareVersions(
  a: [number, number, number] | undefined,
  b: [number, number, number] | undefined,
): number | undefined {
  if (!a || !b) return undefined;
  for (let i = 0; i < 3; i++) {
    if (a[i]! < b[i]!) return -1;
    if (a[i]! > b[i]!) return 1;
  }
  return 0;
}

export function register(server: McpServer): void {
  server.registerTool(
    'get_sdk_compatibility',
    {
      title: '查询 SDK 兼容性',
      description: '平台插件版本与 Flutter/Dart/Android/iOS 版本约束；给了 projectPath 时做逐项对比并给出修复建议。',
      inputSchema: {
        platformId: z.enum(['admob', 'applovin-max', 'unity-levelplay']),
        framework: z.enum(['flutter', 'android', 'ios', 'react-native', 'unity']),
        projectPath: z.string().optional().describe('工程根目录；提供后做逐项兼容性对比'),
      },
      annotations: READ,
    },
    async (args) => {
      try {
        const kb = loadKnowledge();
        const framework = args.framework as Framework;
        const platform = kb.getPlatform(args.platformId as PlatformId);
        let sdk;
        try {
          sdk = kb.getSdk(args.platformId as PlatformId, framework);
        } catch {
          return fail({
            code: 'KNOWLEDGE_MISSING',
            message: `平台 ${args.platformId} 没有框架 ${framework} 的 SDK 知识`,
            hint: '目前只有 admob/flutter 有 SDK 版本知识；其他组合请参考 get_integration_guide 与官方文档',
          });
        }
        const sources = toSourceRefs(sdk.sources, sdk.reviewIntervalDays, new Date());
        const support = platform.frameworks[framework];

        const data: Record<string, unknown> = {
          platformId: sdk.platformId,
          framework: sdk.framework,
          plugin: sdk.plugin,
          constraints: sdk.constraints,
          supportedTargets: sdk.supportedTargets,
          android: sdk.android,
          ios: sdk.ios,
          frameworkSupport: { level: support.support, note: support.note, officialSkill: support.officialSkill },
        };

        if (framework !== 'flutter') {
          return ok({
            summary: `${args.platformId} × ${framework} 的 SDK 级知识仅覆盖 flutter；当前支持级别 ${support.support}`,
            data,
            sources,
            nextSteps: [
              support.support === 'delegate-official-skill' && support.officialSkill
                ? `按官方 Skill 接入: ${support.officialSkill.install}`
                : '参考 get_integration_guide 获取引导式步骤',
            ],
          });
        }

        if (!args.projectPath) {
          return ok({
            summary: `${sdk.plugin.name} ${sdk.plugin.version ?? ''} 兼容性要求（flutter）`,
            data,
            sources,
            nextSteps: ['传入 projectPath 可做逐项对比'],
          });
        }

        const analysis = await analyzeProject(args.projectPath);
        const checks: CheckItem[] = [];

        // Dart SDK 约束
        const dartBound = lowerBound(sdk.constraints['dart']);
        const dartActual = lowerBound(analysis.flutter?.dartSdkConstraint);
        const dartCmp = compareVersions(dartActual, dartBound);
        checks.push({
          item: 'Dart SDK 约束下限',
          required: sdk.constraints['dart'] ?? '未知',
          actual: analysis.flutter?.dartSdkConstraint ?? '未识别',
          status: dartCmp === undefined ? 'unknown' : dartCmp >= 0 ? 'ok' : 'incompatible',
          fix: dartCmp !== undefined && dartCmp < 0 ? `在 pubspec.yaml 中把 environment.sdk 下限提高到 ${sdk.constraints['dart']}` : undefined,
        });

        // 本机 Flutter 版本
        const flutterBound = lowerBound(sdk.constraints['flutter']);
        const flutterActual = parseVersion(analysis.toolchain.flutter);
        const flutterCmp = compareVersions(flutterActual, flutterBound);
        checks.push({
          item: '本机 Flutter 版本',
          required: sdk.constraints['flutter'] ?? '未知',
          actual: analysis.toolchain.flutter ?? (analysis.toolchain.flutter === undefined ? '未检测到 flutter 命令' : '未知'),
          status: flutterCmp === undefined ? 'unknown' : flutterCmp >= 0 ? 'ok' : 'incompatible',
          fix: flutterCmp !== undefined && flutterCmp < 0 ? `升级 Flutter 到 ${sdk.constraints['flutter']} 及以上` : undefined,
        });

        // Android minSdk / compileSdk
        for (const key of ['minSdk', 'compileSdk'] as const) {
          const required = sdk.android?.[key];
          const literal = analysis.android?.[key];
          const resolved = key === 'minSdk' ? analysis.android?.resolvedMinSdk : analysis.android?.resolvedCompileSdk;
          const actualNum = typeof literal === 'number' ? literal : resolved;
          checks.push({
            item: `Android ${key}`,
            required: required !== undefined ? `>= ${required}` : '未知',
            actual:
              actualNum !== undefined
                ? String(actualNum)
                : literal === 'flutter-default'
                  ? `flutter-default（解析为 ${resolved ?? '未知'}）`
                  : '未识别',
            status:
              required === undefined || actualNum === undefined
                ? 'unknown'
                : actualNum >= required
                  ? 'ok'
                  : 'incompatible',
            fix:
              required !== undefined && actualNum !== undefined && actualNum < required
                ? `在 android/app/build.gradle(.kts) 中设置 ${key} = ${required}（或更高）`
                : undefined,
          });
        }

        // iOS 部署目标
        const iosRequired = sdk.ios?.deploymentTarget;
        const iosActual = analysis.ios?.deploymentTarget;
        const iosCmp = compareVersions(parseVersion(iosActual), parseVersion(iosRequired));
        checks.push({
          item: 'iOS 部署目标',
          required: iosRequired ? `>= ${iosRequired}` : '未知',
          actual: iosActual ?? '未识别',
          status: iosCmp === undefined ? 'unknown' : iosCmp >= 0 ? 'ok' : 'incompatible',
          fix:
            iosCmp !== undefined && iosCmp < 0
              ? `在 Podfile 设置 platform :ios, '${iosRequired}' 或在 Xcode 工程提升 IPHONEOS_DEPLOYMENT_TARGET`
              : undefined,
        });

        const incompatible = checks.filter((c) => c.status === 'incompatible').length;
        const unknown = checks.filter((c) => c.status === 'unknown').length;
        return ok({
          summary:
            incompatible > 0
              ? `发现 ${incompatible} 项不满足兼容性要求`
              : unknown > 0
                ? `兼容性检查完成（${unknown} 项未知，缺信息或未检测到工具链）`
                : '兼容性检查全部通过',
          data: { ...data, checks },
          warnings: unknown > 0 ? [`${unknown} 项为 unknown（信息缺失不等于不兼容）`] : [],
          sources,
          nextSteps:
            incompatible > 0
              ? ['先按 fix 修复不兼容项，再继续接入流程']
              : ['用 get_integration_guide 获取接入步骤', '用 generate_ad_integration 生成集成计划'],
        });
      } catch (err) {
        return fail(toToolError(err).error);
      }
    },
  );
}
