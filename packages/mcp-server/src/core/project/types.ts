import type { PlatformId } from '../../knowledge/schema.js';

export type ProjectFramework = 'flutter' | 'android' | 'ios' | 'react-native' | 'unity' | 'unknown';

/** architecture.md 3.3 ProjectAnalysis */
export interface ProjectAnalysis {
  root: string;
  framework: ProjectFramework;
  frameworkEvidence: string[];
  targets: { android: boolean; ios: boolean; web: boolean; desktop: boolean };
  appName?: string | undefined;
  identifiers: { androidApplicationId?: string | undefined; iosBundleId?: string | undefined };
  flutter?: {
    dartSdkConstraint?: string | undefined;
    entryFile?: string | undefined;
    hasMainRunApp: boolean;
    dependencies: Record<string, string>;
  };
  android?: {
    manifestPath?: string | undefined;
    gradleFile?: string | undefined;
    minSdk?: number | 'flutter-default' | undefined;
    compileSdk?: number | 'flutter-default' | undefined;
    admobAppId?: string | undefined;
    resolvedMinSdk?: number | undefined;
    resolvedCompileSdk?: number | undefined;
  };
  ios?: {
    infoPlistPath?: string | undefined;
    podfilePath?: string | undefined;
    deploymentTarget?: string | undefined;
    admobAppId?: string | undefined;
    skAdNetworkCount: number;
    hasAttDescription: boolean;
    pbxprojPath?: string | undefined;
  };
  existingAdSdks: Array<{ platform: PlatformId | 'other'; name: string; version?: string; location: string }>;
  existingAdCode: Array<{ file: string; symbols: string[] }>;
  screens: Array<{ file: string; widget: string; scrollable: boolean }>;
  git: { isRepo: boolean; dirtyFiles: string[] };
  toolchain: { flutter?: string; dart?: string; xcode?: string; java?: string; androidSdk?: boolean };
  issues: string[];
}

export interface AnalyzeOptions {
  skipToolchain?: boolean;
}
