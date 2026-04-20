# OS 适配快捷键 + ERP 中立化文案 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修两个独立的 UI polish bug：(1) 快捷键提示跟 OS 走（Mac 显示 `⌘`、其他显示 `Ctrl`）；(2) 把 Kingdee/BOS/K/3 Cloud 特定术语从 UI 里拿掉，换成 ERP 中立占位（等 Plan 4 项目绑定落地后再做动态插值）。

**Architecture:** 三个正交 commit：
1. `getModKey()` 纯前端 utility（`navigator.userAgent`）+ i18next `{{mod}}` 插值改造 Composer/TitleBar
2. i18n 文案中立化 + `bos*` → `erp*` 识别层改名（i18n key + StatusBar prop + App 调用处原子化）
3. 全量验证

**Tech Stack:** React 19 + TypeScript 6 · react-i18next 17 · Vitest 4（node env，无 jsdom — 手测通过 `pnpm dev` 验证）

**Design Reference:** `docs/superpowers/specs/2026-04-20-os-keys-erp-neutral-design.md`

---

## File Structure

**Create**:
- `src/renderer/utils/platform.ts` — `getModKey()` + 相关类型

**Modify**:
- `src/renderer/components/Composer.tsx` — 用 `getModKey()` 替换硬写 `⌘K`；i18n `t(...)` 传 `{ mod }`
- `src/renderer/components/TitleBar.tsx` — 用 `getModKey()` 替换硬写 `Ctrl K`
- `src/renderer/components/StatusBar.tsx` — prop `bosConnected/bosVersion` → `erpConnected/erpVersion`；JSDoc 去 Kingdee 语气
- `src/renderer/App.tsx` — `<StatusBar bosConnected={false} ... />` → `erpConnected={false}`
- `src/renderer/i18n/locales/zh-CN/common.json` — 4 处 ERP 中立文案 + 1 处 `{{mod}}` 插值 + key rename `bos*` → `erp*`
- `src/renderer/i18n/locales/en-US/common.json` — 对称

**Out of scope**：
- 项目级 ERP 绑定 / 动态 ERP 名插值（Plan 4）
- `package.json description` 里的 "Kingdee"（那是仓库 metadata）
- 硬红线里提到的 `T_META_*` SQL 白名单代码（Plan 4+）

---

## Task 1: Platform utility + 两处快捷键组件

新建 `getModKey()` utility，让 Composer 和 TitleBar 都跟 OS 走；i18n 字符串改用 `{{mod}}` 插值。

**Files:**
- Create: `src/renderer/utils/platform.ts`
- Modify: `src/renderer/components/Composer.tsx`
- Modify: `src/renderer/components/TitleBar.tsx`
- Modify: `src/renderer/i18n/locales/zh-CN/common.json`
- Modify: `src/renderer/i18n/locales/en-US/common.json`

---

- [ ] **Step 1: 创建 `src/renderer/utils/platform.ts`**

Write file content:

```ts
/**
 * Returns the platform-appropriate modifier-key label for display in
 * keyboard shortcut hints.
 *
 * - macOS → `⌘`
 * - Windows / Linux / other → `Ctrl`
 *
 * Uses `navigator.userAgent` (stable, non-deprecated) over
 * `navigator.platform` (deprecated) to make the detection.
 *
 * The value is fixed for the lifetime of the renderer — users don't
 * change OS at runtime — so this is a plain function rather than a hook.
 */
export function getModKey(): '⌘' | 'Ctrl' {
  if (typeof navigator === 'undefined') return 'Ctrl';
  const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent);
  return isMac ? '⌘' : 'Ctrl';
}
```

---

- [ ] **Step 2: 改 i18n composer.hintLeft 两份 locale 用 `{{mod}}` 插值**

Edit `src/renderer/i18n/locales/zh-CN/common.json`. Find in the `composer` block:

```json
    "hintLeft": "⌘K 命令面板 · ⌘/ 切换知识",
```

Change to:

```json
    "hintLeft": "{{mod}}K 命令面板 · {{mod}}/ 切换知识",
```

Edit `src/renderer/i18n/locales/en-US/common.json`. Find in the `composer` block:

```json
    "hintLeft": "⌘K palette · ⌘/ toggle skills",
```

Change to:

