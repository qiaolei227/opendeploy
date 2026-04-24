# BOS 侦察链 Phase 1 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 铺一套 dev-only 的 BOS 侦察工具链(`scripts/bos-recon/`),能对任意扩展 FID 跑 "snapshot-before → XE 抓 SQL trace → UAT 用户在 BOS Designer 操作 → snapshot-after → diff + 对账 → markdown report",产出**一份覆盖"加文本字段"的 🟢 实证 report**,为 Phase 2 写第一个字段 writer 提供 SQL 蓝图 + XML delta 结构。

**Architecture:** 4 个模块(xe-session / xe-parse / snapshot-all / diff)+ 1 个 CLI 入口,5 个 `pnpm recon:*` scripts。只在 dev 环境跑,需要 SA/DBA 权限。连 SQL Server 的配置从 `~/.opendeploy/settings.json` 里按 projectId 读(复用产品既有 K3CloudConnectionConfig 解析)。`.xel` + snapshot JSON + report markdown 都落 `scripts/bos-recon/output/`(已在 .gitignore)。

**Tech Stack:** TypeScript + tsx + mssql(已 dep)+ vitest。无新依赖——XE session / `.xel` 读取都走 SQL Server T-SQL,XML 解析沿用 bos-xml.ts 的 tokenizer 风格。

**范围边界:**
- **本 plan 覆盖** Phase 1 侦察基建 + UAT 第一次"加文本字段"侦察 → 产出 report
- **本 plan 不含** Phase 2 的 `kingdee_add_field` writer 实现 —— 那依赖 Phase 1 UAT 产出的真实表清单 + XML 子树结构,写在 plan 里会是 placeholder。Phase 1 完成后新开 plan

**Spec reference:** `docs/superpowers/specs/2026-04-24-bos-reconnaissance-design.md`

---

## 文件结构

**新建:**
- `scripts/bos-recon/cli.ts` — argv 路由到各 subcommand
- `scripts/bos-recon/xe-session.ts` — XE session 启停 (T-SQL 生成 + 执行)
- `scripts/bos-recon/xe-parse.ts` — `.xel` → SQL 事件数组
- `scripts/bos-recon/snapshot-all.ts` — 扫所有 `T_META_*` 按候选键过滤
- `scripts/bos-recon/diff.ts` — 语义 diff + XE 对账 + markdown report
- `scripts/bos-recon/config.ts` — 从 `~/.opendeploy/settings.json` 读连接配置 (复用产品解析逻辑)
- `scripts/bos-recon/README.md` — 操作手册
- `tests/scripts/bos-recon/xe-session.test.ts`
- `tests/scripts/bos-recon/xe-parse.test.ts`
- `tests/scripts/bos-recon/snapshot-all.test.ts`
- `tests/scripts/bos-recon/diff.test.ts`

**修改:**
- `package.json` — 加 5 个 scripts (`recon:snapshot-before` / `recon:xe-start` / `recon:xe-stop` / `recon:snapshot-after` / `recon:diff`)

**不改:**
- `src/main/**` — Phase 1 完全不改运行时代码
- `.gitignore` — `scripts/bos-recon/output/` 和 `*.xel` 已在

---

## Phase 1 Tasks

### Task 1: Scaffold bos-recon 目录 + cli skeleton + package.json scripts

**Files:**
- Create: `scripts/bos-recon/cli.ts`
- Create: `scripts/bos-recon/README.md`
- Modify: `package.json` (加 5 个 `recon:*` scripts)

**Why first:** 后续 Task 2-5 的 subcommand 函数需要挂到 cli 上;先铺 skeleton 让每加一个 subcommand 都能立刻 `pnpm recon:xxx` 验证。

- [ ] **Step 1: 创建 cli.ts skeleton**

```typescript
// scripts/bos-recon/cli.ts
/**
 * bos-recon CLI — 开发环境 BOS 侦察工具链入口。
 *
 * 用法: pnpm recon:<subcommand> -- [args]
 * subcommands: snapshot-before / xe-start / xe-stop / snapshot-after / diff
 *
 * 每个 subcommand 的具体 args 由各自的模块负责;本入口只做路由。
 */

type Subcommand =
  | 'snapshot-before'
  | 'xe-start'
  | 'xe-stop'
  | 'snapshot-after'
  | 'diff';

const KNOWN: readonly Subcommand[] = [
  'snapshot-before',
  'xe-start',
  'xe-stop',
  'snapshot-after',
  'diff'
] as const;

function isSubcommand(s: string): s is Subcommand {
  return (KNOWN as readonly string[]).includes(s);
}

async function main(): Promise<void> {
  const [, , sub, ...rest] = process.argv;
  if (!sub || !isSubcommand(sub)) {
    console.error(
      `usage: pnpm recon:<subcommand> -- [args]\n` +
        `  subcommands: ${KNOWN.join(' / ')}`
    );
    process.exit(2);
  }
  // TODO: route to subcommand modules in follow-up tasks.
  console.log(`[bos-recon] subcommand=${sub} args=${JSON.stringify(rest)}`);
}

main().catch((err) => {
  console.error('[bos-recon] error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
```

- [ ] **Step 2: 创建 README.md 操作手册**

```markdown
# bos-recon — BOS 侦察工具链 (dev-only)

对 K/3 Cloud BOS Designer 操作做"前后快照 + XE trace"双路侦察,
产出 🟢 实证的 SQL/XML delta 蓝图。

## 前置

- Windows + 已装 SQL Server (K/3 Cloud 连的那个)
- 连接该 SQL Server 的账号有 `ALTER ANY EVENT SESSION` 或 sysadmin 权限
- OpenDeploy 里已建好对应 K/3 Cloud 项目且能连通 (`~/.opendeploy/settings.json` 里有这个项目)
- 目标扩展 FID 已知 (通过 `kingdee_list_extensions` 或 BOS Designer 里看)

## 操作流程

1. 从 `~/.opendeploy/settings.json` 找到目标项目 ID (projects[].id)
2. 跑 before snapshot:
   ```bash
   pnpm recon:snapshot-before -- --project <pid> --ext-id <fid> --label add-text-field
   ```
3. 启 XE session:
   ```bash
   pnpm recon:xe-start -- --project <pid> --label add-text-field
   ```
4. 在 BOS Designer 里做你要侦察的操作 (加字段 / 业务规则 / ...)
5. 操作完,停 XE + 拉 trace:
   ```bash
   pnpm recon:xe-stop -- --project <pid> --label add-text-field
   ```
6. 跑 after snapshot:
   ```bash
   pnpm recon:snapshot-after -- --project <pid> --ext-id <fid> --label add-text-field
   ```
7. 生成 report:
   ```bash
   pnpm recon:diff -- --label add-text-field
   ```
8. `scripts/bos-recon/output/<label>-report.md` 就是侦察产出

## 产出的文件结构

```
scripts/bos-recon/output/
├── <label>-before.json       # snapshot 前 (所有 T_META_* 里匹配 extId 的行)
├── <label>-after.json        # snapshot 后
├── <label>-trace.xel         # SQL Server XE 原始 trace
├── <label>-trace.json        # 解析后的 SQL 事件数组
└── <label>-report.md         # 人类可读的综合 report
```

## 安全 / 合规

- `scripts/bos-recon/output/**` 在 .gitignore 里,不会误提交
- 连接密码从 `~/.opendeploy/settings.json` 读,不在 CLI 参数传明文
- XE target 写文件需要 SQL Server 服务账号对目标目录有写权限 (通常 `C:\ProgramData\...\xe-traces\`)
```

- [ ] **Step 3: 修改 package.json 加 5 个 scripts**

在 `"scripts"` 对象里(紧接 `"agent:chat"` 后)加:

```json
"recon:snapshot-before": "tsx --tsconfig tsconfig.node.json scripts/bos-recon/cli.ts snapshot-before",
"recon:xe-start": "tsx --tsconfig tsconfig.node.json scripts/bos-recon/cli.ts xe-start",
"recon:xe-stop": "tsx --tsconfig tsconfig.node.json scripts/bos-recon/cli.ts xe-stop",
"recon:snapshot-after": "tsx --tsconfig tsconfig.node.json scripts/bos-recon/cli.ts snapshot-after",
"recon:diff": "tsx --tsconfig tsconfig.node.json scripts/bos-recon/cli.ts diff"
```

- [ ] **Step 4: 验证 CLI skeleton**

运行:

```bash
pnpm recon:snapshot-before -- --foo bar
```

Expected output:
```
[bos-recon] subcommand=snapshot-before args=["--foo","bar"]
```

再跑一次不带参数:
```bash
pnpm recon:snapshot-before
```

Expected output 到 stderr (non-zero exit):
```
usage: pnpm recon:<subcommand> -- [args]
  subcommands: snapshot-before / xe-start / xe-stop / snapshot-after / diff
```

- [ ] **Step 5: Commit**

```bash
git add scripts/bos-recon/cli.ts scripts/bos-recon/README.md package.json
git commit -m "feat(recon): scaffold bos-recon CLI skeleton + 5 pnpm scripts"
```

---

### Task 2: config.ts — 从 ~/.opendeploy/settings.json 读连接配置

**Files:**
- Create: `scripts/bos-recon/config.ts`
- Create: `tests/scripts/bos-recon/config.test.ts`

**Why:** 所有其他 subcommand 都需要连 SQL Server。不重新发明连接配置,复用产品那套 `K3CloudConnectionConfig` 的解析逻辑(`src/main/erp/k3cloud/connector.ts` 里有参考)。

- [ ] **Step 1: 写 failing test**

```typescript
// tests/scripts/bos-recon/config.test.ts
import { describe, it, expect } from 'vitest';
import { resolveProjectConfig } from '../../../scripts/bos-recon/config';

describe('resolveProjectConfig', () => {
  it('reads project config from a settings.json shape', () => {
    // 与 src/shared/erp-types.ts `Project.connection: K3CloudConnectionConfig` 对齐:
    //   顶层是 `connection` (不是 `k3cloud`), 字段名是 `server` (不是 `host`)。
    const fakeSettings = {
      projects: [
        {
          id: 'proj-uat',
          erpProvider: 'k3cloud',
          connection: {
            server: 'localhost',
            port: 1433,
            database: 'AIS20260101',
            user: 'sa',
            password: 'Test@123',
            encrypt: true,
            trustServerCertificate: true
          }
        }
      ]
    };
    const cfg = resolveProjectConfig(fakeSettings, 'proj-uat');
    expect(cfg.database).toBe('AIS20260101');
    expect(cfg.server).toBe('localhost');
    expect(cfg.port).toBe(1433);
    expect(cfg.user).toBe('sa');
    expect(cfg.password).toBe('Test@123');
    expect(cfg.options?.encrypt).toBe(true);
  });

  it('throws when projectId not found', () => {
    const fakeSettings = {
      projects: [{ id: 'proj-a', erpProvider: 'k3cloud', connection: {} }]
    };
    expect(() => resolveProjectConfig(fakeSettings, 'missing')).toThrow(
      /project "missing" not found/
    );
  });

  it('throws when project is not a k3cloud project', () => {
    const fakeSettings = {
      projects: [{ id: 'proj-a', erpProvider: 'sap' }]
    };
    expect(() => resolveProjectConfig(fakeSettings, 'proj-a')).toThrow(
      /erpProvider "sap" not supported/
    );
  });
});
```

- [ ] **Step 2: 运行测试确认 FAIL**

```bash
pnpm vitest run tests/scripts/bos-recon/config.test.ts
```

Expected: FAIL — `Cannot find module '../../../scripts/bos-recon/config'`

- [ ] **Step 3: 实现 config.ts**

```typescript
// scripts/bos-recon/config.ts
/**
 * 从 OpenDeploy 产品的 settings.json 里按 projectId 解析出 mssql 连接配置,
 * 给 recon scripts 复用 —— 避免把密码放到 CLI 参数里。
 *
 * 目前只支持 k3cloud provider;其他 ERP 将来加 recon 支持时在这里分派。
 */

