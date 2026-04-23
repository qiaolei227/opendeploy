<!-- 来源:open.kingdee.com 二开规范 + help.open.kingdee.com dokuwiki;实证状态:🟡 主流程;非客户环境实测 -->
# 操作服务插件深入版

> **K/3 Cloud DLL 最常用的场景**。审核 / 反审核 / 下推前校验 / 删除拦截——Python 全做不了,必须 DLL。

<!-- 主源:https://open.kingdee.com/K3Cloud/SDK/CreateOperationServicePlugIn.html;fetched 2026-04-23 -->

## 1. 操作插件 vs 表单插件的本质区别

| 维度 | 表单插件 `AbstractBillPlugIn` | 操作插件 `AbstractOperationServicePlugIn` |
|---|---|---|
| 执行端 | 客户端(WinForm / Web 浏览器) | **服务端**(IIS / AppServer) |
| 生命周期 | 表单打开 → 关闭 | **一次操作**(如一次审核点击)— 触发 → 事务 → 完成 |
| 事务边界 | 无(客户端无事务) | **在数据库事务内** |
| 能读 DB 吗? | 可以(但要小心网络往返) | **就在 DB 所在服务端上** |
| 能阻断保存? | ✅ `BeforeSave` + `e.Cancel` | 不通过此插件——但能阻断**所有**操作 |
| 能阻断审核? | ❌ | ✅ 核心用途之一 |
| 能阻断删除? | ❌ | ✅ |
| 性能敏感? | 一般 | **非常**——服务端多用户并发 |
| Python 可以替代? | ✅ | ❌ |

**关键**:表单插件的 `BeforeSave` 只能校验**客户端能看到的字段**;操作插件能看到**整条数据实体 + 所有字段 + 所有子表**,并且是在事务提交前执行,撤回完全安全。

---

## 2. 完整事件生命周期

<!-- 来源:https://open.kingdee.com/K3Cloud/SDK/CreateOperationServicePlugIn.html;fetched 2026-04-23 -->

用户点"审核"按钮时,**同一个 DLL 的**这些事件按顺序跑:

```
[客户端 BillPlugin.ButtonClick("Audit")]
     ↓  (RPC 调用到服务端)
[1] OnPreparePropertys(PreparePropertysEventArgs e)
     // 声明本次操作需要 DB 加载的字段
     // 默认框架只加载必需字段,需要读 FCustomer.FAge 就在这里 e.FieldKeys.Add("FCustomer.FAge")

[2] OnAddValidators(AddValidatorsEventArgs e)
     // 注册校验器,见下文 "校验器模型"
     // e.Validators.Add(new MyValidator { EntityKey = "FBillHead", ... });

[3] BeginOperationTransaction(BeginOperationTransactionArgs e)
     // DB 事务已开始,校验器已跑完(若校验失败此处不会执行)
     // 可做事务内的前置准备(比如查其他表锁定行)

[4] BeforeExecuteOperationTransaction(BeforeExecuteOperationTransactionArgs e)
     // 核心逻辑执行前——最常用拦截点
     // e.SelectedRows / e.DataEntitys 可读可改
     // 如果要"审核的同时往关联表写一条记录",这里做

--- 框架执行核心逻辑(审核/反审核/删除等) ---

[5] EndOperationTransaction(EndOperationTransactionArgs e)
     // 核心逻辑执行完,事务未提交
     // 典型用法:更新关联表状态(如审核后解锁上游单据)

--- 事务提交 ---

[6] AfterExecuteOperationTransaction(AfterExecuteOperationTransactionArgs e)
     // 事务已提交、不可回滚
     // 发通知、写日志、推消息——这些操作出错不影响主操作
```

---

## 3. 校验器模型(阻断操作的标准姿势)

### 3a. 自定义校验器

