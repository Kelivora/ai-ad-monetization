import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loadKnowledge } from './knowledge/loader.js';
import { FRAMEWORKS, PLATFORM_IDS, type Framework, type PlatformId } from './knowledge/schema.js';
import { register as registerAnalyzeProject } from './tools/analyze_project.js';
import { register as registerCompare } from './tools/compare_ad_platforms.js';
import { register as registerCompatibility } from './tools/get_sdk_compatibility.js';
import { register as registerGuide } from './tools/get_integration_guide.js';
import { register as registerDocs } from './tools/get_platform_docs.js';
import { register as registerPlacements } from './tools/plan_ad_placements.js';
import { register as registerRecommend } from './tools/recommend_ad_platform.js';
import { register as registerSearch } from './tools/search_ad_platforms.js';
import { register as registerValidateAdConfig } from './tools/validate_ad_config.js';
import { register as registerGenerateAdIntegration } from './tools/generate_ad_integration.js';
import { register as registerVerifyAdIntegration } from './tools/verify_ad_integration.js';
import { register as registerBuildReport } from './tools/build_integration_report.js';
import { register as registerGetAdRevenue } from './tools/get_ad_revenue.js';
import { register as registerAnalyzePerformance } from './tools/analyze_ad_performance.js';

const SERVER_NAME = 'ad-monetization';
const SERVER_VERSION = '0.1.0';

/** 平台 × 框架支持矩阵 + 明确不支持的能力清单。 */
function capabilitiesContent(): string {
  const kb = loadKnowledge();
  const header = `| 平台 | ${FRAMEWORKS.join(' | ')} |\n| --- | ${FRAMEWORKS.map(() => '---').join(' | ')} |`;
  const rows = PLATFORM_IDS.map((id: PlatformId) => {
    const platform = kb.getPlatform(id);
    const cells = FRAMEWORKS.map((f: Framework) => platform.frameworks[f].support).join(' | ');
    return `| ${platform.displayName} (${id}) | ${cells} |`;
  });
  const notSupported = [
    '- 不代用户登录广告平台账号（AdMob/MAX/LevelPlay 的账号与 OAuth 授权由用户完成）',
    '- 不在 AdMob 后台创建应用、广告单元或 UMP 隐私消息（人工步骤，工具只给出清单）',
    '- MVP 不自动接入 AppLovin MAX 与 Unity LevelPlay（knowledge-only，仅知识/对比/指南）',
    '- google_mobile_ads 插件不支持 Web 与桌面平台（supportedTargets: web/desktop = false）',
    '- 非代码修改（商店上架、隐私政策文案、法务合规结论）不在工具能力范围内',
  ].join('\n');
  return `# 能力矩阵\n\n${header}\n${rows.join('\n')}\n\n# 明确不支持的能力\n\n${notSupported}\n`;
}

export function createServer(): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { logging: {} } },
  );

  registerSearch(server);
  registerCompare(server);
  registerRecommend(server);
  registerDocs(server);
  registerCompatibility(server);
  registerAnalyzeProject(server);
  registerPlacements(server);
  registerGuide(server);
  registerValidateAdConfig(server);
  registerGenerateAdIntegration(server);
  registerVerifyAdIntegration(server);
  registerBuildReport(server);
  registerGetAdRevenue(server);
  registerAnalyzePerformance(server);

  server.registerResource(
    'capabilities',
    'ad-monetization://capabilities',
    { description: '平台 × 框架支持矩阵与"明确不支持"的能力清单', mimeType: 'text/markdown' },
    (uri) => ({
      contents: [{ uri: uri.href, mimeType: 'text/markdown', text: capabilitiesContent() }],
    }),
  );

  return server;
}