import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type sql from 'mssql';

export interface ReconMssqlConfig {
  server: string;
  port: number;
  database: string;
  user: string;
  password: string;
  options?: sql.config['options'];
}

/**
 * 对齐 src/shared/erp-types.ts 的 `K3CloudConnectionConfig` 形状 ——
 * 顶层 key 是 `connection`(不是 `k3cloud`), 字段名是 `server`(不是 `host`)。
 * 所有字段在这里都声明为 optional 做防御式解析, 但产品正常写入的 settings.json
 * server/database/user/password 都有值; 默认只在理论上兜底。
 */
interface RawConnection {
  server?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  encrypt?: boolean;
  trustServerCertificate?: boolean;
}

interface RawProject {
  id: string;
  erpProvider?: string;
  connection?: RawConnection;
}

interface RawSettings {
  projects?: RawProject[];
}

export function resolveProjectConfig(
  settings: RawSettings,
  projectId: string
): ReconMssqlConfig {
  const p = (settings.projects ?? []).find((x) => x.id === projectId);
  if (!p) throw new Error(`project "${projectId}" not found in settings`);
  if (p.erpProvider !== 'k3cloud') {
    throw new Error(`erpProvider "${p.erpProvider}" not supported by bos-recon`);
  }
  const c = p.connection ?? {};
  return {
    server: c.server ?? 'localhost',
    port: c.port ?? 1433,
    database: c.database ?? '',
    user: c.user ?? '',
    password: c.password ?? '',
    options: {
      encrypt: c.encrypt ?? true,
      trustServerCertificate: c.trustServerCertificate ?? true
    }
  };
}

export function opendeploySettingsPath(): string {
  return path.join(os.homedir(), '.opendeploy', 'settings.json');
}

export async function loadSettings(): Promise<RawSettings> {
  const raw = await readFile(opendeploySettingsPath(), 'utf-8');
  return JSON.parse(raw) as RawSettings;
}
```

- [ ] **Step 4: 运行测试确认 PASS**

```bash
pnpm vitest run tests/scripts/bos-recon/config.test.ts
```

Expected: `3 passed`

- [ ] **Step 5: Commit**

```bash
git add scripts/bos-recon/config.ts tests/scripts/bos-recon/config.test.ts
git commit -m "feat(recon): config.ts — 从 settings.json 解析 projectId → mssql 配置"
```

---

### Task 3: xe-session.ts — XE session 启停 T-SQL 生成器

**Files:**
- Create: `scripts/bos-recon/xe-session.ts`
- Create: `tests/scripts/bos-recon/xe-session.test.ts`

**Why:** XE session 的 T-SQL 是**可测纯函数** —— 给 session name + filename 返 CREATE/DROP 语句。把 SQL 构造和 DB 执行分开,SQL 拼接 bug 在单测里就能抓。执行侧(connection + exec)留给 cli.ts 驱动。

- [ ] **Step 1: 写 failing test**

```typescript
// tests/scripts/bos-recon/xe-session.test.ts
import { describe, it, expect } from 'vitest';
import {
  buildDropSessionSQL,
  buildCreateSessionSQL,
  buildStartSessionSQL,
  buildStopSessionSQL,
  buildReadXelFileSQL
} from '../../../scripts/bos-recon/xe-session';

describe('xe-session SQL builders', () => {
  it('buildDropSessionSQL emits idempotent drop', () => {
    const sql = buildDropSessionSQL('opendeploy_bos_recon');
    expect(sql).toMatch(/IF EXISTS/i);
    expect(sql).toMatch(/DROP EVENT SESSION \[opendeploy_bos_recon\] ON SERVER/);
  });

  it('buildCreateSessionSQL includes statement_completed + actions + file target', () => {
    const sql = buildCreateSessionSQL({
      sessionName: 'opendeploy_bos_recon',
      xelPath: 'C:\\traces\\add-text-field.xel'
    });
    expect(sql).toMatch(/CREATE EVENT SESSION \[opendeploy_bos_recon\] ON SERVER/);
    expect(sql).toMatch(/sqlserver\.sp_statement_completed/);
    expect(sql).toMatch(/sqlserver\.sql_batch_completed/);
    expect(sql).toMatch(/sqlserver\.sql_text/);
    expect(sql).toMatch(/sqlserver\.client_app_name/);
    expect(sql).toMatch(/event_file/);
    // T-SQL 字面量无反斜杠转义 —— Windows 路径原样插入。
    expect(sql).toMatch(/C:\\traces\\add-text-field\.xel/);
  });

  it('buildReadXelFileSQL emits SELECT from fn_xe_file_target_read_file', () => {
    const sql = buildReadXelFileSQL('C:\\traces\\add-text-field.xel');
    expect(sql).toMatch(/SELECT CAST\(event_data AS xml\) AS event_xml/);
    expect(sql).toMatch(/sys\.fn_xe_file_target_read_file/);
    expect(sql).toMatch(/N'C:\\traces\\add-text-field\.xel'/);
    expect(sql).toMatch(/NULL, NULL, NULL/);
  });

  it('buildReadXelFileSQL rejects path with single quote', () => {
    expect(() => buildReadXelFileSQL("C:\\evil'; xp_cmdshell--")).toThrow(/invalid/i);
  });

  it('buildCreateSessionSQL does NOT add client_app_name filter in Phase 1', () => {
    const sql = buildCreateSessionSQL({
      sessionName: 'opendeploy_bos_recon',
      xelPath: 'C:\\traces\\x.xel'
    });
    expect(sql).not.toMatch(/WHERE client_app_name/);
  });

  it('buildStartSessionSQL emits STATE=START', () => {
    const sql = buildStartSessionSQL('opendeploy_bos_recon');
    expect(sql).toMatch(
      /ALTER EVENT SESSION \[opendeploy_bos_recon\] ON SERVER STATE\s*=\s*START/
    );
  });

  it('buildStopSessionSQL emits STATE=STOP', () => {
    const sql = buildStopSessionSQL('opendeploy_bos_recon');
    expect(sql).toMatch(
      /ALTER EVENT SESSION \[opendeploy_bos_recon\] ON SERVER STATE\s*=\s*STOP/
    );
  });

  it('xelPath with single quote throws (prevent T-SQL injection)', () => {
    expect(() =>
      buildCreateSessionSQL({
        sessionName: 'x',
        xelPath: "C:\\evil'; DROP TABLE-- "
      })
    ).toThrow(/invalid/i);
  });
});
```

- [ ] **Step 2: 运行测试确认 FAIL**

```bash
pnpm vitest run tests/scripts/bos-recon/xe-session.test.ts
```

Expected: FAIL — `Cannot find module '../../../scripts/bos-recon/xe-session'`

- [ ] **Step 3: 实现 xe-session.ts**

```typescript
// scripts/bos-recon/xe-session.ts
/**
 * Extended Events session 的 T-SQL 生成器。
 *
 * Phase 1 策略 (由 spec §5.3 决定):
 *   - 不加 client_app_name filter (先看原始 trace 体积是否可接受)
 *   - target 用 event_file (.xel 持久化到磁盘, 不用 ring_buffer 以防丢事件)
 *   - 抓 sp_statement_completed + sql_batch_completed (BOS Designer 的语句
 *     大部分是 stored-proc 或 batched SQL)
 *   - actions: sql_text / session_id / client_app_name / database_name /
 *     tsql_stack (后 4 个用来在 diff 对账阶段区分多客户端)
 *
 * SQL 构造是纯函数 (可测),DB 执行由 cli.ts 驱动。
 */

