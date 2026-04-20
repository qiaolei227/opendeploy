# Logo + Wizard + 应用名重设计 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 logo 从绿色方块换成 Claude Code 赤陶橙的 **B-2 花括号→橙点** 设计；Wizard 首屏精简为 Linear 风 hero；Electron 应用名改成 `OpenDeploy`（系统层固定）+ `开达`/`OpenDeploy`（运行时跟 i18n）。

**Architecture:** 三组正交改动，按依赖顺序落地：
1. **共用 LogoMark 组件** — 先有组件，后面任务才能复用，也能并行替换 TitleBar + WizardPage 两处 inline SVG。
2. **Wizard Step 0 精简** — Hero + CTA + chips，去掉 stepper 和特性卡。
3. **应用名多语言链路** — `productName` / `app.setName` 静态；`setWindowTitle` IPC + renderer 的 `useEffect` 实现动态跟 i18n 切换。

**Tech Stack:** Electron 41 · React 19 + TypeScript 6 · react-i18next · Vitest 4（**仅 node 环境，不含 jsdom**——组件视觉改动通过 `pnpm dev` 手测 + `pnpm typecheck` 兜底；i18n 改动由已有 parity 测试覆盖）

**Design Reference:** `docs/superpowers/specs/2026-04-20-logo-wizard-redesign-design.md`

---

## File Structure

**Create**:
- `resources/icon.svg` — B-2 logo 源文件（设计资产）
- `src/renderer/components/LogoMark.tsx` — 共用 React 组件

**Modify**:
- `package.json` — 加 `productName`
- `src/main/index.ts` — `app.setName` 在 `.whenReady` 之前
- `src/main/window.ts` — 默认 `win.setTitle('开达')`
- `src/main/ipc.ts` — 新增 `setWindowTitle` handler
- `src/preload/index.ts` — 暴露 `setWindowTitle`
- `src/shared/types.ts` — `IpcApi` 加 `setWindowTitle`
- `src/renderer/types/window.d.ts` — 同步类型（若需要）
- `src/renderer/index.html` — `<title>` 默认值
- `src/renderer/App.tsx` — 语言切换 `useEffect` 同步 `document.title` + IPC
- `src/renderer/pages/WizardPage.tsx` — Step 0 重排 + 用 LogoMark
- `src/renderer/components/TitleBar.tsx` — 用 LogoMark
- `src/renderer/i18n/locales/zh-CN/common.json` — 修 `app.name` + 加 `wizard.startCta`
- `src/renderer/i18n/locales/en-US/common.json` — 加 `wizard.startCta`
- `src/renderer/styles/design-system.css` — 新增 `.wiz-hero` / `.wiz-chips` 样式

**Out of scope**（明确留给 Plan 6 打包）：
- 生成 `.ico` / `.icns` / 多尺寸 PNG
- 在 `BrowserWindow` 里设置 `icon` 属性（dev 期仍用默认 Electron icon）
- electron-builder 配置

---

## Task 1: 创建 LogoMark 组件 + SVG 源文件

产出一个可复用的 React 组件，后续任务替换两处 inline SVG 都用它。支持 `default`（浅底黑括号）和 `inverse`（深底白括号）两种变体，橙色圆心 `#D97757` 不变。

**Files:**
- Create: `resources/icon.svg`
- Create: `src/renderer/components/LogoMark.tsx`

---

- [ ] **Step 1: 创建 `resources/icon.svg`**

Write file `resources/icon.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none">
  <path d="M18 10 Q12 10 12 16 L12 22 Q12 24 8 24 Q12 24 12 26 L12 32 Q12 38 18 38"
        stroke="#141414" stroke-width="2.5" fill="none"
        stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="32" cy="24" r="6" fill="#D97757"/>
  <circle cx="32" cy="24" r="2" fill="#fafaf7"/>
</svg>
```

验证：文件存在即可，此步无命令。

---

- [ ] **Step 2: 创建 `src/renderer/components/LogoMark.tsx`**

Write file content:

