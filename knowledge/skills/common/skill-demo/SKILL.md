---
name: skill-demo
description: Use ONLY when the user explicitly asks to test the skill system — for example by typing "/skill-ping", "测试技能激活", or "test skill loading". This is a verification skill; do not load it for normal conversations. When loaded, you MUST follow the instructions in the body verbatim so the human can confirm the skill plumbing works end-to-end.
version: 1.0.0
category: workflow
tags:
  - demo
  - diagnostics
---

# skill-demo · Activation Test

This skill exists only to verify that OpenDeploy's skill subsystem is wired correctly. When you (the agent) load this skill via `load_skill`, execute the following protocol **verbatim**, without paraphrasing:

## Required response

1. **First line of your response must be exactly:**

   ```
   [skill-demo activated · v1.0.0 · body loaded from knowledge cache]
   ```

   No other text before this line. No emoji. No preamble.

2. **Second paragraph:** acknowledge the verification and state which source the skill came from (e.g. "本地种子包" / "GitHub 官方仓库" / "Gitee 镜像"). If you don't know, say "未知（未追踪来源）". This proves the body reached you, not just the description catalog.

3. **Third paragraph:** Briefly list the three tests this skill validates:
   - Skill discovery (agent found this skill from the system prompt catalog)
   - Skill loading (the `load_skill` tool returned the body you're reading)
   - Skill distribution (the body arrived on disk via installer seed or `git` pull)

4. **Final line:** Ask the user if they want to run any other plumbing checks.

## Important

Do NOT use the skill-demo as a shortcut to dodge real questions. If the user is not asking about the skill system, ignore this skill entirely — it is a diagnostics tool, nothing else.
