import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { buildIntegrationReport } from '../src/core/report/report.js';

const fixtures = (name: string) =>
  join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', name);

describe('build_integration_report', () => {
  it('未提供 verification 时第 7 节写"未执行"，且包含全部 9 个章节', async () => {
    const { markdown } = await buildIntegrationReport({ projectPath: fixtures('flutter_with_admob') });
    for (const i of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      expect(markdown).toContain(`## ${i}.`);
    }
    expect((markdown.match(/^## /gm) ?? []).length).toBe(9);
    expect(markdown).toContain('未执行');
  });

  it('提供 verification 时分级列出，runtime 未核对项可见', async () => {
    const verification = {
      verdict: { static: 'passed', build: 'passed', runtime: 'requires_manual_verification' },
      levels: {
        build: {
          status: 'passed',
          summary: 'build passed',
          steps: [
            { id: 'build_android', status: 'skipped', reason: 'TOOLCHAIN_MISSING: 未找到 Android SDK' },
            { id: 'build_ios', status: 'passed' },
          ],
        },
        runtime: { items: [{ id: 'banner-test-label', title: 'Banner 显示 "Test Ad" 标签' }] },
      },
    };
    const { markdown } = await buildIntegrationReport({ projectPath: fixtures('flutter_with_admob'), verification });
    expect(markdown).toContain('build（构建验证）: **passed**');
    expect(markdown).toContain('build_android: skipped');
    expect(markdown).toContain('Android 构建未验证');
    expect(markdown).toContain('Banner 显示 "Test Ad" 标签');
  });

  it('第 8 节包含人工步骤与 release 口径 fail 项（fixture 用测试 ID → release fail）', async () => {
    const { markdown } = await buildIntegrationReport({ projectPath: fixtures('flutter_with_admob') });
    expect(markdown).toContain('## 8. 上线前必须由你完成的事项');
    expect(markdown).toContain('release 口径');
  });

  it('第 9 节包含来源与时效说明', async () => {
    const { markdown } = await buildIntegrationReport({ projectPath: fixtures('flutter_with_admob') });
    expect(markdown).toContain('## 9. 来源与知识时效');
    expect(markdown).toContain('developers.google.com');
  });
});
