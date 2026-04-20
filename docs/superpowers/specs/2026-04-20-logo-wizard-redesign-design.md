# Logo 重设计 + Wizard 首屏精简 + 应用名"开达" — 设计文档

- **日期**：2026-04-20
- **作者**：乔磊 + Claude
- **状态**：已批准，待写 implementation plan
- **目标 Plan**：归入 Plan 1 的补强（UI 壳打磨），不阻塞 Plan 3 推进

## 背景

v0.1.0-alpha.1 当前的 UI 壳里：

1. **Logo 不是 Claude Code 主题色**。`TitleBar.tsx:26-46` 和 `WizardPage.tsx:65-85` 各自 inline 了同一份 **绿色 `#3d7a5a` 方块 logo**（聊天气泡 + 下箭头 + 底线）。和 `design-system.css` 定义的赤陶橙 `--accent = oklch(0.70 0.13 42)` ≈ `#D97757`（Claude Code 主题色）色系严重脱节。
2. **Wizard Step 0 视觉松散**。在 680px 卡片里垂直堆叠：56px logo → 品牌 h1（开达 + OpenDeploy chip）→ 副标语 → stepper → h3 → hint → 3 列压缩特性卡（12.5px 字号）→ 双按钮 footer。信息密度过高、层级不清。
3. **应用名 + 图标没落地**。`package.json` 只有 npm 包名 `opendeploy`，没有 `productName`；`src/main/window.ts` 未设 `icon`；HTML `<title>OpenDeploy</title>`；`zh-CN/common.json` 的 `app.name` 错误地写成 `"OpenDeploy"` 而非"开达"。

用户诉求：(1) logo 换成 Claude Code 赤陶橙主题；(2) Wizard 首屏重排；(3) Electron 应用名改"开达"，支持多语言切换。

## 设计决策

### Logo 方向：B-2 花括号 → 橙点

从 `design/logo-options-v2.html` 9 个候选中选定 **B-2**（设计稿里原作者已标为 candidate + "我的推荐"）：

- 左侧墨色花括号 `{`（开 = open / code）
- 右侧赤陶橙实心圆 `#D97757` + 内嵌象牙点（达 = 命中 / 落地）
- viewBox `0 0 48 48`，在 16×16 favicon 下仍可辨识，反白版干净

**语义**：和 Claude Code 的代码语境强共振（花括号 = 开发者美学），对应品牌"开达"字面含义（开始代码 → 达成交付物）。

**SVG 源（default variant，浅底黑括号 + 橙圆）**：

```svg
<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
  <path d="M18 10 Q12 10 12 16 L12 22 Q12 24 8 24 Q12 24 12 26 L12 32 Q12 38 18 38"
        stroke="#141414" stroke-width="2.5" fill="none"
        stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="32" cy="24" r="6" fill="#D97757"/>
  <circle cx="32" cy="24" r="2" fill="#fafaf7"/>
</svg>
```

**inverse variant**（深底白括号）：括号 `stroke` 改 `#fafaf7`，圆保持橙色。

### LogoMark 组件

`src/renderer/components/LogoMark.tsx` — 单文件 React 组件，props：

- `size: number` — 渲染像素宽高
- `variant?: 'default' | 'inverse'`（默认 default）

两处 inline SVG（TitleBar 22px、WizardPage 40px）全部替换成 `<LogoMark />`。

### Wizard Step 0 精简（Linear / Notion 风）

**动机**：首屏本质是"开机欢迎"，用户已经装了应用，不需要再上来塞 3 张特性卡 pitch。减法比重排更有效。

**新结构**（保持 680px 卡片宽）：

```
                     [LogoMark 80×80]

                          开达
                (48px serif，居中，无 OpenDeploy chip)

                  你的实施交付工具箱
                 (15px muted 单行副标语)

              [ 开 始 使 用  → ]
                (主 CTA，btn primary lg)

        🛡 零服务器 · 🧠 自备 LLM · 📚 ERP 原生
            (12px muted chips 单行，· 分隔)
```

**规则**：
- Step 0 **不渲染 stepper 和 `wiz-progress`**——stepper 从 step 1 开始显示
- Step 0 **不渲染 back 按钮**——直接只显示主 CTA
- Step 0 去掉 `[OpenDeploy]` chip（品牌英文名走系统层 + 语言切换，不在 hero 里重复）
- 3 张特性卡 `featureCards` 降级为一行 inline chips（使用 `design-system.css` 里已有的 `.chip` class）

