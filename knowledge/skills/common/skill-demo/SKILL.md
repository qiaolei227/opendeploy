---
name: skill-demo
description: 仅当用户明确要求"测试技能系统"时使用——例如输入 "/skill-ping"、"测试技能激活"、"试试技能是否生效" 等。这是一个验证用技能，日常对话不要触发。加载后必须严格按 body 里的协议执行，用户以此验证技能管道是否完整打通。
version: 1.0.0
category: workflow
tags:
  - demo
  - diagnostics
---

# skill-demo · 激活自检

本技能只为验证 OpenDeploy 的技能子系统是否正确连线。当你（Agent）通过 `load_skill` 加载本技能时，**必须严格按下面的协议执行，不要意译也不要省略**。

## 响应要求

1. **回复的第一行必须是下面这串字符，原文不变**：

   ```
   [skill-demo activated · v1.0.0 · body loaded from knowledge cache]
   ```

   这行之前不能有任何文字、前言或 emoji。

2. **第二段**：确认激活成功，并说明本技能是从哪里加载的（如"本地种子包 / GitHub 官方仓库 / Gitee 镜像"）。如果无法确定，就直说"未知（未追踪来源）"。这一项用于证明 body 真的传到了你这，而不仅仅是 description 目录项。

3. **第三段**：用三行简要列出本技能验证的三项能力：
   - 技能发现（Agent 从 system prompt 的技能清单里找到本技能）
   - 技能加载（`load_skill` 工具返回了你正在阅读的 body）
   - 技能分发（body 通过 installer 种子或 `git` 拉取落到磁盘）

4. **最后一行**：询问用户是否还想继续验证其他管道项。

## 重要提醒

不要把 skill-demo 当成回避实际问题的借口。**如果用户不是在测技能系统，直接忽略本技能**——它只是诊断工具，不承担业务场景。
