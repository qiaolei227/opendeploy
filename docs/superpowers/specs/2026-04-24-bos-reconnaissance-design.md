# BOS 侦察 + 字段 writer 设计方案

**日期**: 2026-04-24
**状态**: 设计阶段，待实施计划
**范围**: Phase 1 (侦察基建) + Phase 2 (第一个字段 writer)
**不含**: Phase 3 (扩到其他字段类型 / 其他 BOS 能力点) — 那是后续独立 plan

---

## 1. 问题陈述

OpenDeploy v0.1-alpha 的 BOS 写入能力（Plan 5.5 / commit `bcaa80f`）只覆盖"新增扩展对象 + 挂 Python 表单插件"一个场景。BOS Designer 还有 20+ 类能力点（加字段 / 业务规则 / 转换规则 / 审批流 / 套打 / 权限 / 移动端 / ...），agent 全都不会操作。

不是"不懂 BOS 做什么"（`bos-features-index` 已经有 10 份 🟡 主流程级 reference），而是**没有对应的 writer 工具 + 没有 🟢 实证的 SQL/XML delta 蓝图**。

**目标**：建立一套可复用的"能力点侦察方法学"，把每个 BOS 能力点背后的 DB/XML 写入模式摸清楚，沉淀到 skill + 转成 writer 工具。第一个攻克场景：**给扩展单据头加一个文本字段**。

## 2. 约束与决策（brainstorm 阶段已定）

| 维度 | 决策 | 理由 |
|---|---|---|
| 第一个场景 | 扩展单据头加文本字段（key / 名 / 长度） | 最基础、最高频；走通后扩到数字/日期/下拉等成本已知 |
| 侦察方法 | SQL Server Extended Events trace 为主 + snapshot before/after diff 辅助 | XE 给权威 SQL 清单；snapshot 交叉验证最终状态；反编译作为 last resort 但不沉淀 |
| Writer 形态 | 按"能力类别"分层：`kingdee_add_field(extId, fieldType, config)` 一个工具，内部按 `fieldType` 分发 | 平衡专用工具爆炸 vs 通用 patch 工具难拼；tools catalog 增量可控 |
| 侦察链载体 | Dev scripts (`scripts/bos-recon/*.ts`) 优先，不进产品 runtime | 侦察是开发流程而非用户流程；XE 要 SA 权限，产品化成本过大；未来社区有需求再抽 MCP 工具 |
| 推进节奏 | Phase 1 (基建) + Phase 2 (第一个字段端到端) + Phase 3 (后续每类字段独立 PR) | 基建一次性投入；Phase 2 验证完整链路；Phase 3 单位成本已知 |

## 3. 架构概览

**三层，边界清晰**：

```
┌──────────────────────────────────────────────────────────┐
│ 侦察层 (dev only, scripts/bos-recon/)                   │
│ 帮我们搞清楚 BOS Designer 怎么写 DB。仅开发流程用,      │
│ 不打包不 ship,需 SA 权限。                             │
│                                                          │
│   ├─ xe-session.ts   XE session 启停 + .xel 读取       │
│   ├─ xe-parse.ts     解析 event_data XML → SQL 列表    │
│   ├─ snapshot-all.ts 广撒网 snapshot (所有 T_META_*)   │
│   └─ diff.ts         表级 + XML 语义 diff + trace 对账 │
└──────────────────────────────────────────────────────────┘
                          ↓ (人工整理)
        ┌─────────────────┴─────────────────┐
        ↓                                   ↓
┌──────────────────────────┐   ┌──────────────────────────┐
│ 知识层                   │   │ 运行时层 (ships to user) │
│ knowledge/skills/        │   │ src/main/                │
│   k3cloud/               │   │                          │
│   bos-features-index/    │   │  agent/bos-write-tools:  │
│   references/            │   │    kingdee_add_field(    │
│     add-field.md 🟢      │   │      extId,fieldType,    │
│                          │   │      config)             │
│ agent 通过 load_skill    │   │                          │
│ 读完再决策调什么 writer  │   │  erp/k3cloud/            │
│ + 组装什么 args          │   │   bos-field-writer.ts:   │
│                          │   │     按 fieldType 分发    │
│                          │   │                          │
│                          │   │  复用已有:                │
│                          │   │   bos-backup / bos-xml / │
│                          │   │   validator               │
└──────────────────────────┘   └──────────────────────────┘
```

### 边界 / 不变量