export interface CreateSessionOptions {
  sessionName: string;
  xelPath: string;
}

/** 合法 xel 路径: Windows 路径 + 非引号字符。单引号会破坏 T-SQL 字符串。 */
function assertSafeXelPath(xelPath: string): void {
  if (/['\x00-\x1f]/.test(xelPath)) {
    throw new Error(`invalid xel path: must not contain quotes or control chars`);
  }
}

/** SQL Server identifier: 字母 + 数字 + 下划线。防止被当作表达式。 */
function assertSafeSessionName(name: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`invalid session name: ${name}`);
  }
}

export function buildDropSessionSQL(sessionName: string): string {
  assertSafeSessionName(sessionName);
  return (
    `IF EXISTS (SELECT 1 FROM sys.server_event_sessions WHERE name = N'${sessionName}')\n` +
    `  DROP EVENT SESSION [${sessionName}] ON SERVER;`
  );
}

export function buildCreateSessionSQL(opts: CreateSessionOptions): string {
  assertSafeSessionName(opts.sessionName);
  assertSafeXelPath(opts.xelPath);
  return [
    `CREATE EVENT SESSION [${opts.sessionName}] ON SERVER`,
    `ADD EVENT sqlserver.sp_statement_completed(`,
    `  ACTION(sqlserver.sql_text, sqlserver.session_id, sqlserver.client_app_name, sqlserver.database_name, sqlserver.tsql_stack)`,
    `),`,
    `ADD EVENT sqlserver.sql_batch_completed(`,
    `  ACTION(sqlserver.sql_text, sqlserver.session_id, sqlserver.client_app_name, sqlserver.database_name, sqlserver.tsql_stack)`,
    `)`,
    `ADD TARGET package0.event_file(SET filename = N'${opts.xelPath}', max_file_size = 50)`,
    `WITH (MAX_MEMORY = 4096 KB, EVENT_RETENTION_MODE = ALLOW_SINGLE_EVENT_LOSS,`,
    `      MAX_DISPATCH_LATENCY = 5 SECONDS, STARTUP_STATE = OFF);`
  ].join('\n');
}

export function buildStartSessionSQL(sessionName: string): string {
  assertSafeSessionName(sessionName);
  return `ALTER EVENT SESSION [${sessionName}] ON SERVER STATE = START;`;
}

export function buildStopSessionSQL(sessionName: string): string {
  assertSafeSessionName(sessionName);
  return `ALTER EVENT SESSION [${sessionName}] ON SERVER STATE = STOP;`;
}

/** 
 * `sys.fn_xe_file_target_read_file` 按 .xel 路径读出所有 event_data XML 行。
 * 传 NULL 给后 3 个 offset/bookmark 参数让 SQL Server 自己处理未 flush 的 buffer。
 */
export function buildReadXelFileSQL(xelPath: string): string {
  assertSafeXelPath(xelPath);
  return (
    `SELECT CAST(event_data AS xml) AS event_xml\n` +
    `  FROM sys.fn_xe_file_target_read_file(N'${xelPath}', NULL, NULL, NULL)`
  );
}
```

- [ ] **Step 4: 运行测试确认 PASS**

```bash
pnpm vitest run tests/scripts/bos-recon/xe-session.test.ts
```

Expected: `8 passed`

- [ ] **Step 5: Commit**

```bash
git add scripts/bos-recon/xe-session.ts tests/scripts/bos-recon/xe-session.test.ts
git commit -m "feat(recon): xe-session.ts — XE session 启停 T-SQL 生成器 + 单测"
```

---

### Task 4: xe-parse.ts — `.xel` 事件 XML → SQL 事件数组

**Files:**
- Create: `scripts/bos-recon/xe-parse.ts`
- Create: `tests/scripts/bos-recon/xe-parse.test.ts`

**Why:** `.xel` 文件读出来的每行 event_data 是一段 XML,形如 `<event name="..."><data name="statement"><value>...</value></data><action name="sql_text">...</action>...`。解析出 `{ stmt, duration, sessionId, clientApp, timestamp }` 数组是纯函数,可喂 fixture 测。

- [ ] **Step 1: 写 failing test + fixture**

```typescript
// tests/scripts/bos-recon/xe-parse.test.ts
import { describe, it, expect } from 'vitest';
import { parseXelEventXml, normalizeEvents } from '../../../scripts/bos-recon/xe-parse';

/** 
 * 一个真实 sp_statement_completed 事件的简化形态。
 * duration 单位微秒, timestamp ISO 8601。
 */
const FIXTURE_EVENT_XML = `
<event name="sp_statement_completed" package="sqlserver" timestamp="2026-04-24T15:00:01.123Z">
  <data name="duration"><value>4567</value></data>
  <data name="statement"><value>INSERT INTO T_META_FIELD (FID, FKEY) VALUES ('abc', 'F_TEST')</value></data>
  <action name="sql_text" package="sqlserver"><value>INSERT INTO T_META_FIELD (FID, FKEY) VALUES ('abc', 'F_TEST')</value></action>
  <action name="session_id" package="sqlserver"><value>57</value></action>
  <action name="client_app_name" package="sqlserver"><value>Kingdee.BOS.Designer</value></action>
  <action name="database_name" package="sqlserver"><value>AIS20260101</value></action>
</event>
`;

describe('parseXelEventXml', () => {
  it('extracts statement / duration / sessionId / clientApp / ts', () => {
    const ev = parseXelEventXml(FIXTURE_EVENT_XML);
    expect(ev).not.toBeNull();
    expect(ev!.name).toBe('sp_statement_completed');
    expect(ev!.stmt).toContain('INSERT INTO T_META_FIELD');
    expect(ev!.duration).toBe(4567);
    expect(ev!.sessionId).toBe('57');
    expect(ev!.clientApp).toBe('Kingdee.BOS.Designer');
    expect(ev!.database).toBe('AIS20260101');
    expect(ev!.timestamp).toBe('2026-04-24T15:00:01.123Z');
  });

  it('returns null for malformed xml', () => {
    expect(parseXelEventXml('<not-an-event>')).toBeNull();
  });

  it('handles XML-escaped SQL (quotes / <>)', () => {
    const xml = `
<event name="sql_batch_completed" package="sqlserver" timestamp="2026-04-24T15:00:02.000Z">
  <data name="batch_text"><value>SELECT &apos;a &lt; b&apos; FROM T_META_OBJECTTYPE WHERE FID = &quot;abc&quot;</value></data>
  <action name="session_id" package="sqlserver"><value>57</value></action>
</event>
`;
    const ev = parseXelEventXml(xml);
    expect(ev!.stmt).toBe(`SELECT 'a < b' FROM T_META_OBJECTTYPE WHERE FID = "abc"`);
  });
});

describe('normalizeEvents', () => {
  it('filters out our own recon SELECTs (reading sys.fn_xe_file_target_read_file)', () => {
    const events = [
      { name: 'sp_statement_completed', stmt: 'SELECT * FROM sys.fn_xe_file_target_read_file(N\'x\')', duration: 1, sessionId: '1', clientApp: null, database: null, timestamp: '' },
      { name: 'sp_statement_completed', stmt: 'INSERT INTO T_META_FIELD VALUES(...)', duration: 1, sessionId: '2', clientApp: 'BOS', database: 'AIS20260101', timestamp: '' }
    ];
    const cleaned = normalizeEvents(events);
    expect(cleaned).toHaveLength(1);
    expect(cleaned[0].stmt).toContain('T_META_FIELD');
  });

  it('sorts events by timestamp ascending', () => {
    const events = [
      { name: 'x', stmt: 'B', duration: 1, sessionId: '1', clientApp: null, database: null, timestamp: '2026-04-24T15:00:02.000Z' },
      { name: 'x', stmt: 'A', duration: 1, sessionId: '1', clientApp: null, database: null, timestamp: '2026-04-24T15:00:01.000Z' }
    ];
    const sorted = normalizeEvents(events);
    expect(sorted.map((e) => e.stmt)).toEqual(['A', 'B']);
  });
});
```

- [ ] **Step 2: 运行测试确认 FAIL**

```bash
pnpm vitest run tests/scripts/bos-recon/xe-parse.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: 实现 xe-parse.ts**

