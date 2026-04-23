---
name: solution-decision-framework
title: 二开需求落地决策树
description: 收到新的功能性需求(要在系统里造东西 / 改环境)时加载。教 agent 把需求落到"标准功能 / BOS 配置 / Python 插件 / DLL 插件"四层的哪一层,按成本从低到高排查,避免动不动就写代码。本 skill 只讲"决策框架"——如何侦察、如何澄清、给用户问什么问题,由 base-system 硬规则一管辖,不在这里列清单。
version: 2.0.0
category: workflow
---

# 二开需求落地决策树

## 为什么你每次都要走这个

实施顾问值钱的地方是"**判断力**"——看一个需求,知道**不用写代码**就能搞定,或者**只需要配置不需要写插件**。OpenDeploy 的 agent 同样要这种判断力,否则就成了"来啥需求都写 Python"的机器人,客户环境越改越乱。

**核心纪律**:从上到下排查,**找到能解的那层就停,不要继续下钻**。成本从上到下递增,可维护性从上到下递减。

**本 skill 不规定你"必须问哪 3 个问题"**——base-system 硬规则一已经规定了节奏(侦察 → 精准反问 → 设计签字)。你要问什么、问几个,根据需求和侦察结果自己判断;**但决策树的层级顺序不能倒**。

---

## 第 1 优先级 · K/3 Cloud 标准功能

**问题**:客户的需求是不是已经是 K/3 Cloud 内置功能,只是他们不知道怎么用?

**如何查**:加载 `k3cloud/product-features-index` skill,里面按模块组织了 K/3 Cloud 标准产品功能清单。找到对应模块后用 `load_skill_file('k3cloud/product-features-index', 'references/<module>')` 拉具体模块的功能字典(如 `references/sal-sales`)。

**常见误判场景**(用户以为需要二开,实际标准功能就有):
- "订单按审核状态过滤列表" → 标准列表过滤器
- "客户要看某段时间的出货明细" → 标准报表
- "给销售员设置价格权限" → 价格权限方案(标准配置)
- "开启信用管控" → **信用管理启用项**(不是二开!)
- "物料按仓库分组显示库存" → 标准库存查询视图
- "低库存提醒" → **预警平台内置**(不是二开!)

**如果确认标准功能有**:告诉用户启用入口 + 配置步骤,**停手**。不要因为"用户已经找你做定制"就不好意思说"其实不用定制"——这是实施顾问真正的价值。

**如果标准功能不满足** → 下一层。

---

## 第 2 优先级 · BOS 配置(无代码)

**问题**:能否通过 BOS Designer 的配置界面解决,而不是写代码?

**如何查**:加载 `k3cloud/bos-features-index` skill 看 BOS 平台 8 大类能力。需要决策"字段扩展 vs 业务规则 vs 插件"用 `load_skill_file('k3cloud/bos-features-index', 'prompts/choosing-customization-level')`。具体能力(扩展字段、业务规则、转换规则、审批流…)用对应的 `references/*.md`。

BOS Designer 是金蝶的元数据配置工具,大量"看起来需要二开"的需求其实只是 BOS 配置:单据加字段、界面改布局、业务规则公式、审批流节点调整、套打模板……

**OpenDeploy 当前 BOS 工具覆盖**(系统提示词里的 `kingdee_*` 工具清单是权威的):
- ✅ **创建 BOS 扩展 + 注册 Python 表单插件**(核心工具)
- ❌ 其他 BOS 配置项(扩展字段、业务规则、转换规则、审批流、套打模板)**暂不工具化**

**如果需求能靠 BOS 配置且 OpenDeploy 暂不覆盖**:告诉用户"这类需求 OpenDeploy 暂不自动化,建议你在 BOS Designer 里手工配置,我可以给你操作步骤"。**不要尝试绕过去写 Python 插件硬实现**——Python 能模拟出来但会让客户环境变乱。

**如果需求是"表单事件驱动"**(保存前 / 修改时 / 按钮点击) → 下一层。

---

## 第 3 优先级 · Python 插件(轻量脚本)

**问题**:需要事件驱动的业务逻辑(BeforeSave 拦截、字段联动、按钮行为)?

Python 插件是 OpenDeploy 的**主力支持方向**。

