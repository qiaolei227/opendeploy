# 开达 OpenDeploy

> 面向 ERP 实施交付的开源 AI 智能体。

[English](./README.md) | 简体中文

## 开达是什么？

**开达 OpenDeploy** 是一个开源 AI 智能体，帮助 ERP 实施顾问独立交付复杂二开需求（字段扩展、流程自动化、插件生成、接口对接等），无需依赖专业二开人员。

**首批目标**：金蝶云星空 V9.x 私有部署版。
**未来**：金蝶云苍穹、用友、Odoo 等，通过多 ERP Provider 架构扩展。

## 产品哲学：Harness + Knowledge（Claude Code 风格）

- **Harness（骨架）**：Agent 循环框架、工具系统、UI — 产品提供
- **Knowledge（知识）**：深度 ERP 领域知识内置；运行时从客户 ERP 读取元数据
- **LLM**：用户自备（Claude / GPT / DeepSeek / Qwen / GLM / Kimi / 豆包 / Ollama 任选）
- **零服务器**：知识库托管 GitHub，LLM 调用直连你自己的 provider

## 关键承诺

- **永不触碰客户业务数据。** SQL 访问在代码层面硬白名单 —— `T_META_*` 元数据表允许，`T_SAL_*/T_BD_*/T_AR_*` 等业务表硬拦截。
- **100% 本地运行。** 没有开达服务器，没有你未同意的遥测，你的 LLM Key 留在你这里。
- **社区版 MIT 开源**。企业版（团队协作 Hub、深度知识库、老板面板）为商业授权。

## 当前状态

开发中。Plan 1（项目地基）已完成：
- ✅ Electron + React + TypeScript 外壳
- ✅ 国际化（中英）
- ✅ 主题（浅色 / 深色 / 跟随系统）
- ✅ LLM provider 选择（11 个）
- ✅ 首次启动引导
- ⏳ LLM 集成 + Agent Loop（Plan 2）
- ⏳ 知识库 + GitHub 同步（Plan 3）
- ⏳ 金蝶 BOS 元数据读取（Plan 4）
- ⏳ Python 插件代码生成（Plan 5）
- ⏳ v0.1 发布（Plan 6）

## 环境要求

- Windows 10/11
- 你自己的 LLM API Key（Anthropic / OpenAI / DeepSeek / Qwen 等任一支持的 provider）
- （开发需要）Node.js 20+ 和 pnpm

## 开发

```bash
pnpm install
pnpm dev         # 开发模式启动（弹出 Electron 窗口）
pnpm test        # 运行单元测试（Vitest）
pnpm build       # 生产构建 → out/
pnpm typecheck   # TypeScript 检查
```

## 姐妹项目

**开匠 OpenForge** —— 低代码应用开发平台。
两者组成「Open Stack（工匠系列）」：
- 开匠负责造（锻造应用）
- 开达负责交（交付实施）

## 开源协议

MIT — 详见 [LICENSE](./LICENSE)