```typescript
// scripts/bos-recon/xe-parse.ts
/**
 * 把 .xel 文件一行 event_data XML 解析成结构化 XeEvent,
 * 以及把一批事件做归一化 (过滤自己的 recon SELECT + 按时间排序)。
 *
 * 解析用正则抽取 —— event XML 结构固定,专门上 xml 库 (fast-xml-parser)
 * 是 YAGNI。和 bos-xml.ts 同风格 (它也是手写 tokenizer)。
 */

export interface XeEvent {
  /** 事件名 (sp_statement_completed / sql_batch_completed) */
  name: string;
  /** 实际 SQL 文本 (action=sql_text 或 data=statement / batch_text) */
  stmt: string;
  /** 微秒 */
  duration: number;
  sessionId: string;
  clientApp: string | null;
  database: string | null;
  /** event 属性里的 timestamp (ISO 8601) */
  timestamp: string;
}

function xmlUnescape(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * 从 XML 里抽 <data name="X">...<value>...</value>...</data> 或 <action> 同理。
 *
 * SQL Server 的 `CAST(event_data AS xml)` 对强类型列(duration=uint64 等)会
 * 在 <value> 前面序列化 <type name="..."/> 描述符:
 *   <data name="duration">
 *     <type name="uint64" package="package0"/>
 *     <value>4567</value>
 *   </data>
 * 所以匹配用 `[\s\S]*?` 懒匹配跳过任意中间子元素, 而不是只允许 `\s*`。
 */
function extractField(xml: string, tag: 'data' | 'action', name: string): string | null {
  const re = new RegExp(
    `<${tag}\\s+name="${name}"[^>]*>[\\s\\S]*?<value>([\\s\\S]*?)<\\/value>`,
    'i'
  );
  const m = xml.match(re);
  return m ? xmlUnescape(m[1]) : null;
}

/** 第一个非空字符串, 全都 null/空则返 ''。?? 不会在空字符串时 fallback, 这个函数会。 */
function firstNonEmpty(...xs: (string | null)[]): string {
  for (const x of xs) if (x !== null && x.trim() !== '') return x;
  return '';
}

export function parseXelEventXml(eventXml: string): XeEvent | null {
  const nameMatch = eventXml.match(/<event\s+name="([^"]+)"/);
  if (!nameMatch) return null;
  const name = nameMatch[1];
  const tsMatch = eventXml.match(/<event[^>]+timestamp="([^"]+)"/);
  const timestamp = tsMatch ? tsMatch[1] : '';

  // statement 可能在 data (sp_statement_completed) 或 batch_text (sql_batch_completed)。
  // action=sql_text 有时覆盖完整语句。优先 action, fallback data 顺序;
  // firstNonEmpty 保证空字符串也会穿透到下一个候选(?? 只在 null 时穿透)。
  const stmt = firstNonEmpty(
    extractField(eventXml, 'action', 'sql_text'),
    extractField(eventXml, 'data', 'statement'),
    extractField(eventXml, 'data', 'batch_text')
  );

  const durationText = extractField(eventXml, 'data', 'duration');
  const duration = durationText ? Number(durationText) : 0;

  const sessionId = extractField(eventXml, 'action', 'session_id') ?? '';
  const clientApp = extractField(eventXml, 'action', 'client_app_name');
  const database = extractField(eventXml, 'action', 'database_name');

  return { name, stmt, duration, sessionId, clientApp, database, timestamp };
}

/**
 * - 过滤我们自己 recon scripts 发的 SQL (查 sys.fn_xe_file_target_read_file 的那条)
 * - 过滤空 stmt
 * - 按 timestamp 升序
 *
 * 不做 dedup (同一 INSERT 跑多次也全留, BOS Designer 偶尔会内部重发)。
 */
export function normalizeEvents(events: XeEvent[]): XeEvent[] {
  return events
    .filter((e) => e.stmt.trim() !== '')
    .filter((e) => !/sys\.fn_xe_file_target_read_file/i.test(e.stmt))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}
```

- [ ] **Step 4: 运行测试确认 PASS**

```bash
pnpm vitest run tests/scripts/bos-recon/xe-parse.test.ts
```

Expected: `7 passed` (5 原始 + 2 回归: `<type>` 子元素 + sql_text 空串 fallback)

- [ ] **Step 5: Commit**

```bash
git add scripts/bos-recon/xe-parse.ts tests/scripts/bos-recon/xe-parse.test.ts
git commit -m "feat(recon): xe-parse.ts — .xel event XML → XeEvent[] 归一化"
```

---

### Task 5: snapshot-all.ts — 广撒网 snapshot + 过滤

**Files:**
- Create: `scripts/bos-recon/snapshot-all.ts`
- Create: `tests/scripts/bos-recon/snapshot-all.test.ts`

**Why:** snapshot 要扫 `T_META_*` 所有表 + 按候选键 (`FID` / `FOBJECTTYPEID` / `FBILLFORMID` / `FENTRYID` / `FBASEOBJECTID`) 过滤到扩展 FID。**候选键挑选是纯函数** (给表的列清单 + 候选键,返有匹配的列名),可测。执行侧 (连 DB + WHERE 过滤 + JSON 输出) 是薄壳。

- [ ] **Step 1: 写 failing test**

```typescript
// tests/scripts/bos-recon/snapshot-all.test.ts
import { describe, it, expect } from 'vitest';
import {
  pickMatchingKeyColumn,
  buildSnapshotSelectSQL,
  CANDIDATE_KEY_COLUMNS,
  NOISE_COLUMN_BLACKLIST
} from '../../../scripts/bos-recon/snapshot-all';

describe('pickMatchingKeyColumn', () => {
  it('prefers FID when table has it', () => {
    const col = pickMatchingKeyColumn(['FID', 'FOBJECTTYPEID', 'FMODIFYDATE']);
    expect(col).toBe('FID');
  });

  it('falls back to FOBJECTTYPEID when no FID', () => {
    const col = pickMatchingKeyColumn(['FOBJECTTYPEID', 'FNAME']);
    expect(col).toBe('FOBJECTTYPEID');
  });

  it('returns null when table has no candidate key column', () => {
    const col = pickMatchingKeyColumn(['FFOO', 'FBAR']);
    expect(col).toBeNull();
  });

  it('exposes CANDIDATE_KEY_COLUMNS ordered by preference', () => {
    expect(CANDIDATE_KEY_COLUMNS[0]).toBe('FID');
    expect(CANDIDATE_KEY_COLUMNS).toContain('FOBJECTTYPEID');
    expect(CANDIDATE_KEY_COLUMNS).toContain('FBILLFORMID');
    expect(CANDIDATE_KEY_COLUMNS).toContain('FENTRYID');
    expect(CANDIDATE_KEY_COLUMNS).toContain('FBASEOBJECTID');
  });
});

describe('buildSnapshotSelectSQL', () => {
  it('builds parameterized SELECT *', () => {
    const sql = buildSnapshotSelectSQL('T_META_FIELD', 'FID');
    expect(sql).toBe('SELECT * FROM T_META_FIELD WHERE FID = @v');
  });

  it('rejects unsafe table name (防 SQL 注入)', () => {
    expect(() => buildSnapshotSelectSQL("T_META; DROP TABLE X--", 'FID')).toThrow();
  });

  it('rejects unsafe column name', () => {
    expect(() => buildSnapshotSelectSQL('T_META_X', "FID; 1=1--")).toThrow();
  });
});

describe('NOISE_COLUMN_BLACKLIST', () => {
  it('excludes obvious audit cols that churn on every read', () => {
    expect(NOISE_COLUMN_BLACKLIST).toContain('FMODIFYDATE');
    expect(NOISE_COLUMN_BLACKLIST).toContain('FCREATEDATE');
  });
});
```

- [ ] **Step 2: 运行测试确认 FAIL**

```bash
pnpm vitest run tests/scripts/bos-recon/snapshot-all.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: 实现 snapshot-all.ts**

```typescript
// scripts/bos-recon/snapshot-all.ts
/**
 * 广撒网 snapshot —— 扫所有 T_META_* 表, 每张按"首个可用候选键列"过滤到
 * 给定扩展 FID, 把匹配的行 dump 到 JSON。
 *
 * 候选键优先级 (由 BOS 表设计规律归纳, spec §4.1 + bos-backup.ts 已有
 * 8 张表的经验):
 *   1. FID            主键, 大多数 T_META_OBJECTTYPE* 走这个
 *   2. FOBJECTTYPEID  外键指向扩展, TRACKERBILLTABLE / OBJECTTYPEREF 走这个
 *   3. FBILLFORMID    字段 / 控件表可能用这个名
 *   4. FENTRYID       OBJECTTYPENAMEEX* 走这个 (同 FID 但字段名不同)
 *   5. FBASEOBJECTID  指向父单据的外键, 预留候选
 */

import sql from 'mssql';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

export const CANDIDATE_KEY_COLUMNS: readonly string[] = [
  'FID',
  'FOBJECTTYPEID',
  'FBILLFORMID',
  'FENTRYID',
  'FBASEOBJECTID'
] as const;

