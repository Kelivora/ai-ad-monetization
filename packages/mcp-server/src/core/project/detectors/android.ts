import { existsSync } from 'node:fs';
import { isDirectory, readTextIfExists } from '../../../lib/fs.js';

export interface AndroidInfo {
  manifestPath?: string | undefined;
  gradleFile?: string | undefined;
  applicationId?: string | undefined;
  minSdk?: number | "flutter-default" | undefined;
  compileSdk?: number | "flutter-default" | undefined;
  admobAppId?: string | undefined;
  isNativeAppModule: boolean; // gradle 文件直接应用 com.android.application（非 flutter.* 委托）
}

function parseGradleValue(raw: string): number | 'flutter-default' | undefined {
  const value = raw.trim();
  if (/^\d+$/.test(value)) return Number(value);
  if (value.includes('flutter.')) return 'flutter-default'; // flutter.minSdkVersion 等
  return undefined;
}

/** 在 gradle 文本里提取 kts 与 groovy 两种语法的配置值。 */
function extract(gradle: string, key: string): { value: string; isFlutterDefault: boolean } | undefined {
  const patterns = [
    new RegExp(`${key}\\s*=\\s*["']?([\\w.]+)["']?`), // kts / 新 groovy
    new RegExp(`${key}\\s+["']?([\\w.]+)["']?`), // groovy
  ];
  for (const re of patterns) {
    const m = re.exec(gradle);
    if (m?.[1]) return { value: m[1], isFlutterDefault: m[1].includes('flutter.') };
  }
  return undefined;
}

function findManifest(root: string): string | undefined {
  const candidates = [
    'app/src/main/AndroidManifest.xml',
    'android/app/src/main/AndroidManifest.xml',
    'src/main/AndroidManifest.xml',
  ];
  for (const rel of candidates) {
    if (existsSync(`${root}/${rel}`)) return rel;
  }
  return undefined;
}

function readAdmobAppId(manifest: string | undefined): string | undefined {
  if (!manifest) return undefined;
  const text = readTextIfExists(manifest);
  if (!text) return undefined;
  const m = /com\.google\.android\.gms\.ads\.APPLICATION_ID[^>]*?value\s*=\s*"([^"]+)"/.exec(text);
  return m?.[1];
}

/**
 * 检测 Android 构建信息。nativeRoot 用于原生工程判定（settings.gradle / 根 build.gradle）；
 * flutter 工程传 androidDir 指向其 android/ 目录。
 */
export function detectAndroid(root: string): AndroidInfo | null {
  const gradleCandidates = isDirectory(`${root}/android`)
    ? ['android/app/build.gradle.kts', 'android/app/build.gradle']
    : ['app/build.gradle.kts', 'app/build.gradle', 'build.gradle.kts', 'build.gradle'];

  let gradleRel: string | undefined;
  let gradleText: string | undefined;
  for (const rel of gradleCandidates) {
    const text = readTextIfExists(`${root}/${rel}`);
    if (text !== undefined) {
      gradleRel = rel;
      gradleText = text;
      break;
    }
  }
  if (!gradleRel || !gradleText) return null;

  const appliesApplication =
    /com\.android\.application/.test(gradleText) && !gradleText.includes('flutter.compileSdkVersion') && !gradleText.includes('flutter-gradle-plugin');
  const manifestRel = findManifest(root);
  const admobAppId = readAdmobAppId(manifestRel ? `${root}/${manifestRel}` : undefined);

  const applicationId = extract(gradleText, 'applicationId')?.value;
  const minSdkRaw = extract(gradleText, 'minSdk');
  const compileSdkRaw = extract(gradleText, 'compileSdk');

  return {
    manifestPath: manifestRel,
    gradleFile: gradleRel,
    applicationId,
    minSdk: minSdkRaw ? (minSdkRaw.isFlutterDefault ? 'flutter-default' : parseGradleValue(minSdkRaw.value)) : undefined,
    compileSdk: compileSdkRaw
      ? compileSdkRaw.isFlutterDefault
        ? 'flutter-default'
        : parseGradleValue(compileSdkRaw.value)
      : undefined,
    admobAppId,
    isNativeAppModule: appliesApplication,
  };
}

export { extract as extractGradleValue, readAdmobAppId as readManifestAdmobAppId };