**Step 1（provider）和 Step 2（done）保持现样**：小 logo（32px）+ stepper + 原 footer。

### 应用名策略（双层）

| 层级 | 值 | 位置 | 语言敏感 |
|------|-----|------|---------|
| 系统层 | `OpenDeploy` | `productName`、`app.setName`、userData 路径 | ❌ 静态 |
| 运行时 | `开达` / `OpenDeploy` | 窗口标题、HTML title、UI 内文案 | ✅ 跟 i18n |

**理由**：`productName` 打包后锁死（影响安装器、Dock、"关于 Electron"），用 ASCII `OpenDeploy` 避免中文路径在 Electron 某些 API 的边界 bug，英语用户也认得。运行时所有可见文案跟 i18n 切换，zh 用户看到"开达"。

### 改动清单

**新增**：
- `resources/icon.svg` — B-2 logo 源文件（设计资产）
- `src/renderer/components/LogoMark.tsx` — 共用 logo 组件

**修改**：
- `package.json` — 加 `"productName": "OpenDeploy"`
- `src/main/index.ts` — `app.setName('OpenDeploy')`（ready 之前）
- `src/main/window.ts` — 启动默认 `win.setTitle('开达')`
- `src/main/ipc.ts` — 加 `setWindowTitle(title: string)` handler
- `src/preload/index.ts` — 暴露 `setWindowTitle`
- `src/shared/types.ts` — `IpcApi` 加 `setWindowTitle(title: string): Promise<void>`
- `src/renderer/index.html` — `<title>开达</title>`
- `src/renderer/App.tsx` — `useEffect(() => { ... }, [i18n.language])` 同步 document.title + 调用 `window.opendeploy.setWindowTitle`
- `src/renderer/pages/WizardPage.tsx` — Step 0 重排（hero + CTA + chips）
- `src/renderer/components/TitleBar.tsx` — inline SVG 换 `<LogoMark size={22} variant="inverse" />`
- `src/renderer/i18n/locales/zh-CN/common.json` — `app.name: "OpenDeploy"` → `"开达"`；加 `wizard.startCta: "开始使用"`
- `src/renderer/i18n/locales/en-US/common.json` — 加 `wizard.startCta: "Get started"`

**不改动（明确留给 Plan 6）**：
- `.ico` / `.icns` / 多尺寸 PNG 生成
- electron-builder 配置
- 安装包 metadata
- dev 期任务栏图标（仍是默认 Electron 紫齿轮——接受这个代价）

## 测试

新增测试：
- `tests/unit/logo-mark.test.tsx` — 验证 default / inverse 变体 stroke 颜色、size prop 生效
- `tests/unit/wizard-page.test.tsx`（或补充现有）— Step 0 不渲染 `.wiz-stepper`，显示 startCta 按钮；Step 1 恢复 stepper

已有测试覆盖：
- i18n parity 测试会自动捕获 zh / en 的 key 对齐（`app.name`、`wizard.startCta` 必须双语种都加）

手测：
- `pnpm dev` → 窗口标题显示"开达"
- 设置里切换语言到 English → 窗口标题实时变"OpenDeploy"，wizard hero 品牌也切
- Wizard 首屏视觉对比旧版截图

## 风险 & 回滚

- **`app.setName` 影响 userData 路径**：当前 npm name `opendeploy` → 改为 `OpenDeploy`。Electron 默认 userData 目录名会从 `opendeploy` 变成 `OpenDeploy`。我们自己的对话文件在 `%USERPROFILE%/.opendeploy/conversations/` 是代码硬写路径，不受影响。Electron 的 cache/cookies 会搬家——目前项目没有业务状态存在那里，影响可忽略。
- **回滚路径**：每一步都在独立 commit，有问题可以单独 revert。logo 组件 + wizard 重排 + 应用名改动三组改动是正交的。

## 范围外

- 不引入光栅化依赖（`@resvg/resvg-js` / `sharp`）
- 不改 TitleBar 的布局（只换 logo 组件）
- 不改 SettingsPage / WorkspacePage
- 不做 macOS Dock 图标高清处理（Plan 6）
- 不加自定义 frame + 窗口控件 IPC（已知未实现，非本轮范围）
