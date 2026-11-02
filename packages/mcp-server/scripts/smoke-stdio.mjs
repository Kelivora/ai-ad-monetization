#!/usr/bin/env node
// stdio 冒烟测试：通过 StdioClientTransport 启动 dist/index.js 并 listTools。
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = join(here, '..', 'dist', 'index.js');

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
});
const client = new Client({ name: 'smoke-stdio', version: '0.0.0' }, { capabilities: {} });
await client.connect(transport);
const { tools } = await client.listTools();
console.log(`listTools: ${tools.length} 个工具 -> ${tools.map((t) => t.name).join(', ')}`);
if (tools.length < 8) {
  console.error('冒烟测试失败：工具数量不足 8 个');
  process.exit(1);
}
const res = await client.readResource({ uri: 'ad-monetization://capabilities' });
console.log(`capabilities 资源: ${(res.contents[0]?.text ?? '').length} 字符`);
await client.close();
console.log('smoke-stdio: OK');