```tsx
import type { ReactElement } from 'react';

export interface LogoMarkProps {
  /** Rendered pixel size (applies to both width and height). */
  size: number;
  /** `default` for light surfaces (dark bracket), `inverse` for dark surfaces (light bracket). */
  variant?: 'default' | 'inverse';
  /** Optional accessible label. */
  label?: string;
}

/**
 * LogoMark — the 开达 / OpenDeploy brand mark.
 *
 * Design: B-2 bracket → orange dot (from `design/logo-options-v2.html`).
 * - Left side: rounded opening brace (开 = open / code).
 * - Right side: Claude Code terracotta `#D97757` solid circle with an
 *   ivory inset dot (达 = aim / deliver).
 *
 * Source of truth SVG lives at `resources/icon.svg`.
 */
export function LogoMark({ size, variant = 'default', label }: LogoMarkProps): ReactElement {
  const strokeColor = variant === 'inverse' ? '#fafaf7' : '#141414';
  const accent = '#D97757';
  const inset = '#fafaf7';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path
        d="M18 10 Q12 10 12 16 L12 22 Q12 24 8 24 Q12 24 12 26 L12 32 Q12 38 18 38"
        stroke={strokeColor}
        strokeWidth={2.5}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={32} cy={24} r={6} fill={accent} />
      <circle cx={32} cy={24} r={2} fill={inset} />
    </svg>
  );
}

export default LogoMark;
```

---

- [ ] **Step 3: 验证 typecheck 通过**

Run: `pnpm typecheck`

Expected: 无 TS 报错（组件是新建，不影响其他文件）。

---

- [ ] **Step 4: Commit**

```bash
git add resources/icon.svg src/renderer/components/LogoMark.tsx
git commit -m "feat(ui): add LogoMark component + B-2 brand SVG source

Claude Code terracotta #D97757 bracket-to-dot mark, replacing the
legacy green square. Two variants (default/inverse) for light/dark
surfaces."
```

---

## Task 2: 替换 TitleBar inline SVG 为 LogoMark

删掉 `TitleBar.tsx` 里旧的绿色方块 SVG（26-46 行），用 `<LogoMark size={22} variant="inverse" />`。

**Files:**
- Modify: `src/renderer/components/TitleBar.tsx`

---

- [ ] **Step 1: Edit TitleBar.tsx import**

在 `TitleBar.tsx` 顶部 `Icons` import 旁边加 `LogoMark` import。修改后 imports 部分应为：

```tsx
import { useTranslation } from 'react-i18next';
import { Icons } from '@renderer/components/icons';
import { LogoMark } from '@renderer/components/LogoMark';
```

---

- [ ] **Step 2: 替换 brand-mark 内部的 SVG**

`TitleBar.tsx` 当前 25-47 行整块替换。把：

```tsx
<div className="brand-mark" aria-label="开达 OpenDeploy">
  <svg width="22" height="22" viewBox="0 0 48 48" fill="none">
    <rect width="48" height="48" rx="10" fill="#3d7a5a" />
    <rect x="14" y="11" width="20" height="12" rx="2" fill="#fafaf7" />
    <path
      d="M20 27 L24 31 L28 27"
      stroke="#fafaf7"
      strokeWidth="2.5"
      fill="none"
      strokeLinecap="square"
      strokeLinejoin="miter"
    />
    <line
      x1="10"
      y1="37"
      x2="38"
      y2="37"
      stroke="#fafaf7"
      strokeWidth="2.5"
      strokeLinecap="square"
    />
  </svg>
</div>
```

换成：

```tsx
<div className="brand-mark">
  <LogoMark size={22} variant="inverse" label="开达 OpenDeploy" />
</div>
```

---

- [ ] **Step 3: 验证 typecheck 通过**

Run: `pnpm typecheck`

Expected: 无报错。

---

- [ ] **Step 4: 手测 TitleBar 视觉**

Run: `pnpm dev`

预期：应用顶栏 brand 位置显示白色花括号 + 橙色圆心，替代原绿色方块。"开达" + "OpenDeploy" 文字不变。

手测 OK 后关闭应用，继续下一步。

---

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/TitleBar.tsx
git commit -m "feat(ui): use LogoMark in TitleBar

Replaces the legacy green square inline SVG with the shared LogoMark
component in inverse variant (dark titlebar background)."
```