```csharp
using Kingdee.BOS.Core.Validation;
using Kingdee.BOS.Core.DynamicForm;
using Kingdee.BOS.Core.Bill;
using Kingdee.BOS.Orm.DataEntity;

public class CreditLimitValidator : AbstractValidator
{
    public CreditLimitValidator()
    {
        this.EntityKey = "FBillHead";   // 作用于主表(每头数据调一次)
        this.AlwaysValidate = true;
    }

    public override void Validate(
        ExtendedDataEntity[] dataEntities,
        ValidateContext validateContext,
        Context ctx)
    {
        foreach (var entity in dataEntities)
        {
            var row = entity.DataEntity;
            decimal limit = Convert.ToDecimal(row["F_CreditLimit"]);
            decimal used  = Convert.ToDecimal(row["F_CreditUsed"]);
            decimal amt   = Convert.ToDecimal(row["FAmount"]);

            if (used + amt > limit)
            {
                validateContext.AddError(
                    entity,
                    new ValidationErrorInfo(
                        "",                             // fieldKey 空——整行错
                        Convert.ToInt64(row["FID"]),    // 主键
                        entity.RowIndex,
                        0,                              // errorLevel
                        "CreditExceeded",
                        "信用额度超限",
                        $"客户可用余额 {limit - used},本单金额 {amt} 超出"));
            }
        }
    }
}
```

### 3b. 在插件里注册校验器

```csharp
public class SaleOrderCreditGuardOp : AbstractOperationServicePlugIn
{
    public override void OnAddValidators(AddValidatorsEventArgs e)
    {
        base.OnAddValidators(e);
        e.Validators.Add(new CreditLimitValidator());
    }

    public override void OnPreparePropertys(PreparePropertysEventArgs e)
    {
        base.OnPreparePropertys(e);
        // 校验器会用到的字段必须在此声明,否则 entity[fieldKey] 是 null
        e.FieldKeys.Add("FAmount");
        e.FieldKeys.Add("F_CreditLimit");
        e.FieldKeys.Add("F_CreditUsed");
    }
}
```

### 3c. 关键规则

- `AddError` 调用后,框架**立即中止此行**的后续操作(事务内),但**会继续检查其他行**——一次提交 10 个单据,第 3 个错了,其他 9 个继续
- **不要在事件里直接抛异常** (`throw new KDException(...)`)——会把整批回滚,用户体验差,也违反金蝶二开规范
- `fieldKey` 写字段名(如 `"FAmount"`)可以让前端红框高亮那个字段;写空字符串则整行提示

---

## 4. 反审核拦截的标准姿势

反审核在 K/3 Cloud 底层走**同一套** `AbstractOperationServicePlugIn` 事件,**不是**独立的 `BeforeCancelData` 事件。

### 判断当前操作是反审核

```csharp
public override void BeforeExecuteOperationTransaction(
    BeforeExecuteOperationTransactionArgs e)
{
    // 操作 Key 通过 this.OperationName 或 this.OperationNumber 读取
    // 不同版本字段名可能不同 <!-- 待用户实证 -->
    string op = this.OperationName;    // 常见值:"Audit" / "UnAudit" / "Delete"

    if (op != "UnAudit") return;

    foreach (var row in e.DataEntitys)
    {
        // 反审核前检查:下游已开票?已发货?
        long billId = Convert.ToInt64(((DynamicObject)row)["FID"]);
        bool hasInvoice = CheckInvoiceExists(billId);
        if (hasInvoice)
        {
            // 反审核拦截必须用 AddError,不能在 BeforeExecute 用 throw
            // 但 BeforeExecuteOperationTransaction 没有 validateContext——
            // 标准做法:在 OnAddValidators 阶段注册校验器,校验器内做此检查
            // 此处留作示意:如果已经到 BeforeExecute,阻断只能靠抛 KDException
        }
    }
}
```

**最佳实践**:反审核拦截应该**注册一个只在 `UnAudit` 时生效的 Validator**,见 3b 示例——在 Validator 内通过 `validateContext.BusinessInfo` / `ctx.OperationNumber` 判断。<!-- 具体取值字段名待实证 -->

---

## 5. 下推前校验

下推操作从业务语义上也是一次"操作",但走的是 **`AbstractConvertPlugIn`** 而不是 operation plugin——见 `convert-plugin.md`。

如果想"销售订单保存时检查客户有无挂帐欠款",选 operation plugin 的 `Save` 操作即可。

---

## 6. EventArgs 详细说明

### `PreparePropertysEventArgs`

| 属性 | 类型 | 含义 |
|---|---|---|
| `FieldKeys` | `List<string>` | 本次操作需要加载的字段 Key(用 Add 追加) |

### `AddValidatorsEventArgs`

| 属性 | 类型 | 含义 |
|---|---|---|
| `Validators` | `List<AbstractValidator>` | 校验器列表(用 Add 追加) |

### `BeforeExecuteOperationTransactionArgs`

| 属性 | 类型 | 含义 |
|---|---|---|
| `SelectedRows` | `ListSelectedRowCollection` | 用户选中的行(列表操作) |
| `DataEntitys` | `DynamicObject[]` | 操作涉及的完整数据实体 |

