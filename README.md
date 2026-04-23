# 开达 OpenDeploy

> An open-source AI agent for ERP implementation consultants — making "a one-person delivery team" possible.

[English](./README.md) | [简体中文](./README.zh-CN.md)

---

Most "AI assistant tools" today look like this:

> **Consultant**: The client wants an xxx feature.
>
> **AI**: Sure, I'll write the Python plugin.
>
> **Consultant**: ...but the field needs to be created in the system first, and the approval flow edited too.
>
> **AI**: That part's on you.

**What OpenDeploy aims to do: the whole thing, done by AI.**

## What does it do

You're a Kingdee Cloud Cosmic (金蝶云星空) consultant. Clients keep asking for things like:

> "Add a remark field to this sales order"
> "Block checkout when the customer is over their credit limit"
> "Add another step to the approval flow"

Today, either you open BOS Designer and configure it by hand, or you call in a specialized developer to write code — **slow and expensive**.

**OpenDeploy** lets you talk to an AI that does the whole job:

- The AI reads your client's Kingdee system and understands how each form is set up
- The AI decides whether this request should be handled via "standard config / BOS extension / Python plugin / hybrid"
- The AI **calls Kingdee tools directly to get it done** — it doesn't hand you code to paste in manually
- It verifies after writing, and gives you a backup file path + a refresh prompt

You're the reviewer and operator; the AI is the drafter. **The design is signed off by the consultant, not by the AI.**

Think Cursor / GitHub Copilot — but built for implementation consultants, and built around Kingdee.

## Highlights

- **Bring your own AI** — Claude / GPT / DeepSeek / Qwen / Kimi / Doubao / Ollama, whatever you like
- **Zero server** — runs 100% on your laptop; client data never leaves your machine; no compliance headaches
- **Metadata-only, enforced in code** — the AI cannot read your client's business data, even if it tries
- **Cross-ERP by design** — Kingdee V9 first, with Cangqiong / YonYou / Digiwin extensible in the future
- **MIT open source** (Community Edition)

## Vision

An ERP project isn't a pile of scattered requests — it's a staged pipeline: **research → blueprint → configuration → development → testing → go-live → operations**.

OpenDeploy's full goal is to have the AI produce first drafts for each stage's deliverables. v0.1 focuses on "development" (BOS extensions + Python plugin generation) because the BOS meta-model platform is Kingdee's moat — **there's almost no BOS operational knowledge in general-purpose AI training data, and it's the hardest bone to crack**. Crack it, and the product stands up.

## Getting started

Requires Windows 10/11 + an LLM API key.

```bash
pnpm install
pnpm dev
```

A prebuilt installer will ship with v0.1 Alpha.

## Status

Under active development, on the eve of v0.1 Alpha.

- Target: Kingdee Cloud Cosmic V9 on-premise
- 10 skills / 57 markdown files / 10,638 lines of industry knowledge
- See [CLAUDE.md](./CLAUDE.md) for architecture and roadmap details

## Sibling project

**开匠 OpenForge** — low-code app builder.
Together they form "Open Stack (工匠系列)": OpenForge **forges** apps, OpenDeploy **ships** implementations.

## License

MIT — see [LICENSE](./LICENSE)
