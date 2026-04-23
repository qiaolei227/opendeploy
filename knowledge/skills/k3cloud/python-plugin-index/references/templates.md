# 常用插件模板

**使用方式**:照着改。**不要一次性把所有模板都粘进 pyBody**——按澄清问的"触发时机 + 数据来源 + 异常处理"选一个最接近的,删掉不相关的事件,改字段 Key 和业务逻辑。

---

## 模板 1:BeforeSave 校验 + 阻断

场景:保存前校验业务规则,不合格就阻止保存并弹错。

```python
import clr
clr.AddReference('Kingdee.BOS')
clr.AddReference('Kingdee.BOS.Core')
from Kingdee.BOS.Core.Bill.PlugIn import AbstractBillPlugIn
from Kingdee.BOS import KDException

class BeforeSaveValidator(AbstractBillPlugIn):
    def BeforeSave(self, e):
        model = self.Model

        # 1. 必填校验
        cust = model.GetValue("FCustId")
        if cust is None:
            e.Cancel = True
            raise KDException("OPD-SAL-001", u"客户必须填写")

        # 2. 数值合理性
        amount = model.GetValue("FAllAmount")
        if amount is None or amount <= 0:
            e.Cancel = True
            raise KDException("OPD-SAL-002", u"总金额必须大于 0")

        # 3. 业务规则(示例:金额超过 10 万要提示)
        if amount > 100000:
            e.Cancel = True
            raise KDException("OPD-SAL-003",
                u"订单金额 %.2f 超过 10 万,需要主管审批通道,请走审批流下单" % amount)
```

---

## 模板 2:字段联动(DataChanged)

场景:一个字段变了,自动填充 / 清空其他字段。

```python
import clr
clr.AddReference('Kingdee.BOS')
clr.AddReference('Kingdee.BOS.Core')
from Kingdee.BOS.Core.Bill.PlugIn import AbstractBillPlugIn

class FieldSync(AbstractBillPlugIn):
    def DataChanged(self, e):
        model = self.Model
        key = e.Field.Key

        # 客户变了 → 自动填销售员 + 清空信用额度相关字段
        if key == "FCustId":
            cust = model.GetValue("FCustId")
            if cust is not None:
                # 基础资料对象用下标拿扩展字段
                seller = cust["FSellerId"]
                if seller:
                    model.SetValue("FSalerId", seller)
            else:
                model.SetValue("FSalerId", None)

        # 数量或单价变 → 自动算金额
        elif key in ("FQty", "FPrice"):
            row = e.Row
            qty = model.GetValue("FQty", row) or 0
            price = model.GetValue("FPrice", row) or 0
            model.SetValue("FAmount", qty * price, row)
```

**注意**:`SetValue` 会触发目标字段的 `DataChanged`。示例里 `FAmount` 不会递归因为我们没为 `FAmount` 写处理分支——但如果你想给 FAmount 也挂逻辑,当心自己调自己。

---

## 模板 3:按钮触发自定义动作

场景:工具栏按钮点击执行业务动作。

```python
import clr
clr.AddReference('Kingdee.BOS')
clr.AddReference('Kingdee.BOS.Core')
from Kingdee.BOS.Core.Bill.PlugIn import AbstractBillPlugIn

class CustomButton(AbstractBillPlugIn):
    def BarItemClick(self, e):
        if e.BarItemKey == "tbRecalcTotal":
            self._recalculate_total()
        elif e.BarItemKey == "tbExportCustom":
            self._export_current()

    def _recalculate_total(self):
        model = self.Model
        count = model.GetEntryRowCount("FSaleOrderEntry")
        total = 0
        for row in range(count):
            amt = model.GetValue("FAmount", row) or 0
            total += amt
        model.SetValue("FAllAmount", total)
        self.View.ShowMessage(u"重算完成,总金额 %.2f" % total)

    def _export_current(self):
        # ... 自定义导出逻辑 ...
        self.View.ShowMessage(u"导出完成")
```

---

## 模板 4:F7 动态过滤

场景:基础资料选择时只显示符合条件的候选。

