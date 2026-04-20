# OpenDeploy · Plan 5: Python 代码生成 + Demo 闭环

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 闭环 MVP。顾问在对话里描述需求 → agent 问澄清 → 调 `kingdee_*` 读元数据 → 产出 Python 表单插件 → 写到当前项目的 `plugins/` 目录 → 对话右侧面板实时列出产物，顾问能复制或打开。交付基线 demo：**信用额度预警**（销售订单 BeforeSave 挡超限客户）。

**Architecture decisions** (see memory `project_plan_5_decisions`):
- 插件写到 `%USERPROFILE%/.opendeploy/projects/<project-id>/plugins/`（MVP 固定路径）
- Demo 场景锁定**信用额度预警**
- **不**在本 Plan 塞新 skill（内容需用户审核 + push 到 skills repo；Plan 5 收尾再 review 草稿）
- 产物 UI = **对话右侧可折叠"本次会话产物"面板**，只显示**当前会话**内 agent 写的文件
- agent 写文件返回结构化 JSON（路径 + 行数），让 agent 自然汇报；不额外弹 toast

**Tech Stack:** 不引入新依赖。`fs/promises` + 现有 IPC 框架 + React + Zustand。

**Project Root:** `D:\Project\opendeploy\`

---

## Plan 5 完成后能做什么

- 顾问说"客户想要销售订单审核前挡信用额度超限"
- Agent 识别需求 → 追问澄清（通过 skills 指导，但 Plan 5 不新增 skill；依赖 agent 对元数据工具的合理组合）
- Agent 调 `kingdee_search_metadata` / `kingdee_get_fields` 确认 SAL_SaleOrder 字段结构
- Agent 调 `write_plugin('credit_limit_guard.py', '...python body...')` 产出插件
- 对话右侧折叠面板展开后列出本轮新建的 `credit_limit_guard.py`
- 点击文件 → 弹层显示内容，可一键复制
- 顾问把 .py 粘到客户 K/3 Cloud 客户端里按 skill-body 指导注册，搞定

---

## 文件结构规划

```
src/
├── shared/
│   └── plugin-types.ts          # PluginFile, PluginWriteResult
├── main/
│   ├── plugins/
│   │   ├── paths.ts             # projectPluginsDir(projectId)
│   │   ├── store.ts             # listPlugins / readPlugin / writePlugin / deletePlugin
│   │   └── validator.ts         # safeFilename(name): 禁路径穿越、只允许 .py
│   ├── ipc-plugins.ts           # plugins:list / read / write / delete
│   └── agent/
│       └── plugin-tools.ts      # write_plugin / read_plugin / list_plugins agent tools
├── renderer/
│   ├── stores/
│   │   └── artifacts-store.ts   # 当前会话的 agent 写文件记录（不扫盘）
│   ├── components/
│   │   └── ArtifactsPanel.tsx   # 对话右侧可折叠面板
│   └── pages/
│       └── WorkspacePage.tsx    # (修改) 加 ArtifactsPanel
└── tests/
    └── plugins/
        ├── paths.test.ts
        ├── validator.test.ts
        ├── store.test.ts
        └── plugin-tools.test.ts
```

---

## Task 1: 共享类型

**Files:**
- Create: `src/shared/plugin-types.ts`

```typescript
export interface PluginFile {
  /** File name within the project plugins dir, e.g. "credit_limit_guard.py". */
  name: string;
  /** Absolute on-disk path — for the UI "open in file explorer" affordance (Plan 6+). */
  path: string;
  /** ISO timestamp from fs.stat.mtime. */
  modifiedAt: string;
  /** Bytes on disk. */
  size: number;
}

export interface PluginWriteResult {
  projectId: string;
  file: PluginFile;
  /** Line count — agent's natural-language reply uses this ("已保存，共 N 行"). */
  lines: number;
  /** True when this write created the file; false when it overwrote an existing one. */
  created: boolean;
}
```

---

## Task 2: 插件路径工具

**Files:**
- Create: `src/main/plugins/paths.ts`
- Create: `tests/plugins/paths.test.ts`

- [ ] **paths.ts**

```typescript
import { app } from 'electron';
import path from 'node:path';
import os from 'node:os';

