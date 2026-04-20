# OpenDeploy · Plan 3: 知识库（Skills）基础设施

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Plan 2 的 Agent Loop 真正"懂金蝶"—— 实现 Claude Code Skills 模型的完整闭环：本地 skill 注册表 + 远程分发（GitHub/Gitee）+ 多 skill 管理（list/install/update/remove）+ 完整性校验 + Agent 发现和按需加载，并带 UI。

**Architecture:**
- Skill 格式 = Anthropic Claude Code Skills：一个目录含 `SKILL.md`（YAML frontmatter + Markdown body），frontmatter 必含 `name` / `description` / `version`。
- 知识库**只有 skills**。业务对象元数据由 `ErpConnector` 直连数据库读取，不入知识库（决策见 memory: `arch_knowledge_as_skills`）。
- 本地目录：`%USERPROFILE%/.opendeploy/knowledge/`（Electron `app.getPath('userData')` 的兄弟目录），内部结构 `skills/<namespace>/<skill-name>/SKILL.md` + 顶层 `manifest.json`。
- 分发：远程仓库 → HTTPS tarball → 解压到临时目录 → 完整性校验 → 原子替换本地。**无 CDN、无 git 客户端依赖**。
- Agent 集成：会话启动时把所有 skill 的 `description` 汇总注入 system prompt（只列名字 + 描述，不加载 body）；新工具 `load_skill(id)` 允许 agent 按需取回 body。
- UI：NavRail 已有"技能"入口，SkillsPage 提供列表 + 安装/更新/移除。

**Tech Stack:** TypeScript, Node.js `fetch` + `zlib`/`tar-stream` 解压, `js-yaml` 解析 frontmatter, `crypto.createHash('sha256')` 校验, Vitest。

**Project Root:** `D:\Project\opendeploy\`

---

## Plan 3 完成后能做什么

- 用户从 GitHub 或 Gitee 仓库 URL 安装 skill 包；或使用 installer 内置的种子 skill。
- Skills 页可以列出所有 skill、查看 description、手动更新或移除单个 skill。
- Agent Loop 系统提示包含所有 skill 的简介；当用户描述的需求匹配某 skill 时，agent 通过 `load_skill` 工具按需取回详细指引，按指引完成回答。
- 完整性校验：下载后对比 manifest 中的 SHA-256，篡改/残缺包拒绝安装。
- 种子 skill：至少 2 个可用 skill，其中 1 个演示 agent 遇到"金蝶二开需求"时如何触发并应用。
- E2E demo：一次完整对话，agent 主动 `load_skill` 并按 skill 指导产出答案。

---

## 文件结构规划

```
src/
├── shared/
│   └── skill-types.ts              # SkillMeta, LoadedSkill, Manifest, KnowledgeSource
├── main/
│   ├── skills/
│   │   ├── parser.ts               # SKILL.md frontmatter + body 解析
│   │   ├── paths.ts                # 用户 knowledge dir、临时目录路径工具
│   │   ├── registry.ts             # 扫描本地 skills 目录，构建 SkillMeta 列表
│   │   ├── manifest.ts             # manifest.json 读/写
│   │   ├── integrity.ts            # SHA-256 校验
│   │   ├── downloader.ts           # HTTPS 下载 tarball + 解压
│   │   ├── remote.ts               # RemoteSource 接口 + github/gitee 实现
│   │   └── manager.ts              # 生命周期：install / update / remove / check-updates
│   ├── agent/
│   │   ├── loop.ts                 # （修改）注入 skill 清单到 system prompt
│   │   └── builtin-tools.ts        # （修改）新增 load_skill 工具
│   └── ipc-skills.ts               # IPC handlers：列表、安装、更新、移除、检查更新
├── preload/
│   └── index.ts                    # （修改）暴露 skills API
├── renderer/
│   ├── stores/
│   │   └── skills-store.ts         # Zustand skills state
│   ├── pages/
│   │   └── SkillsPage.tsx          # 替换 SkillsPlaceholder
│   └── components/
│       └── SkillCard.tsx           # 单个 skill 卡片
├── shared/
│   └── types.ts                    # （修改）AppSettings 新增 knowledgeSources
└── tests/
    └── skills/
        ├── parser.test.ts
        ├── registry.test.ts
        ├── manifest.test.ts
        ├── integrity.test.ts
        ├── downloader.test.ts
        ├── manager.test.ts
        └── e2e-skill-flow.test.ts