---

## Task 3: 修 zh-CN i18n 的 app.name 并加 wizard.startCta

zh-CN 里 `app.name` 当前错写成 `"OpenDeploy"`，应为 `"开达"`。同时两份 locale 都加 Wizard 新 CTA 的 key。i18n parity test 会自动校验。

**Files:**
- Modify: `src/renderer/i18n/locales/zh-CN/common.json`
- Modify: `src/renderer/i18n/locales/en-US/common.json`

---

- [ ] **Step 1: 修 zh-CN `app.name`**

Edit `src/renderer/i18n/locales/zh-CN/common.json`:

把

```json
"app": {
    "name": "OpenDeploy",
    "tagline": "实施交付智能体"
  },
```

改成

```json
"app": {
    "name": "开达",
    "tagline": "实施交付智能体"
  },
```

---

- [ ] **Step 2: zh-CN 的 wizard 块加 startCta**

Edit `src/renderer/i18n/locales/zh-CN/common.json` 的 `wizard` 块。把 `"finish": "开始工作"` 这行改成：

```json
    "finish": "开始工作",
    "startCta": "开始使用"
```

(保持在 `wizard` 块结尾 `}` 之前。)

---

- [ ] **Step 3: en-US 的 wizard 块加 startCta**

Edit `src/renderer/i18n/locales/en-US/common.json` 的 `wizard` 块。把 `"finish": "Start"` 改成：

```json
    "finish": "Start",
    "startCta": "Get started"
```

---

- [ ] **Step 4: 运行 i18n parity 测试**

Run: `pnpm test tests/i18n.test.ts`

Expected: 3 个测试全部 pass（top-level keys 对齐、嵌套 keys 对齐、值非空）。

---

- [ ] **Step 5: Commit**

```bash
git add src/renderer/i18n/locales/zh-CN/common.json src/renderer/i18n/locales/en-US/common.json
git commit -m "fix(i18n): correct zh-CN app.name to 开达 + add wizard.startCta"
```

---

## Task 4: Wizard Step 0 精简（hero + CTA + chips）

把原三列特性卡 + stepper + 大标语 换成极简 hero 布局。Step 1/2 保持原样。

**Files:**
- Modify: `src/renderer/pages/WizardPage.tsx`
- Modify: `src/renderer/styles/design-system.css`

---

- [ ] **Step 1: 在 design-system.css 加 hero + chips 样式**

Edit `src/renderer/styles/design-system.css`：在文件中找到 `.wiz-progress { ... }` 的定义（约 1056 行），**紧接其后**追加以下 block：

```css
/* Wizard Step 0 hero — Linear-style minimalist welcome */
.wiz-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18px;
  padding: 28px 0 12px;
}
.wiz-hero .mark {
  width: 80px; height: 80px;
  display: grid; place-items: center;
}
.wiz-hero h1 {
  font-family: var(--font-serif);
  font-weight: 600;
  font-size: 48px;
  letter-spacing: -0.02em;
  color: var(--ink);
  margin: 0;
  line-height: 1.1;
}
.wiz-hero .tagline {
  font-size: 15px;
  color: var(--muted);
  text-align: center;
  max-width: 420px;
  line-height: 1.5;
  margin: 0;
}
.wiz-hero .cta {
  margin-top: 8px;
}
.wiz-chips {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: var(--muted);
  margin-top: 4px;
  flex-wrap: wrap;
}
.wiz-chips .chip-dot {
  color: var(--dim);
  margin: 0 2px;
}
.wiz-chips .chip-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.wiz-chips .chip-item svg {
  color: var(--accent-deep);
}
```

---

- [ ] **Step 2: 重写 WizardPage.tsx**

Write file `src/renderer/pages/WizardPage.tsx`（全文替换，因为改动集中在 Step 0，但顺带清理 import / 去掉旧 logo SVG / 去掉 featureCards 变量）：