```json
    "hintLeft": "{{mod}}K palette · {{mod}}/ toggle skills",
```

---

- [ ] **Step 3: 改 `Composer.tsx`**

Edit `src/renderer/components/Composer.tsx`. Two things:
1. Add `getModKey` import at top
2. Replace the hardcoded `⌘K` span + i18n call on line 68

Current imports:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '@renderer/stores/chat-store';
import { useSettingsStore } from '@renderer/stores/settings-store';
import { PROVIDER_BY_ID } from '@renderer/data/providers';
import { Icons } from './icons';
```

Add a new import line after `Icons`:

```tsx
import { getModKey } from '@renderer/utils/platform';
```

Current `chint` block (around line 67-70):

```tsx
        <div className="chint">
          <span><span className="kbd">⌘K</span> {t('composer.hintLeft')}</span>
          <span>{t('composer.hintRight')}</span>
        </div>
```

Change to:

```tsx
        <div className="chint">
          <span>{t('composer.hintLeft', { mod: getModKey() })}</span>
          <span>{t('composer.hintRight')}</span>
        </div>
```

Note: the outer hardcoded `<span className="kbd">⌘K</span>` disappears entirely because the i18n string now contains both mod tokens inline. That also eliminates the duplicated `⌘K ⌘K` rendering bug.

---

- [ ] **Step 4: 改 `TitleBar.tsx`**

Edit `src/renderer/components/TitleBar.tsx`. Two things:
1. Add `getModKey` import
2. Replace hardcoded `Ctrl K` span on line 45

Current imports:

```tsx
import { useTranslation } from 'react-i18next';
import { Icons } from '@renderer/components/icons';
import { LogoMark } from '@renderer/components/LogoMark';
```

Add a new import:

```tsx
import { getModKey } from '@renderer/utils/platform';
```

Current tb-search block:

```tsx
      <div className="tb-search">
        {Icons.search}
        <span>{t('common.search')}</span>
        <span className="kbd">Ctrl K</span>
      </div>
```

Change to:

```tsx
      <div className="tb-search">
        {Icons.search}
        <span>{t('common.search')}</span>
        <span className="kbd">{getModKey()} K</span>
      </div>
```

---

- [ ] **Step 5: Verify typecheck + i18n parity**

Run: `pnpm typecheck`
Expected: PASS.

Run: `pnpm test tests/i18n.test.ts`
Expected: 3/3 PASS (parity preserved — we only changed values, not keys).

Run: `pnpm test`
Expected: 26/26 PASS.

---

- [ ] **Step 6: Commit**

```bash
git add src/renderer/utils/platform.ts src/renderer/components/Composer.tsx src/renderer/components/TitleBar.tsx src/renderer/i18n/locales/zh-CN/common.json src/renderer/i18n/locales/en-US/common.json
git commit -m "feat(ui): OS-adaptive modifier key in shortcut hints

New getModKey() utility returns ⌘ on macOS, Ctrl elsewhere.
Composer and TitleBar now display the correct key; i18n composer.hintLeft
uses {{mod}} interpolation. Also fixes a latent bug where Composer
rendered the mod key twice ('⌘K ⌘K palette')."
```

---

## Task 2: ERP 中立化文案 + `bos*` → `erp*` 原子改名

把 Kingdee/BOS 特定术语从 UI 里拿掉；顺手改 i18n key 和 StatusBar prop 名，保持代码和文案一致。必须原子（i18n key 改 + prop 改 + App 调用处同步）才不会中间态 TS 报错。

**Files:**
- Modify: `src/renderer/i18n/locales/zh-CN/common.json`
- Modify: `src/renderer/i18n/locales/en-US/common.json`
- Modify: `src/renderer/components/StatusBar.tsx`
- Modify: `src/renderer/App.tsx`

---

- [ ] **Step 1: zh-CN 文案中立化 + key 改名**

Edit `src/renderer/i18n/locales/zh-CN/common.json`. Four edits in sequence:

**(a)** In `workspace` block, change:

```json
    "emptyDesc": "用日常语言说清楚客户想要什么。OpenDeploy 会先问澄清问题，再读取 BOS 元数据，最后给你可直接粘贴到客户环境的 Python 插件。",