knowledge/                          # 仓库内种子 skill（installer 会打包）
├── manifest.json
└── skills/
    ├── common/
    │   └── requirements-clarification/
    │       └── SKILL.md
    └── kingdee-cosmic-v9/
        └── bos-plugin-anatomy/
            └── SKILL.md
```

---

## Task 1: 共享 Skill 类型定义

**Files:**
- Create: `src/shared/skill-types.ts`

- [ ] **Step 1: 定义类型**

```typescript
/** Skill frontmatter schema — kept minimal; close to Claude Code skills. */
export interface SkillFrontmatter {
  name: string;                    // human name, matches dir name
  description: string;             // one paragraph, used by agent for discovery
  version: string;                 // semver
  tags?: string[];
  /** Optional ERP provider this skill applies to, e.g. "kingdee-cosmic-v9". Missing = generic. */
  erpProvider?: string;
}

export interface SkillMeta extends SkillFrontmatter {
  /** "<namespace>/<skill-dir>", e.g. "common/requirements-clarification". */
  id: string;
  /** Absolute path to the skill directory. */
  path: string;
}

export interface LoadedSkill extends SkillMeta {
  /** Markdown body without frontmatter. */
  body: string;
}

/** manifest.json at knowledge dir root — describes the installed bundle. */
export interface KnowledgeManifest {
  /** Manifest spec version, e.g. "1". */
  schema: '1';
  /** Content version (semver) for the whole bundle. */
  version: string;
  /** Git SHA or release tag the bundle was built from (optional for dev). */
  sourceRef?: string;
  /** Per-skill integrity records. */
  skills: Array<{
    id: string;                    // namespace/name
    version: string;
    sha256: string;                // of SKILL.md
  }>;
}

/** Remote source config stored in AppSettings. */
export interface KnowledgeSource {
  id: string;                      // user-chosen stable id
  kind: 'github' | 'gitee' | 'local';
  /** For github/gitee: "owner/repo" or "owner/repo@ref". For local: absolute path. */
  location: string;
  /** Display-only label in UI. */
  label?: string;
}
```

- [ ] **Step 2: typecheck pass**

```bash
pnpm typecheck
```

---

## Task 2: SKILL.md 解析器

**Files:**
- Create: `src/main/skills/parser.ts`
- Create: `tests/skills/parser.test.ts`

- [ ] **Step 1: 安装 `js-yaml`**

```bash
pnpm add js-yaml && pnpm add -D @types/js-yaml
```

- [ ] **Step 2: 测试先行**

```typescript
// tests/skills/parser.test.ts
import { describe, it, expect } from 'vitest';
import { parseSkill } from '../../src/main/skills/parser';

describe('parseSkill', () => {
  it('parses frontmatter and body', () => {
    const src = [
      '---',
      'name: demo',
      'description: When to use demo',
      'version: 1.0.0',
      '---',
      '',
      '# Body heading',
      'body text'
    ].join('\n');

    const r = parseSkill(src);
    expect(r.name).toBe('demo');
    expect(r.description).toBe('When to use demo');
    expect(r.version).toBe('1.0.0');
    expect(r.body.trim()).toContain('Body heading');
  });

  it('rejects missing required fields', () => {
    expect(() => parseSkill('---\nname: x\n---\nbody')).toThrow(/description/);
  });

  it('rejects invalid semver version', () => {
    expect(() => parseSkill('---\nname: x\ndescription: y\nversion: v1\n---\n')).toThrow(/semver/);
  });
});
```

- [ ] **Step 3: 实现 parser**

```typescript
// src/main/skills/parser.ts
import yaml from 'js-yaml';
import type { SkillFrontmatter } from '@shared/skill-types';

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[\w.]+)?$/;

export interface ParsedSkill extends SkillFrontmatter {
  body: string;
}