```tsx
import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '@renderer/stores/settings-store';
import { PROVIDERS, PROVIDER_BY_ID } from '@renderer/data/providers';
import { Icons } from '@renderer/components/icons';
import { LogoMark } from '@renderer/components/LogoMark';

interface WizardPageProps {
  /** Called after the user clicks "Finish" on the final step. */
  onFinish: () => void;
}

/**
 * WizardPage — 3-step onboarding wizard.
 *
 * Step 0 is a Linear-style minimalist hero (big logo + brand +
 * single-line tagline + primary CTA + one-line feature chips). The
 * stepper and `back` button only appear from Step 1 onward.
 *
 * Step 1 (provider) and Step 2 (done) keep the existing structure.
 */
export function WizardPage({ onFinish }: WizardPageProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const setLlmProvider = useSettingsStore((s) => s.setLlmProvider);
  const setApiKey = useSettingsStore((s) => s.setApiKey);

  // Stepper only covers the two "real" onboarding steps — Step 0 is a hero.
  const steps = [t('wizard.stepProvider'), t('wizard.stepDone')];
  const stepperIndex = step - 1; // -1 on step 0 = hidden

  const selectedProviderLabel =
    (selectedProvider && PROVIDER_BY_ID[selectedProvider]?.short) ?? '—';

  const handleFinish = async (): Promise<void> => {
    if (selectedProvider) {
      await setLlmProvider(selectedProvider);
      if (selectedProvider !== 'ollama' && apiKeyInput.trim()) {
        await setApiKey(selectedProvider, apiKeyInput.trim());
      }
    }
    onFinish();
  };

  const providerStepBlocked =
    !selectedProvider ||
    (selectedProvider !== 'ollama' && !apiKeyInput.trim());

  return (
    <div className="wizard">
      <div className="wiz-card">
        {step === 0 ? (
          <>
            <div className="wiz-hero">
              <div className="mark">
                <LogoMark size={80} variant="default" label="开达" />
              </div>
              <h1>{t('app.name')}</h1>
              <p className="tagline">{t('wizard.tagline')}</p>
              <button
                type="button"
                className="btn primary lg cta"
                onClick={() => setStep(1)}
              >
                {t('wizard.startCta')} →
              </button>
              <div className="wiz-chips">
                <span className="chip-item">
                  {Icons.shield}
                  {t('wizard.feat1Title')}
                </span>
                <span className="chip-dot">·</span>
                <span className="chip-item">
                  {Icons.brain}
                  {t('wizard.feat2Title')}
                </span>
                <span className="chip-dot">·</span>
                <span className="chip-item">
                  {Icons.book}
                  {t('wizard.feat3Title')}
                </span>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="wiz-stepper">
              {steps.map((s, i) => (
                <Fragment key={i}>
                  <span
                    className={`s ${i < stepperIndex ? 'done' : i === stepperIndex ? 'cur' : ''}`}
                  >
                    <span className="n">{i < stepperIndex ? '✓' : i + 1}</span>
                    {s}
                  </span>
                  {i < steps.length - 1 && <span className="dash" />}
                </Fragment>
              ))}
            </div>

            <div className="wiz-body">
              {step === 1 && (
                <>
                  <h3>{t('wizard.providerHeading')}</h3>
                  <div className="hint">{t('wizard.providerDesc')}</div>
                  <div
                    className="prov-grid"
                    style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}
                  >
                    {PROVIDERS.map((p) => {
                      const active = selectedProvider === p.id;
                      return (
                        <div
                          key={p.id}
                          className={`prov-card${active ? ' on' : ''}`}
                          onClick={() => setSelectedProvider(p.id)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setSelectedProvider(p.id);
                            }
                          }}
                        >
                          <div className="prov-title">
                            <span className={`prov-dot ${p.dot}`}>{p.letter}</span>
                            {p.label}
                            {p.recommended && (
                              <span
                                className="chip accent"
                                style={{ marginLeft: 'auto' }}
                              >
                                {t('settings.recommended')}
                              </span>
                            )}
                          </div>
                          <div className="prov-sub">{p.sub}</div>
                        </div>
                      );
                    })}
                  </div>
                  {selectedProvider && (
                    <div style={{ marginTop: 16 }}>
                      {selectedProvider === 'ollama' ? (
                        <div className="hint">{t('settings.ollamaNoKey')}</div>
                      ) : (
                        <>
                          <label
                            style={{
                              display: 'block',
                              fontSize: 12,
                              fontWeight: 600,
                              marginBottom: 6
                            }}
                          >
                            {t('settings.apiKey')}
                          </label>
                          <input
                            type="password"
                            value={apiKeyInput}
                            onChange={(e) => setApiKeyInput(e.target.value)}
                            placeholder={t('settings.apiKeyPlaceholder')}
                            style={{
                              width: '100%',
                              padding: '8px 12px',
                              border: '1px solid var(--border)',
                              borderRadius: 6,
                              background: 'var(--surface)',
                              color: 'var(--ink)',
                              fontSize: 13,
                              fontFamily: 'var(--font-mono)'
                            }}
                          />
                        </>
                      )}
                    </div>
                  )}
                </>
              )}

              {step === 2 && (
                <>
                  <h3>{t('wizard.doneHeading')}</h3>
                  <div className="hint">{t('wizard.doneDesc')}</div>
                  <div className="card" style={{ margin: 0, padding: 14 }}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginBottom: 8
                      }}
                    >
                      <span className="muted small">LLM</span>
                      <span className="mono small">{selectedProviderLabel}</span>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginBottom: 8
                      }}
                    >
                      <span className="muted small">{t('wizard.skillLib')}</span>
                      <span className="mono small">@built-in · 2026-04-19</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span className="muted small">{t('wizard.next')}</span>
                      <span
                        className="mono small"
                        style={{ color: 'var(--accent-deep)' }}
                      >
                        {t('wizard.nextAction')}
                      </span>
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="wiz-foot">
              <button
                className="btn"
                type="button"
                onClick={() => setStep((s) => Math.max(0, s - 1))}
              >
                {t('wizard.back')}
              </button>
              <span className="wiz-progress">
                {step} / {steps.length}
              </span>
              {step < steps.length ? (
                <button
                  className="btn primary lg"
                  type="button"
                  disabled={step === 1 && providerStepBlocked}
                  onClick={() => setStep((s) => Math.min(steps.length, s + 1))}
                >
                  {t('wizard.continue')}
                </button>
              ) : (
                <button
                  className="btn accent lg"
                  type="button"
                  onClick={() => {
                    void handleFinish();
                  }}
                >
                  {t('wizard.finish')} →
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default WizardPage;
```