```

to:

```json
    "emptyDesc": "用日常语言说清楚客户想要什么。OpenDeploy 会先问澄清问题，再读取 ERP 元数据，最后给你可直接粘贴到客户环境的 Python 插件。",
```

**(b)** In `workspace` block, change:

```json
    "securityReassurance": "本次会话不会访问你客户的业务数据。SQL 白名单硬拦截 T_SAL_* / T_AR_* 等业务表，仅允许 T_META_* 结构信息。"
```

to:

```json
    "securityReassurance": "本次会话不会访问你客户的业务数据。SQL 白名单硬拦截客户业务表，仅允许元数据结构信息。"
```

**(c)** In `workspace` block, change:

```json
    "placeholder": "描述一个金蝶二开需求...",
```

to:

```json
    "placeholder": "描述一个 ERP 二开需求...",
```

**(d)** In `composer` block, change:

```json
    "placeholder": "描述一个金蝶二开需求…",
```

to:

```json
    "placeholder": "描述一个 ERP 二开需求…",
```

(Note: `composer.placeholder` uses horizontal ellipsis `…`, `workspace.placeholder` uses three dots `...` — keep those as-is; different contexts use slightly different punctuation already.)

**(e)** In `status` block, rename the two `bos*` keys. Current:

```json
  "status": {
    "bosConnected": "BOS 已连接",
    "bosDisconnected": "BOS 未连接",
    ...
  },
```

Change to:

```json
  "status": {
    "erpConnected": "ERP 已连接",
    "erpDisconnected": "ERP 未连接",
    ...
  },
```

---

- [ ] **Step 2: en-US 文案中立化 + key 改名（对称）**

Edit `src/renderer/i18n/locales/en-US/common.json`. Same four edits:

**(a)** `workspace.emptyDesc`:

```json
    "emptyDesc": "Describe what the client wants. OpenDeploy clarifies, reads BOS metadata, and hands you a paste-ready Python plugin.",
```

→

```json
    "emptyDesc": "Describe what the client wants. OpenDeploy clarifies, reads ERP metadata, and hands you a paste-ready Python plugin.",
```

**(b)** `workspace.securityReassurance`:

```json
    "securityReassurance": "This session does not read business data. SQL whitelist hard-blocks T_SAL_*/T_AR_*; only T_META_* structure is allowed."
```

→

```json
    "securityReassurance": "This session does not read business data. SQL whitelist hard-blocks client business tables; only metadata structure is allowed."
```

**(c)** `workspace.placeholder`:

```json
    "placeholder": "Describe a Kingdee customization need...",
```

→

```json
    "placeholder": "Describe an ERP customization need...",
```

**(d)** `composer.placeholder`:

```json
    "placeholder": "Describe a Kingdee customization need…",
```

→

```json
    "placeholder": "Describe an ERP customization need…",