export function parseSkill(src: string): ParsedSkill {
  const m = FM_RE.exec(src);
  if (!m) throw new Error('SKILL.md must start with a YAML frontmatter block');
  const fm = yaml.load(m[1]) as Record<string, unknown>;
  if (!fm || typeof fm !== 'object') throw new Error('Invalid YAML frontmatter');

  const name = str(fm, 'name');
  const description = str(fm, 'description');
  const version = str(fm, 'version');
  if (!SEMVER_RE.test(version)) throw new Error(`Invalid semver version: ${version}`);

  const tags = fm.tags === undefined ? undefined : asStringArray(fm.tags, 'tags');
  const erpProvider = fm.erpProvider === undefined ? undefined : str(fm, 'erpProvider');

  return { name, description, version, tags, erpProvider, body: m[2] };
}

function str(o: Record<string, unknown>, key: string): string {
  const v = o[key];
  if (typeof v !== 'string' || !v.trim()) throw new Error(`Missing or empty ${key}`);
  return v;
}

function asStringArray(v: unknown, key: string): string[] {
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) {
    throw new Error(`${key} must be string[]`);
  }
  return v as string[];
}
```

- [ ] **Step 4: typecheck + tests pass**

---

## Task 3: 本地 Skill 注册表 + 路径工具

**Files:**
- Create: `src/main/skills/paths.ts`
- Create: `src/main/skills/registry.ts`
- Create: `tests/skills/registry.test.ts`

- [ ] **Step 1: paths.ts**

```typescript
// src/main/skills/paths.ts
import { app } from 'electron';
import path from 'node:path';
import os from 'node:os';

/** Root of the knowledge cache — `~/.opendeploy/knowledge/`. */
export function knowledgeDir(): string {
  const home = app?.getPath ? app.getPath('home') : os.homedir();
  return path.join(home, '.opendeploy', 'knowledge');
}

export function skillsDir(): string {
  return path.join(knowledgeDir(), 'skills');
}

export function manifestPath(): string {
  return path.join(knowledgeDir(), 'manifest.json');
}

/** Scratch dir for downloads; caller must clean up. */
export function tmpDownloadDir(): string {
  return path.join(knowledgeDir(), '.tmp', String(Date.now()));
}
```

- [ ] **Step 2: registry scan — 测试**

```typescript
// tests/skills/registry.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { scanSkills } from '../../src/main/skills/registry';

async function makeSkill(root: string, id: string, fm: Record<string, unknown>, body = 'body') {
  const dir = path.join(root, 'skills', ...id.split('/'));
  await fs.mkdir(dir, { recursive: true });
  const yaml = Object.entries(fm).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n');
  await fs.writeFile(path.join(dir, 'SKILL.md'), `---\n${yaml}\n---\n${body}\n`, 'utf8');
}

describe('scanSkills', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'skills-test-'));
  });

  it('returns empty array when skills dir is missing', async () => {
    expect(await scanSkills(root)).toEqual([]);
  });

  it('discovers skills across namespaces', async () => {
    await makeSkill(root, 'common/a', { name: 'a', description: 'desc a', version: '1.0.0' });
    await makeSkill(root, 'kingdee-cosmic-v9/b', { name: 'b', description: 'desc b', version: '0.2.0' });
    const skills = await scanSkills(root);
    expect(skills.map((s) => s.id).sort()).toEqual(['common/a', 'kingdee-cosmic-v9/b']);
  });

  it('skips dirs without SKILL.md and logs invalid frontmatter to errors', async () => {
    await fs.mkdir(path.join(root, 'skills', 'common', 'empty'), { recursive: true });
    await makeSkill(root, 'common/bad', { name: 'x' }); // missing description/version
    const skills = await scanSkills(root);
    expect(skills).toHaveLength(0);
  });
});
```

- [ ] **Step 3: 实现 scanSkills**

```typescript
// src/main/skills/registry.ts
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseSkill } from './parser';
import type { SkillMeta, LoadedSkill } from '@shared/skill-types';

