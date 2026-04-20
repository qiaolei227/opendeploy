# OpenDeploy · Plan 4: 金蝶 K/3 Cloud 元数据只读

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 agent 真正"懂客户的那套金蝶"—— 通过 MSSQL 直连读取 K/3 Cloud 元数据（业务对象、字段、基础资料引用），配合高阶类型化工具让 agent 按需查询，项目模型落地让顾问能在多个客户环境间切换。

**Architecture decisions** (see memory `project_plan_4_decisions`):
- **MSSQL 直连** — 不走 OpenAPI；仅支持 mssql 驱动
- **项目 CRUD 完整** — 独立 Projects 页，每项目一份连接配置
- **高阶类型化工具** — 5–6 个 `kingdee_*` 具名工具，不给 agent 裸 SQL
- **凭据明文存 settings.json** — 与 `apiKeys` 同路径风格
- **SQL 白名单暂不加，但预留挂载点** — `validateQuery(sql)` 接口就位，release 前必补
- **命名**：产品族 `k3cloud`；版本（`v9`/`v10`）+ 版次（`standard`/`enterprise`）作为连接配置字段；连接器单类 `K3CloudConnector`

**Tech Stack:** `mssql` (SQL Server driver for Node), Vitest。

**Project Root:** `D:\Project\opendeploy\`

**User dev env:** `localhost\SQLEXPRESS`, `sa` / `123`, K/3 Cloud 标准版

---

## Plan 4 完成后能做什么

- 顾问在 Projects 页新建项目，填写客户 K/3 Cloud 的数据库连接信息（服务器 / 账套库名 / 版本 / 版次 / 账号密码）
- 点"测试连接"确认可连；Status bar 显示当前激活项目 + 连接状态
- 对话中 agent 能主动调用 `kingdee_list_objects` / `kingdee_get_object` / `kingdee_get_fields` / `kingdee_search_metadata` 等工具，按需读取客户环境的 K/3 Cloud 元数据（**只读**，走校验器挂载点，白名单稍后补）
- 多项目切换无缝：左侧边栏项目列表，切一下连接池切到对应环境

---

## 关键未知（必须先查）

用户明确表示**表名不一定以 `T_META` 开头**。所以：

**Task 1 必须是 schema discovery**——跑诊断 SQL 把用户 UAT 库的元数据相关表结构导出来，再设计后续工具 SQL。用户已提供 UAT 环境：`localhost\SQLEXPRESS` + `sa/123` + K/3 Cloud Standard。

Task 12（类型化查询方法）和 Task 13（agent 工具）依赖本任务产出。其余任务可并行推进。

---

## 文件结构规划

```
src/
├── shared/
│   └── erp-types.ts              # ErpConnector 接口 + Project + K3CloudConfig
├── main/
│   ├── erp/
│   │   ├── types.ts              # ErpConnector / ConnectionPool 内部契约
│   │   ├── validator.ts          # validateQuery(sql) 校验器挂载点（现在 no-op）
│   │   ├── k3cloud/
│   │   │   ├── connector.ts      # K3CloudConnector 主类
│   │   │   ├── queries.ts        # 5-6 个类型化查询方法的 SQL（Task 12）
│   │   │   └── schema.ts         # 从 discovery 结果固化下来的表名 / 列名常量
│   │   └── factory.ts            # createConnector(config) by erpProvider id
│   ├── projects/
│   │   └── store.ts              # Project CRUD + 激活项目管理
│   ├── agent/
│   │   └── k3cloud-tools.ts      # kingdee_list_objects / kingdee_get_object / ...
│   └── ipc-projects.ts           # projects:* IPC handlers
├── preload/
│   └── index.ts                  # 暴露 projects + erp API
├── renderer/
│   ├── stores/
│   │   └── projects-store.ts     # Zustand projects state
│   ├── pages/
│   │   └── ProjectsPage.tsx      # 列表 + 新建/编辑对话框 + 删除 + 测试连接
│   └── components/
│       ├── ProjectForm.tsx       # 复用于新建 / 编辑
│       └── StatusBar.tsx         # (修改) 显示激活项目 + 连接状态
└── shared/
    └── types.ts                  # (修改) AppSettings 新增 projects + activeProjectId

scripts/
└── discover-k3cloud-schema.ts    # Task 1: 连 UAT 库，导出 metadata-suggestive 表结构

tests/
└── erp/
    ├── validator.test.ts
    ├── k3cloud-connector.test.ts  # 用 mock mssql
    └── k3cloud-queries.test.ts    # Task 12 后加
