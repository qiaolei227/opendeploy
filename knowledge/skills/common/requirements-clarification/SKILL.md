---
name: requirements-clarification
description: Use when the user describes an ERP customization need but essential details are missing. Drives a short, targeted Q&A pass to pin down the primary business object, the triggering event, the success / failure criteria, and approval / unapproval behavior before any metadata reads or code generation begins.
version: 1.0.0
category: workflow
tags:
  - clarification
  - pre-implementation
---

# 需求澄清 · Requirements Clarification

## 触发条件

**当用户描述的二开需求符合以下任一特征时，使用本技能**：

- 只说了"想要什么"，没说"什么时候触发"
- 提到某个单据/对象，但没指定是主表、明细表还是某个字段
- 没说失败时给用户什么提示
- 没说是否影响反审核 / 反审批 / 反过账
- 没说是否跨账套、跨组织或跨期间

在读取元数据和写代码**之前**，**先**用下面的问题列表补齐缺失信息。

## 必问清单

每个需求至少确认以下 5 项：

1. **主对象**：涉及哪张单据？（销售订单 / 采购入库单 / 物料 / 客户…）是头表字段、明细行字段，还是按钮？
2. **触发事件**：什么时机执行？
   - 单据保存前（`BeforeSave` / 可阻止）
   - 单据保存后（`AfterSave` / 无法阻止）
   - 提交审核前（`BeforeSubmit`）
   - 审核前（`BeforeAudit`）
   - 反审核前（`BeforeUnAudit`）
   - 字段变更后（`DataChanged` / 联动计算）
3. **判断条件**：什么情况下需要干预？（"客户应收超过信用额度"、"物料编码为空"、"入库数量大于采购数量"…）
4. **失败文案**：阻止时给用户看什么提示？（中文 / 要不要带具体数值 / 是否区分审核人/录入人）
5. **反向操作**：如果单据已经审核通过后用户反审核，是否需要回滚这个逻辑？（默认金蝶反审核不会自动触发反向逻辑）

## 进阶清单（按需问）

- **跨账套**：需要在所有账套生效，还是只在特定账套？
- **期间边界**：涉及应收/应付/库存期间的，是否要检查当前期间是否已结账？
- **权限**：只有某些角色能绕过这个校验？还是一视同仁？
- **日志**：阻止/放行要不要写审计日志？
- **性能**：实时计算还是后台批量？数据量预估（百级 / 万级 / 百万级）？

## 输出契约

完成澄清后，产出一份结构化需求描述（以下 6 字段）再进入下一步：

```
业务对象: <主对象名 + 表单标识>
触发事件: <具体事件钩子名>
判断条件: <纯业务语言描述，含边界值>
失败文案: "<给用户看的完整提示文本>"
反向处理: <反审核时的行为约定>
副作用: <日志 / 发送通知 / 其他>
```

**只有这 6 字段齐全**，才调用后续的元数据读取技能（例如 `kingdee-cosmic-v9/bos-plugin-anatomy`）生成骨架。字段残缺就继续追问，不要猜。

## 常见坑

- 不要替用户"合理化"未说的条件（例如用户没说跨账套，默认就是当前账套）。
- 不要假设失败文案——用户的文案往往有公司特定术语，猜错了他还得改。
- 反审核场景 80% 的用户没想清楚；**主动问**，不要等报了 bug 再改。