/** Scan the skills/ tree under `root` (2-level: namespace/name). */
export async function scanSkills(root: string): Promise<SkillMeta[]> {
  const skillsRoot = path.join(root, 'skills');
  let namespaces: string[];
  try {
    namespaces = await fs.readdir(skillsRoot);
  } catch {
    return [];
  }

  const out: SkillMeta[] = [];
  for (const ns of namespaces) {
    const nsDir = path.join(skillsRoot, ns);
    const stat = await fs.stat(nsDir).catch(() => null);
    if (!stat?.isDirectory()) continue;
    for (const name of await fs.readdir(nsDir)) {
      const dir = path.join(nsDir, name);
      const s = await fs.stat(dir).catch(() => null);
      if (!s?.isDirectory()) continue;
      const file = path.join(dir, 'SKILL.md');
      const src = await fs.readFile(file, 'utf8').catch(() => null);
      if (src == null) continue;
      try {
        const parsed = parseSkill(src);
        out.push({ ...parsed, id: `${ns}/${name}`, path: dir });
      } catch {
        /* TODO surface to UI via diagnostics later */
      }
    }
  }
  return out;
}

export async function loadSkillBody(meta: SkillMeta): Promise<LoadedSkill> {
  const src = await fs.readFile(path.join(meta.path, 'SKILL.md'), 'utf8');
  const parsed = parseSkill(src);
  return { ...meta, body: parsed.body };
}
```

- [ ] **Step 4: typecheck + tests pass**

---

## Task 4: Manifest + 完整性校验

**Files:**
- Create: `src/main/skills/manifest.ts`
- Create: `src/main/skills/integrity.ts`
- Create: `tests/skills/manifest.test.ts`
- Create: `tests/skills/integrity.test.ts`

- [ ] **Step 1: manifest 读/写**

```typescript
// src/main/skills/manifest.ts
import fs from 'node:fs/promises';
import type { KnowledgeManifest } from '@shared/skill-types';