```

---

## Task 1: Schema Discovery（阻塞 Task 12-13）

**Files:**
- Create: `scripts/discover-k3cloud-schema.ts`

- [ ] **Step 1: 安装 mssql**

```bash
pnpm add mssql && pnpm add -D @types/mssql
```

- [ ] **Step 2: 写 discovery 脚本**

脚本职责：
- 连 `localhost\SQLEXPRESS`（`sa`/`123`）
- 列出所有数据库（SELECT name FROM sys.databases）让用户选
- 在选定库里按关键字过滤 metadata-suggestive 表（`%meta%`、`%bos%`、`%form%`、`%entity%`、`%field%`、`%property%`、`%schema%`）
- 对每张命中的表，导出 columns + 5 行样本 + row count
- 结果写到 `scripts/out/k3cloud-schema-<timestamp>.json`

- [ ] **Step 3: 用户在 UAT 跑脚本 + 贴结果**

```bash
pnpm tsx scripts/discover-k3cloud-schema.ts
# or: node --experimental-strip-types scripts/discover-k3cloud-schema.ts
```

用户把 `scripts/out/k3cloud-schema-*.json` 的内容贴回来，我据此设计 Task 12 的实际 SQL。

---

## Task 2: 共享类型契约

**Files:**
- Create: `src/shared/erp-types.ts`

定义：

- `ErpProvider` 枚举：`'k3cloud'`（未来 `'sap'` / `'oracle-ebs'` 之类扩展）
- `K3CloudEdition`: `'standard' | 'enterprise'`
- `K3CloudVersion`: `'9' | '10'`（字符串，不加 "v" 前缀，便于枚举）
- `K3CloudConnectionConfig`: `{ server, database, user, password, edition, version, port?, encrypt?, trustServerCertificate? }`
- `Project`: `{ id, name, erpProvider: 'k3cloud', connection: K3CloudConnectionConfig, createdAt, updatedAt }`
- `TestConnectionResult`: `{ ok, serverVersion?, error? }`
- `ObjectMeta`, `FieldMeta` 等查询结果类型（先占位，Task 12 按 schema 产出填实）

---

## Task 3: AppSettings 扩展

**Files:**
- Modify: `src/shared/types.ts` — `projects?: Project[]`; `activeProjectId?: string`
- Modify: `src/main/settings.ts` — 默认值迁移（老 settings 文件缺字段时合并）

---

## Task 4: mssql 驱动集成

**Files:**
- Create: `src/main/erp/k3cloud/connector.ts` （空壳）
- Create: `src/main/erp/types.ts`

连接池设计：
- 每个项目一个连接池（`mssql.ConnectionPool`），懒加载
- 切换激活项目时，其他池标记为空闲但不立即关（LRU 清理？或手动 disconnect？MVP 先懒不管）
- 池错误事件要监听，断连时 UI 要能感知（`activeProjectConnectionState: 'connected' | 'connecting' | 'error'`）

---

## Task 5: Query 校验器挂载点（预留白名单接口）

**Files:**
- Create: `src/main/erp/validator.ts`
- Create: `tests/erp/validator.test.ts`

```typescript
export interface QueryValidation {
  ok: boolean;
  reason?: string;
}

/** MVP: returns { ok: true } unless DEV override triggered. Release must replace
 *  with real whitelist — see memory: project_plan_4_decisions. */
