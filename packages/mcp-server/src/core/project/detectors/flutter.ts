import { parse as parseYaml } from 'yaml';
import { isDirectory, readTextIfExists } from '../../../lib/fs.js';

export interface FlutterProject {
  appName?: string | undefined;
  dartSdkConstraint?: string | undefined;
  entryFile?: string | undefined;
  hasMainRunApp: boolean;
  dependencies: Record<string, string>;
  targets: { android: boolean; ios: boolean; web: boolean; desktop: boolean };
}

/** 依赖描述符转字符串：字符串原样，对象转 `key: value` 形式（如 `sdk: flutter`）。 */
function depToString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return Object.keys(obj)
      .map((k) => `${k}: ${String(obj[k])}`)
      .join(', ');
  }
  return String(value);
}

export function detectFlutter(root: string): FlutterProject | null {
  const pubspecRaw = readTextIfExists(`${root}/pubspec.yaml`);
  if (!pubspecRaw) return null;
  let parsed: unknown;
  try {
    parsed = parseYaml(pubspecRaw);
  } catch {
    return null;
  }
  const doc = parsed as {
    name?: string;
    environment?: { sdk?: string };
    dependencies?: Record<string, unknown>;
  } | null;
  if (!doc || typeof doc !== 'object') return null;
  const flutterDep = doc.dependencies?.['flutter'];
  if (!flutterDep || typeof flutterDep !== 'object' || (flutterDep as { sdk?: string }).sdk !== 'flutter') {
    return null;
  }
  const deps: Record<string, string> = { flutter: depToString(flutterDep) };
  for (const [name, value] of Object.entries(doc.dependencies ?? {})) {
    if (name !== 'flutter') deps[name] = depToString(value);
  }
  const entryFile = 'lib/main.dart';
  const mainSource = readTextIfExists(`${root}/${entryFile}`);
  return {
    appName: typeof doc.name === 'string' ? doc.name : undefined,
    dartSdkConstraint: doc.environment?.sdk,
    entryFile: mainSource !== undefined ? entryFile : undefined,
    hasMainRunApp: mainSource !== undefined && /runApp\s*\(/.test(mainSource),
    dependencies: deps,
    targets: {
      android: isDirectory(`${root}/android`),
      ios: isDirectory(`${root}/ios`),
      web: isDirectory(`${root}/web`),
      desktop: isDirectory(`${root}/macos`) || isDirectory(`${root}/windows`) || isDirectory(`${root}/linux`),
    },
  };
}
