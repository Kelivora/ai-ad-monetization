import { z } from 'zod';
import type { IntegrationGuide, GuideInput, PlatformAdapter, SupportInfo, PlanInput, IntegrationPlan, RevenueQuery, RevenueRows, ValidationRule } from '../types.js';
import type { KnowledgeBase } from '../../knowledge/loader.js';
import type { AdFormat, Framework, OfficialSkillRef } from '../../knowledge/schema.js';
import type { ProjectAnalysis } from '../../core/project/types.js';
import { toSourceRefs } from '../../knowledge/freshness.js';
import { AppError } from '../../lib/errors.js';
import { planFlutterIntegration } from './flutter/plan.js';
import { admobFlutterRules } from './flutter/rules.js';
import { fetchAdMobApiRevenue, type AdMobDimension } from './revenue-api.js';

/** AdMob 适配器：由知识库驱动，MVP 中唯一 automated 的平台。 */
export class AdMobAdapter implements PlatformAdapter {
  readonly id = 'admob' as const;
  readonly displayName: string;
  readonly optionsSchema = z.object({
    useNextGenSdk: z.boolean().default(false),
    interstitialMinIntervalSeconds: z.number().int().min(0).default(180),
    includeSmokeTest: z.boolean().default(true),
  });

  private readonly kb: KnowledgeBase;

  constructor(kb: KnowledgeBase) {
    this.kb = kb;
    this.displayName = kb.getPlatform('admob').displayName;
  }

  supportFor(framework: Framework): SupportInfo {
    const support = this.kb.getPlatform('admob').frameworks[framework];
    const info: SupportInfo = { level: support.support };
    if (support.officialSkill) info.officialSkill = support.officialSkill as OfficialSkillRef;
    if (support.note) info.note = support.note;
    return info;
  }

  formats(framework: Framework): AdFormat[] {
    void framework;
    return this.kb.getPlatform('admob').formats;
  }

  getIntegrationGuide(input: GuideInput): IntegrationGuide {
    const platform = this.kb.getPlatform('admob');
    const support = platform.frameworks[input.framework];
    const sources = toSourceRefs(platform.sources, platform.reviewIntervalDays, new Date());

    if (input.framework === 'flutter') {
      return {
        strategy: 'automated',
        prerequisites: [
          'Flutter >= 3.38.1、Dart >= 3.10.0（google_mobile_ads 9.x）',
          'Android minSdk >= 24、compileSdk >= 36；iOS 部署目标 >= 13.0',
          'AdMob 账号（后台创建应用/广告单元由用户完成，工具不会代登录）',
        ],
        steps: [
          { id: 'analyze', title: '分析工程', detail: '确认框架、平台目标、已有 SDK 与 git 状态', tool: 'analyze_project', manual: false },
          { id: 'compatibility', title: '检查兼容性', detail: '逐项对比 Dart/Flutter/minSdk/compileSdk/iOS 部署目标', tool: 'get_sdk_compatibility', manual: false },
          { id: 'plan', title: '规划广告位', detail: '按屏幕滚动性与目标策略确定格式与位置', tool: 'plan_ad_placements', manual: false },
          { id: 'apply', title: '生成集成（先 plan 后 apply）', detail: '写入 pubspec / AndroidManifest / Info.plist / lib/ads/*，默认测试 ID', tool: 'generate_ad_integration', manual: false },
          { id: 'ump', title: '后台创建 UMP 消息', detail: '在 AdMob 后台（Privacy & messaging）创建 GDPR/美国州合规消息；需要面向 EEA/UK/CH/US 时必须完成', manual: true },
          { id: 'validate', title: '静态校验', detail: '检查 App ID、测试 ID、初始化、同意流程等规则', tool: 'validate_ad_config', manual: false },
          { id: 'verify', title: '构建验证', detail: 'flutter pub get / analyze / build apk / build ios', tool: 'verify_ad_integration', manual: false },
          { id: 'real-ids', title: '替换真实广告单元 ID', detail: '上线前用 --dart-define 覆盖测试 ID，并在发布口径下重新校验', manual: true },
        ],
        sources,
      };
    }

    if (support.support === 'delegate-official-skill' && support.officialSkill) {
      const skill = support.officialSkill as OfficialSkillRef;
      return {
        strategy: 'delegate-official-skill',
        officialSkill: skill,
        prerequisites: [`安装官方 Skill: ${skill.install}`],
        steps: [
          { id: 'install-skill', title: '安装并使用官方 Skill', detail: `运行 ${skill.install}，按官方流程接入（${skill.docsUrl}）`, manual: true },
          { id: 'compare', title: '平台选型对比', detail: '如需在 AdMob/MAX/LevelPlay 之间比较，可用我们的知识库对比', tool: 'compare_ad_platforms', manual: false },
          { id: 'placements', title: '广告位规划', detail: '基于启发式规则规划广告位（与引擎无关）', tool: 'plan_ad_placements', manual: false },
          { id: 'revenue', title: '收益分析', detail: '接入后可用导出报表做收益分析', tool: 'get_ad_revenue', manual: false },
        ],
        sources,
      };
    }

    if (support.support === 'guided') {
      return {
        strategy: 'guided',
        prerequisites: ['按官方文档手动接入；以下为引导式建议，不做自动修改'],
        steps: [
          { id: 'compatibility', title: '查看 SDK 知识', detail: '确认插件名与版本约束', tool: 'get_sdk_compatibility', manual: false },
          { id: 'docs', title: '阅读官方文档', detail: '知识库已摘录的官方指南（如有）', tool: 'get_platform_docs', manual: false },
          { id: 'placements', title: '广告位规划', detail: '基于启发式规则规划广告位', tool: 'plan_ad_placements', manual: false },
          { id: 'manual', title: '手动接入', detail: `按官方文档在 ${input.framework} 工程中接入 ${support.package ?? 'AdMob SDK'}`, manual: true },
        ],
        sources,
      };
    }

    throw new AppError('UNSUPPORTED_COMBINATION', `AdMob 不支持 ${input.framework}`);
  }

  async planIntegration(project: ProjectAnalysis, input: PlanInput): Promise<IntegrationPlan> {
    if (project.framework !== 'flutter') {
      throw new AppError('UNSUPPORTED_COMBINATION', `AdMob 自动接入目前仅支持 Flutter（当前工程: ${project.framework}）`);
    }
    return planFlutterIntegration(project, input, this.kb);
  }

  validationRules(framework: Framework): ValidationRule[] {
    if (framework !== 'flutter') {
      throw new AppError('UNSUPPORTED_COMBINATION', `AdMob 校验规则目前仅支持 Flutter（当前: ${framework}）`);
    }
    return admobFlutterRules();
  }

  /** 拉取 AdMob 报表 API（令牌来自环境变量 ADMOB_ACCESS_TOKEN，由用户自行获取）。 */
  async fetchRevenue(query: RevenueQuery): Promise<RevenueRows> {
    if (!query.publisherId) {
      throw new AppError('INVALID_INPUT', 'admob_api 源需要 publisherId（pub-xxxxxxxxxxxxxxxx，见 AdMob 后台 设置 → 账号信息）');
    }
    const result = await fetchAdMobApiRevenue({
      publisherId: query.publisherId,
      startDate: query.startDate,
      endDate: query.endDate,
      dimensions: (query.dimensions ?? undefined) as AdMobDimension[] | undefined,
    });
    return { rows: result.rows, currency: result.currency };
  }
}
