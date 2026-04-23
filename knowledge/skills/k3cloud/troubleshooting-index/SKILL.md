---
name: troubleshooting-index
title: K/3 Cloud 常见问题诊断索引
description: 当用户报告 K/3 Cloud 标准功能报错 / 操作失败 / 数据对不上 / 系统慢时加载。本 skill 是常见问题的分类索引:报错 / 数据对不上 / 操作失败 / 性能问题。先按用户描述定位类型,然后 load_skill_file 拉对应分类的 reference 看具体场景 + 解决方向。**和 systematic-debugging 互补**:那个讲方法论(怎么排错),本 skill 讲具体场景(碰到 X 就查 Y)。
version: 1.0.0
category: troubleshooting
---

<!-- 来源:help.open.kingdee.com / vip.kingdee.com / club.kingdee.com 公开内容;实证状态:🟡 常见场景索引,具体解决方案以客户环境为准 -->

# K/3 Cloud 常见问题诊断索引 🟡

当用户反馈"系统报错 / 操作不灵 / 数据对不上 / 跑得很慢"——**不是要写新功能,是现成功能出问题了**——加载本 skill。

**和"写新功能"的需求区分**:
- ❌ "我要给销售单加一个审批字段" → 走 `solution-decision-framework`
- ✅ "销售单审核报'字段必填',字段明明填了" → 走本 skill(standard-errors / operation-failures)
- ✅ "库存报表里数量和仓库实物对不上" → 走本 skill(data-inconsistency)
- ✅ "月结关账提示凭证未审核" → 走本 skill(standard-errors)

---

## 和其他 troubleshooting skill 的边界

这 4 块内容不重复,各有角色:

| skill / 文件 | 覆盖什么 | 何时去它 |
|---|---|---|
| **`common/systematic-debugging`** | 通用排错**方法论**:列症状 → 假设 → 证据 → 锁定 → 再动手 | 每个排错场景**都**要按它的五步走 |
| **`k3cloud/bos-features-index/references/known-pitfalls`** | **我们写 BOS 代码**踩的工程坑(FUSERID / FTABLEID / 缓存 / 白名单) | 调 `kingdee_*` BOS 写入工具报错或反查不到 |
| **`k3cloud/python-plugin-index/prompts/debugging`** | **我们写的 Python 插件**运行时排障流程 | 插件注册成功但行为不符合预期 |
| **本 skill** | **客户日常使用 K/3 Cloud 标准功能**遇到的报错 / 数据问题 / 操作失败 / 性能问题 | 客户反馈系统不对劲,**我们没写代码**也会遇到 |

简单说:前三个是"我们造的代码有问题",本 skill 是"金蝶标准产品 + 客户配置 + 客户数据"三方面碰撞出的日常症状。

---

## 何时加载本 skill

用户说下面这类话时立刻 load:

- "系统报错了,说……"
- "……功能点不动 / 按了没反应 / 卡死了"
- "……数据对不上" / "账实不符" / "账龄差了几万块"
- "关账过不去" / "启用不成功" / "登录进不去"
- "跑得很慢" / "查询半天出不来" / "保存要 30 秒"
- "凭证生不出来" / "下推失败" / "反审核提示错误"

**不要**在用户说"帮我在销售单上加个校验"时加载——那是**造新功能**,走 `solution-decision-framework`。

---

## 子文件导航(按症状归类 4 类,各自何时拉)

按需用 `load_skill_file('k3cloud/troubleshooting-index', '<path>')` 拉具体内容。4 份加起来约 900 行,**不要一次性全拉**,先按症状定位。

| 何时拉 | path |
|---|---|
| 登录 / 启用模块 / 关账 / 业务参数这类**系统级报错** | `references/standard-errors` |
| **数据对不上**——库存账实、凭证不全、账龄不准、报表为空、现金流量表空 | `references/data-inconsistency` |
| 用户**操作失败**——下推 / 审核 / 反审核 / 删除 / 保存被拦截 | `references/operation-failures` |
| 系统**慢 / 卡 / 超时**——单据保存 / 列表查询 / 报表 / 客户端 / MRP | `references/performance-issues` |

