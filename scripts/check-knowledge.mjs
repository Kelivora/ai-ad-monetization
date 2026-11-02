#!/usr/bin/env node
/**
 * kb:check —— 只报告，不改写。
 * 1) 请求 https://pub.dev/api/packages/google_mobile_ads，对比知识库中的插件版本；
 * 2) 遍历 knowledge 下所有 JSON 文件，报告超过 reviewIntervalDays 的 stale 文件。
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const KB_DIR = process.env['AD_MONETIZATION_KB'] ?? join(ROOT, 'knowledge');
const DAY_MS = 86_400_000;

async function findKnowledgeDir() {
  if (process.env['AD_MONETIZATION_KB']) return KB_DIR;
  let dir = ROOT;
  for (;;) {
    const candidate = join(dir, 'knowledge', 'index.json');
    try {
      await stat(candidate);
      return join(dir, 'knowledge');
    } catch {
      const parent = resolve(dir, '..');
      if (parent === dir) throw new Error('未找到 knowledge/index.json');
      dir = parent;
    }
  }
}

async function* walkJson(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkJson(full);
    else if (entry.name.endsWith('.json')) yield full;
  }
}

async function checkVersionDrift(kbDir) {
  const url = 'https://pub.dev/api/packages/google_mobile_ads';
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    console.log(`⚠️  网络请求失败，跳过版本对比（未做任何改动）：${err.message}`);
    return;
  }
  if (!res.ok) {
    console.log(`⚠️  pub.dev 返回 ${res.status}，跳过版本对比（未做任何改动）。`);
    return;
  }
  const latest = (await res.json())?.latest?.version;
  const sdk = JSON.parse(await readFile(join(kbDir, 'platforms/admob/sdk/flutter.json'), 'utf8'));
  const known = sdk?.plugin?.version ?? null;
  if (!latest) {
    console.log('⚠️  pub.dev 响应中没有 latest.version，跳过版本对比。');
    return;
  }
  if (known === latest) {
    console.log(`✅ google_mobile_ads 版本一致：${known}`);
  } else {
    console.log(`⏳ 版本漂移：知识库记录 ${known ?? '(null)'}，pub.dev 最新 ${latest}。请人工核对官方 changelog 后更新知识库。`);
  }
}

async function checkFreshness(kbDir, now = new Date()) {
  const stale = [];
  for await (const file of walkJson(kbDir)) {
    let data;
    try {
      data = JSON.parse(await readFile(file, 'utf8'));
    } catch {
      console.log(`❌ 非法 JSON：${relative(kbDir, file)}`);
      continue;
    }
    const retrievedAt = data?.retrievedAt;
    const interval = data?.reviewIntervalDays ?? 120;
    if (typeof retrievedAt !== 'string') continue;
    const retrieved = new Date(`${retrievedAt}T00:00:00Z`).getTime();
    if (Number.isNaN(retrieved) || now.getTime() - retrieved > interval * DAY_MS) {
      stale.push({ file: relative(kbDir, file), retrievedAt, interval });
    }
  }
  if (stale.length === 0) {
    console.log('✅ 所有知识文件都在复核期内。');
  } else {
    console.log(`⏳ ${stale.length} 个文件已过复核期：`);
    for (const s of stale) console.log(`   - ${s.file}（retrievedAt ${s.retrievedAt}，interval ${s.interval}d）`);
  }
}

try {
  const kbDir = await findKnowledgeDir();
  console.log(`知识库目录：${kbDir}\n`);
  await checkVersionDrift(kbDir);
  console.log('');
  await checkFreshness(kbDir);
} catch (err) {
  console.error(`kb:check 失败：${err.message}`);
  process.exitCode = 1;
}
