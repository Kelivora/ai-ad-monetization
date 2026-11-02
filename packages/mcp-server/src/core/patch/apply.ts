import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { sha256 } from '../../lib/hash.js';
import { AppError } from '../../lib/errors.js';
import { readTextIfExists } from '../../lib/fs.js';
import type { PlannedIntegrationPlan } from './types.js';

export interface ApplyResult {
  changedFiles: string[]; // created + modified
  createdFiles: string[];
  modifiedFiles: string[];
  skippedFiles: string[];
  backupDir: string;
  integrationFile: string;
}

/**
 * 落盘集成计划（architecture.md 3.4 写入规则）：
 * 1. 校验 modify/skip 文件当前 sha256 == beforeHash（否则 PLAN_MISMATCH）；
 * 2. 被修改文件备份到 .ai-ad-monetization/backups/<时间戳>/<相对路径>；
 * 3. 写入文件（create 绝不覆盖已存在文件）；
 * 4. 写 .ai-ad-monetization/integration.json。
 */
export function applyPlan(
  root: string,
  plan: PlannedIntegrationPlan,
  meta: { pluginName: string; pluginVersion: string },
): ApplyResult {
  // 1. 逐项校验原文件哈希
  for (const change of plan.changes) {
    if (change.action === 'create') continue;
    const file = join(root, change.path);
    const current = readTextIfExists(file);
    const currentHash = current === undefined ? undefined : sha256(current);
    if (currentHash !== change.beforeHash) {
      throw new AppError('PLAN_MISMATCH', `文件在确认后发生了变化，中止写入: ${change.path}`, {
        details: { path: change.path, expectedHash: change.beforeHash, actualHash: currentHash },
      });
    }
    if (change.action === 'modify' && change.newText === undefined) {
      throw new AppError('INTERNAL', `变更缺少新内容: ${change.path}`);
    }
  }

  const timestamp = new Date().toISOString().replace(/:/g, '-');
  const backupDir = join(root, '.ai-ad-monetization', 'backups', timestamp);
  const createdFiles: string[] = [];
  const modifiedFiles: string[] = [];
  const skippedFiles: string[] = [];

  for (const change of plan.changes) {
    const file = join(root, change.path);
    if (change.action === 'skip') {
      skippedFiles.push(change.path);
      continue;
    }
    if (change.action === 'create') {
      if (existsSync(file)) {
        // plan 阶段就应是 skip；出现说明文件在确认后被创建
        throw new AppError('PLAN_MISMATCH', `create 目标已存在，拒绝覆盖: ${change.path}`);
      }
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, change.content ?? '', 'utf8');
      createdFiles.push(change.path);
      continue;
    }
    // modify：先备份再写入
    const backupFile = join(backupDir, change.path);
    mkdirSync(dirname(backupFile), { recursive: true });
    copyFileSync(file, backupFile);
    writeFileSync(file, change.newText!, 'utf8');
    modifiedFiles.push(change.path);
  }

  const integrationFile = join(root, '.ai-ad-monetization', 'integration.json');
  mkdirSync(dirname(integrationFile), { recursive: true });
  writeFileSync(
    integrationFile,
    JSON.stringify(
      {
        platform: plan.platform,
        framework: plan.framework,
        formats: plan.formats,
        usesTestIds: plan.usesTestIds,
        plugin: { name: meta.pluginName, version: meta.pluginVersion },
        planHash: plan.planHash,
        appliedAt: new Date().toISOString(),
        changedFiles: [...createdFiles, ...modifiedFiles],
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  return {
    changedFiles: [...createdFiles, ...modifiedFiles],
    createdFiles,
    modifiedFiles,
    skippedFiles,
    backupDir,
    integrationFile,
  };
}

/** 读文件并计算哈希的便捷函数（plan 阶段用）。 */
export function hashFile(file: string): { text?: string; hash?: string } {
  if (!existsSync(file)) return {};
  try {
    const text = readFileSync(file, 'utf8');
    return { text, hash: sha256(text) };
  } catch {
    return {};
  }
}