export async function readManifest(p: string): Promise<KnowledgeManifest | null> {
  try {
    const txt = await fs.readFile(p, 'utf8');
    const parsed = JSON.parse(txt) as KnowledgeManifest;
    if (parsed.schema !== '1') throw new Error(`unsupported manifest schema: ${parsed.schema}`);
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function writeManifest(p: string, m: KnowledgeManifest): Promise<void> {
  await fs.writeFile(p, JSON.stringify(m, null, 2) + '\n', 'utf8');
}
```

- [ ] **Step 2: SHA-256 校验**

```typescript
// src/main/skills/integrity.ts
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { KnowledgeManifest, SkillMeta } from '@shared/skill-types';

export async function hashFile(p: string): Promise<string> {
  const h = createHash('sha256');
  h.update(await fs.readFile(p));
  return h.digest('hex');
}

export interface IntegrityReport {
  ok: boolean;
  mismatches: Array<{ id: string; expected: string; actual: string | null }>;
}

/** Verify every skill listed in manifest has a matching SHA-256 on disk. */
export async function verifyIntegrity(
  root: string,
  manifest: KnowledgeManifest,
  skills: SkillMeta[]
): Promise<IntegrityReport> {
  const byId = new Map(skills.map((s) => [s.id, s]));
  const mismatches: IntegrityReport['mismatches'] = [];
  for (const entry of manifest.skills) {
    const meta = byId.get(entry.id);
    if (!meta) {
      mismatches.push({ id: entry.id, expected: entry.sha256, actual: null });
      continue;
    }
    const actual = await hashFile(path.join(meta.path, 'SKILL.md'));
    if (actual !== entry.sha256) mismatches.push({ id: entry.id, expected: entry.sha256, actual });
  }
  return { ok: mismatches.length === 0, mismatches };
}
```

- [ ] **Step 3: 写测试（含 happy path + 1 个篡改场景）**
- [ ] **Step 4: typecheck + tests pass**

---

## Task 5: 下载器（HTTPS tarball 拉取 + 解压）

**Files:**
- Create: `src/main/skills/downloader.ts`
- Create: `tests/skills/downloader.test.ts`

- [ ] **Step 1: 依赖**

```bash
pnpm add tar
pnpm add -D @types/tar
```

- [ ] **Step 2: 实现**

```typescript
// src/main/skills/downloader.ts
import fs from 'node:fs/promises';
import { createWriteStream, createReadStream } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import tar from 'tar';

/** Download a tarball to a local file, streaming. Throws on non-2xx. */
export async function downloadTarball(url: string, destFile: string, signal?: AbortSignal): Promise<void> {
  const res = await fetch(url, { signal });
  if (!res.ok || !res.body) throw new Error(`download failed: ${res.status} ${res.statusText}`);
  await fs.mkdir(path.dirname(destFile), { recursive: true });
  const file = createWriteStream(destFile);
  // @ts-expect-error node fetch body is a WHATWG ReadableStream; pipeline handles it since Node 18.
  await pipeline(res.body, file);
}

/** Extract a `.tar.gz` into `destDir`. Returns top-level extracted dir name (if single). */
export async function extractTarGz(file: string, destDir: string): Promise<void> {
  await fs.mkdir(destDir, { recursive: true });
  await pipeline(createReadStream(file), createGunzip(), tar.x({ cwd: destDir }));
}
```

- [ ] **Step 3: 测试**

用 `vi.stubGlobal('fetch', ...)` mock HTTP；准备一个小的 fixture tarball（测试里用 `tar.c` 临时打包一个目录再解开），断言解压后文件存在。

- [ ] **Step 4: typecheck + tests pass**

---

## Task 6: RemoteSource 抽象 + GitHub/Gitee 实现

**Files:**
- Create: `src/main/skills/remote.ts`
- Create: `tests/skills/remote.test.ts`

- [ ] **Step 1: 接口 + 两种实现**

```typescript
// src/main/skills/remote.ts
import type { KnowledgeSource } from '@shared/skill-types';

export interface RemoteSourceAdapter {
  /** URL for the default-branch tarball of the remote repo. */
  tarballUrl(source: KnowledgeSource): string;
  /** URL for an individual raw file inside the repo. */
  rawUrl(source: KnowledgeSource, filePath: string): string;
}

const GITHUB: RemoteSourceAdapter = {
  tarballUrl({ location }) {
    const { repo, ref } = parseLoc(location);
    return `https://codeload.github.com/${repo}/tar.gz/refs/heads/${ref}`;
  },
  rawUrl({ location }, filePath) {
    const { repo, ref } = parseLoc(location);
    return `https://raw.githubusercontent.com/${repo}/${ref}/${filePath}`;
  }
};

const GITEE: RemoteSourceAdapter = {
  tarballUrl({ location }) {
    const { repo, ref } = parseLoc(location);
    return `https://gitee.com/${repo}/repository/archive/${ref}.tar.gz`;
  },
  rawUrl({ location }, filePath) {
    const { repo, ref } = parseLoc(location);
    return `https://gitee.com/${repo}/raw/${ref}/${filePath}`;
  }
};

function parseLoc(loc: string): { repo: string; ref: string } {
  const [repo, ref = 'main'] = loc.split('@');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`invalid repo: ${repo}`);
  return { repo, ref };
}

export function adapterFor(source: KnowledgeSource): RemoteSourceAdapter {
  switch (source.kind) {
    case 'github': return GITHUB;
    case 'gitee': return GITEE;
    case 'local': throw new Error('local sources do not use RemoteSourceAdapter');
  }
}
```

- [ ] **Step 2: 测试 URL 构造 + 解析**
- [ ] **Step 3: typecheck + tests pass**

---

## Task 7: Skill 生命周期管理

**Files:**
- Create: `src/main/skills/manager.ts`
- Create: `tests/skills/manager.test.ts`

**职责:** 协调 registry + downloader + remote + integrity + manifest。提供 `installFromSource` / `updateAll` / `remove` / `checkUpdates`。

- [ ] **Step 1: 实现 manager**

```typescript
// src/main/skills/manager.ts
import fs from 'node:fs/promises';
import path from 'node:path';
import { knowledgeDir, manifestPath, tmpDownloadDir } from './paths';
import { downloadTarball, extractTarGz } from './downloader';
import { adapterFor } from './remote';
import { readManifest, writeManifest } from './manifest';
import { scanSkills } from './registry';
import { verifyIntegrity } from './integrity';
import type { KnowledgeSource, KnowledgeManifest } from '@shared/skill-types';

/** Install/replace the whole knowledge bundle from a remote source.
 *  MVP strategy: replace-all — simpler than diffing per-skill. */
export async function installFromSource(source: KnowledgeSource): Promise<void> {
  if (source.kind === 'local') return installFromLocal(source.location);

  const tmp = tmpDownloadDir();
  await fs.mkdir(tmp, { recursive: true });
  try {
    const url = adapterFor(source).tarballUrl(source);
    const tarFile = path.join(tmp, 'bundle.tar.gz');
    await downloadTarball(url, tarFile);
    await extractTarGz(tarFile, tmp);

    // github/gitee tarballs wrap content in a single top-level dir; find it.
    const entries = (await fs.readdir(tmp, { withFileTypes: true })).filter((d) => d.isDirectory());
    const bundleRoot = entries.length === 1 ? path.join(tmp, entries[0].name) : tmp;
    await adoptBundle(bundleRoot);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

async function installFromLocal(src: string): Promise<void> {
  await adoptBundle(src);
}

/** Atomic-ish replace: build side-by-side, verify, then swap. */
async function adoptBundle(bundleRoot: string): Promise<void> {
  const manifest = (await readManifest(path.join(bundleRoot, 'manifest.json'))) ??
    rejectMissing('manifest.json');
  const skills = await scanSkills(bundleRoot);
  const report = await verifyIntegrity(bundleRoot, manifest, skills);
  if (!report.ok) throw new Error(`integrity check failed: ${JSON.stringify(report.mismatches)}`);

  const target = knowledgeDir();
  await fs.rm(target, { recursive: true, force: true });
  await fs.mkdir(target, { recursive: true });
  await fs.cp(bundleRoot, target, { recursive: true });
}

function rejectMissing(what: string): never {
  throw new Error(`bundle is missing ${what}`);
}

export async function removeAll(): Promise<void> {
  await fs.rm(knowledgeDir(), { recursive: true, force: true });
}

export async function currentVersion(): Promise<string | null> {
  const m = await readManifest(manifestPath());
  return m?.version ?? null;
}

/** Check if remote manifest declares a different version than local. */
export async function checkUpdates(source: KnowledgeSource): Promise<{ local: string | null; remote: string }> {
  const local = await currentVersion();
  const url = adapterFor(source).rawUrl(source, 'manifest.json');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`manifest fetch failed: ${res.status}`);
  const m = (await res.json()) as KnowledgeManifest;
  return { local, remote: m.version };
}
```

- [ ] **Step 2: 测试（mock fetch + mock remote + 校验 happy path + 篡改拒绝）**
- [ ] **Step 3: typecheck + tests pass**

---

## Task 8: AppSettings 扩展 + IPC + preload

**Files:**
- Modify: `src/shared/types.ts` — `AppSettings.knowledgeSources: KnowledgeSource[]`，默认空数组
- Create: `src/main/ipc-skills.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/types/window.d.ts`

- [ ] **Step 1: AppSettings 扩展 + default**

- [ ] **Step 2: IPC handlers**

```typescript
// src/main/ipc-skills.ts
import { ipcMain } from 'electron';
import { scanSkills, loadSkillBody } from './skills/registry';
import { installFromSource, removeAll, checkUpdates } from './skills/manager';
import { knowledgeDir } from './skills/paths';

export function registerSkillIpc(): void {
  ipcMain.handle('skills:list', async () => scanSkills(knowledgeDir()));
  ipcMain.handle('skills:load', async (_e, id: string) => {
    const all = await scanSkills(knowledgeDir());
    const hit = all.find((s) => s.id === id);
    if (!hit) throw new Error(`unknown skill: ${id}`);
    return loadSkillBody(hit);
  });
  ipcMain.handle('skills:install', async (_e, source) => installFromSource(source));
  ipcMain.handle('skills:remove-all', async () => removeAll());
  ipcMain.handle('skills:check-updates', async (_e, source) => checkUpdates(source));
}
```

- [ ] **Step 3: preload + window.d.ts 同步类型**
- [ ] **Step 4: 主进程 `src/main/index.ts` 首次启动时把仓库内 `knowledge/` 目录复制到 `~/.opendeploy/knowledge/`（若后者不存在），实现"installer 内置种子 skill" 的效果**
- [ ] **Step 5: typecheck + tests pass**

---

## Task 9: Agent Loop 集成（skill 发现 + load_skill 工具）

**Files:**
- Modify: `src/main/agent/loop.ts`
- Modify: `src/main/agent/builtin-tools.ts`
- Create: `tests/agent/skills-integration.test.ts`

- [ ] **Step 1: 注入 skill 清单到 system prompt**

```typescript
// 伪代码（集成到 runAgentLoop）
const skills = await scanSkills(knowledgeDir());
const skillCatalog = skills.length
  ? [
      'You have access to the following skills. When a skill description matches the task, call `load_skill` with its id before answering:',
      ...skills.map((s) => `- ${s.id}: ${s.description}`)
    ].join('\n')
  : '';
const systemMessage = [baseSystemPrompt, skillCatalog].filter(Boolean).join('\n\n');
```

- [ ] **Step 2: 注册 `load_skill` 工具**

```typescript
// src/main/agent/builtin-tools.ts (增加)
export const loadSkillTool = {
  name: 'load_skill',
  description: 'Load the full body of a skill by its id (namespace/name).',
  parameters: {
    type: 'object' as const,
    properties: { id: { type: 'string', description: 'e.g. "common/requirements-clarification"' } },
    required: ['id']
  },
  async execute({ id }: { id: string }) {
    const all = await scanSkills(knowledgeDir());
    const hit = all.find((s) => s.id === id);
    if (!hit) throw new Error(`unknown skill: ${id}`);
    const loaded = await loadSkillBody(hit);
    return loaded.body;
  }
};
```

- [ ] **Step 3: 测试：mock 2 个 skill，断言 system prompt 含描述、load_skill 返回 body**
- [ ] **Step 4: typecheck + tests pass**

---

## Task 10: UI — Skills 页

**Files:**
- Create: `src/renderer/stores/skills-store.ts`
- Create: `src/renderer/pages/SkillsPage.tsx`
- Create: `src/renderer/components/SkillCard.tsx`
- Modify: `src/renderer/App.tsx` — 去掉 `SkillsPlaceholder`，路由到 `SkillsPage`
- Modify: `src/renderer/i18n/locales/**` — 新增 skills 页文案（两语 parity）

- [ ] **Step 1: Zustand store**

```typescript
// src/renderer/stores/skills-store.ts
import { create } from 'zustand';
import type { SkillMeta, KnowledgeSource } from '@shared/skill-types';

interface SkillsState {
  skills: SkillMeta[];
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  install: (source: KnowledgeSource) => Promise<void>;
  removeAll: () => Promise<void>;
}

export const useSkillsStore = create<SkillsState>((set) => ({
  skills: [],
  loading: false,
  error: null,
  load: async () => {
    set({ loading: true, error: null });
    try {
      set({ skills: await window.opendeploy.skillsList(), loading: false });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), loading: false });
    }
  },
  install: async (source) => {
    await window.opendeploy.skillsInstall(source);
    set({ skills: await window.opendeploy.skillsList() });
  },
  removeAll: async () => {
    await window.opendeploy.skillsRemoveAll();
    set({ skills: [] });
  }
}));
```

- [ ] **Step 2: 页面布局（列表 + "从 GitHub/Gitee 安装"表单 + "全部移除"按钮）**
- [ ] **Step 3: i18n 两语 parity**
- [ ] **Step 4: typecheck + tests pass**

---

## Task 11: 种子 skill 包

**Files:**
- Create: `knowledge/manifest.json`
- Create: `knowledge/skills/common/requirements-clarification/SKILL.md`
- Create: `knowledge/skills/kingdee-cosmic-v9/bos-plugin-anatomy/SKILL.md`
- Modify: `electron-builder` 配置（若存在）或 `package.json` `build.extraResources` 把 `knowledge/` 打入 installer
- Modify: `src/main/index.ts` — 首次启动从 `process.resourcesPath/knowledge/` 拷贝到 `~/.opendeploy/knowledge/`

- [ ] **Step 1: 写 `common/requirements-clarification/SKILL.md`**

要点（description 要精准，决定 agent 何时触发）：
- name: 需求澄清助手
- description: "当用户描述一个 ERP 二开需求但信息不全时使用。通过一组针对性问题定位业务对象、触发时机、审核/权限边界和异常处理期望。"
- body: 列出必问问题清单（主对象 / 触发事件 / 判断条件 / 失败提示文案 / 是否影响反审核 / 是否跨账套 …）

- [ ] **Step 2: 写 `kingdee-cosmic-v9/bos-plugin-anatomy/SKILL.md`**

要点：
- name: 金蝶云星空 BOS 表单插件骨架
- description: "当任务涉及金蝶云星空 V9.x 的表单插件（Form Plugin）开发时使用。给出 Python 表单插件的标准骨架（继承类、常用事件钩子、SDK 引入、注册方式）和常见坑。"
- body: 骨架代码 + 事件钩子对照表 + 调试技巧

- [ ] **Step 3: 生成 `manifest.json`（含 SHA-256）**

可以写一个临时脚本 `scripts/gen-manifest.ts`（一次性），扫 `knowledge/skills` 并输出。

- [ ] **Step 4: installer extraResources 配置**
- [ ] **Step 5: 主进程首次拷贝逻辑 + 测试**

---

## Task 12: E2E + 收尾

**Files:**
- Create: `tests/skills/e2e-skill-flow.test.ts`
- Modify: `CLAUDE.md` — "当前状态" 进度更新为 ✅ Plan 3

- [ ] **Step 1: E2E 测试**

在临时目录搭一个 fake knowledge 目录（含 1 个 skill + 完整 manifest），完整跑一遍 `runAgentLoop`（用 stub LLM 客户端返回"我想用 X skill"→ 触发 `load_skill` → 最终回答包含 skill body 摘要），断言工具调用顺序和最终文本。

- [ ] **Step 2: `pnpm typecheck && pnpm test --run` 全绿**
- [ ] **Step 3: 更新 `CLAUDE.md`**
  - "当前状态" 里 Plan 3 勾掉 ✅
  - 目录结构说明补 `src/main/skills/` 和 `knowledge/`
- [ ] **Step 4: 单 commit 合并或按 task 拆 commit（推荐按 task 拆，每 task 一 commit）**

---

## 决策备忘（架构）

- **为什么选 replace-all 而不是增量同步**：MVP 不值得做 diff 算法；用户更新频率低（手动触发）；文件数少（<100）；replace-all + 原子 cp 实现简单且不会半更新。
- **为什么不引入签名（PGP）**：GitHub/Gitee HTTPS + manifest SHA-256 已覆盖常见篡改场景；PGP 需要密钥管理，对社区用户和 v0.1 都不值。
- **为什么 erpProvider 是可选 frontmatter 字段**：早期绝大多数 skill 是 `common/`，只有金蝶相关的才标 `kingdee-cosmic-v9`；agent 根据当前项目绑定的 ERP 过滤（Plan 4+ 起生效，Plan 3 里暂不过滤）。
- **为什么本地源（`kind: 'local'`）**：开发时用，指向仓库内 `knowledge/` 即可实时迭代，不用每次构造 tarball。
- **为什么 Agent 在 system prompt 里先给 description 清单而不是 embedding 检索**：Claude Code Skills 正是这么做的；agent 在上下文里自己判断比 RAG 结果更可控，且对 1M 上下文的 Opus 4.7 几乎无成本。

---

## 失败回滚

每个 task 独立 commit。如果某个 task 实现后发现 architecture 有问题，`git revert <sha>` 即可回滚；manager.ts 的"安装前校验、校验通过才替换"保证本地 knowledge 永远处在已校验的状态。
