import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export function readTextIfExists(file: string): string | undefined {
  if (!existsSync(file)) return undefined;
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
}

export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** 递归列出目录下所有 .dart 文件（相对路径），skipDirs 中的目录名被忽略。 */
export function listDartFiles(root: string, skipDirs: string[] = []): string[] {
  const results: string[] = [];
  const walk = (dir: string, rel: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (skipDirs.includes(entry.name)) continue;
        walk(join(dir, entry.name), relPath);
      } else if (entry.isFile() && entry.name.endsWith('.dart')) {
        results.push(relPath);
      }
    }
  };
  walk(root, '');
  return results.sort();
}
