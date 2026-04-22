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

## 模板 6:初始化默认值(AfterBindData)

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