```

**(e)** `status.bosConnected/Disconnected` → `status.erpConnected/Disconnected`:

```json
  "status": {
    "bosConnected": "BOS connected",
    "bosDisconnected": "BOS not connected",
```

→

```json
  "status": {
    "erpConnected": "ERP connected",
    "erpDisconnected": "ERP not connected",
```

---

- [ ] **Step 3: `StatusBar.tsx` prop + JSDoc + label 改名**

Edit `src/renderer/components/StatusBar.tsx`. Three coordinated changes:

**(a)** Rename props in interface. Current:

```tsx
export interface StatusBarProps {
  /** Currently selected LLM provider id (e.g. 'deepseek'). `undefined` means not configured. */
  llmProviderId?: string;
  /** Whether BOS (Kingdee K/3 Cloud) is currently connected. */
  bosConnected?: boolean;
  /** BOS version string shown next to the connection state, e.g. "V9.1.0.2". */
  bosVersion?: string;
  /** Skills bundle short git hash, e.g. "@4a7f1b2". */
  skillsVersion?: string;
  /** Number of installed skill packs. `0` or missing falls back to built-in label. */
  skillsCount?: number;
  /** App version, e.g. "v0.1.3". */
  appVersion?: string;
  /** Whether a product update is available. */
  updateAvailable?: boolean;
  /** Tokens consumed this session. */
  tokensUsed?: number;
}
```

Change to:

```tsx
export interface StatusBarProps {
  /** Currently selected LLM provider id (e.g. 'deepseek'). `undefined` means not configured. */
  llmProviderId?: string;
  /** Whether the target ERP is currently connected. */
  erpConnected?: boolean;
  /** ERP version string shown next to the connection state, e.g. "V9.1.0.2". */
  erpVersion?: string;
  /** Skills bundle short git hash, e.g. "@4a7f1b2". */
  skillsVersion?: string;
  /** Number of installed skill packs. `0` or missing falls back to built-in label. */
  skillsCount?: number;
  /** App version, e.g. "v0.1.3". */
  appVersion?: string;
  /** Whether a product update is available. */
  updateAvailable?: boolean;
  /** Tokens consumed this session. */
  tokensUsed?: number;
}
```

**(b)** Update the JSDoc on the component. Current:

```tsx
/**
 * StatusBar — bottom status/footer bar.
 *
 * Ported from `design/components/App.jsx` `StatusBar` function.
 *
 * MVP-0.1 reality: most props are optional/undefined — there is no real BOS
 * connection yet, skills don't exist, update channel isn't wired. The component
 * renders gracefully with missing values, showing "not connected" / "built-in"
 * / "not set" fallbacks instead of crashing.
 */
```

Change to:

```tsx
/**
 * StatusBar — bottom status/footer bar.
 *
 * Ported from `design/components/App.jsx` `StatusBar` function.
 *
 * MVP-0.1 reality: most props are optional/undefined — there is no real ERP
 * connection yet, skills don't exist, update channel isn't wired. The component
 * renders gracefully with missing values, showing "not connected" / "built-in"
 * / "not set" fallbacks instead of crashing.
 */
```

**(c)** Update function destructure and label-building code. Current:

```tsx
export function StatusBar({
  llmProviderId,
  bosConnected = false,
  bosVersion,
  skillsVersion,
  skillsCount = 0,
  appVersion,
  updateAvailable = false,
  tokensUsed = 0
}: StatusBarProps) {
  const { t } = useTranslation();

  const bosLabel = bosConnected
    ? `${t('status.bosConnected')}${bosVersion ? ` · ${bosVersion}` : ''}`
    : t('status.bosDisconnected');
```

Change the whole destructure + label construction to:

```tsx
export function StatusBar({
  llmProviderId,
  erpConnected = false,
  erpVersion,
  skillsVersion,
  skillsCount = 0,
  appVersion,
  updateAvailable = false,
  tokensUsed = 0
}: StatusBarProps) {
  const { t } = useTranslation();

  const erpLabel = erpConnected
    ? `${t('status.erpConnected')}${erpVersion ? ` · ${erpVersion}` : ''}`
    : t('status.erpDisconnected');
```

**(d)** Update JSX using `bosLabel` / `bosConnected` later in the render. Current:

```tsx
      <span className={`sbseg ${bosConnected ? 'good' : ''}`.trim()}>
        <span className="sbdot" />
        {bosLabel}
      </span>
```

Change to:

```tsx
      <span className={`sbseg ${erpConnected ? 'good' : ''}`.trim()}>
        <span className="sbdot" />
        {erpLabel}
      </span>
```

---

- [ ] **Step 4: `App.tsx` StatusBar 调用处改名**

Edit `src/renderer/App.tsx`. The StatusBar is rendered at the bottom of the `App()` function. Current:

```tsx
          {!isWizard && (
            <StatusBar
              llmProviderId={settings.llmProvider}
              bosConnected={false}
              appVersion="v0.1.0-alpha.1"
            />
          )}
```

Change to:

```tsx
          {!isWizard && (
            <StatusBar
              llmProviderId={settings.llmProvider}
              erpConnected={false}
              appVersion="v0.1.0-alpha.1"
            />
          )}
```

---

- [ ] **Step 5: Verify typecheck + full tests**

Run: `pnpm typecheck`
Expected: PASS. (TypeScript will fail if any `bos*` reference slipped through rename — that's how we know we caught everything.)

Run: `pnpm test`
Expected: 26/26 PASS. (i18n parity test verifies both locales still have matching key sets.)

---

- [ ] **Step 6: Grep check for stragglers**

Run a search to confirm no orphan references left:

```bash
grep -rn "bosConnected\|bosDisconnected\|bosVersion\|bosLabel" src/ 2>/dev/null || echo "CLEAN"
```

Expected: output is `CLEAN` (no matches in `src/`). If any matches appear, fix them before committing.

```bash
grep -rn "Kingdee\|金蝶\|BOS 元数据\|BOS metadata\|T_SAL_\|T_META_\|T_AR_" src/ 2>/dev/null || echo "CLEAN"
```

Expected: `CLEAN`. Note: `StatusBar.tsx` example version `"V9.1.0.2"` is a neutral version format and stays; it's no longer Kingdee-specific given we removed the K/3 wording from the JSDoc.

---

- [ ] **Step 7: Commit**

```bash
git add src/renderer/i18n/locales/zh-CN/common.json src/renderer/i18n/locales/en-US/common.json src/renderer/components/StatusBar.tsx src/renderer/App.tsx
git commit -m "refactor: make UI copy and identifiers ERP-neutral

Removes Kingdee/BOS/T_SAL_*/T_META_* specific terms from user-facing
copy (placeholder, empty state, security reassurance, connection
status). Renames bos* → erp* across i18n keys, StatusBar props, and
the App caller in one atomic commit. Project-driven dynamic ERP
name interpolation is deferred to Plan 4 (project ERP binding)."
```

---

## Task 3: 全量验证

确保三组正交改动整合无回归。

**Files:** N/A

---

- [ ] **Step 1: Typecheck**

Run: `pnpm typecheck`
Expected: 无错误。

---

- [ ] **Step 2: Tests**

Run: `pnpm test`
Expected: 26/26 PASS，8 test files。

---

- [ ] **Step 3: Build**

Run: `pnpm build`
Expected: 构建成功，`out/main/index.js`、`out/preload/index.mjs`、`out/renderer/index.html + assets/*` 全部生成。

(`pnpm lint` 在 master 上就坏的，ESLint 9 需要 `eslint.config.js` — 不是本计划范围，忽略。)

---

- [ ] **Step 4: 手测清单（通过 `pnpm dev`）**

启动 `pnpm dev`，确认：

- [ ] Windows 下 `TitleBar` 右侧显示 `Ctrl K`（不是 `⌘ K`）
- [ ] Workspace 的 Composer 下方提示栏显示"Ctrl K 命令面板 · Ctrl/ 切换知识"（不再有重复的 `⌘K`）
- [ ] Workspace 空状态文案是 "描述一个 ERP 二开需求..." / "再读取 ERP 元数据"
- [ ] Composer placeholder 是 "描述一个 ERP 二开需求…"
- [ ] StatusBar 左侧显示"ERP 未连接"（不是"BOS 未连接"）
- [ ] 切换 Settings → English → 所有文本变英文 "ERP customization need" / "ERP not connected" / "Ctrl K palette" 等
- [ ] 回到 Workspace → 安全说明文案显示"SQL 白名单硬拦截客户业务表，仅允许元数据结构信息"（不再出现 T_* 表名）

---

- [ ] **Step 5: 若全部通过，无需新 commit（Task 1 + Task 2 已 commit）。检查 log：**

Run: `git log --oneline master..HEAD`

Expected: 看到 2 个新 commit（Task 1 + Task 2）。

---

## Self-Review 映射

| Spec 要求 | 对应任务 |
|---|---|
| `getModKey()` utility | Task 1 Step 1 |
| Composer 用 `getModKey()` | Task 1 Step 3 |
| TitleBar 用 `getModKey()` | Task 1 Step 4 |
| `composer.hintLeft` `{{mod}}` 插值 | Task 1 Step 2 |
| `workspace.placeholder` 中立 | Task 2 Step 1c + Step 2c |
| `composer.placeholder` 中立 | Task 2 Step 1d + Step 2d |
| `workspace.emptyDesc` 中立 | Task 2 Step 1a + Step 2a |
| `workspace.securityReassurance` 中立 | Task 2 Step 1b + Step 2b |
| `status.bosConnected/Disconnected` 改名 | Task 2 Step 1e + Step 2e |
| StatusBar prop `bos*` → `erp*` | Task 2 Step 3 |
| StatusBar JSDoc 去 Kingdee | Task 2 Step 3b |
| App.tsx 调用处改名 | Task 2 Step 4 |
| typecheck + test + build | Task 3 |
