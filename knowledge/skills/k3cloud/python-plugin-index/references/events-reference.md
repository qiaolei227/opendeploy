# 表单插件事件签名参考

按**触发时机**组织。`AbstractBillPlugIn` 的常用 override 方法,覆盖 80% 实施场景。精确签名以本机 `D:\K3Cloud\WebSite\Bin\Kingdee.BOS.Core.dll` 为准——本表对不上时以 DLL 为准。

---

## 表单生命周期

### `BeforeBindData(self, e)`
- 触发:数据绑定前。此时 `Model.DataObject` 有值但控件没显示
- 常用:初始化默认值 / 根据当前用户预填字段
- `e.Cancel`:**不支持**

### `AfterBindData(self, e)`
- 触发:数据绑定后。控件已显示,字段值都可读
- 常用:读初始字段值,决定界面显隐 / 只读状态
- `e.Cancel`:**不支持**

### `BeforeClosed(self, e)`
- 触发:表单关闭前
- 常用:提醒未保存修改
- `e.Cancel`:**支持**,设 True 阻止关闭

---

## 字段值变化

### `DataChanged(self, e)`
- 触发:头字段 / 明细字段值**变化后**
- `e.Field.Key` — 字段 Key,如 `"FCustId"`
- `e.OldValue` / `e.NewValue` — 变化前后值
- `e.Row` — 明细行索引(头字段 = -1)
- `e.Cancel`:**不支持**(已经变了,无法回滚)

```python
def DataChanged(self, e):
    if e.Field.Key == "FCustId":
        # 客户变了,自动填销售员
        cust = self.Model.GetValue("FCustId")
        if cust:
            self.Model.SetValue("FSalerId", cust["FSellerId"])
```

### `DataChanging(self, e)`
- 触发:字段值变化**前**(验证用)
- 同上属性,多一个 `e.Cancel`
- `e.Cancel`:**支持**,设 True 拒绝这次值变化

---

## 保存 / 提交(最常用)

### `BeforeSave(self, e)`
- 触发:保存前,客户端 UI 线程
- 常用:业务规则校验,金额 / 数量合理性检查
- `e.Cancel`:**支持**。拦截姿势:同时 `e.Cancel = True` 且 `raise KDException(...)`,详见 `prompts/error-handling`

```python
def BeforeSave(self, e):
    amount = self.Model.GetValue("FAllAmount")
    if amount is None or amount <= 0:
        e.Cancel = True
        raise KDException("OPD-SAL-001", u"金额必须大于 0")
```

### `AfterSave(self, e)`
- 触发:保存后,带 `e.Result`
- 常用:日志 / 通知,**不能取消**,只能副作用
- `e.Cancel`:**不支持**

### `BeforeUpdate(self, e)` / `AfterUpdate(self, e)`
- 同 Save 系列,但触发于"修改已有单据"(而非新建)
- 细节同上

---

## 审核 / 提交审核

**表单插件拿不到**。审核 / 反审核拦截需要**操作插件**(`T_META_OPERATESERVICEPLUGIN`),OpenDeploy v0.1 不支持。

遇到用户要求"审核时校验",告知:
> "审核拦截需要操作插件,当前 OpenDeploy 工具链不支持。建议:
> 1. 在 BOS Designer 手工注册 C# 操作插件
> 2. 或者把校验时机改到'保存前',保存通过即意味着合规
> 3. 未来 OpenDeploy v0.2+ 会覆盖操作插件"

---

## 按钮事件

### `BarItemClick(self, e)`
- 触发:工具栏按钮点击
- `e.BarItemKey` — 按钮 Key
- `e.Cancel`:**不支持**

```python
def BarItemClick(self, e):
    if e.BarItemKey == "tbCalcBtn":
        self._recalculate_total()
```

### `ButtonClick(self, e)`
- 触发:单据体内按钮点击(非工具栏)
- `e.Key` — 按钮 Key
- `e.Cancel`:**不支持**

---

## 基础资料选择前

### `BeforeF7Select(self, e)`
- 触发:点击基础资料字段的放大镜前,弹出选择器前
- 常用:动态过滤基础资料列表(比如选客户时只列当前组织的)
- `e.FilterString` — 可赋值,SQL 式过滤表达式
- `e.Cancel`:**支持**,阻止弹出

```python
def BeforeF7Select(self, e):
    if e.FieldKey == "FCustId":
        org_id = self.Context.CurrentOrganizationInfo.ID
        e.FilterString = "FUseOrgId.FOrgId = %d" % org_id
```

### `BeforeF7ViewSelect(self, e)`
- 触发:选择面板里的候选项被选中前
- 常用:根据当前行内容限制可选项
- `e.Cancel`:**支持**

---

## 事件属性总表

| 事件 | 时机 | `e.Cancel` | 常用 `e.*` |
|---|---|---|---|
| `BeforeBindData` | 绑定前 | ❌ | - |
| `AfterBindData` | 绑定后 | ❌ | - |
| `BeforeClosed` | 关闭前 | ✅ | - |
| `DataChanging` | 值变化前 | ✅ | `Field.Key, OldValue, NewValue, Row` |
| `DataChanged` | 值变化后 | ❌ | 同上 |
| `BeforeSave` | 保存前 | ✅ | - |
| `AfterSave` | 保存后 | ❌ | `Result` |
| `BeforeUpdate` | 更新前 | ✅ | - |
| `AfterUpdate` | 更新后 | ❌ | `Result` |
| `BarItemClick` | 工具栏按钮 | ❌ | `BarItemKey` |
| `ButtonClick` | 单据体按钮 | ❌ | `Key` |
| `BeforeF7Select` | F7 弹窗前 | ✅ | `FieldKey, FilterString` |
| `BeforeF7ViewSelect` | F7 选中前 | ✅ | `FieldKey` |