---

## agent 的姿势(关键)

### 1. 不是"给标准答案",是"给诊断方向 + 反查动作"

**K/3 Cloud 是高度可配置产品**——同一个症状在不同客户环境,原因可能是:

- 启用项勾选不同
- BOS 扩展的业务规则拦了
- 二开插件拦了
- 数据权限不同
- 期间设置不同
- 预置方案不同

所以**绝对不要**给用户一句"XX 功能有 bug,去设置 Y"——你会误导。**正确姿势**:

1. 用 **`kingdee_*` 工具 / SQL 查询**看客户当前状态
2. 列**可能的原因**(2-3 个假设,走 `systematic-debugging` 五步流程)
3. 告诉用户**去哪个菜单 / 哪张表**看对应证据
4. 根据证据**再给结论**

### 2. 不要编错误码

金蝶 K/3 Cloud 的错误码体系**不稳定**——不同版本、不同补丁、不同服务端,同一个现象可能报不同错误码。**不要在 skill 里列"错误码 XXX = YYY"**,只列"现象描述 + 可能原因 + 查证方向"。

碰到用户给了具体错误码,让他们:
- 查 K/3 Cloud 服务端日志(`<K3Cloud 安装目录>\WebSite\App_Data\ErrorLog` 或 IIS 日志,具体路径以客户环境为准)
- 客户端按 **Ctrl+F12** 或 **Ctrl+Alt+Shift+M** 调出性能 / 日志面板(因版本而异)
- 查客户端本地日志:`%USERPROFILE%\Documents\Kingdee\K3Cloud\Log`

### 3. 强制走 systematic-debugging 五步

**每个场景**的"解决方向"段都要提醒 agent:不要跳步。症状没钉死前不要形成假设;证据没收齐前不要动手修。跳步 = 乱试 = 把客户环境搞更乱。

### 4. 分清"金蝶标准行为" vs "客户现场的二开"

很多"报错"其实是**客户自己的二开插件**抛的(前实施顾问 / 前二开留下的),不是金蝶原厂 bug。agent 要会问:

> "这个报错提示文本里有没有中文自定义描述?如果有,这往往是你们现场的 Python / DLL 插件拦的,不是标准行为。可以查 BOS Designer 看这个单据有没有扩展、扩展上有没有挂插件。"

---

## 完成闭环

排障完成后,回复用户**四段齐全**(`systematic-debugging` 要求):

1. **症状**:用户报的原话 + 你观察到的客观现象
2. **根因**:锁定的那一个(不是"可能是 X 或 Y")
3. **修复动作**:具体做了什么 / 要用户做什么
4. **验证结果**:怎么确认问题没了(反查 / 复测)

**没锁定根因就如实说**——`systematic-debugging` 第 4 步:"我走完了 A / B / C 几个假设都不是,建议你 [具体动作,比如查服务端日志 / 找熟手 / 金蝶官方提单]"。硬编答案 = 埋雷。

---

## 关联 skill

- **`common/systematic-debugging`**——**每次**进排错模式前必须加载,本 skill 是它的"场景索引",不是替代
- **`k3cloud/solution-decision-framework`**——如果排障排到最后发现"标准功能真的不够",跳回决策树考虑 BOS / 插件
- **`k3cloud/bos-features-index`**——如果根因是客户现场有 BOS 二开干扰,去查对应能力(业务规则 / 审批流 / 操作插件)
- **`k3cloud/python-plugin-index`** / **`k3cloud/webapi-index`**——如果排障指向客户的自写插件 / 集成层

---

## 来源

- [金蝶云产品手册(dokuwiki)](https://help.open.kingdee.com/dokuwiki/)
- [金蝶云产品手册(标准版 dokuwiki_std)](https://help.open.kingdee.com/dokuwiki_std/)
- [金蝶云社区 VIP 文章库](https://vip.kingdee.com/article/)
- [金蝶云社区问答](https://club.kingdee.com/)
- [金蝶服务官网 FAQ](https://m.heshuyun.com/)

fetched 2026-04-23
