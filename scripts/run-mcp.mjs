#!/usr/bin/env node
/**
 * MCP launcher for the ai-ad-monetization plugin.
 *
 * Locates the repository root (this script lives in <root>/scripts/), then
 * imports the MCP server entry from packages/mcp-server/dist in the SAME node
 * process so stdio is passed through untouched.
 *
 * Never writes anything but MCP protocol to stdout. If the build output is
 * missing, prints an actionable hint to stderr and exits non-zero — it never
 * auto-installs dependencies.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, '..');
const serverEntry = join(repoRoot, 'packages', 'mcp-server', 'dist', 'index.js');

if (!existsSync(serverEntry)) {
  process.stderr.write(
    [
      '[ai-ad-monetization] MCP server build output not found:',
      `  ${serverEntry}`,
      '',
      'Build it first, then restart the agent:',
      `  cd ${repoRoot}`,
      '  npm install && npm run build',
      '',
      'This launcher intentionally does not install or build anything on its own.',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

try {
  await import(pathToFileURL(serverEntry).href);
} catch (error) {
  process.stderr.write(
    `[ai-ad-monetization] Failed to start MCP server from ${serverEntry}: ${error && error.stack ? error.stack : String(error)}\n`,
  );
  process.exit(1);
}