说明（写给执行者）：
- Step 0 用全新 `wiz-hero` 布局，不复用旧 `wiz-logo` / `wiz-card h1` 样式
- Stepper 的 "1 / 2" 改成 `{step} / {steps.length}`（step 从 1 开始，steps 只剩 2 项）
- Step 2 的 finish 按钮触发条件：`step < steps.length ? continue : finish`，step=2 即最后一步（index 1 in steps array）

---

- [ ] **Step 3: 验证 typecheck 通过**

Run: `pnpm typecheck`

Expected: 无报错。

---

- [ ] **Step 4: 运行已有测试确保无回归**

Run: `pnpm test`

Expected: 26 tests pass（新 startCta key 已被 parity 测试覆盖）。

---

- [ ] **Step 5: 手测 wizard 全流程**

Run: `pnpm dev`

- 启动后触发 wizard（`settings.llmProvider` 为空时自动进）
- **Step 0**：应看到 80px logo + "开达" 大字 + 单行 tagline + "开始使用 →" 大按钮 + 一行 chips（🛡 零服务器 · 🧠 自备 LLM · 📚 ERP 原生）。**不应**看到 stepper 和"返回"按钮。
- 点"开始使用"→ 进入 Step 1（provider 选择），此时应看到 "1 LLM provider — 2 完成" 的 stepper，左下角"返回"按钮出现
- 选一个 provider + 填 key → 继续 → Step 2（done 摘要卡）
- 点"开始工作 →" 应关闭 wizard 进入工作台

手测 OK 后关闭应用。

---

- [ ] **Step 6: Commit**