```python
import clr
clr.AddReference('Kingdee.BOS')
clr.AddReference('Kingdee.BOS.Core')
from Kingdee.BOS.Core.Bill.PlugIn import AbstractBillPlugIn

class DynamicF7Filter(AbstractBillPlugIn):
    def BeforeF7Select(self, e):
        # 选客户时只列当前组织能用的
        if e.FieldKey == "FCustId":
            org_id = self.Context.CurrentOrganizationInfo.ID
            # FilterString 是 SQL WHERE 片段(走 BOS 的 ORM 语法)
            e.FilterString = "FUseOrgId.FOrgId = %d" % org_id

        # 选物料时按当前行的"物料类别"过滤
        elif e.FieldKey == "FMaterialId":
            row = e.Row
            category = self.Model.GetValue("FMaterialCategory", row)
            if category:
                e.FilterString = "FCategoryId = %d" % category.Id
```

---

## 模板 5:跨查基础资料扩展字段

场景:客户档案有个扩展字段 `FCreditLimit`(信用额度),校验时要读出来。基础资料对象的下标访问**可能不包含扩展字段**,要用 SQL 跨查。

```python
import clr
clr.AddReference('Kingdee.BOS')
clr.AddReference('Kingdee.BOS.Core')
clr.AddReference('Kingdee.BOS.App')
from Kingdee.BOS.Core.Bill.PlugIn import AbstractBillPlugIn
from Kingdee.BOS.App.Data import DBUtils
from Kingdee.BOS import KDException

class CreditCheck(AbstractBillPlugIn):
    def BeforeSave(self, e):
        cust = self.Model.GetValue("FCustId")
        if cust is None:
            return

        # 跨查客户扩展字段(参数化,安全)
        result = DBUtils.ExecuteDynamicObject(
            self.Context,
            "SELECT FCreditLimit FROM T_BD_CUSTOMER WHERE FCUSTID = @id",
            [("@id", cust.Id)]
        )

        credit_limit = None
        for row in result:
            credit_limit = row["FCreditLimit"]
            break

        if credit_limit is None:
            return  # 未设信用额度 → 不限制

        amount = self.Model.GetValue("FAllAmount") or 0
        if amount > credit_limit:
            e.Cancel = True
            raise KDException("OPD-SAL-CREDIT-001",
                u"订单金额 %.2f 超过客户信用额度 %.2f,请联系财务" % (amount, credit_limit))
```

**红线提醒**:以上是**读**客户表的 SQL,**不能改写成 UPDATE**。客户业务数据写入要走 K/3 Cloud BusinessService,不是直接 UPDATE T_BD_CUSTOMER。

---

## 模板 6(非销售): 库存数量校验 BeforeSave

场景:出库 / 调拨 / 盘点单据保存前校验数量字段非负、不超过当前可用库存。**单纯改字段名就能复用模板 1**——展示一下别在销售订单上死磕。

```python
import clr
clr.AddReference('Kingdee.BOS')
clr.AddReference('Kingdee.BOS.Core')
from Kingdee.BOS.Core.Bill.PlugIn import AbstractBillPlugIn
from Kingdee.BOS import KDException

class StockQtyValidator(AbstractBillPlugIn):
    def BeforeSave(self, e):
        model = self.Model
        # 明细行实体名 / 数量字段名替换为实际单据的:
        #   出库:FStockOutEntry / FQty
        #   调拨:FBillEntry / FQty
        #   盘点:FCheckEntry / FCheckQty
        ENTRY = "FStockOutEntry"
        QTY_KEY = "FQty"

        count = model.GetEntryRowCount(ENTRY)
        for row in range(count):
            qty = model.GetValue(QTY_KEY, row)
            if qty is None or qty <= 0:
                e.Cancel = True
                raise KDException("OPD-STK-QTY-001",
                    u"第 %d 行数量必须大于 0" % (row + 1))
```

**非销售场景的关键差异**仅在三处:**实体名**、**字段 Key**、**错误码模块前缀**。事件签名、`e.Cancel + raise` 姿势完全相同。

---