- **侦察层永远不进 production**：`scripts/bos-recon/output/**` 进 `.gitignore`（`.xel` 与 snapshot JSON 可能含客户数据）
- **运行时层不需要 SA**：沿用现有 `kingdee_create_extension_with_python_plugin` 的 pattern —— 事务 + backup + 有限白名单表；K/3 Cloud 普通业务账号应能做
- **知识层是跨层介质**：侦察产出转成 skill 内容；skill reference 同时给 agent 读和给开发者写 writer 参考
- **白名单与 backup 要扩**：`BOS_EXTENSION_TABLES`（现 8 张）扩到含字段相关 N 张（具体由 Phase 1 侦察决定）；`erp/validator.ts`（Plan 6 release gate）也要同步扩

## 4. 组件分解

### 4.1 侦察层 (scripts/bos-recon/)

**全新目录，4 个文件 + README**。入口是 `package.json` scripts。

| 文件 | 职责 | 关键 API |
|---|---|---|
| `xe-session.ts` | XE session 启停 + 输出路径管理 | `startSession({ sessionName, xelDir, clientAppFilter? })` / `stopSession(sessionName)` |
| `xe-parse.ts` | 读 `.xel` 文件 → 解析 event_data XML → 标准化 SQL 数组 | `parseXelFile(path) → Array<{ stmt, params, duration, txId, timestamp }>` |
| `snapshot-all.ts` | 广撒网 snapshot：扫所有 `T_META_*`，按候选键过滤到扩展 FID，输出 JSON | `snapshotAllMeta(pool, extId, label) → Promise<string>` |
| `diff.ts` | 两 snapshot JSON 语义 diff + XE trace 对账 + 输出 markdown report | `diffSnapshots(before, after, xeTrace) → ReconReport` |

**配套**：
- `scripts/bos-recon/README.md` — 使用流程（新 Claude 或新贡献者照着跑）
- `.gitignore` 增加 `scripts/bos-recon/output/**`

**package.json scripts**：
```json
"recon:snapshot-before": "tsx scripts/bos-recon/cli.ts snapshot-before",
"recon:xe-start":        "tsx scripts/bos-recon/cli.ts xe-start",
"recon:xe-stop":         "tsx scripts/bos-recon/cli.ts xe-stop",
"recon:snapshot-after":  "tsx scripts/bos-recon/cli.ts snapshot-after",
"recon:diff":            "tsx scripts/bos-recon/cli.ts diff"
```

CLI args 通过环境变量或命令行参数传入（扩展 FID / DB 连接 / 输出标签）。

### 4.2 运行时层 (src/main/)

**新建 1 个文件，扩已有 3 个**：

| 文件 | 动作 | 内容 |
|---|---|---|
| `src/main/erp/k3cloud/bos-field-writer.ts` | 🆕 新建 | `addField(pool, { projectId, extId, fieldType, config })` 入口；按 `fieldType` switch 到 `buildTextField` / `buildNumericField` / ...（Phase 2 只实现 `buildTextField`，其他报 `not-yet-implemented`）；返回 `FieldDelta = { sqlInserts, kernelXmlPatch }` |
| `src/main/agent/bos-write-tools.ts` | ✏️ 扩 | 新增 `addFieldTool(c, projectId)` 工厂；`buildBosWriteTools()` 末尾 push；parallelSafe 留空（写工具） |
| `src/main/erp/k3cloud/bos-backup.ts` | ✏️ 扩 | `BOS_EXTENSION_TABLES` 从 8 张扩到"8 张 + 字段相关 N 张"；`KEY_COLUMN` 对应扩 |
| `src/main/erp/k3cloud/bos-xml.ts` | ✏️ 扩 | 新增 `addFieldToKernelXml(currentXml, fieldDelta) → string` |

**`bos-writer.ts` 不动**（已 460 行，超出 CLAUDE.md 300 行软约，新 writer 独立文件）。

### 4.3 知识层 (knowledge/skills/k3cloud/bos-features-index/)

| 文件 | 动作 | 内容 |
|---|---|---|
| `references/add-field.md` | 🆕 新建 | 🟢 实证 SQL 蓝图：每张涉及表的 INSERT 语法 + FKERNELXML 字段 XML 模板 + 每列含义 + 已知坑；格式参照 `references/known-pitfalls.md`；`source:` 写 `OpenDeploy BOS 侦察实证 — 2026-04-24 — BOS Designer 版本 <Phase 1 填>` |
| `SKILL.md` | ✏️ 扩 | `files:` 清单加一行；body 的"能力地图"一节加 `加字段 → see references/add-field.md` |

### 4.4 测试

