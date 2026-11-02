import { isDirectory, readTextIfExists } from '../../../lib/fs.js';

export interface UnityProject {
  unityVersion?: string | undefined;
}

export function detectUnity(root: string): UnityProject | null {
  if (!isDirectory(`${root}/Assets`) || !isDirectory(`${root}/ProjectSettings`)) return null;
  const versionText = readTextIfExists(`${root}/ProjectSettings/ProjectVersion.txt`);
  const unityVersion = versionText ? /m_EditorVersionWithRevision:\s*(\S+)/.exec(versionText)?.[1] : undefined;
  return { unityVersion };
}