export function projectsRoot(): string {
  const home = app?.getPath ? app.getPath('home') : os.homedir();
  return path.join(home, '.opendeploy', 'projects');
}

export function projectDir(projectId: string): string {
  return path.join(projectsRoot(), projectId);
}

export function projectPluginsDir(projectId: string): string {
  return path.join(projectDir(projectId), 'plugins');
}
```

- [ ] **Test with env-overridable home**（settings.ts 已有 `OPENDEPLOY_HOME` pattern，参照）

---

## Task 3: 文件名校验器

**Files:**
- Create: `src/main/plugins/validator.ts`
- Create: `tests/plugins/validator.test.ts`

职责：agent 写进来的 `filename` 参数必须安全。拒绝：
- 路径分隔符（`/` `\`）
- 相对路径片段（`..`、`.` 开头）
- 扩展名非 `.py`
- 空 / 超长（> 80 char）

```typescript
export interface FilenameValidation { ok: boolean; reason?: string }
export function validatePluginFilename(name: string): FilenameValidation;
```

TDD：路径穿越 / 非 .py / 空名 / 超长 / 合法名字一共 6-8 tests。

---

## Task 4: 文件系统 store

**Files:**
- Create: `src/main/plugins/store.ts`
- Create: `tests/plugins/store.test.ts`

Signature：

```typescript
listPlugins(projectId: string): Promise<PluginFile[]>;
readPlugin(projectId: string, name: string): Promise<string>;
writePlugin(projectId: string, name: string, content: string): Promise<PluginWriteResult>;
deletePlugin(projectId: string, name: string): Promise<void>;
```

- `writePlugin` 先跑 `validatePluginFilename(name)`，reject 就 throw
- 创建 plugins 目录 if missing (`mkdir recursive`)
- 返回 `PluginWriteResult { file, lines, created }`

TDD：
- listPlugins 空目录 → []
- writePlugin 创建 + 返回 created=true
- writePlugin 覆盖 + 返回 created=false
- writePlugin 非法文件名 → throw
- readPlugin 未知文件 → ENOENT
- deletePlugin 移除

---

## Task 5: Plugins IPC

**Files:**
- Create: `src/main/ipc-plugins.ts`
- Modify: `src/main/index.ts` — 挂载
- Modify: `src/shared/types.ts` — IpcApi 新增 plugin 方法
- Modify: `src/preload/index.ts` — 暴露

Handlers：
- `plugins:list` (projectId)
- `plugins:read` (projectId, name)
- `plugins:write` (projectId, name, content) — **renderer 不直接调这个**，agent 工具经由 main process 调用；handler 预留给未来手动编辑场景
- `plugins:delete` (projectId, name)

---

## Task 6: Agent 工具

**Files:**
- Create: `src/main/agent/plugin-tools.ts`
- Create: `tests/agent/plugin-tools.test.ts`
- Modify: `src/main/ipc-llm.ts` — 每次请求注册 plugin 工具（只在有激活项目时）

三个工具：

### `write_plugin`
- description: "把 Python 表单插件代码写到当前项目的 plugins 目录。仅在需求已澄清 + 元数据查询完成后使用。filename 必须是 .py 结尾、不含路径分隔符的短名（如 `credit_limit_guard.py`）。"
- parameters: `{ filename: string, content: string }`
- execute: 读 active project id（通过 `getConnectionState().projectId`），无激活项目时 throw；否则写文件、返回 JSON `{ created, path, lines }`

### `list_plugins`
- description: "列出当前项目 plugins 目录里的 .py 文件。用于看是否有已存在的插件可以复用 / 扩展。"
- execute: 读 active project id + 调 `listPlugins(id)`，返回 JSON 数组

### `read_plugin`
- description: "读取已有插件的完整 Python 源码。用于在已有插件基础上增量修改。"
- parameters: `{ filename: string }`

工具组通过 `buildPluginTools()` 返回；`ipc-llm.ts` 里和 `buildK3CloudTools()` 同处挂载。

---

## Task 7: renderer artifacts store

**Files:**
- Create: `src/renderer/stores/artifacts-store.ts`

当前会话的 agent 产物记录——**不扫盘**，只累加本轮 agent 工具调用的输出。结构：

```typescript
interface Artifact {
  id: string;                  // tool_call.id
  kind: 'plugin';              // 未来可扩展其他文件类型
  projectId: string;
  filename: string;
  path: string;
  createdAt: string;
  lines?: number;
}

