---
name: product-features-index
title: K/3 Cloud 标准产品功能速查索引
description: 在决定要不要"二开"之前加载本 skill。它是 K/3 Cloud 内置功能字典的索引,按模块(销售 / 采购 / 库存 / 财务 / 基础资料)组织。每个子文件列该模块的标准功能、启用路径、常见误判("以为要二开其实标准就有")。按需 load_skill_file 拉具体模块。
version: 1.0.0
category: product-features
---

# K/3 Cloud 标准产品功能速查

**存在的意义**:实施顾问经常碰到"这个需求做不做?"——K/3 Cloud 本身功能极其庞大(SAL / PUR / STK / AR / AP / GL / MRP / MFG / HR / CRM …),很多顾问只熟悉自己做过的模块,容易**把标准功能当成二开需求**。

走 `solution-decision-framework` 的第 1 优先级(标准功能)时,先用这个索引定位模块 → 拉对应子文件查具体功能。**找到 = 告诉用户启用路径 + 停手**,不要继续下钻到 BOS / Python 层。

---

## 模块索引

按 K/3 Cloud 常见功能分区,每个模块对应一个 reference 子文件。用 `load_skill_file('k3cloud/product-features-index', 'references/<module>')` 加载。

| 模块简称 | 中文 | 子文件 | 典型需求关键词 |
|---|---|---|---|
| **SAL** | 销售管理 | `references/sal-sales` | 销售订单、发货、退货、信用、价格、销售员 |
| **PUR** | 采购管理 | `references/pur-purchase` | 采购申请、采购订单、收货、退货、供应商 |
| **STK** | 库存管理 | `references/stk-inventory` | 出入库、库存查询、调拨、盘点、库存组织 |
| **FIN** | 财务(AR/AP/GL) | `references/fin-finance` | 应收、应付、凭证、总账、税金、结算 |
| **BD** | 基础资料 | `references/bd-basedata` | 客户、物料、供应商、仓库、部门、员工 |

---

## 其他重要模块(v0.1 暂不覆盖,但识别到就告知用户)

这些模块 K/3 Cloud 也有,本 skill 暂未整理功能字典。识别到相关关键词时告知用户"该模块属于 K/3 Cloud 标准覆盖,我这边暂无索引,建议咨询金蝶或查 K/3 Cloud 官方帮助":

- **MRP** 物料需求计划
- **MFG** 生产制造(生产订单、工单、BOM、工艺路线)
- **HR** 人力资源(招聘、薪资、绩效)
- **CRM** 客户关系管理
- **OA** 协同办公(审批流相关归 OA)
- **报表**(利润表、资产负债表、应收账龄、库龄等内置报表)

---

## 使用流程

1. 读用户需求,判断主要模块
2. `load_skill_file` 拉对应 reference
3. 在 reference 里按"关键词→功能名→启用入口"对照
4. 找到 → 给用户启用步骤,停手
5. 找不到但关键词在上面的"暂不覆盖"列表 → 告知用户
6. 都没命中 → 进 `solution-decision-framework` 第 2 优先级(BOS 配置)

---

## 写作纪律(给后续贡献者看)

本索引不追求完整覆盖 K/3 Cloud 所有功能(那是金蝶官方手册的事),而是**覆盖实施顾问最常误判的场景**。贡献新条目时:

- **必须有"典型误判"描述**:"用户通常想要 X,他们会说'需要二开加一个 Y',但其实 K/3 Cloud 标准里是 Z 功能,启用路径 A"
- **不要照抄官方手册**——那是信息冗余。写成"判断 + 启用指引"
- **每个功能条目必须带启用路径**(系统参数 / 账表设置 / 功能开关 / 基础资料界面 / BOS Designer),用户能照着点