| 文件 | 动作 | 覆盖 |
|---|---|---|
| `tests/erp/k3cloud/bos-field-writer.test.ts` | 🆕 | `buildTextField(config)` 纯函数 → SQL text + params + XML patch；合法/非法 config（空 key / 超长 / 非法字符） |
| `tests/erp/k3cloud/bos-xml-add-field.test.ts` | 🆕 | `addFieldToKernelXml(currentXml, delta)` 纯函数 |
| `tests/agent/bos-write-tools-add-field.test.ts` | 🆕 | 工具 args schema 校验 / probe 失败 / result shape |

**不做 UI e2e 自动化**（BOS Designer 非 web，成本过高）——改 UAT 手动验证。

## 5. 数据流

### 5.1 Phase 1 侦察时序

```
你                        我 (Claude)                    DB / BOS Designer
──                        ───────────                    ─────────────────
告知已有扩展 FID ──────▶
                          pnpm recon:snapshot-before
                           ─ 所有 T_META_* WHERE fk=FID ─▶ SELECT *
                          ◀─ before.json
                          pnpm recon:xe-start
                           ─ CREATE EVENT SESSION       ─▶
                             + filter + file target
                          "去 BOS Designer 操作" ─▶
在扩展单据头加字段 ─────────────────────────────────────▶ (BOS Designer 写 DB)
F_TEST01 / 测试 / 50                                       INSERT/UPDATE 若干
保存                                                       (XE 抓到 .xel)
"保存完了" ────────────▶
                          pnpm recon:xe-stop
                           ─ 停 session + 读 .xel         ─▶
                          pnpm recon:snapshot-after
                          ◀─ after.json
                          pnpm recon:diff
                           ─ before/after 表级 diff
                             + FKERNELXML 语义 diff
                             + XE SQL 对账
                           ─ 输出 report.md
◀─ 展示 report 给你讨论确认

                          人工整理:
                           a. 写 skill reference 🟢
                           b. 扩 BOS_EXTENSION_TABLES
                           c. 写 bos-field-writer.ts
                           d. 写 addFieldToKernelXml
                           e. 暴露 kingdee_add_field
                           f. 单测
                          
新对话端到端 UAT ────▶    (走 Phase 2 时序)
```

### 5.2 Phase 2 运行时链路

```
1. 用户: "帮销售订单扩展加一个'备注2'字段,文本,长度 100"

2. Agent:
   ├─ 看 tools: 有 kingdee_add_field
   ├─ load_skill('k3cloud/bos-features-index')
   ├─ load_skill_file(.., 'references/add-field.md')  ← 拿 config schema
   ├─ kingdee_list_extensions('SAL_SaleOrder')        ← 拿扩展 FID
   └─ kingdee_add_field({
        extId: '<FID>',
        fieldType: 'text',
        config: { key: 'F_REMARK2', name: '备注2', length: 100 }
      })

3. 工具内部:
   ├─ ensureReady(c)
   ├─ validate(config)
   ├─ snapshotExtension(pool, extId, 'add-field')   ← 已扩展的白名单
   ├─ writeBackupSnapshot(projectId, snap)
   ├─ BEGIN TRAN
   │   ├─ SELECT FKERNELXML WITH (UPDLOCK, ROWLOCK)
   │   ├─ newXml = addFieldToKernelXml(current, delta)
   │   ├─ UPDATE T_META_OBJECTTYPE SET FKERNELXML...
   │   └─ INSERT T_META_FIELD / _L / _BILL... (由 Phase 1 决定)
   ├─ COMMIT
   └─ return { ok, backupFile, fieldKey, reminder }

4. Agent 回复用户,附 BOS Designer F5 + 客户端重登提示 + backup 路径
```

### 5.3 关键决策

- **XE filter 策略**：Phase 1 第一次**不加 filter**，先看原始 trace 体积；噪声大时再加 `client_app_name LIKE ...`。侦察阶段宁滥勿缺
- **XE target**：用 `event_file` 写 `.xel`（持久可重放）而非 `ring_buffer`（可能丢事件）
- **噪声基线**：正式 UAT 前先跑一次"空白 snapshot"（不做任何 BOS Designer 操作）看哪些列 / 表每次都变（审计列），建立噪声黑名单

## 6. 错误处理

### 6.1 侦察层 (dev scripts)

