import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { READ } from '../lib/annotations.js';
import { fail, ok } from '../lib/envelope.js';
import { toToolError } from '../lib/errors.js';
import { AppError } from '../lib/errors.js';
import { loadKnowledge } from '../knowledge/loader.js';
import { isStale } from '../knowledge/freshness.js';
import type { Framework, PlatformId } from '../knowledge/schema.js';

const DEFAULT_REVIEW_INTERVAL_DAYS = 120;

export function register(server: McpServer): void {
  server.registerTool(
    'get_platform_docs',
    {
      title: '获取平台文档',
      description: '读取知识库中某平台某主题的官方文档摘录（正文 + 来源 + 时效）；知识缺失时返回可用 topic 列表。',
      inputSchema: {
        platformId: z.enum(['admob', 'applovin-max', 'unity-levelplay']),
        topic: z.string().describe('主题，如 init / banner / interstitial / rewarded / privacy / testing / errors'),
        framework: z.enum(['flutter', 'android', 'ios', 'react-native', 'unity']).optional().default('flutter'),
      },
      annotations: READ,
    },
    async (args) => {
      try {
        const kb = loadKnowledge();
        const framework = (args.framework ?? 'flutter') as Framework;
        let doc;
        try {
          doc = kb.getDoc(args.platformId as PlatformId, args.topic, framework);
        } catch (err) {
          if (err instanceof AppError && err.code === 'KNOWLEDGE_MISSING') {
            const topics = kb.listDocTopics(args.platformId as PlatformId);
            return fail({
              code: 'KNOWLEDGE_MISSING',
              message: `没有文档: ${args.platformId}/${framework}/${args.topic}`,
              hint: topics.length > 0 ? `可用 topic: ${topics.join(', ')}` : '该平台没有任何文档',
            });
          }
          throw err;
        }
        const stale = isStale(doc.retrievedAt, DEFAULT_REVIEW_INTERVAL_DAYS, new Date());
        return ok({
          summary: `${args.platformId}/${framework} 的 ${args.topic} 文档`,
          data: {
            file: doc.file,
            topic: doc.topic,
            framework: doc.framework,
            verifiedVersion: doc.verifiedVersion,
            body: doc.body,
          },
          warnings: stale ? [`该文档摘录已超过复核周期（retrievedAt ${doc.retrievedAt}），请核对官方最新文档`] : [],
          sources: [
            {
              title: doc.file,
              url: doc.source,
              retrievedAt: doc.retrievedAt,
              ...(doc.verifiedVersion ? { verifiedVersion: doc.verifiedVersion } : {}),
              stale,
            },
          ],
        });
      } catch (err) {
        return fail(toToolError(err).error);
      }
    },
  );
}
