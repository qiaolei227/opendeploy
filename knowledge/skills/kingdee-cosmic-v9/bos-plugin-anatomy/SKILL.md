---
name: bos-plugin-anatomy
description: Use when the user needs to implement a Kingdee Cloud Cosmic V9.x BOS form plugin (表单插件) in Python. Provides the standard skeleton — base class, event hooks, SDK imports, registration — plus the most common gotchas so the agent emits a minimal working plugin instead of a hallucinated one.
version: 1.0.0
category: plugin-dev
tags:
  - form-plugin
  - python
  - ironpython
erpProvider: kingdee-cosmic-v9
---

# 金蝶云星空 V9.x · BOS 表单插件骨架

## 触发条件

**适用于**：金蝶云星空 V9.x 私有部署 + 业务需求澄清后（通常紧跟 `common/requirements-clarification` 之后）确定要做"表单插件"（不是"操作服务插件"、不是"字段插件"、不是"列表插件"）。

**不适用于**：金蝶云苍穹（V2）、精斗云、KIS；或者需求其实应该用"业务规则" / 简单公式 / 字段属性就能解决——那种情况先建议走配置，不上代码。

## 最小骨架（Python，V9 IronPython）

```python
# -*- coding: utf-8 -*-
import clr
clr.AddReference('System.Core')
clr.AddReference('Kingdee.BOS')
clr.AddReference('Kingdee.BOS.Core')
from Kingdee.BOS.Core.Bill.PlugIn import AbstractBillPlugIn

class MyFormPlugin(AbstractBillPlugIn):
    # 事件钩子示例：保存前阻止
    def BeforeSave(self, e):
        view = self.View
        model = view.Model
        # 读取主表字段（示例：客户）
        customer = model.GetValue("FCustomerId")
        if customer is None:
            e.Cancel = True                       # 阻止保存
            view.ShowErrMessage("请选择客户")      # 用户可见提示
            return

    # 字段联动：客户变更时自动带出信用额度
    def DataChanged(self, e):
        if e.Field.Key == "FCustomerId":
            view = self.View
            model = view.Model
            customer = e.NewValue
            # 业务逻辑 ...
            model.SetValue("FCreditLimit", 100000)
```

## 事件钩子速查

| 事件 | 可阻止？ | 典型用途 |
|---|---|---|
| `OnInitialize` | ❌ | 插件加载时注册字段显隐逻辑 |
| `OnLoad` | ❌ | 单据打开后的初始化（默认值、权限判断） |
| `DataChanged(e)` | ❌ | 字段联动：`e.Field.Key` / `e.OldValue` / `e.NewValue` |
| `BeforeSave(e)` | ✅ `e.Cancel=True` | 保存前校验，最常用 |
| `AfterSave(e)` | ❌ | 保存后动作（写日志、发通知），**不能再改单据** |
| `BeforeSubmit(e)` | ✅ | 提交前校验 |
| `BeforeAudit(e)` | ✅ | 审核前校验 |
| `AfterAudit(e)` | ❌ | 审核后动作（同步到下游单据） |
| `BeforeUnAudit(e)` | ✅ | 反审核前校验（**反向逻辑在这里**） |
| `BarItemClick(e)` | ❌ | 工具栏按钮点击：`e.BarItemKey` |

## 取值 / 赋值 API

- 主表字段：`model.GetValue("FFieldKey")` / `model.SetValue("FFieldKey", value)`
- 明细行字段：`model.GetValue("FFieldKey", rowIndex)` / `model.SetValue("FFieldKey", value, rowIndex)`
- 明细行数：`model.GetEntryRowCount("FEntity")`
- 获取表单视图：`self.View` / 显示消息：`self.View.ShowMessage(...)`、`ShowErrMessage(...)`、`ShowWarnningMessage(...)`
- 数据库查询（**只读元数据，绝不允许查业务表**）：走 `self.Context` + `DBUtils.ExecuteDataSet` 且 SQL 必须走白名单

## 注册位置（用户需要操作）

插件写完后，在金蝶客户端：**业务对象 → 对应单据 → 表单 → 扩展 → 注册插件**，填入 Python 文件路径（相对于服务端部署目录）。重启客户端让插件生效。

## 常见坑

- **Python 2 语法**：V9 的 IronPython 是 2.7 语法，不能用 f-string、不能用 async。
- **字段标识 vs 显示名**：`FFieldKey` 是标识（大小写敏感），`字段显示名` 是给人看的。插件里一律用标识。
- **单据头 vs 明细**：明细字段取值**必须**传 `rowIndex`，否则返回的是"空引用"。
- **反审核逻辑**：金蝶默认不会自动执行反向逻辑，需要你在 `BeforeUnAudit` 或 `AfterUnAudit` 里主动写回滚。
- **性能**：`BeforeSave` 里**不要**做跨单据查询（行数据库 IO），会把 UI 卡到无响应。实时性要求高的联动放 `DataChanged`，批量校验放 `BeforeSave`。
- **调试**：V9 没有原生断点，用 `self.View.ShowMessage(str(variable))` 打桩，或者 `Kingdee.BOS.Log.Logger.Info` 写服务端日志。

## 后续步骤

骨架产出后：
1. 对照 `common/requirements-clarification` 的 6 字段，把校验逻辑填进 `BeforeSave` / 对应钩子
2. 如果涉及联动字段，加 `DataChanged`
3. 反审核场景必加 `BeforeUnAudit`
4. 提醒用户：**部署前在测试账套复现一遍**，不要直接上生产
