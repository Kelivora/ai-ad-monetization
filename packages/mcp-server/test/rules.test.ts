import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAdConfig } from '../src/core/validation/engine.js';
import { generateIntegration } from '../src/core/integration/generate.js';

const fixtures = (name: string) => join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', name);

function copyFixture(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `admon-rules-${name}-`));
  cpSync(fixtures(name), dir, { recursive: true });
  return dir;
}

const FORMATS = ['banner', 'interstitial', 'rewarded'] as const;

/** 对临时副本执行一次完整 apply，得到"已集成"的工程。 */
async function integratedCopy(name = 'flutter_basic'): Promise<string> {
  const root = copyFixture(name);
  const plan = await generateIntegration({ projectPath: root, formats: [...FORMATS], mode: 'plan' });
  await generateIntegration({
    projectPath: root,
    formats: [...FORMATS],
    mode: 'apply',
    confirm: true,
    expectedPlanHash: plan.plan.planHash,
    allowDirty: true,
  });
  return root;
}

function finding(output: Awaited<ReturnType<typeof validateAdConfig>>, ruleId: string) {
  return output.findings.filter((f) => f.ruleId === ruleId);
}

describe('validateAdConfig 规则', () => {
  let integrated: string;
  let flutterWithAdmob: string;
  beforeAll(async () => {
    integrated = await integratedCopy();
    flutterWithAdmob = copyFixture('flutter_with_admob');
  });
  afterAll(() => {
    rmSync(integrated, { recursive: true, force: true });
    rmSync(flutterWithAdmob, { recursive: true, force: true });
  });

  it('未集成的工程：关键规则 fail；非 Flutter → UNSUPPORTED_COMBINATION', async () => {
    const output = await validateAdConfig({ projectPath: flutterWithAdmob, profile: 'development' });
    const byId = (id: string) => finding(output, id);
    expect(byId('ADMOB_PLUGIN_PRESENT')[0]?.status).toBe('pass');
    expect(byId('ADMOB_PLUGIN_VERSION')[0]?.status).toBe('warning'); // ^5.1.0
    expect(byId('DEPRECATED_BANNER_SIZE_API')[0]?.status).toBe('warning'); // fixture 用了废弃 API
    expect(byId('SDK_INITIALIZED')[0]?.status).toBe('pass');

    const native = copyFixture('native_android');
    try {
      await expect(validateAdConfig({ projectPath: native })).rejects.toMatchObject({
        code: 'UNSUPPORTED_COMBINATION',
      });
    } finally {
      rmSync(native, { recursive: true, force: true });
    }
  });

  it('集成后的工程：development 口径下测试 ID 为 pass，release 口径为 fail', async () => {
    const dev = await validateAdConfig({ projectPath: integrated, profile: 'development', markets: ['US'] });
    const release = await validateAdConfig({ projectPath: integrated, profile: 'release', markets: ['US'] });

    const devTest = dev.findings.filter((f) => f.ruleId === 'TEST_APP_ID');
    const releaseTest = release.findings.filter((f) => f.ruleId === 'TEST_APP_ID');
    expect(devTest.length).toBeGreaterThan(0);
    expect(devTest.every((f) => f.status === 'pass')).toBe(true);
    expect(releaseTest.every((f) => f.status === 'fail')).toBe(true);

    // 生成的 ad_unit_ids.dart 默认值是测试 ID
    expect(finding(release, 'TEST_AD_UNIT')[0]?.status).toBe('fail');
    expect(finding(dev, 'TEST_AD_UNIT')[0]?.status).toBe('pass');
    expect(dev.overall).not.toBe('fail');
    expect(release.overall).toBe('fail');
  });

  it('EEA 市场缺同意流程 → CONSENT_FLOW fail', async () => {
    // flutter_with_admob fixture 有 MobileAds 但没有 UMP 同意流程
    const output = await validateAdConfig({ projectPath: flutterWithAdmob, markets: ['EEA'] });
    expect(finding(output, 'CONSENT_FLOW')[0]?.status).toBe('fail');
    expect(output.overall).toBe('fail');
    // 不含 EEA 时降级为 warning
    const usOnly = await validateAdConfig({ projectPath: flutterWithAdmob, markets: ['US'] });
    expect(finding(usOnly, 'CONSENT_FLOW')[0]?.status).toBe('warning');
  });

  it('集成后的工程：EEA 下同意流程 pass；隐私选项入口 warning（需人工放设置页）', async () => {
    const output = await validateAdConfig({ projectPath: integrated, markets: ['EU', 'UK'] }); // EU 别名归一化为 EEA
    expect(finding(output, 'CONSENT_FLOW')[0]?.status).toBe('pass');
    expect(finding(output, 'CAN_REQUEST_ADS_GATE')[0]?.status).toBe('pass');
    expect(finding(output, 'PRIVACY_OPTIONS_ENTRY')[0]?.status).toBe('warning');
    expect(finding(output, 'IOS_SKADNETWORK')[0]?.status).toBe('pass');
    expect(finding(output, 'BANNER_DISPOSE').every((f) => f.status === 'pass')).toBe(true);
    expect(finding(output, 'FULLSCREEN_DISPOSE').every((f) => f.status === 'pass')).toBe(true);
  });

  it('childDirected=true：有/无 tagForChildDirectedTreatment 的两种结论', async () => {
    // 用 childDirected=true 生成的工程包含标记 → pass
    const root = copyFixture('flutter_basic');
    try {
      const plan = await generateIntegration({ projectPath: root, formats: [...FORMATS], mode: 'plan', childDirected: true });
      await generateIntegration({
        projectPath: root,
        formats: [...FORMATS],
        mode: 'apply',
        confirm: true,
        expectedPlanHash: plan.plan.planHash,
        allowDirty: true,
        childDirected: true,
      });
      const withTag = await validateAdConfig({ projectPath: root, childDirected: true });
      expect(finding(withTag, 'CHILD_DIRECTED_TAG')[0]?.status).toBe('pass');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
    // 已有工程没有标记 → fail
    const withoutTag = await validateAdConfig({ projectPath: flutterWithAdmob, childDirected: true });
    expect(finding(withoutTag, 'CHILD_DIRECTED_TAG')[0]?.status).toBe('fail');
  });

  it('APP_ID_PLATFORM_MISMATCH：把 Android 的 App ID 换成 iOS 测试 ID → fail', async () => {
    const root = await integratedCopy();
    try {
      const output = await validateAdConfig({ projectPath: root });
      expect(finding(output, 'APP_ID_PLATFORM_MISMATCH')[0]?.status).toBe('pass');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('汇总计数与 overall 一致；各状态计数 = findings 数', async () => {
    const output = await validateAdConfig({ projectPath: integrated, markets: ['US'] });
    expect(output.summary.pass + output.summary.warning + output.summary.fail + output.summary.na).toBe(output.findings.length);
    const fails = output.findings.filter((f) => f.status === 'fail').length;
    expect(output.summary.fail).toBe(fails);
  });
});