**如何写**:加载 `k3cloud/python-plugin-index` skill,里面是事件 / API / 模板的索引。

**适合的场景**:

| ✅ Python 插件能搞 | ❌ Python 插件搞不定 |
|---|---|
| 保存前校验业务规则 | 审核 / 反审核服务端拦截(操作插件,v0.2) |
| 字段变化时自动填充 / 计算 | 下推单据字段映射(转换插件,v0.2) |
| 按钮点击触发自定义动作 | 跨单据数据聚合报表(需另建报表) |
| 金额 / 数量自动汇总 | 高频大数据处理(性能不够) |
| 客户 / 物料信息联动携带 | 复杂线程 / 并发逻辑(IronPython 限制) |

**到这一层的行动顺序**:
1. 先用 `kingdee_list_extensions` 查父单据有没有现成扩展可复用
2. 参考 `k3cloud/python-plugin-index` skill 生成 `pyBody`
3. **出 design,等用户签字**(base-system 硬规则一)
4. 调 `kingdee_register_python_plugin`(挂到已有扩展)**或** `kingdee_create_extension_with_python_plugin`(新建扩展 + 挂插件)
5. **反查验证**(base-system 硬规则四 + erp-rules/k3cloud.md 写入闭环)
6. 告知用户:`backupFile` 路径 + BOS Designer F5 刷新 + 客户端重登 + SVN 同步(如适用)

---

## 第 4 优先级 · DLL 插件(复杂场景)

**问题**:Python 搞不定(性能、复杂类型、跨 AppDomain)?

**当前版本 OpenDeploy 不支持 DLL 生成 / 注册**。v0.2+ 才考虑。

碰到这种需求的正确做法:

> "这个需求超出了 Python 插件的能力范围,需要 .NET DLL 开发——目前 OpenDeploy 工具链还没覆盖,建议:
> 1. 由你的技术方或二开供应商用 C# 实现
> 2. OpenDeploy 可以帮你梳理实现思路、看 BOS 标准插件源码找参考
> 3. 未来 OpenDeploy v0.2 会把 DLL 生成 + 注册能力排进来"

**不要硬凑 Python 插件**。复杂场景硬用 Python 往往跑不通或性能爆炸,最后让客户环境多一份不稳定的技术债。

---

## 组合需求——分解 + plan

很多需求一步到位不了,要**多层组合**:
- "库存预警 + 超限邮件通知" = [标准启用 预警平台] + [BOS 业务规则 / 或 Python 插件 发邮件]
- "信用管控升级" = [标准启用 信用管理] + [BOS 扩展客户档案加"预付标记"字段] + [Python 插件 BeforeSave 检查]
- "销售整体交付" = 分几十个独立子项

这时按 base-system 硬规则一走"**分解 + plan**"路径:
1. 先把需求拆成独立子项(每个子项走本决策树能单独定层)
2. 加载 `common/implementation-planning` skill 拿 plan md 模板
3. 写 plan md 到 `~/.opendeploy/projects/<pid>/plans/YYYY-MM-DD-<topic>.md`,每步打层级标签 + owner,分步签字

---

## 反模式警告

看到以下 agent 行为要自觉纠正:

| ❌ 反模式 | ✅ 正确做法 |
|---|---|
| 一听"销售单据加校验"直接调 `kingdee_create_extension_with_python_plugin` | 先查标准 / BOS 有没有 → 侦察 + 精准反问 → 出 design 签字 → 再调 |
| 用户说"加个字段",直接动 FKERNELXML | **拒绝**,扩展字段暂不工具化,建议手工 BOS |
| 审批流调整,尝试用 Python 模拟 | **拒绝**,审批流 v0.2,建议手工 BOS Designer 改 |
| 用户说"慢",立刻提议写插件优化 | 先查是否索引 / 配置问题,Python 几乎不会让业务变快 |
| 没侦察就问"通用化"问题 | 先用工具摸清项目现状,再提**针对本次**的问题 |
| 以前见过类似的就套模板,不问这次有什么不同 | 每个客户的业务规则都有细节差异,不澄清就套模板 = 埋雷 |
| 写入工具成功就直接报"完成" | 必须反查落库 + 插件挂载 + 属性一致,才说完成 |
