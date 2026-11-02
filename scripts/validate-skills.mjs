#!/usr/bin/env node
/**
 * Validates the skills/ directory and plugin manifests for the
 * ai-ad-monetization plugin. Pure Node, no dependencies.
 *
 * Checks:
 *  - exactly the 8 expected skill dirs, each with a SKILL.md
 *  - frontmatter: name matches dir name and ^[a-z0-9-]{1,64}$,
 *    description <= 1024 chars, metadata.version/category present
 *  - the 8 required sections are present
 *  - at least one references/*.md per skill, and every references/xxx.md
 *    link inside SKILL.md resolves to an existing file
 *  - every backtick-quoted snake_case identifier in SKILL.md / references is
 *    either one of the 14 MCP tool names or a known non-tool identifier
 *  - all plugin JSON manifests parse
 *
 * Exit code 0 = all checks passed.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const skillsDir = join(root, 'skills');

const EXPECTED_SKILLS = [
  'ad-monetization',
  'ad-platform-selector',
  'ad-unit-planner',
  'ad-sdk-integrator',
  'ad-compliance-checker',
  'ad-config-validator',
  'ad-integration-tester',
  'ad-revenue-optimizer',
];

const MCP_TOOLS = new Set([
  'search_ad_platforms',
  'compare_ad_platforms',
  'recommend_ad_platform',
  'get_platform_docs',
  'get_sdk_compatibility',
  'analyze_project',
  'plan_ad_placements',
  'get_integration_guide',
  'validate_ad_config',
  'generate_ad_integration',
  'verify_ad_integration',
  'build_integration_report',
  'get_ad_revenue',
  'analyze_ad_performance',
]);

// Backtick-quoted snake_case tokens that are identifiers, not tool names.
const KNOWN_NON_TOOLS = new Set([
  'google_mobile_ads', // pub.dev package name
  'requires_manual_verification', // verify_ad_integration status literal
  'admob_api', // get_ad_revenue source literal
  'delegate_official_skill', // support level literal
]);

const REQUIRED_SECTIONS = [
  'when to use',
  'prerequisites',
  'workflow',
  'decision logic',
  'error handling',
  'output',
  'references',
  'core rules',
];

const MANIFEST_FILES = [
  '.claude-plugin/plugin.json',
  '.claude-plugin/marketplace.json',
  '.codex-plugin/plugin.json',
  '.cursor-plugin/plugin.json',
  '.mcp.json',
];

const errors = [];
const notes = [];

function parseFrontmatter(text, file) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!match) {
    errors.push(`${file}: missing YAML frontmatter`);
    return {};
  }
  const fm = {};
  let currentKey = null;
  for (const rawLine of match[1].split(/\r?\n/)) {
    if (/^\s*#/.test(rawLine)) continue;
    const top = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(rawLine);
    if (top && !/^\s/.test(rawLine)) {
      currentKey = top[1];
      fm[currentKey] = top[2].trim();
      continue;
    }
    if (currentKey === 'metadata') {
      const sub = /^\s+([\w-]+):\s*(.*)$/.exec(rawLine);
      if (sub) fm[`metadata.${sub[1]}`] = sub[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  // Fold block scalars (>) used for long descriptions.
  const descMatch = /description:\s*>-\r?\n((?:[ \t]+.*\r?\n?)+)/.exec(match[1]);
  if (descMatch) {
    fm.description = descMatch[1]
      .split(/\r?\n/)
      .map((l) => l.trim())
      .join(' ');
  }
  const nameQuoted = /^name:\s*["']?([^"'\s]+)["']?$/.exec(fm.name ?? '');
  if (nameQuoted) fm.name = nameQuoted[1];
  const versionQuoted = /^["'](.*)["']$/.exec(fm['metadata.version'] ?? '');
  if (versionQuoted) fm['metadata.version'] = versionQuoted[1];
  return fm;
}

function findHeadings(text) {
  const headings = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) headings.push(m[2].trim().toLowerCase());
  }
  return headings;
}

function checkSnakeCaseTokens(text, file) {
  // Backtick-quoted tokens that look like snake_case identifiers.
  const tokenRe = /`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`/g;
  let m;
  while ((m = tokenRe.exec(text)) !== null) {
    const token = m[1];
    if (MCP_TOOLS.has(token) || KNOWN_NON_TOOLS.has(token)) continue;
    errors.push(`${file}: unknown tool-like identifier \`${token}\` (not one of the 14 MCP tool names)`);
  }
}

// --- skills ---

const dirEntries = readdirSync(skillsDir).filter((d) => statSync(join(skillsDir, d)).isDirectory());
for (const d of dirEntries) {
  if (!EXPECTED_SKILLS.includes(d)) errors.push(`skills/${d}: unexpected skill directory`);
}
for (const skill of EXPECTED_SKILLS) {
  const skillDir = join(skillsDir, skill);
  if (!existsSync(skillDir)) {
    errors.push(`skills/${skill}: missing skill directory`);
    continue;
  }
  const skillMd = join(skillDir, 'SKILL.md');
  if (!existsSync(skillMd)) {
    errors.push(`skills/${skill}/SKILL.md: missing`);
    continue;
  }
  const text = readFileSync(skillMd, 'utf8');

  const fm = parseFrontmatter(text, `skills/${skill}/SKILL.md`);
  if (fm.name !== skill) errors.push(`skills/${skill}/SKILL.md: frontmatter name "${fm.name}" != directory name`);
  if (!/^[a-z0-9-]{1,64}$/.test(fm.name ?? '')) errors.push(`skills/${skill}/SKILL.md: name fails ^[a-z0-9-]{1,64}$`);
  const desc = fm.description ?? '';
  if (!desc) errors.push(`skills/${skill}/SKILL.md: missing description`);
  if (desc.length > 1024) errors.push(`skills/${skill}/SKILL.md: description ${desc.length} chars > 1024`);
  if (fm['metadata.version'] !== '0.1.0') errors.push(`skills/${skill}/SKILL.md: metadata.version should be "0.1.0"`);
  if (fm['metadata.category'] !== 'AdMonetization') errors.push(`skills/${skill}/SKILL.md: metadata.category should be AdMonetization`);

  const headings = findHeadings(text);
  for (const section of REQUIRED_SECTIONS) {
    if (!headings.some((h) => h === section || h.endsWith(`: ${section}`) || h.startsWith(`${section} (`) || h.startsWith(`${section} —`) || h.startsWith(`${section} -`))) {
      errors.push(`skills/${skill}/SKILL.md: missing required section "${section}"`);
    }
  }

  const refsDir = join(skillDir, 'references');
  const refFiles = existsSync(refsDir)
    ? readdirSync(refsDir).filter((f) => f.endsWith('.md'))
    : [];
  if (refFiles.length === 0) errors.push(`skills/${skill}: no references/*.md files`);

  const linkedRefs = [...text.matchAll(/references\/([A-Za-z0-9._-]+\.md)/g)].map((m) => m[1]);
  if (linkedRefs.length === 0) errors.push(`skills/${skill}/SKILL.md: does not reference any references/*.md file`);
  for (const ref of linkedRefs) {
    if (!existsSync(join(refsDir, ref))) errors.push(`skills/${skill}/SKILL.md: links references/${ref} but file does not exist`);
  }
  for (const ref of refFiles) {
    const rel = `skills/${skill}/references/${ref}`;
    if (!linkedRefs.includes(ref)) errors.push(`${rel}: file exists but is not referenced from SKILL.md`);
    checkSnakeCaseTokens(readFileSync(join(refsDir, ref), 'utf8'), rel);
  }

  checkSnakeCaseTokens(text, `skills/${skill}/SKILL.md`);
  notes.push(`skills/${skill}: ${text.split(/\r?\n/).length} lines, references: ${refFiles.join(', ')}`);
}

// --- manifests ---

for (const file of MANIFEST_FILES) {
  const abs = join(root, file);
  if (!existsSync(abs)) {
    errors.push(`${file}: missing manifest`);
    continue;
  }
  try {
    JSON.parse(readFileSync(abs, 'utf8'));
  } catch (e) {
    errors.push(`${file}: invalid JSON — ${e.message}`);
  }
}

for (const note of notes) console.log(note);
if (errors.length > 0) {
  console.error(`\n${errors.length} error(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`\nOK: ${EXPECTED_SKILLS.length} skills and ${MANIFEST_FILES.length} manifests validated.`);