### `EndOperationTransactionArgs`

| 属性 | 类型 | 含义 |
|---|---|---|
| `DataEntitys` | `DynamicObject[]` | 数据实体(此时已被核心逻辑改过,比如审核状态已是 C/已审核) |

### `AfterExecuteOperationTransactionArgs`

| 属性 | 类型 | 含义 |
|---|---|---|
| `DataEntitys` | `DynamicObject[]` | 数据实体(事务已提交) |

---

## 7. 性能注意事项

<!-- 来源:https://open.kingdee.com/k3cloud/open/DevelopStandard.html;fetched 2026-04-23 -->

二开规范明确:

- **禁止在大批量循环中执行低性能或高数据量 SQL**——一次批量审核 200 单,不要每单一条 SELECT
- 建议:把主键收集成 List,用 `IN` 批量查一次,拆到 Dictionary 后循环内 O(1) 查找
- `OnPreparePropertys` 里**只加需要的字段**——多一个字段多一个 JOIN / SELECT 列
- `AfterExecuteOperationTransaction` 里发邮件 / 推 MQ 必须**异步**——不要卡住用户
- 不要调用 `DBUtils.Execute` 做写操作——用金蝶提供的 `ServiceHelper` 走标准 API 保证事务

---

## 8. 多操作组合

一个单据可以挂**多个操作插件**,同一操作也可以挂**多个**。事件触发顺序:

1. **同一插件内事件**按本文 §2 顺序
2. **同一操作上的多个插件**按**注册顺序**调用;任意一个在 `OnAddValidators` 里注册的校验器报错,整个操作链就停
3. **不同操作之间**不会互相触发

---

## 9. 注册到元数据(XML 样板)

用户已经写完 DLL 后,需要把插件注册到 `T_META_OBJECTTYPE.FKERNELXML` 的 `<OperationServicePlugins>` 节点——扩展对象写扩展的 FID,不要改父对象。

```xml
<OperationServicePlugins>
  <OperationServicePlugin OperationName="Audit">
    <PlugIn>
      <ClassName>ABC.SAL.SaleOrderCreditGuardOp</ClassName>
      <AssemblyName>ABC.SAL.BusinessPlugIn</AssemblyName>
    </PlugIn>
  </OperationServicePlugin>
  <OperationServicePlugin OperationName="UnAudit">
    <PlugIn>
      <ClassName>ABC.SAL.SaleOrderUnAuditBlockOp</ClassName>
      <AssemblyName>ABC.SAL.BusinessPlugIn</AssemblyName>
    </PlugIn>
  </OperationServicePlugin>
</OperationServicePlugins>
```

**OpenDeploy v0.1 不自动化此步骤**——开发者必须自己通过 BOS Designer 或 `kingdee_write_plugin_*`(扩展对象机制)注入。

---

## 10. 常见坑

- **字段没加载**:校验器里 `entity.DataEntity["F_xxx"]` 返回 `null`——忘记在 `OnPreparePropertys` 加
- **事务内做耗时 IO**:调外部 HTTP 接口 / 写文件——整单事务卡住,锁行时间过长
- **在 `AfterExecuteOperationTransaction` 里 `throw` **:事务已经提交了,抛异常只会影响后面回调,不会回滚
- **校验器 `EntityKey` 选错**:选 `FBillHead` 每头调一次,选 `FEntity` 每行调一次——选错会漏校验或重复校验
- **多线程安全**:操作插件会在服务端并发执行,**不要用静态字段存状态**

---

## 临时话术(agent 引用)

> 你这个需求是【审核 / 反审核 / 删除 / 下推 / 保存】拦截,要用**操作服务插件**:
>
> - 基类:`Kingdee.BOS.Core.DynamicForm.PlugIn.AbstractOperationServicePlugIn`
> - 关键事件:`OnAddValidators` 注册校验器 + 校验器的 `Validate` 方法 + `validateContext.AddError(...)` 阻断
> - 必须在 `OnPreparePropertys` 里声明用到的字段,否则读到 null
> - 注册到扩展对象的 `FKERNELXML.<OperationServicePlugins>.<OperationServicePlugin OperationName="Audit">`
>
> 代码需要 Visual Studio 写,本产品 v0.1 不代办。我可以给你:工程搭建细节(见 `development-setup.md`)/ 样例代码框架。
