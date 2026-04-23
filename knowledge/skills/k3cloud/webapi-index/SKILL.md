---
name: webapi-index
title: K/3 Cloud WebAPI 集成索引
description: 收到"和外部系统对接"类需求(电商 / OA / BI / 第三方平台)时加载。本 skill 是 K/3 Cloud WebAPI 的索引——认证 / 常用端点 / 错误码 / 集成模式。让 agent 区分"应该走 WebAPI" vs "应该写插件" vs "应该让客户自建集成"。
version: 1.0.0
category: integration
---

<!-- 来源:open.kingdee.com 二开规范 + help.open.kingdee.com dokuwiki + vip.kingdee.com 社区文章;实证状态:🟡 主流程;非客户环境实测 -->

# K/3 Cloud WebAPI 集成索引 🟡

K/3 Cloud 给外部系统(电商 / OA / BI / 第三方平台 / 钉钉 / 企微 / SRM / WMS)的**唯一推荐通道**就是 **WebAPI**——HTTP + JSON,基于站点 `/K3Cloud/` 暴露的 RESTful endpoint。本 skill 是 WebAPI 知识的索引,告诉 agent **哪种集成需求该走哪条路**,以及具体端点 / 错误处理 / 模式细节去哪份子文件查。

---

## 三条边界(收到集成需求第一时间分清)

| 路径 | 何时选 | 谁去做 |
|---|---|---|
| **走 WebAPI** | 标准单据的 CRUD / 查询 / 提交审核 / 下推 / 附件 | 客户的集成开发(或顾问写脚本调用) |
| **写插件辅助** | WebAPI 拿不到的高级动作(自定义校验 / 跨单据级联 / 复杂事务),仍走 WebAPI 但服务端用 Python / DLL 插件接管 | OpenDeploy 工具 + 客户集成端 |
| **让客户自建集成** | 复杂消息流转(消息队列 / 事务一致性 / 异步状态机) | 客户 IT 团队 / 第三方 ESB / iPaaS |

**红线**:绝不教用户**直连客户库写业务表**(`T_SAL_*` / `T_BD_*` / `T_STK_*`)。这是产品架构第 1 条硬红线 —— 元数据可读 + 扩展元数据可写 + **业务数据走 WebAPI**。详见 `references/integration-patterns`。

---

## OpenDeploy v0.1 工具覆盖现状

**❌ 不工具化 WebAPI 调用**。原因:

1. **凭据敏感**——AppId / AppSecret 是客户的资产,不能让 agent 在对话里随手发起调用
2. **跨进程边界模糊**——WebAPI 是客户业务系统的接口,产品定位是**实施交付**(设计 + 部署),不是**集成中间件**
3. **失败模式开放**——批量保存 / 限流 / 网络抖动这些状态需要客户自己的集成层处理,不该塞进 agent loop

所以本 skill 的角色是:**让 agent 给出正确指引**——告诉用户应该用哪个端点 / 怎么认证 / 哪些坑 / 性能怎么优化,**用户(或客户的开发团队)自己实现集成代码**。OpenDeploy 工具只在"需要写服务端 Python 插件辅助 WebAPI" 这一支介入。

---

## 子文件导航

按需用 `load_skill_file('k3cloud/webapi-index', '<path>')` 拉具体内容,**不要一次性全拉**——4 份 reference 加起来约 700 行,塞满上下文。

| 何时拉 | path |
|---|---|
| 用户问"怎么调用 WebAPI"——账号密码 / AppSecret / Cookie / 多账套切换 | `references/authentication` |
| 用户问"具体怎么查/存/审核单据"——端点 URL / 请求 JSON / 响应结构 / 字段顺序 | `references/common-endpoints` |
| 用户调用报错——HTTP 500 / "字段必填" / "非赠品价格 0" / 限流退避 | `references/error-handling` |
| 用户问"一次性同步几万条订单怎么办"——4 种集成模式 / ESB / iPaaS 选型 | `references/integration-patterns` |

---

## 使用纪律

1. **先分边界**——收到"对接 X 系统"类需求,**先确认是 X 拉数据 / X 推数据 / 双向同步**,再选模式(`integration-patterns`)。一上来就丢端点列表是错的
2. **认证选型不要凭直觉**——私有部署 V8.0 之前可以用账号密码(`ValidateUser`),V8.0 + 公有云**必须** AppSecret(`LoginByAppSecret`)。不知道客户版本就**先问**
3. **WebAPI 不能全替代 BOS 操作**——审批流走完后的复杂联动 / 成本计算 / 库存计费这些**只能在服务端插件里做**,WebAPI 只能触发"调用"。该让客户写插件就写,别硬用 WebAPI 拼
4. **别从训练数据凑端点**——所有端点 URL / 字段名 / 错误码以子文件 source URL 为准。拿不准就回答"建议查客户的 K3Cloud 服务端日志或 `vip.kingdee.com` 官方说明书 V6.0"
5. **批量 ≤ 20 条 / `BatchCount ≤ 10`**——这是金蝶官方建议,不是猜的(详见 `error-handling`)

---

## 关联 skill

- **`k3cloud/solution-decision-framework`**——所有需求先过决策树。集成需求一般落在"标准外 + 第三方"这一支,决策树会指向本 skill
- **`k3cloud/python-plugin-index`**——当 WebAPI 触发后,服务端要做复杂逻辑时,改回插件路径
- **`k3cloud/bos-features-index`**——服务端逻辑如果走"操作插件"或"转换规则",查 BOS 的 `references/plugin-types` 和 `references/convert-rules`

---

## 来源

- [金蝶云星空 WebAPI 接口说明书 V6.0](https://vip.kingdee.com/article/490771221039228672)
- [金蝶云星空系统集成(WebAPI)汇总贴](https://vip.kingdee.com/article/76278025062688512)
- [浅谈通过 WebAPI 实现金蝶云单据对接](https://vip.kingdee.com/article/11179)
- [金蝶 WebAPI 三种登录方式](https://vip.kingdee.com/article/548833368948065536)
- [open.kingdee.com 开放平台](https://openapi.open.kingdee.com/)

fetched 2026-04-23
