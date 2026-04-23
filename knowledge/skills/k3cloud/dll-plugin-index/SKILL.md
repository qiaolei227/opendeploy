<!-- 来源:open.kingdee.com 二开规范 + help.open.kingdee.com dokuwiki;实证状态:🟡 主流程;非客户环境实测 -->
---
name: dll-plugin-index
title: K/3 Cloud DLL 插件开发索引
description: 当 Python 表单插件搞不定(审核/反审核/下推服务端拦截 / 复杂性能 / 跨 AppDomain)需要 .NET DLL 时加载。本 skill 覆盖 6 种 DLL 插件类型 + 协同开发平台部署 + Python vs DLL 决策。**OpenDeploy v0.1 不自动化 DLL 注册**,本 skill 用于让 agent 能明确告知用户"这个要 DLL 不能 Python"以及给开发方向。
version: 1.0.0
category: plugin-dev
---

# K/3 Cloud DLL 插件开发索引 🟡

## 何时加载本 skill

触发条件(agent 按需 `load_skill('k3cloud/dll-plugin-index')`):

1. **Python 搞不定的场景**——用户需求涉及:
   - 审核 / 反审核 / 提交 / 撤销 / 删除等**服务端操作**拦截
   - 下推(单据转换)前的跨单据校验或字段映射
   - 打印模板的动态条码 / 动态模板选择 / 大写金额
   - 列表界面的自定义过滤 / 格式化 / 按钮
   - 报表的自定义取数逻辑(非简单 SQL)
   - 大数据量 / 高频循环 / 多线程(IronPython 性能够呛)

2. **用户已有 DLL**——需要解释如何部署 / 如何注册到元数据 / 如何排错。

3. **决策时刻**——agent 在"要不要写 Python 插件"分叉点,需要 load 本 skill 的 `python-vs-dll.md` 做决策。

## DLL vs Python 的本质边界

| 维度 | Python 表单插件 | DLL 插件 |
|---|---|---|
| 执行位置 | 客户端(winform)/ Web 浏览器 | **服务端** IIS / AppServer |
| 事件范围 | 仅 `AbstractBillPlugIn` 客户端事件 | **所有 6 类插件基类** |
| 能拦截服务端操作? | ❌ 无法 | ✅ 通过 `AbstractOperationServicePlugIn` |
| 能改下推行为? | ❌ | ✅ 通过 `AbstractConvertPlugIn` |
| 性能 | IronPython 解释执行,慢 | 原生 .NET,快 |
| 调试 | BOS Designer 脚本编辑器 | Visual Studio + 金蝶 DLL 引用 |
| 部署 | **改元数据**(扩展的 FKERNELXML) | **改元数据 + 发布 DLL 到 WebSite\Bin** |
| 上线审批 | 无 | 公有云必须走协同开发平台审批;私有云可直接放 |
| **OpenDeploy v0.1 支持?** | ✅ 通过 `kingdee_write_plugin_*` 工具 | ❌ **完全不支持** |

## OpenDeploy v0.1 工具覆盖现状

**全部不工具化**——本产品不写 DLL 代码、不编译、不部署、不注册 DLL 到元数据。

当用户需求落到 DLL 场景时,agent 的正确行为是:

1. 明确告诉用户"这个要 DLL,Python 搞不了"
2. 引用本 skill 的对应 reference(比如"这是一个操作插件场景,需要继承 `AbstractOperationServicePlugIn`")
3. 给出开发方向 / VS 工程命名 / 引用 DLL / 事件选择
4. 提示:"代码需要开发者用 Visual Studio 实现,然后通过协同开发平台或手工部署到 `WebSite\Bin`;本产品不代办"
5. 如果用户已有 DLL,解释如何注册到 `T_META_OBJECTTYPE.FKERNELXML` 的 `<OperationServicePlugins>` / `<ConvertPlugins>` 等节点(仍然需要开发者自己改元数据,我们不自动化)

## 子文件导航

按需加载(不要一次全拉):

| 子文件 | 何时加载 |
|---|---|
| `references/plugin-types-deep.md` | 需要列出 6 种插件类型 + 基类 + 关键事件对比 |
| `references/operation-plugin.md` | 需求涉及审核 / 反审核 / 删除拦截 / 服务端校验(**最常用**) |
| `references/convert-plugin.md` | 需求涉及下推 / 转换 / 跨单据数据映射 |
| `references/print-plugin.md` | 需求涉及打印模板定制(条码 / 大写金额 / 动态选模板) |
| `references/development-setup.md` | 用户问"怎么建 VS 工程""怎么部署""怎么发布" |
| `references/python-vs-dll.md` | 决策时刻——agent 需要快速判定走哪条路 |

调用方式:`load_skill_file('k3cloud/dll-plugin-index', 'references/operation-plugin')`

## 临时话术(agent 引用)

> 你的需求涉及【审核拦截 / 下推前校验 / 复杂打印逻辑】,这个场景 Python 表单插件做不了——原因是 Python 插件只能挂在客户端表单上,触碰不到服务端操作事件。这类需求必须用 .NET DLL 实现(C# / VB.NET),继承金蝶的对应抽象基类。
>
> OpenDeploy v0.1 不自动化 DLL 开发——代码需要开发者用 Visual Studio 写,然后通过**协同开发平台**在线发布,或者手工拷贝到客户环境 `WebSite\Bin` 目录。
>
> 我可以给出:**应该用哪种插件**(操作 / 转换 / 打印)、**继承哪个基类**、**挂哪个事件**、**VS 工程命名怎么起**、**参考代码样例**。你看需要哪一块?
