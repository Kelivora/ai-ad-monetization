import { readTextIfExists } from '../../../lib/fs.js';

export interface ReactNativeProject {
  appName?: string | undefined;
  hasExpo: boolean;
}

export function detectReactNative(root: string): ReactNativeProject | null {
  const raw = readTextIfExists(`${root}/package.json`);
  if (!raw) return null;
  let pkg: { name?: string; dependencies?: Record<string, string> } | null;
  try {
    pkg = JSON.parse(raw) as typeof pkg;
  } catch {
    return null;
  }
  const deps = pkg?.dependencies ?? {};
  if (!('react-native' in deps)) return null;
  return { appName: pkg?.name, hasExpo: 'expo' in deps };
}
