import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { patchPubspec } from '../src/core/patch/pubspec.js';
import { patchAndroidManifest } from '../src/core/patch/android-manifest.js';
import { patchPlist } from '../src/core/patch/plist.js';
import { patchGradle } from '../src/core/patch/gradle.js';
import { patchPodfile } from '../src/core/patch/podfile.js';
import { patchDartMain } from '../src/core/patch/dart-main.js';
import { unifiedDiff } from '../src/core/patch/diff.js';
import { loadKnowledge } from '../src/knowledge/loader.js';

const kb = loadKnowledge();
const testIds = kb.getTestIds('admob');

const flutterBasicPubspec = `name: demo_news_app
description: "A new Flutter project."
publish_to: 'none'

version: 1.0.0+1

environment:
  sdk: ^3.13.7

dependencies:
  flutter:
    sdk: flutter

  # The following adds the Cupertino Icons font to your application.
  cupertino_icons: ^1.0.8

dev_dependencies:
  flutter_test:
    sdk: flutter

  flutter_lints: ^6.0.0

flutter:

  uses-material-design: true
`;

describe('patchPubspec', () => {
  it('无依赖时在 dependencies 块末尾追加（保留注释与空行）', () => {
    const result = patchPubspec(flutterBasicPubspec, { dependency: 'google_mobile_ads', version: '^9.2.0' });
    expect(result.action).toBe('modify');
    expect(result.newText).toContain('  cupertino_icons: ^1.0.8\n  google_mobile_ads: ^9.2.0\n\ndev_dependencies:');
    expect(result.newText).toContain('# The following adds the Cupertino Icons font');
  });

  it('已有依赖 → skip 并带出已有约束', () => {
    const existing = flutterBasicPubspec.replace('  cupertino_icons: ^1.0.8', '  cupertino_icons: ^1.0.8\n  google_mobile_ads: ^5.1.0');
    const result = patchPubspec(existing, { dependency: 'google_mobile_ads', version: '^9.2.0' });
    expect(result.action).toBe('skip');
    expect(result.reason).toContain('^5.1.0');
    expect(result.newText).toBe(existing);
  });

  it('幂等：对补丁后的 pubspec 再跑一次得到 skip', () => {
    const once = patchPubspec(flutterBasicPubspec, { dependency: 'google_mobile_ads', version: '^9.2.0' });
    const twice = patchPubspec(once.newText, { dependency: 'google_mobile_ads', version: '^9.2.0' });
    expect(twice.action).toBe('skip');
  });
});