export function validateQuery(sql: string, opts?: { devAllowUnsafe?: boolean }): QueryValidation {
  // TODO(Plan 6 gate): implement real whitelist
  return { ok: true };
}
```

虽然现在 no-op，**每个 SQL 执行点都必须调用它**——这样以后塞规则进去零代码改动。

---

## Task 6: K3CloudConnector 骨架

**Files:**
- Create: `src/main/erp/k3cloud/connector.ts`

构造参数 `{ edition, version, server, database, user, password }`。方法占位（Task 12 填实）：

```typescript
class K3CloudConnector implements ErpConnector {
  async connect(): Promise<void>;
  async disconnect(): Promise<void>;
  async testConnection(): Promise<TestConnectionResult>;
  async listObjects(keyword?: string): Promise<ObjectMeta[]>;   // Task 12
  async getObject(formId: string): Promise<ObjectMeta | null>;  // Task 12
  async getFields(formId: string): Promise<FieldMeta[]>;        // Task 12
  async searchMetadata(keyword: string): Promise<...>;           // Task 12
}
```

`testConnection` 在 Task 6 里就能实现——跑 `SELECT @@VERSION` 即可。

---

## Task 7: Projects CRUD IPC

**Files:**
- Create: `src/main/projects/store.ts` — 纯内存 + 落到 settings.json
- Create: `src/main/ipc-projects.ts` — handlers:
  - `projects:list`
  - `projects:create(input)`
  - `projects:update(id, patch)`
  - `projects:delete(id)`
  - `projects:set-active(id)`
  - `projects:test-connection(id)` — 新建池，跑 testConnection，不保留
  - `projects:current-connection-state()` — 给 StatusBar 查

---

## Task 8: Preload + IpcApi 同步

**Files:**
- Modify: `src/shared/types.ts` — 添加对应 IpcApi 方法
- Modify: `src/preload/index.ts`

---

## Task 9: Projects Page UI

**Files:**
- Create: `src/renderer/pages/ProjectsPage.tsx`
- Create: `src/renderer/components/ProjectForm.tsx`
- Create: `src/renderer/stores/projects-store.ts`
- Modify: `src/renderer/App.tsx` — 用 `ProjectsPage` 替换 placeholder

UI 要素：
- 项目列表（卡片样式，显示名称、ERP 类型、版本、连接状态图标、上次连接时间）
- "+ 新建项目"按钮 → 对话框打开 `ProjectForm`
- 每条卡片：**编辑** / **测试连接** / **设为当前** / **删除**
- 删除前确认
- ProjectForm 字段：项目名、服务器、端口（默认 1433）、实例名（SQLEXPRESS 之类）、数据库、用户、密码、版本下拉、版次下拉、`trustServerCertificate` 勾选（local dev 默认 on）、`encrypt` 勾选

---

## Task 10: Workspace 侧栏 + StatusBar 集成

- Modify: `src/renderer/components/SecondarySide.tsx` — `workspaceProjects` 已经有位置，从 `projects-store` 读取真实项目
- Modify: `src/renderer/components/StatusBar.tsx` — 显示 `当前项目 · 连接状态`；连接失败时红点
- Modify: `src/renderer/App.tsx` — 挂载 projects store, 传数据进 SecondarySide

---

## Task 11: 首次连接的 Wizard 集成（可选，看时间）

如果时间允许：新项目表单里 "保存 + 测试连接" 一把过，成功才保存；失败不保存并显示错误。

否则 MVP 就先"能保存 + 手动再点测试"。

---

## Task 12: K3CloudConnector 类型化查询方法（需要 Task 1 产出）

按 Task 1 discovery 结果设计实际 SQL。预期要实现：

- `listObjects(keyword?, limit?, offset?)` — 搜索业务对象（FormID + 中文名模糊匹配）
- `getObject(formId)` — 单个对象基础信息 + 主表字段数
- `getFields(formId, entryKey?)` — 字段列表（主表或某明细表）
- `searchMetadata(keyword)` — 跨对象 / 字段的模糊搜索
- `getBaseDataRef(formId, fieldKey)` — 某字段引用的基础资料对象

每个方法：
1. 调 `validateQuery()` 校验 SQL（Task 5 挂载点）
2. 参数化查询（`mssql` 的 `request.input()`），**绝不拼字符串**
3. 返回解析后的类型化对象

---

## Task 13: Agent 工具层

**Files:**
- Create: `src/main/agent/k3cloud-tools.ts`

5-6 个 ToolHandler，对应 Task 12 的方法。每个工具：
- description 写清何时使用（给 agent 判断）
- parameters schema 严格（只暴露必要参数）
- execute 内部调 `K3CloudConnector`，返回格式化后的 JSON/Markdown 字符串

**关键**：agent 工具**不绕过 validator**。如果用户没激活项目，工具 execute 直接返回 "no active project"，不假装成功。

注册到 `ToolRegistry`：修改 `src/main/ipc-llm.ts` 在每次请求时加入 k3cloud 工具组（只在有激活项目时注册）。

---

## Task 14: E2E 验证

- `tests/erp/k3cloud-connector.test.ts` — mock `mssql`，验证 testConnection / listObjects 等方法的 SQL 构造 + 参数
- `tests/erp/validator.test.ts` — 现在空，保证 `validateQuery` 签名就位；白名单规则到 Plan 6 gating 再加
- **真实 smoke test**：用户在本机 SQLEXPRESS 上手动跑一次 `pnpm dev` → 新建项目 → 测试连接 → 在对话里让 agent 调 `kingdee_list_objects` → 看能返回真实对象列表

---

## Task 15: CLAUDE.md + 收尾

- Plan 4 标 ✅
- 目录结构说明加 `src/main/erp/` 和 `src/main/projects/`
- 当前状态：推到 Plan 5

---

## 决策备忘（关键设计）

- **为什么高阶工具不给 agent 裸 SQL**：低阶 `exec_sql` 表面上灵活，实际上 agent 会把白名单当对抗性规则去绕（或单纯写错），fail 模式多。5-6 个类型化工具对应 5-6 个真实查询意图，更稳且 agent 不"越界"。
- **为什么连接器不拆类**：Standard vs Enterprise 的元数据差异目前还没摸清，可能 80% 相同。先单类跑通 Standard，遇到 Enterprise 特有的再在方法内 `switch(edition)`。如果分歧大到 50%+ 再考虑拆。
- **为什么一个连接池对应一个项目**：切换项目不能"等 N 秒连"——池长期持有，即开即用。代价是内存（每池几 MB）可接受。
- **为什么 validator 先 no-op**：用户需要先摸清 T_META 表结构再定白名单规则。但保留函数调用点 → 未来塞规则是单点改动，而不是找全所有 SQL 执行点。release 前必须完成（见 Plan 6 gating）。

---

## 风险

- **T_META 表名未知**：Task 1 堵上
- **Standard vs Enterprise 差异未知**：只能 Standard 跑通，Enterprise 等实际用户反馈
- **白名单缺位是定时炸弹**：必须在 Plan 6（打包发布）前补上；CLAUDE.md 加条 release checklist 项
- **明文密码**：文档里要提醒用户 `~/.opendeploy/settings.json` 有 DB 密码，不要分享这个文件

---

## 失败回滚

每个 task 独立 commit。如果某 task 实现有问题，`git revert <sha>` 即可。Task 4-6 只是基础设施，即使回滚也不影响 Plan 3 的功能。