| 场景 | 处理 |
|---|---|
| XE 无权限 (`ALTER ANY EVENT SESSION`) | 脚本退出 + 明确提示用 sysadmin 账号 |
| 同名 session 残留 | 启动前 `IF EXISTS DROP EVENT SESSION` |
| `.xel` 文件未刷盘 | `STATE=STOP` 后等 1s 再读 |
| `.xel` XML 解析损坏事件 | 单事件 try/catch，损坏计数 + 继续 |
| snapshot 遇表不存在 | 跳过 + report 记 `missing table`，不 fallback |
| 候选键列全无匹配 | 跳过 + report 记 `unmatched table`，不算错 |
| FKERNELXML 是 binary 列 | 沿用 `bos-backup.stripBinary` 现有 `{__binary, bytes}` marker |
| 两次 snapshot 间 schema 变化 | 侦察期间禁止其他 BOS 元数据变更 |
| XE 解释不了某处 snapshot 变化 | report 标注 `⚠ unexplained` + 人工 review（可能走后台服务）|

### 6.2 运行时层

| 场景 | 处理 |
|---|---|
| `ensureReady` 失败 | throw，**不**进入写路径 |
| 参数校验失败 | throw 同步错，agent 澄清 |
| 扩展 FID 不存在 | throw `extension not found` |
| 字段 key 已存在 | throw `field already exists` |
| snapshot 失败 | throw 终止 |
| backup 写盘失败 | throw 终止（有 backup 才敢写）|
| 事务内 SQL 失败 | `tx.rollback()` + throw 带 backup 路径 |
| COMMIT 后失败 | throw + backup 依然有效，agent 提示用户去 BOS Designer 看实际状态 |
| 并发 lost update | 读 FKERNELXML 用 `WITH (UPDLOCK, ROWLOCK)` |

### 6.3 知识层

| 场景 | 处理 |
|---|---|
| skill reference 内容错 | 单测 + Phase 2 UAT 兜底 |
| `SKILL.md` `files:` 漏更新 | `pnpm knowledge:manifest` 必跑 |

## 7. 明确**不**做的（YAGNI）

- ❌ `dryRun: true` 参数 — Phase 3 看需求再加
- ❌ backup 自动清理 — Plan 6 Alpha 处理
- ❌ 自动 restore 工具 — CLAUDE.md 已标记未实装
- ❌ 侦察脚本 / `kingdee_add_field` 的幂等重跑 — 跑崩了 DROP 重来
- ❌ 非 SQL Server 侦察（只管 K/3 Cloud）
- ❌ UI 自动化（BOS Designer 的 Windows UIAutomation 探针作为 side quest，不进 plan）

## 8. Phase 1 侦察要回答的"未知"

这些**只能由侦察答**，现在为 `TBD`，不假设、不预先写死：

1. 字段涉及的具体表清单（估计在 `T_META_FIELD` / `T_META_FIELD_L` / `T_META_BILLFIELD` / `T_META_CTRL` 附近）
2. 字段 FID 是客户端生成（GUID）还是服务端 identity 分配
3. FKERNELXML 的字段 XML 子树结构（`<Entity>/<Fields>/<Field>` 嵌套）
4. ControlType / ValueSource / PropertyFlag 等属性的默认值和枚举
5. "单据头" vs "单据体" 的字段区分机制（可能是 `FENTITYID` / parent entity key）
6. BOS Designer 是否同步更新缓存表

## 9. 成功标准

**Phase 1 完成标志**：
- 侦察 4 文件 + README + package.json scripts 到位
- 能对任意扩展 FID 跑完整流程（snapshot-before → XE-start → 手动操作 → XE-stop → snapshot-after → diff → report）
- 产出一份覆盖"加文本字段"的 markdown report（包含所有涉及表 / SQL 清单 / XML delta / 对账结果）

**Phase 2 完成标志**：
- `knowledge/skills/k3cloud/bos-features-index/references/add-field.md` 🟢 实证就位
- `kingdee_add_field` 工具在 agent tools catalog 出现（projectId + K/3 Cloud 项目条件下）
- `BOS_EXTENSION_TABLES` + `validator` 白名单同步扩
- 单测全绿
- 在你环境端到端 UAT 跑通：新对话 → agent 调 `kingdee_add_field` → BOS Designer F5 刷新 → 客户端登录销售订单表单 → 看到新字段 → 填数据 → 保存成功

## 10. Phase 3+ 路线（本 plan 不含）

- 字段类型扩展：数字 / 日期 / 时间 / 复选框 / 下拉 / 基础资料（每类 ~1 PR，~1-2 小时：UAT + builder + skill 条目）
- 单据体字段（可能复用 `kingdee_add_field` 的 `config.entityKey` 参数）
- 其他 BOS 能力点（业务规则 / 转换规则 / 审批 / 套打 / 权限 / 移动端）—— 每类独立 plan，走同一套侦察方法学