```bash
git add src/renderer/pages/WizardPage.tsx src/renderer/styles/design-system.css
git commit -m "feat(wizard): redesign Step 0 as Linear-style hero

Replace the cramped 3-col feature cards with a minimalist welcome:
big LogoMark + serif brand + tagline + primary CTA + single-line
chips. Stepper and back button only appear from Step 1 onward."
```

---

## Task 5: `package.json` 加 productName + 主进程 app.setName

静态层：让打包产物 + Electron 的 userData 目录名锁在 ASCII `OpenDeploy`。

**Files:**
- Modify: `package.json`
- Modify: `src/main/index.ts`

---

- [ ] **Step 1: Edit package.json**

Edit `package.json`：在 `"main": "./out/main/index.js"` 这一行下面插入一行：

```json
"main": "./out/main/index.js",
"productName": "OpenDeploy",
```

---

- [ ] **Step 2: Edit `src/main/index.ts`**

把 import 下面、`let mainWin` 之前插入 `app.setName` 调用。修改后开头应为：

```ts
import { app, BrowserWindow } from 'electron';
import { createMainWindow } from './window';
import { registerIpcHandlers } from './ipc';
import { registerLlmIpc } from './ipc-llm';

// Must run before app `ready` so Electron's userData path uses this name.
app.setName('OpenDeploy');

let mainWin: BrowserWindow | null = null;
```

---

- [ ] **Step 3: 验证 typecheck**

Run: `pnpm typecheck`

Expected: 无报错。

---

- [ ] **Step 4: 手测**

Run: `pnpm dev`

- Windows 任务栏 hover 应用应显示"OpenDeploy"（fallback 系统名），**此时尚未**显示中文（中文动态标题要到 Task 7 才接上）。
- 应用正常启动，对话功能不炸。

手测 OK 后关闭。

---

- [ ] **Step 5: Commit**

```bash
git add package.json src/main/index.ts
git commit -m "feat(app): set productName and app.setName to OpenDeploy

Locks the system-level app identity (installer label, macOS Dock,
userData path) to ASCII 'OpenDeploy'. Runtime display name comes
from i18n in the next commit."
```

---

## Task 6: 新增 `setWindowTitle` IPC（main + preload + types）

搭建运行时改窗口标题的管道。Renderer 监听语言切换 → 调用此 IPC → 主进程 `win.setTitle`。

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/main/window.ts`
- Modify: `src/preload/index.ts`

---

- [ ] **Step 1: 在 `IpcApi` 加方法签名**

Edit `src/shared/types.ts`：在 `IpcApi` 接口里、`getPlatform` 下面加一行：

```ts
export interface IpcApi {
  getSettings: () => Promise<AppSettings>;
  saveSettings: (settings: AppSettings) => Promise<void>;
  getPlatform: () => Promise<NodeJS.Platform>;
  setWindowTitle: (title: string) => Promise<void>;
  llmSendMessage: (req: LlmChatRequest) => Promise<{ requestId: string }>;
  // … rest unchanged
}
```

---

- [ ] **Step 2: 在主进程注册 handler**

Edit `src/main/ipc.ts`：先改 import，再加 handler。改 imports 顶部：

```ts
import { BrowserWindow, ipcMain } from 'electron';
```

把 `registerIpcHandlers` 函数整体替换为：

```ts
export function registerIpcHandlers(): void {
  ipcMain.handle('settings:get', async () => {
    return await loadSettings();
  });

  ipcMain.handle(
    'settings:save',
    async (_event, settings: AppSettings) => {
      await saveSettings(settings);
    }
  );

  ipcMain.handle('app:platform', () => {
    return process.platform;
  });

  ipcMain.handle('app:set-window-title', (event, title: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      win.setTitle(title);
    }
  });
}
```

---

- [ ] **Step 3: 默认窗口标题**

Edit `src/main/window.ts`：在 `new BrowserWindow({...})` 之后，`win.on('ready-to-show', ...)` 之前加一行 `win.setTitle('开达')`。修改后对应段落应为：

```ts
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.setTitle('开达');

  win.on('ready-to-show', () => {
    win.show();
  });
