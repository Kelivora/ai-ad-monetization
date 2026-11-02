import { readdirSync } from 'node:fs';
import { isDirectory, readTextIfExists } from '../../../lib/fs.js';

export interface IosInfo {
  infoPlistPath?: string | undefined;
  podfilePath?: string | undefined;
  deploymentTarget?: string | undefined;
  bundleId?: string | undefined;
  bundleIdFromPbxproj?: boolean;
  admobAppId?: string | undefined;
  skAdNetworkCount: number;
  hasAttDescription: boolean;
  pbxprojPath?: string | undefined;
}

function plistString(text: string, key: string): string | undefined {
  const m = new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(text);
  return m?.[1];
}

function findInfoPlist(root: string, iosDir: string): string | undefined {
  const prefix = iosDir === '' ? '' : `${iosDir}/`;
  const candidates = [`${prefix}Runner/Info.plist`, `${prefix}Info.plist`];
  for (const rel of candidates) {
    if (readTextIfExists(`${root}/${rel}`) !== undefined) return rel;
  }
  try {
    const base = iosDir === '' ? root : `${root}/${iosDir}`;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const rel = `${prefix}${entry.name}/Info.plist`;
        if (readTextIfExists(`${root}/${rel}`) !== undefined) return rel;
      }
    }
  } catch {
    // 目录不可读则跳过
  }
  return undefined;
}

function findPbxproj(root: string, iosDir: string): string | undefined {
  const searchDirs = iosDir === '' ? [root] : [`${root}/${iosDir}`, root];
  for (const dir of searchDirs) {
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory() || !entry.name.endsWith('.xcodeproj')) continue;
        const pbx = `${dir === root ? '' : `${iosDir}/`}${entry.name}/project.pbxproj`;
        if (readTextIfExists(`${root}/${pbx}`) !== undefined) return pbx;
      }
    } catch {
      // 目录不可读则跳过
    }
  }
  return undefined;
}

/** 轻量解析 Info.plist / Podfile / project.pbxproj（正则，不引入 plist 依赖）。 */
export function detectIos(root: string, iosDir = 'ios'): IosInfo | null {
  const hasIos = iosDir === '' ? true : isDirectory(`${root}/${iosDir}`);
  if (!hasIos) return null;

  const infoRel = findInfoPlist(root, iosDir);
  const infoText = infoRel ? readTextIfExists(`${root}/${infoRel}`) : undefined;
  const podfileText = readTextIfExists(`${root}/${iosDir}/Podfile`);

  const pbxprojRel = findPbxproj(root, iosDir);
  const pbxprojText = pbxprojRel ? readTextIfExists(`${root}/${pbxprojRel}`) : undefined;

  if (!infoText && !podfileText && !pbxprojText) return null;

  let bundleId = infoText ? plistString(infoText, 'CFBundleIdentifier') : undefined;
  let bundleIdFromPbxproj = false;
  if (bundleId && bundleId.includes('$(')) {
    // $(PRODUCT_BUNDLE_IDENTIFIER) 之类占位符，从 pbxproj 取真实值（优先非 Tests 的）
    bundleId = undefined;
    if (pbxprojText) {
      const ids = [...pbxprojText.matchAll(/PRODUCT_BUNDLE_IDENTIFIER\s*=\s*([^;]+);/g)]
        .map((m) => m[1]!.trim())
        .filter((id) => !id.includes('$(') && !/Tests?$/.test(id));
      if (ids.length > 0) {
        bundleId = ids[0];
        bundleIdFromPbxproj = true;
      }
    }
  }

  // 部署目标：未注释的 Podfile platform 优先，否则 pbxproj
  let deploymentTarget: string | undefined;
  if (podfileText) {
    for (const line of podfileText.split('\n')) {
      const m = /^\s*platform\s+:ios,\s*['"](\d+(?:\.\d+)?)['"]/.exec(line);
      if (m?.[1]) {
        deploymentTarget = m[1];
        break;
      }
    }
  }
  if (deploymentTarget === undefined && pbxprojText) {
    deploymentTarget = /IPHONEOS_DEPLOYMENT_TARGET\s*=\s*(\d+(?:\.\d+)?);/.exec(pbxprojText)?.[1];
  }

  const skadMatches = infoText ? (infoText.match(/SKAdNetworkIdentifier/g) ?? []).length : 0;

  return {
    infoPlistPath: infoText !== undefined ? infoRel : undefined,
    podfilePath: podfileText !== undefined ? (iosDir === '' ? 'Podfile' : `${iosDir}/Podfile`) : undefined,
    deploymentTarget,
    bundleId,
    bundleIdFromPbxproj,
    admobAppId: infoText ? plistString(infoText, 'GADApplicationIdentifier') : undefined,
    skAdNetworkCount: skadMatches,
    hasAttDescription: infoText !== undefined && infoText.includes('NSUserTrackingUsageDescription'),
    pbxprojPath: pbxprojRel,
  };
}
