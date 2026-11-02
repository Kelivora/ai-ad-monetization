import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.js';

const fixtures = (name: string) =>
  join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', name);

const EXPECTED_TOOLS = [
  'search_ad_platforms',
  'compare_ad_platforms',
  'recommend_ad_platform',
  'get_platform_docs',
  'get_sdk_compatibility',
  'analyze_project',
  'plan_ad_placements',
  'get_integration_guide',
  'validate_ad_config',
  'generate_ad_integration',
  'verify_ad_integration',
  'build_integration_report',
  'get_ad_revenue',
  'analyze_ad_performance',
];

let client: Client;

beforeAll(async () => {
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: 'test-client', version: '0.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client.close();
});

describe('MCP server', () => {
  it('listTools 返回 14 个工具（11 只读 + generate_ad_integration 写 + verify_ad_integration 执行）', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
    for (const tool of tools) {
      if (tool.name === 'generate_ad_integration' || tool.name === 'verify_ad_integration') continue;
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.annotations?.destructiveHint).toBe(false);
    }
  });

  it('verify_ad_integration 注解为 EXEC（readOnlyHint=false、destructiveHint=false）', async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'verify_ad_integration');
    expect(tool).toBeDefined();
    expect(tool?.annotations?.readOnlyHint).toBe(false);
    expect(tool?.annotations?.destructiveHint).toBe(false);
  });

  it('generate_ad_integration 注解为 WRITE 且 _meta 要求用户交互', async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'generate_ad_integration');
    expect(tool).toBeDefined();
    expect(tool?.annotations?.destructiveHint).toBe(true);
    expect(tool?.annotations?.readOnlyHint).toBe(false);
    expect((tool?._meta as Record<string, unknown> | undefined)?.['anthropic/requiresUserInteraction']).toBe(true);
  });

  it('capabilities 资源可读', async () => {
    const res = await client.readResource({ uri: 'ad-monetization://capabilities' });
    const text = res.contents[0]?.text ?? '';
    expect(text).toContain('不支持');
    expect(text).toContain('flutter');
  });

  it('analyze_project（fixture，跳过工具链）返回 ok', async () => {
    const res = await client.callTool({
      name: 'analyze_project',
      arguments: { projectPath: fixtures('flutter_basic'), detectToolchain: false },
    });
    const structured = res.structuredContent as { ok: boolean; data: { framework: string } };
    expect(structured.ok).toBe(true);
    expect(structured.data.framework).toBe('flutter');
  });

  it('analyze_project 对不存在路径返回 PROJECT_NOT_FOUND', async () => {
    const res = await client.callTool({
      name: 'analyze_project',
      arguments: { projectPath: fixtures('no_such_dir') },
    });
    const structured = res.structuredContent as { ok: boolean; error: { code: string } };
    expect(structured.ok).toBe(false);
    expect(structured.error.code).toBe('PROJECT_NOT_FOUND');
    expect(res.isError).toBe(true);
  });

  it('recommend_ad_platform（flutter + US/EU）admob 第一', async () => {
    const res = await client.callTool({
      name: 'recommend_ad_platform',
      arguments: {
        framework: 'flutter',
        markets: ['US', 'EU'],
        appCategory: 'news',
        goal: 'balanced',
      },
    });
    const structured = res.structuredContent as {
      ok: boolean;
      data: { results: Array<{ platformId: string; supportLevel: string }> };
    };
    expect(structured.ok).toBe(true);
    expect(structured.data.results[0]?.platformId).toBe('admob');
    expect(structured.data.results[0]?.supportLevel).toBe('automated');
  });

  it('get_sdk_compatibility(projectPath=flutter_basic) 返回 ok 与逐项对比', async () => {
    const res = await client.callTool({
      name: 'get_sdk_compatibility',
      arguments: { platformId: 'admob', framework: 'flutter', projectPath: fixtures('flutter_basic') },
    });
    const structured = res.structuredContent as {
      ok: boolean;
      data: { checks: Array<{ item: string; status: string }> };
    };
    expect(structured.ok).toBe(true);
    expect(structured.data.checks.length).toBe(5);
    const dart = structured.data.checks.find((c) => c.item.includes('Dart'));
    expect(dart?.status).toBe('ok'); // ^3.13.7 下限 >= 3.10.0
  });

  it('get_platform_docs 知识缺失时返回 KNOWLEDGE_MISSING 与可用 topic', async () => {
    const res = await client.callTool({
      name: 'get_platform_docs',
      arguments: { platformId: 'admob', topic: 'no_such_topic' },
    });
    const structured = res.structuredContent as { ok: boolean; error: { code: string; hint?: string } };
    expect(structured.ok).toBe(false);
    expect(structured.error.code).toBe('KNOWLEDGE_MISSING');
    expect(structured.error.hint).toContain('init');
  });

  it('get_integration_guide: unity + unity-levelplay 委派官方 Skill', async () => {
    const res = await client.callTool({
      name: 'get_integration_guide',
      arguments: { platformId: 'unity-levelplay', framework: 'unity', formats: ['rewarded'] },
    });
    const structured = res.structuredContent as {
      ok: boolean;
      data: { strategy: string; officialSkill?: { install: string } };
    };
    expect(structured.ok).toBe(true);
    expect(structured.data.strategy).toBe('delegate-official-skill');
    expect(structured.data.officialSkill?.install).toContain('npx skills add');
  });
});
