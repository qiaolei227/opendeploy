# OS 适配快捷键 + ERP 中立化文案 — 设计文档

- **日期**：2026-04-20
- **状态**：已批准
- **分支**：`feat/os-keys-erp-neutral`
- **承接**：follow-up polish on `feat/logo-wizard-redesign` (已 merge to master)

## 背景

两个独立的 UI 文案缺陷，合并在一个小分支里修：

1. **快捷键提示硬编码 macOS 符号**。`composer.hintLeft` 和 `TitleBar` 里都直接写 `⌘K`、`⌘/`、`Ctrl K`，Mac 用户看到 Windows 字、Windows 用户看到 Mac 字，两端都至少错一半。
2. **文案 Kingdee-specific**。架构已规定主应用 ERP 中立（`CLAUDE.md` → "Multi-ERP Provider 架构"），但 i18n 和组件里散着 8 处硬写"金蝶/BOS/T_SAL_*/T_META_*"。用户实际可绑任意 ERP（Plan 4 后），现在的 copy 和架构矛盾。

## 决策

### 1. OS 适配：纯前端 utility + i18next 插值

- 新建 `src/renderer/utils/platform.ts` 导出 `getModKey(): '⌘' | 'Ctrl'`，用 `navigator.userAgent.includes('Mac')` 判断。理由：Electron renderer 里稳定可用，同步，零 IPC，零状态。
- i18n 字符串改用 i18next 插值 `{{mod}}`，调用时传 `t('composer.hintLeft', { mod: getModKey() })`。
- `TitleBar` 里现在硬写的 `Ctrl K` 同步改用 `getModKey()`。

### 2. ERP 中立化：硬中立占位（YAGNI）

现阶段项目状态尚未接入（Plan 4 才做"项目级 ERP 绑定"），所以先把 Kingdee 特定词用通用词替换占位。等 Plan 4 加上项目 ERP 绑定后，再换成 `t('placeholder', { erp: 'Kingdee K/3' })` 动态插值。

具体替换：

| key | zh 旧 | zh 新 |
|---|---|---|
| `workspace.placeholder` | 描述一个**金蝶**二开需求... | 描述一个 ERP 二开需求... |
| `composer.placeholder` | 同上 | 同上 |
| `workspace.emptyDesc` | 再读取 **BOS** 元数据 | 再读取 ERP 元数据 |
| `workspace.securityReassurance` | SQL 白名单硬拦截 **T_SAL_*/T_AR_*** 等业务表，仅允许 **T_META_*** 结构信息 | SQL 白名单硬拦截客户业务表，仅允许元数据结构 |

en 对称中立化，同样移除 "Kingdee"、"BOS"、"T_META_*" 字样。

### 3. 识别层清理：`bos*` → `erp*` 重命名

Kingdee 特定命名不止在 UI 文案里，也在代码 identifier 里。顺手改：

- i18n key：`status.bosConnected/Disconnected` → `status.erpConnected/Disconnected`
- `StatusBar.tsx` prop：`bosConnected?: boolean` → `erpConnected?: boolean`（+ JSDoc 去 Kingdee 语气）
- `App.tsx` 调用处 `<StatusBar bosConnected={false} ... />` → `erpConnected={false}`

这三处改动必须原子化（一个 commit），否则中间态 TypeScript 报错。

## 改动清单

**Create**:
- `src/renderer/utils/platform.ts` — `getModKey()` + 类型

**Modify**:
- `src/renderer/components/Composer.tsx` — 用 `getModKey()`
- `src/renderer/components/TitleBar.tsx` — 用 `getModKey()`（替换硬写的 `Ctrl K`）
- `src/renderer/components/StatusBar.tsx` — prop 改名 `bos* → erp*` + JSDoc 去 Kingdee
- `src/renderer/App.tsx` — StatusBar 调用处 prop 改名
- `src/renderer/i18n/locales/zh-CN/common.json` — 6 处文案中立 + 2 key 改名
- `src/renderer/i18n/locales/en-US/common.json` — 对称

**Out of scope**:
- 项目级 ERP 绑定（Plan 4）
- Plan 6 打包/图标
- `CLAUDE.md` 硬红线里提到的 `T_META_*` 白名单代码（本 Plan 还没实现 SQL 白名单）
- 把"Kingdee"从 npm description 里移除（那是仓库 metadata，不是 UI）

## 测试

- i18n parity 测试自动覆盖 key 改名
- `pnpm typecheck` 覆盖 prop 改名
- 手测两个快捷键位置显示正确（Windows 下都是 `Ctrl`）

## 风险 & 回滚

- 三个 commit 每个都正交可独立 revert
- i18n key 改名（`bos*` → `erp*`）是 break change，但只影响组件内部，无外部 API 依赖
