# 开达 OpenDeploy

> Open-source AI delivery agent for ERP implementation.

English | [简体中文](./README.zh-CN.md)

## What is OpenDeploy?

**开达 OpenDeploy** is an open-source AI agent that empowers ERP implementation consultants to deliver complex customizations (field extensions, workflow automation, plugin generation, interface integration) without relying on specialized developers.

**First target**: Kingdee Cloud Cosmic (金蝶云星空) V9.x private deployment.
**Future**: Kingdee Cangqiong (苍穹), YonYou, Odoo, and more via the multi-ERP provider architecture.

## Philosophy: Harness + Knowledge (Claude Code style)

- **Harness**: Agent loop framework, tool system, UI — provided by the app
- **Knowledge**: Deep ERP domain expertise bundled with the app; runtime metadata read from client ERP
- **LLM**: Bring your own (Claude, GPT, DeepSeek, Qwen, GLM, Kimi, Doubao, Ollama — any)
- **No server**: Knowledge hosted on GitHub, LLM calls go direct to your provider's API

## Key Promises

- **Never touches your client's business data.** SQL access is hard-whitelisted at the code level — `T_META_*` metadata tables allowed, `T_SAL_*/T_BD_*/T_AR_*` business tables hard-blocked.
- **Runs 100% on your laptop.** No OpenDeploy server, no telemetry you didn't opt into, your LLM key stays with you.
- **Open source (MIT)** for the community edition. Enterprise edition (team collaboration Hub, deep knowledge library, boss dashboard) will be commercially licensed.

## Status

Under active development. Plan 1 (project foundation) complete:
- ✅ Electron + React + TypeScript shell
- ✅ i18n (zh-CN / en-US)
- ✅ Theme (light / dark / system)
- ✅ LLM provider picker (11 providers)
- ✅ Onboarding wizard
- ⏳ LLM integration + Agent loop (Plan 2)
- ⏳ Knowledge base + GitHub sync (Plan 3)
- ⏳ Kingdee BOS metadata read (Plan 4)
- ⏳ Python plugin generation (Plan 5)
- ⏳ v0.1 release (Plan 6)

## Requirements

- Windows 10/11
- Your own LLM API key (Anthropic, OpenAI, DeepSeek, Qwen, or any supported provider)
- (For development) Node.js 20+ and pnpm

## Development

```bash
pnpm install
pnpm dev         # Start in dev mode (opens Electron window)
pnpm test        # Run unit tests (Vitest)
pnpm build       # Production build → out/
pnpm typecheck   # TypeScript validation
```

## Sibling Project

**开匠 OpenForge** — Low-code application development platform.
Together they form the "Open Stack (工匠系列)":
- 开匠 forges apps (create)
- 开达 delivers implementations (ship)

## License

MIT — see [LICENSE](./LICENSE)