/** 这些列几乎每次读都会变,diff 阶段直接剔除,减少噪声。 */
export const NOISE_COLUMN_BLACKLIST: readonly string[] = [
  'FMODIFYDATE',
  'FCREATEDATE',
  'FMODIFIERID',
  'FCOMPUTERINFO',
  'FVERSION',
  'FMAINVERSION'
] as const;

function isSafeIdentifier(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name);
}

/**
 * 已知扩展表的"链接列"硬覆盖映射 —— mirror src/main/erp/k3cloud/bos-backup.ts 的 KEY_COLUMN。
 * 有些表同时有 FID (行 PK) 和 FOBJECTTYPEID (指向扩展的外键),
 * 纯启发式会挑 FID → 0 行 → 误归 emptyTables。override 保证挑对列。
 */
export const KNOWN_EXTENSION_LINK: Record<string, string> = {
  T_META_OBJECTTYPE: 'FID',
  T_META_OBJECTTYPE_L: 'FID',
  T_META_OBJECTTYPE_E: 'FID',
  T_META_OBJECTTYPENAMEEX: 'FENTRYID',
  T_META_OBJECTTYPENAMEEX_L: 'FENTRYID',
  T_META_OBJECTFUNCINTERFACE: 'FID',
  T_META_OBJECTTYPEREF: 'FOBJECTTYPEID',
  T_META_TRACKERBILLTABLE: 'FOBJECTTYPEID'
};

export function pickMatchingKeyColumn(columns: string[]): string | null {
  const set = new Set(columns.map((c) => c.toUpperCase()));
  for (const candidate of CANDIDATE_KEY_COLUMNS) {
    if (set.has(candidate)) return candidate;
  }
  return null;
}

/** 优先用已知映射, fallback 启发式; 还要验证 override 列真存在。 */
export function pickKeyForTable(tableName: string, columns: string[]): string | null {
  const override = KNOWN_EXTENSION_LINK[tableName];
  if (override) {
    const upperCols = new Set(columns.map((c) => c.toUpperCase()));
    if (upperCols.has(override)) return override;
  }
  return pickMatchingKeyColumn(columns);
}

export function buildSnapshotSelectSQL(tableName: string, keyColumn: string): string {
  if (!isSafeIdentifier(tableName)) throw new Error(`unsafe table name: ${tableName}`);
  if (!isSafeIdentifier(keyColumn)) throw new Error(`unsafe column name: ${keyColumn}`);
  return `SELECT * FROM ${tableName} WHERE ${keyColumn} = @v`;
}

const LIST_META_TABLES_SQL = `
  SELECT name FROM sys.tables WHERE name LIKE 'T_META[_]%' ORDER BY name
`;

const LIST_COLS_SQL = `
  SELECT name FROM sys.columns WHERE object_id = OBJECT_ID(@t) ORDER BY column_id
`;

/** Binary → 长度 marker,避免 JSON 爆炸 (沿用 bos-backup.stripBinary 的形状)。 */
function stripBinary(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (Buffer.isBuffer(v)) out[k] = { __binary: true, bytes: v.length };
    else out[k] = v;
  }
  return out;
}

export interface SnapshotResult {
  /** 扫的 T_META_* 总表数 */
  scannedTables: number;
  /** 没有任何候选键列的表 (跳过, 计入 unmatched) */
  unmatchedTables: string[];
  /** 有候选键但对给定 extId 无行的表 */
  emptyTables: string[];
  /** 有行的表, key = 表名, value = 行数组 */
  tables: Record<string, Record<string, unknown>[]>;
}

export async function snapshotAllMeta(
  pool: sql.ConnectionPool,
  extId: string
): Promise<SnapshotResult> {
  const tablesRes = await pool.request().query<{ name: string }>(LIST_META_TABLES_SQL);
  const allTables = tablesRes.recordset.map((r) => r.name);

  const unmatchedTables: string[] = [];
  const emptyTables: string[] = [];
  const tables: Record<string, Record<string, unknown>[]> = {};

  for (const tableName of allTables) {
    const colsRes = await pool
      .request()
      .input('t', sql.VarChar(128), tableName)
      .query<{ name: string }>(LIST_COLS_SQL);
    const columns = colsRes.recordset.map((r) => r.name);
    const keyColumn = pickKeyForTable(tableName, columns);

    if (keyColumn === null) {
      unmatchedTables.push(tableName);
      continue;
    }

    const selectSQL = buildSnapshotSelectSQL(tableName, keyColumn);
    const rows = await pool
      .request()
      .input('v', sql.VarChar(64), extId)
      .query<Record<string, unknown>>(selectSQL);

    if (rows.recordset.length === 0) {
      emptyTables.push(tableName);
    } else {
      tables[tableName] = rows.recordset.map(stripBinary);
    }
  }

  return {
    scannedTables: allTables.length,
    unmatchedTables,
    emptyTables,
    tables
  };
}

export async function writeSnapshotJson(
  outputDir: string,
  label: string,
  which: 'before' | 'after',
  snapshot: SnapshotResult
): Promise<string> {
  await mkdir(outputDir, { recursive: true });
  const filePath = path.join(outputDir, `${label}-${which}.json`);
  await writeFile(filePath, JSON.stringify(snapshot, null, 2), 'utf-8');
  return filePath;
}
```

- [ ] **Step 4: 运行测试确认 PASS**

```bash
pnpm vitest run tests/scripts/bos-recon/snapshot-all.test.ts
```

Expected: `14 passed` (原 8 + pickKeyForTable 5 + KNOWN_EXTENSION_LINK 覆盖 1)

- [ ] **Step 5: Commit**

```bash
git add scripts/bos-recon/snapshot-all.ts tests/scripts/bos-recon/snapshot-all.test.ts
git commit -m "feat(recon): snapshot-all.ts — 广撒网 T_META_* snapshot + 候选键挑选"
```

---

### Task 6: diff.ts — 两 snapshot 语义 diff + XE 对账 + markdown report

**Files:**
- Create: `scripts/bos-recon/diff.ts`
- Create: `tests/scripts/bos-recon/diff.test.ts`

**Why:** 整个侦察的产出由这里决定 —— report 质量 == 侦察质量。核心逻辑全是纯函数,testable:
1. 表级行 diff (before vs after 按候选键 + 非噪声列 hash 找 added/modified/unchanged)
2. FKERNELXML 语义 diff (找 before/after 的 T_META_OBJECTTYPE 行的 FKERNELXML, 按 XML 子树结构 diff 而不是字符 diff)
3. XE trace 对账 (每处 snapshot 变化能不能在 XE 里找到解释它的 INSERT/UPDATE)
4. Markdown 渲染

- [ ] **Step 1: 写 failing test**

```typescript
// tests/scripts/bos-recon/diff.test.ts
import { describe, it, expect } from 'vitest';
import {
  computeTableRowDiff,
  hashRowExcludingNoise,
  formatRowAsTable,
  renderReportMarkdown
} from '../../../scripts/bos-recon/diff';

describe('hashRowExcludingNoise', () => {
  it('ignores noise columns so only semantic change bumps hash', () => {
    const h1 = hashRowExcludingNoise({ FID: 'x', FNAME: 'A', FMODIFYDATE: '2026-01-01' });
    const h2 = hashRowExcludingNoise({ FID: 'x', FNAME: 'A', FMODIFYDATE: '2026-99-99' });
    expect(h1).toBe(h2);
  });

  it('detects semantic change', () => {
    const h1 = hashRowExcludingNoise({ FID: 'x', FNAME: 'A' });
    const h2 = hashRowExcludingNoise({ FID: 'x', FNAME: 'B' });
    expect(h1).not.toBe(h2);
  });
});

describe('computeTableRowDiff', () => {
  it('classifies added / removed / modified / unchanged', () => {
    const before = [{ FID: 'a', FNAME: 'X' }, { FID: 'b', FNAME: 'Y' }];
    const after = [
      { FID: 'a', FNAME: 'X' },    // unchanged
      { FID: 'b', FNAME: 'Y2' },   // modified
      { FID: 'c', FNAME: 'Z' }     // added
    ];
    // removed: 'b' ... wait b still exists modified. add a real removed:
    // Add 'd' to before that disappears in after.
    const before2 = [...before, { FID: 'd', FNAME: 'W' }];
    const diff = computeTableRowDiff(before2, after, 'FID');
    expect(diff.added.map((r) => r.FID)).toEqual(['c']);
    expect(diff.removed.map((r) => r.FID)).toEqual(['d']);
    expect(diff.modified.map((r) => r.after.FID)).toEqual(['b']);
    expect(diff.unchanged).toHaveLength(1);
  });

  it('empty before + empty after = no changes', () => {
    const diff = computeTableRowDiff([], [], 'FID');
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.modified).toHaveLength(0);
  });

  it('missing key column in a row -> row listed as unidentifiable', () => {
    const diff = computeTableRowDiff([{ FID: 'a' }], [{ FOTHER: 'b' }], 'FID');
    expect(diff.unidentifiable).toHaveLength(1);
  });
});