## 模板 7(非销售): 物料字段联动 DataChanged

场景:基础资料**物料档案**(`BD_MATERIAL`)上启用了某个扩展字段,变化时联动其他字段。和模板 2 同结构,只是事件触发对象是基础资料而非单据。

```python
import clr
clr.AddReference('Kingdee.BOS')
clr.AddReference('Kingdee.BOS.Core')
from Kingdee.BOS.Core.Bill.PlugIn import AbstractBillPlugIn

class MaterialFieldSync(AbstractBillPlugIn):
    def DataChanged(self, e):
        model = self.Model
        key = e.Field.Key

        # 启用批号管理 → 自动启用保质期开关(业务联动)
        if key == "FIsBatchManage":
            new_val = e.NewValue
            if new_val:
                model.SetValue("FIsKFPeriod", True)

        # 物料属性变化 → 清空"采购属性"相关默认
        elif key == "FErpClsID":
            model.SetValue("FDefaultVendor", None)
```

---

## 模板 8(非销售): 跨查基础资料用 ServiceHelper(非 SQL)

场景:任何模块的插件需要**跨查另一个基础资料**的字段,且不愿 / 不允许直连 SQL。用 BOS 的 `BusinessDataServiceHelper`。

```python
import clr
clr.AddReference('Kingdee.BOS')
clr.AddReference('Kingdee.BOS.Core')
clr.AddReference('Kingdee.BOS.ServiceHelper')
from Kingdee.BOS.Core.Bill.PlugIn import AbstractBillPlugIn
from Kingdee.BOS.ServiceHelper import BusinessDataServiceHelper

class CrossLookupExample(AbstractBillPlugIn):
    def BeforeSave(self, e):
        material = self.Model.GetValue("FMaterialId")
        if material is None:
            return

        # 用 ServiceHelper 拿物料完整 DynamicObject(含扩展字段)
        objs = BusinessDataServiceHelper.LoadFromCache(
            self.Context,
            [material.Id],
            "BD_MATERIAL"  # FormId
        )
        if objs and len(objs) > 0:
            full = objs[0]
            # 按字段 key 取
            spec = full["FSpecification"]
            # ...
```

**`ServiceHelper` vs SQL 取舍**:

| 用 ServiceHelper | 用 SQL |
|---|---|
| 想要完整对象(含扩展字段) | 只要少量列 / 高性能 |
| 不想关心表结构 | 表结构很熟、查询复杂 |
| 跨数据中心安全可控 | 数据中心内单表读 |

---

## 模板使用纪律

1. **改字段名 + 实体名是一行内的事**——不要为每个新业务**重抄整段**。模板的价值是骨架,不是穷举所有业务
2. **模板只覆盖 80% 高频场景**——遇到模板不覆盖的(操作插件 / 服务端拦截 / 复杂状态机),回 `solution-decision-framework` 重新决策,不要硬塞
3. **错误码前缀模块化**:`OPD-<模块>-<子类>-<编号>`(`OPD-SAL-` / `OPD-PUR-` / `OPD-STK-` / `OPD-FIN-` / `OPD-BD-` / `OPD-MFG-`...),方便客户日志检索

## 模板 9:初始化默认值(AfterBindData)

场景:新建单据时自动填写默认字段(比如当前用户为销售员、当前日期为交货日)。

```python
import clr
clr.AddReference('Kingdee.BOS')
clr.AddReference('Kingdee.BOS.Core')
from Kingdee.BOS.Core.Bill.PlugIn import AbstractBillPlugIn
from System import DateTime

class DefaultValues(AbstractBillPlugIn):
    def AfterBindData(self, e):
        model = self.Model

        # 只在新建时设默认(已保存过的不碰)
        if model.DataObject["FID"] > 0:
            return

        # 默认销售员 = 当前登录用户
        if not model.GetValue("FSalerId"):
            model.SetValue("FSalerId", self.Context.UserId)

        # 默认交货日 = 今天 + 7 天
        if not model.GetValue("FDeliveryDate"):
            model.SetValue("FDeliveryDate", DateTime.Today.AddDays(7))
```