```

---

- [ ] **Step 4: Preload 暴露方法**

Edit `src/preload/index.ts`：在 `api` 对象里、`getPlatform` 下方加一行：

```ts
const api: IpcApi = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: AppSettings) => ipcRenderer.invoke('settings:save', settings),
  getPlatform: () => ipcRenderer.invoke('app:platform'),
  setWindowTitle: (title: string) => ipcRenderer.invoke('app:set-window-title', title),
  llmSendMessage: (req: LlmChatRequest) => ipcRenderer.invoke('llm:send', req),
  llmOnStream: (cb: (ev: LlmStreamEvent) => void) => {
    const listener = (_event: unknown, ev: LlmStreamEvent) => cb(ev);
    ipcRenderer.on('llm:stream', listener);
    return () => ipcRenderer.removeListener('llm:stream', listener);
  },
  conversationsList: () => ipcRenderer.invoke('conversations:list'),
  conversationsLoad: (id: string) => ipcRenderer.invoke('conversations:load', id)
};
```

---

- [ ] **Step 5: 验证 typecheck**

Run: `pnpm typecheck`

Expected: 无报错（IpcApi 在 shared 定义，preload 实现完整实现了接口，renderer 侧 `window.opendeploy` 类型自动跟上）。

---

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/main/ipc.ts src/main/window.ts src/preload/index.ts
git commit -m "feat(main): add setWindowTitle IPC for runtime title switching

Default title set to 开达 at window creation; renderer can override
via window.opendeploy.setWindowTitle() when language changes."
```

---

## Task 7: Renderer 监听语言切换同步窗口 + HTML 标题

最后一块管道：在 `App.tsx` 加 `useEffect`，语言变化时更新 `document.title` 和窗口标题。

**Files:**
- Modify: `src/renderer/index.html`
- Modify: `src/renderer/App.tsx`

---

- [ ] **Step 1: 改 HTML 默认 title**

Edit `src/renderer/index.html`：把 `<title>OpenDeploy</title>` 改成 `<title>开达</title>`。

---

- [ ] **Step 2: 在 App.tsx 加 useEffect 同步 title**

Edit `src/renderer/App.tsx`：

(a) import 顶部加入 i18n.language 获取途径。原已 import `useTranslation` from `react-i18next`，将第 2 行改为：

```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
```

(其中 `useEffect` 已有；这里只是提醒。)

(b) 在 `App()` 函数体里、`const settings = ...` 这组 hooks 下面加 `t` hook，并加一个 `useEffect` 跟 language：

插入位置：在 `const [wizardCompleted, setWizardCompleted] = useState(false);` 这一行下面，`useEffect(() => { if (!loaded) { void load(); } }, ...)` 之前。

插入内容：

```tsx
  const { t, i18n } = useTranslation();

  // Sync document title and native window title to the current language.
  useEffect(() => {
    const title = t('app.name');
    document.title = title;
    void window.opendeploy.setWindowTitle(title);
  }, [t, i18n.language]);
```

注意：`App` 组件内部原本没有 `useTranslation()` 调用（它通过子组件获取），现在需要加。上面 ProjectsPlaceholder / SkillsPlaceholder 的 `useTranslation()` 调用保持不变。

---

- [ ] **Step 3: 验证 typecheck**

Run: `pnpm typecheck`

Expected: 无报错。`src/renderer/types/window.d.ts` 已确认为 `opendeploy: IpcApi`（直接引用 IpcApi），所以在 Task 6 里给 `IpcApi` 加 `setWindowTitle` 之后，renderer 的 `window.opendeploy.setWindowTitle` 类型会自动跟上，无需改 window.d.ts。

---

- [ ] **Step 4: 跑测试**

Run: `pnpm test`

Expected: 26 tests pass。

---

- [ ] **Step 5: 手测语言切换**

Run: `pnpm dev`

- 启动应用 → Windows 标题栏显示"开达"（HTML title + 主进程默认值）
- 进 Settings → 切换语言为 English → **标题栏立即变成"OpenDeploy"**（不需要重启）
- 再切回中文 → 标题栏变回"开达"
- Wizard Step 0 的大字品牌也跟着切（因为用 `t('app.name')`）