describe('renderReportMarkdown', () => {
  it('includes sections: overview / changed tables / XE trace / unexplained', () => {
    const md = renderReportMarkdown({
      label: 'add-text-field',
      extId: 'ext-123',
      beforeJsonPath: 'add-text-field-before.json',
      afterJsonPath: 'add-text-field-after.json',
      xelPath: 'add-text-field-trace.xel',
      tableChanges: [
        { tableName: 'T_META_FIELD', added: 1, removed: 0, modified: 0 }
      ],
      xmlChanges: [
        { table: 'T_META_OBJECTTYPE', column: 'FKERNELXML', addedElements: ['<Field>...'], removedElements: [] }
      ],
      xeEvents: 7,
      unexplained: []
    });
    expect(md).toMatch(/# Recon report:/);
    expect(md).toMatch(/## Changed tables/);
    expect(md).toMatch(/T_META_FIELD/);
    expect(md).toMatch(/## FKERNELXML diff/);
    expect(md).toMatch(/## XE SQL trace/);
    expect(md).toMatch(/7 events/);
  });

  it('surfaces unexplained diffs prominently', () => {
    const md = renderReportMarkdown({
      label: 'x',
      extId: 'e',
      beforeJsonPath: '',
      afterJsonPath: '',
      xelPath: '',
      tableChanges: [],
      xmlChanges: [],
      xeEvents: 0,
      unexplained: ['T_META_CACHE: 1 row added but no XE INSERT found']
    });
    expect(md).toMatch(/⚠.*unexplained/i);
    expect(md).toMatch(/T_META_CACHE/);
  });
});

describe('formatRowAsTable', () => {
  it('renders a row as a markdown table', () => {
    const md = formatRowAsTable({ FID: 'x', FNAME: 'Test' });
    expect(md).toMatch(/\| column \| value \|/);
    expect(md).toMatch(/\| FID \| x \|/);
    expect(md).toMatch(/\| FNAME \| Test \|/);
  });
});
```

- [ ] **Step 2: 运行测试确认 FAIL**

```bash
pnpm vitest run tests/scripts/bos-recon/diff.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: 实现 diff.ts**

```typescript
// scripts/bos-recon/diff.ts
/**
 * 两 snapshot 的语义 diff + XE trace 对账 + markdown report 生成。
 *
 * - 行级 diff: 按候选键 (通常 FID) 匹配 before/after 行, 排除噪声列做 hash 比较
 * - XML 子树 diff: 专门抽 T_META_OBJECTTYPE.FKERNELXML, 找 before 没 after 有的顶级元素
 * - XE 对账: 每张变化的表, 看 XE trace 里有没有 INSERT/UPDATE/DELETE 该表的语句,
 *   找不到就标 "unexplained"
 * - Markdown 渲染: 单模板拼装
 *
 * 都是纯函数,DB 不进这个文件。
 */

import { createHash } from 'node:crypto';
import { NOISE_COLUMN_BLACKLIST } from './snapshot-all';

export interface RowDiffResult {
  added: Record<string, unknown>[];
  removed: Record<string, unknown>[];
  modified: Array<{ before: Record<string, unknown>; after: Record<string, unknown> }>;
  unchanged: Record<string, unknown>[];
  /** Rows with no key column value — can't be matched across snapshots. */
  unidentifiable: Record<string, unknown>[];
}

export function hashRowExcludingNoise(row: Record<string, unknown>): string {
  const filtered: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (!NOISE_COLUMN_BLACKLIST.includes(k.toUpperCase())) {
      filtered[k] = v;
    }
  }
  // 稳定 JSON (sorted keys) → sha1 hex。
  const keys = Object.keys(filtered).sort();
  const stable = JSON.stringify(keys.map((k) => [k, filtered[k]]));
  return createHash('sha1').update(stable).digest('hex');
}

export function computeTableRowDiff(
  before: Record<string, unknown>[],
  after: Record<string, unknown>[],
  keyColumn: string
): RowDiffResult {
  const result: RowDiffResult = {
    added: [],
    removed: [],
    modified: [],
    unchanged: [],
    unidentifiable: []
  };

  const keyOf = (r: Record<string, unknown>): string | null => {
    const v = r[keyColumn];
    return v === undefined || v === null ? null : String(v);
  };

  const beforeByKey = new Map<string, Record<string, unknown>>();
  for (const r of before) {
    const k = keyOf(r);
    if (k === null) result.unidentifiable.push(r);
    else beforeByKey.set(k, r);
  }

  const seenAfterKeys = new Set<string>();
  for (const r of after) {
    const k = keyOf(r);
    if (k === null) {
      result.unidentifiable.push(r);
      continue;
    }
    seenAfterKeys.add(k);
    const bRow = beforeByKey.get(k);
    if (!bRow) {
      result.added.push(r);
    } else if (hashRowExcludingNoise(bRow) !== hashRowExcludingNoise(r)) {
      result.modified.push({ before: bRow, after: r });
    } else {
      result.unchanged.push(r);
    }
  }
  for (const [k, r] of beforeByKey) {
    if (!seenAfterKeys.has(k)) result.removed.push(r);
  }
  return result;
}

// ─── Markdown report ──────────────────────────────────────────────

export interface ReportInput {
  label: string;
  extId: string;
  beforeJsonPath: string;
  afterJsonPath: string;
  xelPath: string;
  tableChanges: Array<{
    tableName: string;
    added: number;
    removed: number;
    modified: number;
  }>;
  xmlChanges: Array<{
    table: string;
    column: string;
    addedElements: string[];
    removedElements: string[];
  }>;
  xeEvents: number;
  unexplained: string[];
}

export function formatRowAsTable(row: Record<string, unknown>): string {
  const lines = ['| column | value |', '| --- | --- |'];
  for (const [k, v] of Object.entries(row)) {
    const safeVal = typeof v === 'string' ? v.replace(/\|/g, '\\|') : JSON.stringify(v);
    lines.push(`| ${k} | ${safeVal} |`);
  }
  return lines.join('\n');
}

export function renderReportMarkdown(input: ReportInput): string {
  const sections: string[] = [];
  sections.push(`# Recon report: ${input.label}`);
  sections.push('');
  sections.push(`**Extension FID:** \`${input.extId}\`  `);
  sections.push(`**Before snapshot:** \`${input.beforeJsonPath}\`  `);
  sections.push(`**After snapshot:** \`${input.afterJsonPath}\`  `);
  sections.push(`**XE trace:** \`${input.xelPath}\` (${input.xeEvents} events)`);
  sections.push('');

  if (input.unexplained.length > 0) {
    sections.push('## ⚠ Unexplained changes');
    sections.push('');
    sections.push(
      'These snapshot diffs could not be explained by any SQL in the XE trace — '
        + 'possibly BOS Designer routes them through a backend service. Investigate before '
        + 'shipping a writer.'
    );
    sections.push('');
    for (const u of input.unexplained) sections.push(`- ${u}`);
    sections.push('');
  }

  sections.push('## Changed tables');
  sections.push('');
  if (input.tableChanges.length === 0) {
    sections.push('_No table-level changes detected._');
  } else {
    sections.push('| table | + | − | ~ |');
    sections.push('| --- | --- | --- | --- |');
    for (const t of input.tableChanges) {
      sections.push(`| \`${t.tableName}\` | ${t.added} | ${t.removed} | ${t.modified} |`);
    }
  }
  sections.push('');

  sections.push('## FKERNELXML diff');
  sections.push('');
  if (input.xmlChanges.length === 0) {
    sections.push('_No FKERNELXML changes._');
  } else {
    for (const x of input.xmlChanges) {
      sections.push(`### ${x.table}.${x.column}`);
      if (x.addedElements.length > 0) {
        sections.push('');
        sections.push('**Added elements:**');
        sections.push('');
        for (const el of x.addedElements) sections.push(`- \`${el}\``);
      }
      if (x.removedElements.length > 0) {
        sections.push('');
        sections.push('**Removed elements:**');
        sections.push('');
        for (const el of x.removedElements) sections.push(`- \`${el}\``);
      }
      sections.push('');
    }
  }

  sections.push('## XE SQL trace');
  sections.push('');
  sections.push(`See \`${input.xelPath}\` and its parsed \`${input.label}-trace.json\`.`);
  sections.push(`Total normalized events: **${input.xeEvents}**`);

  return sections.join('\n');
}
```

- [ ] **Step 4: 运行测试确认 PASS**

```bash
pnpm vitest run tests/scripts/bos-recon/diff.test.ts
```

Expected: `9 passed`

- [ ] **Step 5: Commit**

```bash
git add scripts/bos-recon/diff.ts tests/scripts/bos-recon/diff.test.ts
git commit -m "feat(recon): diff.ts — snapshot 行 diff + 报告渲染 (纯函数 + 单测)"
```

---

### Task 7: cli.ts — 把 5 个 subcommand 接起来

**Files:**
- Modify: `scripts/bos-recon/cli.ts` (替换 Task 1 的 skeleton)

**Why:** 各模块都准备好了,cli 负责驱动 —— 读 --project / --ext-id / --label,连 DB,调 snapshot/xe/diff,写文件。这一步没单测 (属于 glue code, 用 smoke 验),但每个 subcommand 都能独立跑。

- [ ] **Step 1: 扩 cli.ts 把 5 个 subcommand 接起来**

整体替换 `scripts/bos-recon/cli.ts`:

```typescript
// scripts/bos-recon/cli.ts
/**
 * bos-recon CLI — 开发环境 BOS 侦察工具链入口。
 *
 * 用法: pnpm recon:<subcommand> -- --project <pid> [--ext-id <fid>] [--label <label>]
 *
 * 所有 subcommand 共享 --project (必填) 和 --label (默认 'default')。
 * snapshot-before / snapshot-after 额外要 --ext-id。
 * diff 只需要 --label (从 output 目录读已有 JSON/.xel)。
 */

import sql from 'mssql';
import path from 'node:path';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { loadSettings, resolveProjectConfig } from './config';
import {
  buildCreateSessionSQL,
  buildDropSessionSQL,
  buildReadXelFileSQL,
  buildStartSessionSQL,
  buildStopSessionSQL
} from './xe-session';
import { normalizeEvents, parseXelEventXml, type XeEvent } from './xe-parse';
import { snapshotAllMeta, writeSnapshotJson, type SnapshotResult } from './snapshot-all';
import {
  computeTableRowDiff,
  renderReportMarkdown,
  type ReportInput
} from './diff';

const SESSION_NAME = 'opendeploy_bos_recon';
const OUTPUT_DIR = path.resolve('scripts/bos-recon/output');

type Subcommand =
  | 'snapshot-before'
  | 'xe-start'
  | 'xe-stop'
  | 'snapshot-after'
  | 'diff';

const KNOWN: readonly Subcommand[] = [
  'snapshot-before',
  'xe-start',
  'xe-stop',
  'snapshot-after',
  'diff'
] as const;

function isSubcommand(s: string): s is Subcommand {
  return (KNOWN as readonly string[]).includes(s);
}

interface CliArgs {
  project?: string;
  extId?: string;
  label: string;
  xelAbsPath?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { label: 'default' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project') out.project = argv[++i];
    else if (a === '--ext-id') out.extId = argv[++i];
    else if (a === '--label') out.label = argv[++i];
    else if (a === '--xel-path') out.xelAbsPath = argv[++i];
  }
  return out;
}

function requireArg<K extends keyof CliArgs>(args: CliArgs, key: K, sub: Subcommand): NonNullable<CliArgs[K]> {
  const v = args[key];
  if (v === undefined || v === '') {
    throw new Error(`[bos-recon ${sub}] missing required --${String(key)}`);
  }
  return v as NonNullable<CliArgs[K]>;
}

async function connect(projectId: string): Promise<sql.ConnectionPool> {
  const settings = await loadSettings();
  const cfg = resolveProjectConfig(settings, projectId);
  const pool = new sql.ConnectionPool({
    server: cfg.server,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    options: cfg.options
  });
  await pool.connect();
  return pool;
}

function xelPathFor(label: string): string {
  return path.join(OUTPUT_DIR, `${label}-trace.xel`);
}

// ─── subcommands ──────────────────────────────────────────────

async function cmdSnapshotBefore(args: CliArgs): Promise<void> {
  const project = requireArg(args, 'project', 'snapshot-before');
  const extId = requireArg(args, 'extId', 'snapshot-before');
  const pool = await connect(project);
  try {
    const snap = await snapshotAllMeta(pool, extId);
    const out = await writeSnapshotJson(OUTPUT_DIR, args.label, 'before', snap);
    console.log(`[bos-recon] before snapshot: ${out}`);
    console.log(
      `           scanned=${snap.scannedTables} unmatched=${snap.unmatchedTables.length} ` +
      `empty=${snap.emptyTables.length} hit=${Object.keys(snap.tables).length}`
    );
  } finally {
    await pool.close();
  }
}

async function cmdSnapshotAfter(args: CliArgs): Promise<void> {
  const project = requireArg(args, 'project', 'snapshot-after');
  const extId = requireArg(args, 'extId', 'snapshot-after');
  const pool = await connect(project);
  try {
    const snap = await snapshotAllMeta(pool, extId);
    const out = await writeSnapshotJson(OUTPUT_DIR, args.label, 'after', snap);
    console.log(`[bos-recon] after snapshot: ${out}`);
  } finally {
    await pool.close();
  }
}

async function cmdXeStart(args: CliArgs): Promise<void> {
  const project = requireArg(args, 'project', 'xe-start');
  await mkdir(OUTPUT_DIR, { recursive: true });
  const xelPath = args.xelAbsPath ?? xelPathFor(args.label);
  const pool = await connect(project);
  try {
    // 幂等 drop 再 create, 防止上次跑崩残留。
    await pool.request().batch(buildDropSessionSQL(SESSION_NAME));
    await pool.request().batch(buildCreateSessionSQL({ sessionName: SESSION_NAME, xelPath }));
    await pool.request().batch(buildStartSessionSQL(SESSION_NAME));
    console.log(`[bos-recon] XE session "${SESSION_NAME}" started, target=${xelPath}`);
    console.log(`           → 现在去 BOS Designer 做你要侦察的操作, 完了跑 pnpm recon:xe-stop`);
  } finally {
    await pool.close();
  }
}

async function cmdXeStop(args: CliArgs): Promise<void> {
  const project = requireArg(args, 'project', 'xe-stop');
  const xelPath = args.xelAbsPath ?? xelPathFor(args.label);
  const pool = await connect(project);
  try {
    await pool.request().batch(buildStopSessionSQL(SESSION_NAME));
    // 等 buffer flush。
    await new Promise((r) => setTimeout(r, 1500));

    const readSql = buildReadXelFileSQL(xelPath);
    const res = await pool.request().query<{ event_xml: string }>(readSql);
    const rawEvents: XeEvent[] = [];
    for (const row of res.recordset) {
      const e = parseXelEventXml(row.event_xml);
      if (e) rawEvents.push(e);
    }
    const events = normalizeEvents(rawEvents);

    const jsonPath = path.join(OUTPUT_DIR, `${args.label}-trace.json`);
    await writeFile(jsonPath, JSON.stringify(events, null, 2), 'utf-8');

    // Session 不 drop, 下次 xe-start 会幂等处理。
    console.log(`[bos-recon] XE stopped, ${events.length} events → ${jsonPath}`);
  } finally {
    await pool.close();
  }
}

async function cmdDiff(args: CliArgs): Promise<void> {
  const beforePath = path.join(OUTPUT_DIR, `${args.label}-before.json`);
  const afterPath = path.join(OUTPUT_DIR, `${args.label}-after.json`);
  const tracePath = path.join(OUTPUT_DIR, `${args.label}-trace.json`);
  const xelPath = xelPathFor(args.label);

  const before: SnapshotResult = JSON.parse(await readFile(beforePath, 'utf-8'));
  const after: SnapshotResult = JSON.parse(await readFile(afterPath, 'utf-8'));
  let trace: XeEvent[] = [];
  try {
    trace = JSON.parse(await readFile(tracePath, 'utf-8'));
  } catch {
    console.warn(`[bos-recon] no XE trace at ${tracePath} — report will omit XE section`);
  }

  // 所有 union 的表名。
  const allTables = new Set([...Object.keys(before.tables), ...Object.keys(after.tables)]);
  const tableChanges: ReportInput['tableChanges'] = [];
  const unexplained: string[] = [];

  for (const tableName of allTables) {
    const b = before.tables[tableName] ?? [];
    const a = after.tables[tableName] ?? [];
    // 粗略 pick 候选键: 第一行有的候选键列。
    const sampleRow = a[0] ?? b[0] ?? {};
    const keyCol = ['FID', 'FOBJECTTYPEID', 'FBILLFORMID', 'FENTRYID', 'FBASEOBJECTID'].find(
      (c) => c in sampleRow
    );
    if (!keyCol) continue;
    const d = computeTableRowDiff(b, a, keyCol);
    const added = d.added.length;
    const removed = d.removed.length;
    const modified = d.modified.length;
    if (added + removed + modified > 0) {
      tableChanges.push({ tableName, added, removed, modified });
      // XE 对账: 找 trace 里有没有提到此表名的 SQL。
      const mentioned = trace.some((e) => e.stmt.toUpperCase().includes(tableName.toUpperCase()));
      if (!mentioned) {
        unexplained.push(
          `${tableName}: ${added} added / ${removed} removed / ${modified} modified — no XE event references this table name`
        );
      }
    }
  }

  // FKERNELXML 子树 diff (MVP: 粗粒度字符串 diff,Phase 2 再精细)。
  const xmlChanges: ReportInput['xmlChanges'] = [];
  const bKernel = (before.tables.T_META_OBJECTTYPE ?? [])[0]?.FKERNELXML as string | undefined;
  const aKernel = (after.tables.T_META_OBJECTTYPE ?? [])[0]?.FKERNELXML as string | undefined;
  if (bKernel && aKernel && bKernel !== aKernel) {
    // MVP: 抽出 after 里有 before 没有的顶级标签。
    const beforeTags = new Set(Array.from(bKernel.matchAll(/<([A-Z][A-Za-z0-9]+)\b/g)).map((m) => m[1]));
    const afterTagMatches = Array.from(aKernel.matchAll(/<([A-Z][A-Za-z0-9]+)\b/g)).map((m) => m[1]);
    const addedTags = [...new Set(afterTagMatches.filter((t) => !beforeTags.has(t)))];
    xmlChanges.push({
      table: 'T_META_OBJECTTYPE',
      column: 'FKERNELXML',
      addedElements: addedTags,
      removedElements: []
    });
  }

  // extId 粗略从 T_META_OBJECTTYPE 行拿。
  const extId =
    ((after.tables.T_META_OBJECTTYPE ?? [])[0]?.FID as string | undefined) ?? '(unknown)';

  const md = renderReportMarkdown({
    label: args.label,
    extId,
    beforeJsonPath: path.basename(beforePath),
    afterJsonPath: path.basename(afterPath),
    xelPath: path.basename(xelPath),
    tableChanges,
    xmlChanges,
    xeEvents: trace.length,
    unexplained
  });

  const reportPath = path.join(OUTPUT_DIR, `${args.label}-report.md`);
  await writeFile(reportPath, md, 'utf-8');
  console.log(`[bos-recon] report → ${reportPath}`);
  console.log(`           tables changed: ${tableChanges.length}, unexplained: ${unexplained.length}`);
}

// ─── main ──────────────────────────────────────────────

async function main(): Promise<void> {
  const [, , sub, ...rest] = process.argv;
  if (!sub || !isSubcommand(sub)) {
    console.error(
      `usage: pnpm recon:<subcommand> -- --project <pid> [--ext-id <fid>] [--label <label>]\n` +
        `  subcommands: ${KNOWN.join(' / ')}`
    );
    process.exit(2);
  }
  const args = parseArgs(rest);
  switch (sub) {
    case 'snapshot-before': return cmdSnapshotBefore(args);
    case 'xe-start':         return cmdXeStart(args);
    case 'xe-stop':          return cmdXeStop(args);
    case 'snapshot-after':   return cmdSnapshotAfter(args);
    case 'diff':             return cmdDiff(args);
  }
}

main().catch((err) => {
  console.error('[bos-recon] error:', err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
```

- [ ] **Step 2: typecheck + 单测全过**

```bash
pnpm typecheck
pnpm vitest run tests/scripts/bos-recon/
```

Expected: typecheck exit 0, vitest 全 4 文件全过 (23 tests 总和)。

- [ ] **Step 3: Commit**

```bash
git add scripts/bos-recon/cli.ts
git commit -m "feat(recon): cli.ts — 接通 5 个 subcommand (snapshot / xe / diff)"
```

---

### Task 8: 🛑 UAT — 第一次"加文本字段"侦察

**⚠ 非自动化任务 —— 需要用户手动操作 BOS Designer,然后你把产出 report 返给用户。**

**Files:** 产出 `scripts/bos-recon/output/add-text-field-*.{json,xel,md}` (不 commit,在 .gitignore 里)

- [ ] **Step 1: 和用户确认 UAT 准备就绪**

跟用户确认:
- 他手头有一个可用的 K/3 Cloud 项目 (OpenDeploy 里能连通 + 有扩展)
- 扩展 FID 是什么 (可以用 `kingdee_list_extensions` 或让用户在 BOS Designer 里看)
- projectId 是什么 (从 `~/.opendeploy/settings.json` 里找)
- 他对 SQL Server 的账号有 `ALTER ANY EVENT SESSION` 或 sysadmin 权限

缺任一就停,让用户补齐再继续。

- [ ] **Step 2: 跑 snapshot-before**

```bash
pnpm recon:snapshot-before -- --project <PID> --ext-id <FID> --label add-text-field
```

Expected: 打印 `scanned=N unmatched=M empty=K hit=J`, 并写 `output/add-text-field-before.json`。

记录 `hit` (有匹配行的表数) 数字给用户参考。

- [ ] **Step 3: 启 XE session**

```bash
pnpm recon:xe-start -- --project <PID> --label add-text-field
```

Expected: 打印 `XE session "opendeploy_bos_recon" started, target=...\add-text-field-trace.xel`

- [ ] **Step 4: 🛑 让用户操作 BOS Designer**

告诉用户:

> XE 已经开始抓 SQL。请你在 BOS Designer 里:
> 1. 打开扩展 \<extName> (FID = \<FID>)
> 2. 在**单据头**拖一个"文本字段"控件到布局
> 3. 字段属性: key=`F_TEST01`, 中文名="侦察测试字段", 长度=50, 不必填
> 4. 保存
> 
> 保存成功后回来告诉我 "done"。如果遇到报错,告诉我具体信息。

暂停等待。

- [ ] **Step 5: 停 XE + snapshot-after + diff**

用户确认 done 后,顺序跑:

```bash
pnpm recon:xe-stop -- --project <PID> --label add-text-field
pnpm recon:snapshot-after -- --project <PID> --ext-id <FID> --label add-text-field
pnpm recon:diff -- --label add-text-field
```

Expected: 打印 `report → ...add-text-field-report.md`, tables changed 计数 ≥ 1。

- [ ] **Step 6: 把 report 给用户看 + 人工分析**

打开 `scripts/bos-recon/output/add-text-field-report.md`,跟用户一起走一遍:

1. **Changed tables** — 列出了哪几张表?这些就是"加文本字段"涉及的 `BOS_FIELD_TABLES` (Phase 2 白名单)
2. **FKERNELXML diff** — added elements 是什么 XML 标签?这就是字段 XML 子树的顶级元素
3. **XE SQL trace** — 按时间顺序看 BOS Designer 发了哪些 INSERT/UPDATE
4. **⚠ Unexplained** — 如果有,跟用户讨论为什么。可能是 BOS 服务端接口,Phase 2 需要特殊处理

把**关键发现写到 commit message** (但 report.md 本身在 .gitignore 里不进 git)。

- [ ] **Step 7: Commit "UAT 完成" 里程碑**

在 repo 里新建一个占位文件标记 UAT 已完成 (因为 output/ 在 .gitignore 里,没法 commit report):

```bash
# 在 docs/superpowers/plans/ 里 append UAT 发现到一个附件 md
cat > docs/superpowers/plans/2026-04-24-bos-recon-phase1-uat-findings.md <<'EOF'
# Phase 1 UAT 发现 (加文本字段)

**日期:** (填实际日期)
**扩展 FID:** (填)
**BOS Designer 版本:** (填)

## 涉及的表 (BOS_FIELD_TABLES Phase 2 白名单候选)

(把 report.md Changed tables 清单粘这儿)

## FKERNELXML 字段子树结构

(粘 added elements + 从 .xel 里对应的完整 XML 片段)

## BOS Designer 的 SQL 序列 (按时间)

(精简总结, 不放原始 trace)

## 已知坑 / 警告

- (如有 unexplained 条目,列在这里)

## 下一步 (Phase 2 plan)

基于以上发现写 `kingdee_add_field` writer。
EOF

git add docs/superpowers/plans/2026-04-24-bos-recon-phase1-uat-findings.md
git commit -m "docs(recon): Phase 1 UAT 发现 — 加文本字段涉及的 DB 表 + XML 结构"
```

- [ ] **Step 8: 报告给用户 Phase 1 完成 + 提示 Phase 2 下一步**

对用户说:

> Phase 1 侦察链全部完成:
> - 4 个模块 + CLI + 单测 (23 tests 全绿)
> - 对"加文本字段"跑通一次完整 UAT,产出 report
> - 关键发现已沉淀到 `docs/superpowers/plans/2026-04-24-bos-recon-phase1-uat-findings.md`
>
> Phase 2 需要基于这份 UAT 发现另起一个 plan (writer + skill reference + 端到端 UAT)。
> 要我现在调 `superpowers:writing-plans` 开 Phase 2 plan 吗?

---

## 自我审查 (我已替你跑过)

**Spec 覆盖** ✅
- Spec §4.1 侦察层 4 文件 → Tasks 3/4/5/6 + 1 个 config + 1 个 cli (共 6 文件,合理展开)
- Spec §4.1 package.json scripts 5 个 → Task 1 Step 3
- Spec §4.1 README.md → Task 1 Step 2
- Spec §4.1 .gitignore output/ → 已在
- Spec §5.1 UAT 时序完整 → Task 8
- Spec §6.1 侦察层错误处理 → 分散在各 task 的实现里 (幂等 drop、buffer flush 等待、binary 列 marker 等)

**Placeholder 扫描** ✅ 无 "TBD / implement later / 类似 Task N" 等禁词。

**类型一致性** ✅
- `XeEvent` 在 xe-parse.test / xe-parse.ts / cli.ts 一致
- `SnapshotResult` 在 snapshot-all.ts / cli.ts 一致
- `ReportInput` 在 diff.test / diff.ts / cli.ts 一致
- `CANDIDATE_KEY_COLUMNS` / `NOISE_COLUMN_BLACKLIST` 在 snapshot-all.ts 定义,在 diff.ts + cli.ts 引用
- subcommand 名 (5 个) 在 Task 1 cli.ts 定义,Task 7 cli.ts 用到,package.json 用到
- SESSION_NAME `opendeploy_bos_recon` 固定常量,没有在不同文件写不同值

**Phase 2 不在 plan** ✅ 已在开头范围边界明示。

---

## 执行交接

Plan 写完并存到 `docs/superpowers/plans/2026-04-24-bos-recon-phase1.md`。两种执行路径:

**1. Subagent-Driven (推荐)** — 我每个 task 派一个 fresh subagent, task 间我 review, 迭代快

**2. Inline Execution** — 本 session 里按 `executing-plans` 批次跑, checkpoints 间审查

选哪种?
