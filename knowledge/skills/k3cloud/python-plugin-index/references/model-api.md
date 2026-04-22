# Model / View / Context API

`AbstractBillPlugIn` 的三个核心属性。写业务逻辑 90% 的代码在操作它们。

---

## `self.Model` —— 读写字段值

### 头字段

```python
# 读
val = self.Model.GetValue("FCustId")
# 写
self.Model.SetValue("FNote", u"备注内容")
```

### 明细字段

```python
# 读(row 从 0 开始)
val = self.Model.GetValue("FQty", row_index)
# 写
self.Model.SetValue("FPrice", 100.0, row_index)
```

### 子单据体字段(三参数重载)

```python
# 读子单据体(如税率子表)
val = self.Model.GetValue("FTaxRate", row_index, "FTaxDetailSubEntity")
self.Model.SetValue("FTaxRate", 0.13, row_index, "FTaxDetailSubEntity")
```

### 基础资料字段返回的是**对象**

基础资料字段(`FCustId`、`FMaterialId`、`FSellerId` 等) `GetValue` 返回的不是 ID 而是带字段的对象:

```python
cust_obj = self.Model.GetValue("FCustId")
if cust_obj is not None:
    cust_id = cust_obj.Id              # 客户 FID (long)
    cust_num = cust_obj["FNumber"]     # 客户编码
    cust_name = cust_obj["FName"]      # 客户名
    # 其他扩展字段也靠下标索引
    credit = cust_obj["FCreditLimit"]  # 假设有信用额度字段
```

**注意**:这个对象只有**基础资料本身的字段**,没有扩展字段。要查扩展字段的当前值,要么用 SQL 查 `T_BD_CUSTOMER` 主表,要么用 `ServiceHelper` 按 ID 再取。

### 明细行操作

```python
# 明细行数量
count = self.Model.GetEntryRowCount("FSaleOrderEntry")

# 遍历明细
for row in range(count):
    qty = self.Model.GetValue("FQty", row)
    price = self.Model.GetValue("FPrice", row)

# 新增明细行
self.Model.CreateNewEntryRow("FSaleOrderEntry")

# 删除明细行
self.Model.DeleteEntryRow("FSaleOrderEntry", row_index)
```

### 整张单据 DataObject

```python
# 拿整张单据的 DynamicObject(只读更稳妥)
bill = self.Model.DataObject
# 遍历所有字段
for field in bill.DynamicObjectType.Properties:
    print(field.Name, bill[field.Name])
```

---

## `self.View` —— UI 操作

### 消息框 / 提示

```python
from Kingdee.BOS.Core.DynamicForm import MessageBoxOptions

# 阻塞式消息框
self.View.ShowMessage(u"校验通过", MessageBoxOptions.OK)

# 简短提示(非阻塞)
self.View.ShowMessage(u"已自动填充销售员")

# 错误提示
self.View.ShowErrMessage(u"客户信用超限", u"错误")

# 警告提示
self.View.ShowWarnningMessage(u"金额接近上限")
```

### 字段 UI 控制

```python
# 禁用 / 启用字段
self.View.GetFieldEditor("FPrice", row).Enabled = False

# 隐藏 / 显示字段(整列)
self.View.GetFieldEditor("FNote", -1).Visible = False

# 设置字段必填(UI 提示,真正必填要在 BeforeSave 里校验)
self.View.GetFieldEditor("FCustId", -1).MustInput = True
```

### 刷新界面

```python
# 改完字段后让界面同步
self.View.UpdateView("FPrice", row_index)
self.View.UpdateView()  # 全刷
```

---

## `self.Context` —— 运行上下文

```python
# 当前登录用户 ID
uid = self.Context.UserId

# 当前组织
org = self.Context.CurrentOrganizationInfo
org_id = org.ID
org_name = org.Name

# 数据库 key
db_id = self.Context.AccountId

# 当前用户所属角色列表(长 ID 数组)
role_ids = self.Context.UserRoleIds
```

### 跨查服务(ServiceHelper)

用 Context 跨查其他数据的通道。常见场景:

```python
import clr
clr.AddReference('Kingdee.BOS.App')
from Kingdee.BOS.App.Data import DBUtils

# 通过 Context 拿数据库会话,跑参数化 SQL
result = DBUtils.ExecuteDynamicObject(
    self.Context,
    "SELECT FID, FNAME FROM T_BD_CUSTOMER WHERE FMASTERID = @custId",
    [("@custId", cust_id)]
)
for row in result:
    print(row["FID"], row["FNAME"])
```

**⚠️ 红线**:业务表 SQL 是**读取**可以,**写入**不行——客户业务数据红线。需要写库存 / 订单这类业务表,走 K/3 Cloud 自己的 BusinessService,不要 UPDATE SQL。

---

## 常见陷阱

1. **`SetValue` 触发联动**——设值会触发目标字段的 `DataChanged`,容易递归。要避免可用 `self.Model.BeginInit()` / `EndInit()` 包住批量赋值(具体 API 待核)
2. **`GetValue` 返回 .NET 类型**——比如 `FDate` 字段返回 `System.DateTime`,不是 Python `datetime`。要转:
   ```python
   from System import DateTime
   dt = self.Model.GetValue("FDate")  # System.DateTime
   # 转成字符串
   s = dt.ToString("yyyy-MM-dd")
   ```
3. **明细字段读不到值**——可能是字段 Key 写错了,或该字段在子单据体里(用三参数 `GetValue`)
4. **基础资料对象为 None**——用户没选该字段时 `GetValue` 返回 None,不是空对象。先 `is not None` 判断
5. **按钮事件 `BarItemKey` 大小写敏感**——BOS 里注册的 Key 是什么就是什么,对不上就不触发