手测 OK 关闭。

---

- [ ] **Step 6: Commit**

```bash
git add src/renderer/index.html src/renderer/App.tsx
git commit -m "feat(ui): sync window title with i18n language

App.tsx listens for i18n.language changes and updates both
document.title and the native window title via IPC. Wizard hero
brand already uses t('app.name') so it switches together."
```

---

## Task 8: Plan 验证 + 总 review

跑一遍完整的 sanity checks，确保所有改动整合起来无回归。

**Files:** N/A

---

- [ ] **Step 1: 跑全量测试**

Run: `pnpm test`

Expected: 全部 pass，文件数 ≥ 8（现有），测试数 ≥ 26（现有，本计划不新增 .ts 测试）。

---

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`

Expected: 无报错。

---

- [ ] **Step 3: Lint**

Run: `pnpm lint`

Expected: 无错误（warning 容许）。

---

- [ ] **Step 4: Build 验证**

Run: `pnpm build`

Expected: 输出到 `out/`，无错误。

---

- [ ] **Step 5: 全量 dev 手测清单**

Run: `pnpm dev`

清单（全部必须通过）：
- [ ] 启动后窗口标题是"开达"
- [ ] Wizard Step 0 显示新 hero（80px 花括号+橙圆 logo、大字"开达"、tagline、开始使用按钮、chips）
- [ ] Wizard Step 0 **没有** stepper 和返回按钮
- [ ] TitleBar 左上角 logo 是新的花括号+橙圆（白色括号打深色背景）
- [ ] 点"开始使用"进 Step 1，看到 "1 LLM provider — 2 完成" stepper 和返回按钮
- [ ] 选 provider + 填 key → 继续 → Step 2 done 卡片
- [ ] 点"开始工作 →" 关闭 wizard 进工作台
- [ ] 进 Settings → 切换到 English → 窗口标题实时变 "OpenDeploy"，TitleBar 文本切 English
- [ ] 切回中文 → 窗口标题"开达"，一切正常

---

- [ ] **Step 6: 若所有验证通过，无需额外 commit（前面每 task 已 commit）。git log 查看**

Run: `git log --oneline -10`

Expected: 看到 7 个新 commit（Task 1-7 各一，Task 3/4 合并 i18n + wizard）：

```
feat(ui): sync window title with i18n language
feat(main): add setWindowTitle IPC for runtime title switching
feat(app): set productName and app.setName to OpenDeploy
feat(wizard): redesign Step 0 as Linear-style hero
fix(i18n): correct zh-CN app.name to 开达 + add wizard.startCta
feat(ui): use LogoMark in TitleBar
feat(ui): add LogoMark component + B-2 brand SVG source
```

---

## Self-Review Notes

执行完所有任务应该满足 spec：

| Spec 要求 | 对应任务 |
|----------|---------|
| B-2 logo 作为 SVG 源 | Task 1 |
| LogoMark 组件 default/inverse | Task 1 |
| TitleBar 用 LogoMark | Task 2 |
| WizardPage 用 LogoMark | Task 4 |
| Wizard Step 0 hero + CTA + chips | Task 4 |
| Step 0 无 stepper / back | Task 4 |
| Step 1 / Step 2 保持原样 | Task 4 |
| productName: "OpenDeploy" | Task 5 |
| app.setName('OpenDeploy') | Task 5 |
| setWindowTitle IPC | Task 6 |
| HTML title 默认"开达" | Task 7 |
| App.tsx 语言切换同步 | Task 7 |
| zh-CN/app.name → "开达" | Task 3 |
| wizard.startCta 双语 | Task 3 |

**范围外**（符合 spec"不做"）：
- `.ico` / `.icns` / 多尺寸 PNG → 留 Plan 6
- electron-builder 配置 → 留 Plan 6
- `BrowserWindow.icon` 属性 → 留 Plan 6（dev 期用默认）
- 组件视觉单元测试 → 基建 (jsdom + RTL) 不装，走手测
