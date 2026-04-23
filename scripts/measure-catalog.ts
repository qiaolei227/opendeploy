/**
 * Render the agent-facing skills catalog and report its size in chars +
 * approx tokens. Helps gauge how much context the catalog itself consumes
 * before any user message / load_skill call.
 *
 * Usage: pnpm tsx scripts/measure-catalog.ts
 *        node --experimental-strip-types scripts/measure-catalog.ts
 */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

interface Frontmatter {
  name?: string;
  title?: string;
  description?: string;
}

interface SkillSnapshot {
  id: string;
  fm: Frontmatter;
  resources: string[]; // ["prompts/x", "references/y", ...]
}

const KNOWLEDGE_ROOT = 'knowledge/skills';

async function readFrontmatter(path: string): Promise<Frontmatter> {
  const text = await readFile(path, 'utf-8');
  const m = /^---\s*\n([\s\S]*?)\n---/.exec(text);
  if (!m) return {};
  const fm: Frontmatter = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^(\w+):\s*(.*)$/.exec(line.trim());
    if (!kv) continue;
    const k = kv[1] as keyof Frontmatter;
    let v = kv[2].trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1);
    (fm as Record<string, string>)[k] = v;
  }
  return fm;
}

async function listFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile() && e.name.endsWith('.md')).map((e) => e.name.replace(/\.md$/, ''));
  } catch {
    return [];
  }
}

async function scanSkills(): Promise<SkillSnapshot[]> {
  const out: SkillSnapshot[] = [];
  const namespaces = await readdir(KNOWLEDGE_ROOT, { withFileTypes: true });
  for (const ns of namespaces) {
    if (!ns.isDirectory()) continue;
    const nsDir = join(KNOWLEDGE_ROOT, ns.name);
    const skills = await readdir(nsDir, { withFileTypes: true });
    for (const sk of skills) {
      if (!sk.isDirectory()) continue;
      const skillDir = join(nsDir, sk.name);
      const skillFile = join(skillDir, 'SKILL.md');
      const fm = await readFrontmatter(skillFile);
      const id = `${ns.name}/${sk.name}`;
      const promptNames = await listFiles(join(skillDir, 'prompts'));
      const refNames = await listFiles(join(skillDir, 'references'));
      const resources = [
        ...promptNames.map((n) => `prompts/${n}`),
        ...refNames.map((n) => `references/${n}`)
      ];
      out.push({ id, fm, resources });
    }
  }
  return out;
}

function renderCatalog(skills: SkillSnapshot[], intro: string): string {
  const lines: string[] = [intro, ''];
  for (const s of skills) {
    const label = s.fm.title ? `${s.fm.title} · \`${s.id}\`` : `\`${s.id}\``;
    lines.push(`- ${label}: ${s.fm.description ?? ''}`);
    if (s.resources.length > 0) {
      const pathList = s.resources.map((r) => `\`${r}\``).join(', ');
      lines.push(`  files: ${pathList}`);
    }
  }
  return lines.join('\n');
}

const INTRO = `下面列出已装载的 skills——每份都是针对特定场景的专家指令。描述匹配当前任务时,先调 \`load_skill(id)\` 拿完整内容,按返回指令执行。

部分 skill 带子文件:\`prompts/*\`(过程性指引)、\`references/*\`(查阅用表格 / API / 模板)。按需调 \`load_skill_file(id, path)\`,\`path\` 形如 \`"prompts/xxx"\` 或 \`"references/xxx"\`(**不带 \`.md\` 后缀**)。**只拉当前需要的**——每次调用都有 token 成本。`;

function approxTokens(s: string): number {
  // Rough heuristic: Chinese ~1.5 char/token, ASCII ~4 char/token.
  // Most catalog content is mixed; use ~2 char/token as midpoint.
  return Math.ceil(s.length / 2);
}

const all = await scanSkills();

// Same filtering as production: system/* hidden, common/* always, others depend
// on activeErpProvider. Show two scenarios.
const visibleNoProject = all.filter((s) => s.id.startsWith('common/'));
const visibleK3Cloud = all.filter((s) => s.id.startsWith('common/') || s.id.startsWith('k3cloud/'));

console.log('=== Catalog scenario A: no active project (only common/*) ===');
const catalogA = renderCatalog(visibleNoProject, INTRO);
console.log(catalogA);
console.log(`\n[stats A] skills=${visibleNoProject.length} chars=${catalogA.length} approx_tokens=${approxTokens(catalogA)}\n`);

console.log('=== Catalog scenario B: active K/3 Cloud project ===');
const catalogB = renderCatalog(visibleK3Cloud, INTRO);
console.log(catalogB);
console.log(`\n[stats B] skills=${visibleK3Cloud.length} chars=${catalogB.length} approx_tokens=${approxTokens(catalogB)}`);

console.log('\n=== Per-skill catalog footprint ===');
for (const s of visibleK3Cloud) {
  const single = renderCatalog([s], '');
  console.log(`  ${s.id.padEnd(40)} chars=${String(single.length).padStart(5)} approx_tokens=${approxTokens(single)}`);
}

console.log('\n=== Bundled SKILL.md bodies (total, if everything loaded) ===');
let totalBodyChars = 0;
for (const s of all) {
  const body = await readFile(join(KNOWLEDGE_ROOT, s.id, 'SKILL.md'), 'utf-8');
  totalBodyChars += body.length;
}
console.log(`  all SKILL.md combined: chars=${totalBodyChars} approx_tokens=${approxTokens(String(totalBodyChars))}`);
console.log(`  approx_tokens (sum): ${approxTokens(String(totalBodyChars).repeat(0))}`);
console.log(`  total bundled SKILL.md tokens ~ ${Math.ceil(totalBodyChars / 2)}`);
