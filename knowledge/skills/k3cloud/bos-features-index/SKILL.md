---
name: bos-features-index
title: K/3 Cloud BOS 平台能力速查索引
description: 当 solution-decision-framework 判定需求"标准功能不够但可能靠 BOS 配置解决"时加载。本 skill 是 K/3 Cloud BOS 平台可定制能力的索引——扩展字段、业务规则、转换规则、审批流、插件类型、套打模板等。关键是区分"BOS 本身能做" vs "OpenDeploy 工具当前自动化的"——前者更广,后者有限,agent 要据此给用户正确建议。
version: 1.0.0
category: bos-features
---

# K/3 Cloud BOS 平台能力速查

**两个清晰的问题**要一直分开回答:

1. **BOS 平台本身能不能做?**——金蝶的客观能力边界(平台存在近 20 年,功能极其丰富)
2. **OpenDeploy 当前自动化了哪部分?**——工具边界(v0.1 很有限,只覆盖扩展对象 + Python 表单插件)

绝大多数 BOS 能力 OpenDeploy v0.1 **不工具化**,答案是"BOS 能做,让用户去 BOS Designer 手工"。这不是坏事——我们的定位是**可程序化的常用部分**,其他让用户做一次手工配置即可。

---

## BOS 8 大类能力速览

| 类别 | BOS 能做什么 | OpenDeploy v0.1 工具 | 子文件 |
|---|---|---|---|
| **扩展对象** | 在不动原单据的前提下派生一份副本,挂插件 / 加字段 | ✅ `kingdee_create_extension_with_python_plugin` 等 | `references/extension-model` |
| **扩展字段** | 在单据上加自定义字段(存到 `_XXXX` 扩展表) | ❌ 手工 BOS Designer | `references/custom-fields` |
| **业务规则 / 公式** | 字段间自动计算(`F金额 = F数量 * F单价`) | ❌ 手工 | `references/business-rules` |
| **转换规则** | 单据下推映射(销售订单 → 发货通知单) | ❌ 手工 | `references/convert-rules` |
| **审批流** | 多级审批、条件路由、Python 表达式判断 | ❌ 手工 | `references/approval-workflow` |
| **插件类型** | 6 种插件类型(表单 / 列表 / 操作 / 转换 / 打印 / 报表) | ✅ 仅表单插件(FormPlugins)| `references/plugin-types` |
| **套打模板** | 自定义打印布局 | ❌ 手工 | (未覆盖) |
| **权限方案** | 按角色 / 组织控制字段可见性 / 可编辑 | ❌ 手工 | (未覆盖) |

---

## 子文件导航

### 决策类(prompts/)

| 何时拉 | path |
|---|---|
| 需求可以选"扩展字段 vs 业务规则 vs Python 插件"多种路径解决,但不确定选哪个 | `prompts/choosing-customization-level` |

### 查阅类(references/)

| 主题 | path |
|---|---|
| 扩展对象机制(FKERNELXML delta、8 张表写入) | `references/extension-model` |
| **已实证的坑(FUSERID 作废 / FTABLEID / 缓存 / 写白名单)** | `references/known-pitfalls` |
| 扩展字段的 schema 和落位 | `references/custom-fields` |
| 业务规则 / 公式 | `references/business-rules` |
| 转换规则 / 下推配置 | `references/convert-rules` |
| 审批流 + Python 条件表达式 | `references/approval-workflow` |
| 插件类型全谱 | `references/plugin-types` |
| 套打模板(骨架) | `references/print-templates` |
| 权限方案(骨架) | `references/permissions` |
| 移动端表单(骨架) | `references/mobile-form` |

---

## 使用纪律

1. 回答用户"这个需求能不能在 BOS 里做"时,**先回答 BOS 能不能做**,再回答 **OpenDeploy 能不能自动化**。两个答案合起来才是完整建议:
   - BOS 能 + 工具自动化 → 调工具
   - BOS 能 + 工具未自动化 → "BOS 能做,我给你操作步骤,去 Designer 手工"
   - BOS 不能 → "BOS 本身不支持,需要换方案或接受标准行为"

2. **不要把 Python 插件当万能锤**。扩展字段用插件硬模拟 = 数据存哪里都是问题;业务规则用插件硬写 = 维护性差。该用哪个 BOS 能力就用哪个

3. **工具边界以系统提示词里的 `kingdee_*` 工具清单为准**。v0.1 当前覆盖 7 个 `kingdee_*` 工具(BOS 写入相关 + 元数据只读)。本 skill 标注的 ✅/❌ 是当前快照,会随版本演进

---

## 写作纪律(贡献者看)

- references 里写 **BOS 客观能力**,不写"OpenDeploy 做没做"——工具边界会变,领域知识稳定
- prompts 里写 **怎么选**——决策类逻辑
- 每份 reference 控制在 200-400 行,大了拆
- 不要复制官方帮助原文,要加"实施顾问视角"——常见坑、典型误判