describe('patchAndroidManifest', () => {
  const manifest = `<?xml version="1.0"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application
        android:label="demo"
        android:name="\${applicationName}">
        <activity android:name=".MainActivity" />
        <meta-data
            android:name="flutterEmbedding"
            android:value="2" />
    </application>
</manifest>
`;

  it('在 <application> 开始标签后插入带注释的 meta-data', () => {
    const result = patchAndroidManifest(manifest, { appId: testIds.appId.android });
    expect(result.action).toBe('modify');
    expect(result.newText).toContain('com.google.android.gms.ads.APPLICATION_ID');
    expect(result.newText).toContain(testIds.appId.android);
    expect(result.newText).toContain('ai-ad-monetization: Google sample AdMob app ID for testing. Replace before release.');
    // 插入位置：<application ...> 之后、<activity> 之前，缩进对齐
    const inserted = result.newText.indexOf('com.google.android.gms.ads.APPLICATION_ID');
    expect(inserted).toBeGreaterThan(result.newText.indexOf('<application'));
    expect(inserted).toBeLessThan(result.newText.indexOf('<activity'));
    expect(result.newText).toMatch(/        <meta-data\r?\n            android:name="com\.google/);
  });

  it('已有 APPLICATION_ID → skip（不覆盖真实 ID）', () => {
    const withReal = manifest.replace(
      '        <meta-data\n            android:name="flutterEmbedding"',
      `        <meta-data\n            android:name="com.google.android.gms.ads.APPLICATION_ID"\n            android:value="ca-app-pub-1234567890123456~1234567890" />\n        <meta-data\n            android:name="flutterEmbedding"`,
    );
    const result = patchAndroidManifest(withReal, { appId: testIds.appId.android });
    expect(result.action).toBe('skip');
    expect(result.newText).toContain('ca-app-pub-1234567890123456~1234567890');
  });
});

describe('patchPlist', () => {
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
\t<key>CFBundleName</key>
\t<string>demo</string>
</dict>
</plist>
`;
  const skadIds = kb.getSkadnetworkIds('admob');

  it('插入 GADApplicationIdentifier 与全部 SKAdNetworkItems', () => {
    const result = patchPlist(plist, { appId: testIds.appId.ios, skadnetworkIds: skadIds });
    expect(result.action).toBe('modify');
    expect(result.newText).toContain(`<key>GADApplicationIdentifier</key>`);
    expect(result.newText).toContain(testIds.appId.ios);
    expect(result.newText.match(/<string>[a-z0-9.]+\.skadnetwork<\/string>/g)).toHaveLength(skadIds.length);
  });

  it('结果通过 plutil -lint（仅 macOS 且 plutil 存在时）', () => {
    const hasPlutil = process.platform === 'darwin' && existsSync('/usr/bin/plutil');
    if (!hasPlutil) return;
    const result = patchPlist(plist, { appId: testIds.appId.ios, skadnetworkIds: skadIds });
    const dir = mkdtempSync(join(tmpdir(), 'admon-plist-'));
    const file = join(dir, 'Info.plist');
    writeFileSync(file, result.newText, 'utf8');
    expect(() => execFileSync('/usr/bin/plutil', ['-lint', file], { stdio: 'pipe' })).not.toThrow();
  });

  it('已有 GADApplicationIdentifier → 保留，只补 SKAdNetworkItems', () => {
    const withGad = plist.replace(
      '</dict>',
      `\t<key>GADApplicationIdentifier</key>\n\t<string>ca-app-pub-1111222233334444~1122334455</string>\n</dict>`,
    );
    const result = patchPlist(withGad, { appId: testIds.appId.ios, skadnetworkIds: skadIds });
    expect(result.action).toBe('modify');
    expect(result.newText).toContain('ca-app-pub-1111222233334444~1122334455');
    expect(result.newText).not.toContain(testIds.appId.ios);
  });

  it('已有完整 SKAdNetworkItems → skip', () => {
    const entries = skadIds.map((id) => `\t\t<dict>\n\t\t\t<key>SKAdNetworkIdentifier</key>\n\t\t\t<string>${id}</string>\n\t\t</dict>`).join('\n');
    const complete = plist.replace(
      '</dict>',
      `\t<key>SKAdNetworkItems</key>\n\t<array>\n${entries}\n\t</array>\n\t<key>GADApplicationIdentifier</key>\n\t<string>ca-app-pub-1111222233334444~1122334455</string>\n</dict>`,
    );
    const result = patchPlist(complete, { appId: testIds.appId.ios, skadnetworkIds: skadIds });
    expect(result.action).toBe('skip');
  });

  it('已有部分 SKAdNetworkItems → 只补缺失项', () => {
    const partial = plist.replace(
      '</dict>',
      `\t<key>SKAdNetworkItems</key>\n\t<array>\n\t\t<dict>\n\t\t\t<key>SKAdNetworkIdentifier</key>\n\t\t\t<string>${skadIds[0]}</string>\n\t\t</dict>\n\t</array>\n</dict>`,
    );
    const result = patchPlist(partial, { appId: testIds.appId.ios, skadnetworkIds: skadIds });
    expect(result.action).toBe('modify');
    const count = result.newText.match(/<string>[a-z0-9.]+\.skadnetwork<\/string>/g)?.length;
    expect(count).toBe(skadIds.length);
  });
});

describe('patchGradle', () => {
  const gradle = (minSdkLine: string) => `android {
    defaultConfig {
        ${minSdkLine}
    }
}
`;

  it('字面量 < 24 → 改为 24', () => {
    const result = patchGradle(gradle('minSdk = 21'), { minSdk: 21, requiredMinSdk: 24 });
    expect(result.action).toBe('modify');
    expect(result.newText).toContain('minSdk = 24');
  });

  it('字面量 >= 24 → skip', () => {
    const result = patchGradle(gradle('minSdk = 24'), { minSdk: 24, requiredMinSdk: 24 });
    expect(result.action).toBe('skip');
  });

  it("flutter-default 且 resolvedMinSdk >= 24 → skip", () => {
    const text = gradle('minSdk = flutter.minSdkVersion');
    const result = patchGradle(text, { minSdk: 'flutter-default', resolvedMinSdk: 24, requiredMinSdk: 24 });
    expect(result.action).toBe('skip');
  });

  it("flutter-default 且解析不到 → skip + warning", () => {
    const text = gradle('minSdk = flutter.minSdkVersion');
    const result = patchGradle(text, { minSdk: 'flutter-default', requiredMinSdk: 24 });
    expect(result.action).toBe('skip');
    expect(result.warnings?.[0]).toContain('minSdk');
  });
});

describe('patchPodfile', () => {
  it('platform 12.0 → 13.0', () => {
    const result = patchPodfile("platform :ios, '12.0'\n", { minDeploymentTarget: '13.0' });
    expect(result.action).toBe('modify');
    expect(result.newText).toBe("platform :ios, '13.0'\n");
  });

  it('platform 13.0 → skip', () => {
    const result = patchPodfile("platform :ios, '13.0'\n", { minDeploymentTarget: '13.0' });
    expect(result.action).toBe('skip');
  });

  it('无 platform 行 → skip', () => {
    const result = patchPodfile("target 'Runner' do\nend\n", { minDeploymentTarget: '13.0' });
    expect(result.action).toBe('skip');
  });
});

describe('patchDartMain', () => {
  it('块函数体：在 runApp 前插入标记片段，import 区末尾加 ads 导出', () => {
    const result = patchDartMain(`import 'package:flutter/material.dart';

void main() {
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {}
`);
    expect(result.action).toBe('modify');
    expect(result.newText).toContain(`import 'package:flutter/material.dart';
import 'ads/ads.dart';`);
    expect(result.newText).toContain(`void main() {
  // ai-ad-monetization:begin
  WidgetsFlutterBinding.ensureInitialized();
  AdsInitializer.instance.initialize(); // not awaited: do not block startup
  // ai-ad-monetization:end
  runApp(const MyApp());
}`);
  });

  it('箭头函数：改写为块函数体后插入', () => {
    const result = patchDartMain(`import 'package:flutter/material.dart';

void main() => runApp(const MyApp());
`);
    expect(result.action).toBe('modify');
    expect(result.newText).toContain('// ai-ad-monetization:begin');
    expect(result.newText).toContain('runApp(const MyApp());');
    expect(result.newText).not.toContain('=>');
  });

  it('已有 ensureInitialized 则不重复插入', () => {
    const result = patchDartMain(`Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const MyApp());
}
`);
    expect(result.action).toBe('modify');
    expect(result.newText.match(/WidgetsFlutterBinding\.ensureInitialized\(\);/g)).toHaveLength(1);
  });

  it('已有 begin 标记 → skip；无 runApp → skip', () => {
    expect(patchDartMain('// ai-ad-monetization:begin\nvoid main() {}\n').action).toBe('skip');
    expect(patchDartMain('void main() {}\n').action).toBe('skip');
  });
});

describe('unifiedDiff', () => {
  it('生成标准 unified diff 头与 3 行上下文', () => {
    const oldText = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].join('\n') + '\n';
    const newText = ['a', 'b', 'c', 'D2', 'e', 'f', 'g', 'h'].join('\n') + '\n';
    const diff = unifiedDiff(oldText, newText, 'sample.txt');
    expect(diff).toContain('--- a/sample.txt');
    expect(diff).toContain('+++ b/sample.txt');
    expect(diff).toMatch(/@@ -1,7 \+1,7 @@/);
    expect(diff).toContain('-d');
    expect(diff).toContain('+D2');
    expect(diff).toContain(' a');
  });

  it('内容相同 → 空字符串', () => {
    expect(unifiedDiff('x\n', 'x\n', 'f')).toBe('');
  });
});