interface ArtifactsState {
  items: Artifact[];
  addFromToolResult: (tc: ToolCall, result: string) => void;  // 解析 write_plugin 结果
  clear: () => void;           // 新对话时调
}
```

- chat-store 在 `tool_result` 事件里检查工具名，若是 `write_plugin` 则 `addFromToolResult`
- chat-store 的 `clear()` 里顺便调 `artifactsStore.clear()`

---

## Task 8: ArtifactsPanel 组件

**Files:**
- Create: `src/renderer/components/ArtifactsPanel.tsx`
- Modify: `src/renderer/pages/WorkspacePage.tsx` — 嵌入右侧

UI：
- 折叠按钮（默认展开 if artifacts.length > 0，否则折叠）
- 标题 "本次会话产物 · N"
- 每个 artifact 一行：filename + "N 行" + modifiedAt + 右侧"复制"按钮
- 点击行 → 弹层显示 `content`（读自 `plugins:read` IPC），内部 `<pre><code>` 高亮，右上角"复制"按钮

设计上占 Workspace 右侧 300-340px 栏，空态时收起不占地方。

---

## Task 9: i18n + 样式

- `artifacts.title` / `artifacts.empty` / `artifacts.lines` / `artifacts.copy` / `artifacts.copied` / `artifacts.openFile`
- design-system.css 加 `.artifacts-panel` / `.artifact-item` / `.artifact-dialog`

---

## Task 10: E2E

**Files:**
- Create: `tests/plugins/e2e-codegen-flow.test.ts`

Scripted agent 流：
1. mock connector（返回假的 `listObjects` / `getFields` 对应 SAL_SaleOrder）
2. scripted LLM：先调 `kingdee_get_fields`，再调 `write_plugin`
3. 跑 `runAgentLoop`
4. 断言：
   - `write_plugin` 被调过
   - `%TMP%/.../plugins/credit_limit_guard.py` 写到磁盘
   - 文件内容含 "FCreditLimit" 等字样（从脚本 content 里）

---

## Task 11: CLAUDE.md + docs

- Plan 5 标 ✅
- 目录结构加 `src/main/plugins/` + `src/renderer/stores/artifacts-store.ts`
- 测试数字更新
- 关键 UX 决策记录新增"产物面板"条目

---

## 决策备忘（关键设计）

- **为什么不扫盘而是跟踪会话产物**：同一个 project 可能跨多次对话产出多个文件。若"产物面板"扫盘显示当前项目所有历史 `.py`，面板会越来越混乱。按会话粒度来，用户清了对话也清了面板，符合"这次会话的成果"直觉。当用户需要查看全部文件时，走 Plan 6 的"项目文件浏览器"功能。
- **为什么 `write_plugin` 不让 renderer 直接调**：renderer 不该有"写任意文件"的能力——agent 工具经由 main 进程写是唯一路径。plugins:write IPC 存在但未来编辑场景再用。
- **为什么不做 Python 语法校验**：IronPython 2.7 专有语法 + 缺少可靠的纯 JS 解析器；错误反馈给 agent 价值有限（agent 本来就不完美），让顾问在客户环境试跑是最可靠的。
- **为什么 Demo 锁定信用额度预警**：单表（SAL_SaleOrder 头表字段）、单事件（BeforeSave）、引用 1 张基础资料（客户 → 信用额度），是 4 个 sample 里最简洁能跑通的。

---

## 失败回滚

每 task 独立 commit。基础设施（Task 1-5）和 UI（Task 7-9）可分别回滚不互相依赖。

---

## Plan 5 完成后的状态

- v0.1 alpha 的**所有产品能力**都就位
- 剩 Plan 6（打包 + SQL 白名单 gate）就能发布
