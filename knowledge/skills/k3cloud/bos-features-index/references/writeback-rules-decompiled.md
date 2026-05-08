---
name: writeback-rules-decompiled
title: BOS 反写规则 — 反编译 + DB 实证
description: WriteBackRuleElement 完整属性树、WriteBackType 枚举、触发模型、源-目标字段映射、DB 存储格式，以及 k3cloud_add_write_back_rule / _list / _delete 的实现路径。
fetched: 2026-04-25
sources:
  - /tmp/bos-decompile/out-core/Kingdee.BOS.Core.decompiled.cs (line 137959+, 134998+, 211980+)
  - DB: AIS20260302144343 T_BF_WRITEBACKRULE (1238 rows), T_BF_WRITEBACKRULE_L, T_BF_WRITEBACKRULECUST
---

<!-- 
  实证级别说明：
  🟢 实证 — decompile 源码 + 真实 DB 行双重确认
  🟡 主流程 — 仅 decompile 确认，未 DB 写入验证
  🔴 骨架 — 推断，未经验证
-->

# BOS 反写规则的完整工程模型

反写规则（WriteBack Rule）是 BOS 的**跨单据数量/金额累计机制**：当目标单据（如发货单）执行某操作时，把目标单据的某字段值（按公式计算）累加/扣减/覆盖回源单据（如销售订单）的某字段。

---

## 1. WriteBackRuleElement 属性模型

🟢 decompile 源码 `Kingdee.BOS.Core.decompiled.cs` line 137959，class `WriteBackRuleElement : ISupportInitialize`。

### 1.1 身份 / 归属

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `Id` | `string` | GUID | 规则主键，`[SimpleProperty(true)]` = primaryKey |
| `Name` | `LocaleValue` | — | 多语言名称 |
| `SourceFormId` | `string` | — | 源单据 FormId（被写入方，如 `SAL_SaleOrder`） |
| `TargetFormId` | `string` | — | 目标单据 FormId（触发方，如 `SAL_OUTSTOCK`） |
| `ForbidStatus` | `string` | — | `"A"` 正常 / `"B"` 禁用（见 `WriteBackRuleStatus` 常量） |
| `SysStatus` | `string` | — | `"0"` 正常 / `"1"` 系统禁用（见 `WriteBackRuleSysStatus`） |
| `IsNormal` | `bool` | — | 是否正常状态 |

### 1.2 触发条件

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `OperationNumber` | `string` | `"Save"` | 触发操作码（见第3节） |
| `Condition` | `string` | — | IronPython 表达式字符串，对目标单据行过滤 |
| `ConditionDesc` | `LocaleValue` | — | Condition 的人读描述（BOS Designer 显示用） |
| `ConditionFieldKeys` | `List<string>` | — | Condition 中引用的字段键列表 |
| `ConditionExpression` | `BOSExpression` | — | 预编译表达式（运行时） |

### 1.3 写回动作（核心）

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `WriteBackType` | `WriteBackType` | `Add` | 操作类型：`Add` / `Lessen` / `Cover`（见第2节） |
| `Formula` | `string` | — | IronPython 表达式，计算本次写回的**增量值**（来自目标单据行） |
| `FormulaDesc` | `LocaleValue` | — | Formula 人读描述 |
| `FormulaFieldKeys` | `List<string>` | — | Formula 中引用的字段键列表 |
| `FormulaKeys` | `string[]` | — | Formula 键数组（运行时） |
| `Expression` | `BOSExpression` | — | 预编译表达式（运行时） |
| `SourceCommitFieldKey` | `string` | — | 源单据上**累计写回结果**存放字段的 Key（如 `FStockBaseStockOutQty`） |
| `SourceCommitFieldName` | `LocaleValue` | — | 上述字段的显示名 |

### 1.4 分配模式

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `DistributeType` | `DistributeType` | `TopDown` | 分配方式：`TopDown`（先来先得）/ `Weight`（按权重比） |
| `MaxDistributeFormula` | `string` | — | 源单据行**可分配最大量**公式（超量控制的上限） |
| `MaxDistributeFormulaDesc` | `LocaleValue` | — | 人读描述 |
| `MaxDistributeExpression` | `BOSExpression` | — | 预编译（运行时） |
| `UseLinkEntity` | `bool` | — | 是否使用 LinkEntity 关联（含关联表的多单据场景） |
| `TargetControlFieldKey` | `string` | — | 目标单据控制字段 Key |

### 1.5 行关闭 / 单据关闭

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `CloseCheckFormula` | `string` | — | 行关闭判断公式（满足 → 标行为"已完成"状态） |
| `CloseCheckFormulaDesc` | `LocaleValue` | — | 人读描述 |
| `CloseCheckExpression` | `BOSExpression` | — | 预编译（运行时） |
| `EntityCloseFieldKey` | `string` | — | 源单据**行**关闭状态字段 Key（如 `FMrpCloseStatus`） |
| `EntityCloseFieldSuccesStatus` | `string` | — | 行关闭成功状态值（通常 `"B"`） |
| `EntityCloseFieldFailStatus` | `string` | — | 行关闭失败状态值（通常 `"A"`） |
| `BillClosePolicy` | `BillClosePolicy` | `AllRowsClosed` | 单据整体关闭策略：`AllRowsClosed` / `OneRowClosed` |
| `BillCloseFieldKey` | `string` | — | 源单据**头**关闭状态字段 Key（如 `FCloseStatus`） |
| `BillCloseFieldSuccesStatus` | `string` | — | 单据关闭成功值（通常 `"B"`） |
| `BillCloseFieldFailStatus` | `string` | — | 单据关闭失败值（通常 `"A"`） |

### 1.6 超量控制

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `ExcessCheckType` | `ExcessCheckType` | `StrictControl` | 超量策略（见第2节） |
| `ExcessSelectFormula` | `string` | — | 当 `SelectByFormula` 时，动态选策略的公式 |
| `ExcessSelectFormulaDesc` | `LocaleValue` | — | 人读描述 |
| `ExcessSelectTrue` | `ExcessCheckType` | `CanExcellAlways` | 公式为 true 时采用的策略 |
| `ExcessSelectFalse` | `ExcessCheckType` | `CanExcellAlways` | 公式为 false 时采用的策略 |
| `ExcessSelectExpression` | `BOSExpression` | — | 预编译（运行时） |
| `ExcessCheckFormula` | `string` | — | 超量检查公式（是否真的超量） |
| `ExcessCheckFormulaDesc` | `LocaleValue` | — | 人读描述 |
| `ExcessCheckMessage` | `LocaleValue` | — | 超量时弹出的提示消息 |
| `ExcessCheckExpression` | `BOSExpression` | — | 预编译（运行时） |

### 1.7 其他

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `AutoFitFreeFlow` | `bool` | `true` | 自动适配自由流程 |
| `AutoFitAllFlows` | `bool` | `true` | 自动适配所有流程 |
| `IsCommitToHeadEntity` | `bool` | — | 写回到头实体（非行） |
| `SourceTableName` | `string` | — | 源表名（多实体场景） |
| `RuleGroup` | `string` | `""` | 规则分组标识 |
| `IsCancelPrecision` | `bool` | `false` | 是否取消精度控制 |
| `WriteBackFallbackValue` | `EWriteBackFallbackValue` | `NoHandle` | 无法写回时的回退处理 |
| `WBNetWorkCtrlType` | `WBNetWorkCtrlType` | `Default` | 网络控制类型 |

---

## 2. 枚举值完整定义

🟢 decompile line 134998–135035。

### WriteBackType — 写回操作类型

| 值 | XML 字符串 | 语义 |
|----|-----------|------|
| `0` | `Add` | **累加**：`SourceCommitField += Formula` |
| `1` | `Lessen` | **扣减**：`SourceCommitField -= Formula` |
| `2` | `Cover` | **覆盖**：`SourceCommitField = Formula` |

> 🟢 DB 实证：1238 条规则中，`Add` 最多（如 `SAL_OUTSTOCK→SAL_SaleOrder` 出库累加），`Lessen` 次之（退货扣减），`Cover` 较少（如票据退回覆盖退款字段）。

### DistributeType — 分配方式

| 值 | XML 字符串 | 语义 |
|----|-----------|------|
| `0` | `TopDown` | 按单据顺序优先分配（先来先得），是绝大多数业务规则的默认选项 |
| `1` | `Weight` | 按权重比分配（如质检场景按样品损耗比例） |

> 🟢 DB 实证：`DistributeType>Weight` 出现于质检扣损场景（`QM_QCWriteBack`）。

### ExcessCheckType — 超量控制策略

| 值 | XML 字符串 | 语义 |
|----|-----------|------|
| `0` | `StrictControl` | 严格控制：超量直接拒绝 |
| `1` | `CanExcessOneTime` | 允许一次超量（整体超过时告警但允许） |
| `2` | `CanExcellAlways` | 始终允许超量（宽松模式） |
| `3` | `SelectByFormula` | 由公式动态决定采用哪种策略 |

### BillClosePolicy — 单据关闭策略

| 值 | XML 字符串 | 语义 |
|----|-----------|------|
| `0` | `AllRowsClosed` | 所有行均关闭才关闭单据头（默认） |
| `1` | `OneRowClosed` | 任意一行关闭即关闭单据头 |

### EWriteBackFallbackValue — 写回失败回退

| 值 | XML 字符串 | 语义 |
|----|-----------|------|
| `0` | `NoHandle` | 不处理（默认） |
| `1` | `ClearValue` | 清空目标字段 |
| `2` | `DefaultValue` | 写默认值 |

> 🟢 DB 实证：`DefaultValue` 在 `CMK_RT_TicketsReturn→AR_REFUNDBILL` 的 Cover 规则中出现。

### WBNetWorkCtrlType — 网络控制类型

| 值 | XML 字符串 | 语义 |
|----|-----------|------|
| `0` | `Default` | 默认 |
| `1` | `OnlyWBCtrl` | 仅反写控制 |
| `2` | `ResetWBCtrl` | 重置反写控制 |
| `3` | `WBCtrlPlus` | 反写控制增强 |

---

## 3. 触发模型（OperationNumber）

🟢 decompile line 211980，class `OperationNumberConst`。

`WriteBackRuleElement.OperationNumber` 是一个字符串，值取自以下常量：

| 常量 | 字符串值 | 典型业务场景 |
|------|---------|------------|
| `OperationNumber_Save` | `"Save"` | **保存时触发**（最常见，占 DB 中绝大多数规则） |
| `OperationNumber_Audit` | `"Audit"` | **审核时触发**（如报销审核反写付款金额） |
| `OperationNumber_UnAudit` | `"UnAudit"` | 反审核时触发（回冲） |
| `OperationNumber_Delete` | `"Delete"` | 删除时触发（回冲） |
| `OperationNumber_CancelAssign` | `"CancelAssign"` | 取消分配 |
| `OperationNumber_Cancel` | `"Cancel"` | 作废 |
| `OperationNumber_Allocate` | `"Allocate"` | 分配 |
| `OperationNumber_Push` | `"Push"` | 推单 |
| `OperationNumber_Disable` | `"Disable"` | 禁用 |

> 🟢 DB 实证：SAL_SaleOrder 关联的 90 条规则，`OperationNumber` 以 `"Save"` 为主，`"Audit"` 次之（如应收应付反写在审核时触发）。

默认值验证：`GetOpNumberWithDefault()` 方法 —— 当 `OperationNumber` 为空时返回 `"Save"`。

---

## 4. 源-目标字段映射形态

🟢 DB 实证，从 SAL_SaleOrder→SAL_OUTSTOCK 规则（FID=`73455b4e`）提取。

### 4.1 最小规则配置（无行关闭）

以"发货单审核反写销售订单已出库量"为例：

```xml
<WriteBackRule>
  <Id>73455b4e-f14e-4763-a33c-aa06481aee25</Id>
  <TargetFormId>SAL_OUTSTOCK</TargetFormId>      <!-- 触发方：发货单 -->
  <SourceFormId>SAL_SaleOrder</SourceFormId>      <!-- 被写入方：销售订单 -->
  <Condition>FOUTCONTROL=0 And FSrcType="SAL_SaleOrder" And FISGENFORIOS == false</Condition>
  <OperationNumber>Save</OperationNumber>          <!-- 保存时触发 -->
  <WriteBackType>Lessen</WriteBackType>            <!-- 扣减 -->
  <MaxDistributeFormula>FStockBaseCanOutQty</MaxDistributeFormula>  <!-- 可分配上限 -->
  <Formula>FBaseUnitQty</Formula>                 <!-- 增量值：本次出库基本单位数量 -->
  <SourceCommitFieldKey>FStockBaseCanOutQty</SourceCommitFieldKey>  <!-- 写入目标字段 -->
  <ExcessCheckType>CanExcessOneTime</ExcessCheckType>
  <ExcessCheckFormula>...</ExcessCheckFormula>
  <ExcessCheckMessage>...</ExcessCheckMessage>
</WriteBackRule>
```

### 4.2 含行关闭+单据关闭的规则

以"发货单→销售订单（含出库完结标记）"为例（FID=`2ac20b0a`）：

```xml
<EntityCloseFieldKey>FMrpCloseStatus</EntityCloseFieldKey>   <!-- 行关闭字段 -->
<EntityCloseFieldSuccesStatus>B</EntityCloseFieldSuccesStatus>  <!-- B=已完结 -->
<EntityCloseFieldFailStatus>A</EntityCloseFieldFailStatus>      <!-- A=未完结 -->
<BillCloseFieldKey>FCloseStatus</BillCloseFieldKey>           <!-- 单据头关闭字段 -->
<BillCloseFieldSuccesStatus>B</BillCloseFieldSuccesStatus>
<BillCloseFieldFailStatus>A</BillCloseFieldFailStatus>
<CloseCheckFormula>
  (FOUTLMTUNIT == 'STK' And abs(FSTOCKBASESTOCKOUTQTY) - abs(FSTOCKBASEREBACKQTY) >= abs(FStockBaseQty)) 
  Or (FOUTLMTUNIT == 'SAL' And ...)
</CloseCheckFormula>
```

### 4.3 审核触发 + Cover 模式（ER 报销→付款单）

```xml
<OperationNumber>Audit</OperationNumber>           <!-- 审核时触发 -->
<WriteBackType>Cover</WriteBackType>               <!-- 覆盖写入 -->
<Formula>0</Formula>                               <!-- 覆盖值为 0 -->
<SourceCommitFieldKey>FISTOREFUND</SourceCommitFieldKey>
<WriteBackFallbackValue>DefaultValue</WriteBackFallbackValue>
```

### 4.4 字段映射逻辑总结

```
[目标单据行字段 Formula]  ---(WriteBackType: Add/Lessen/Cover)--->  [源单据行字段 SourceCommitFieldKey]
                                    ↑
           [触发条件 Condition] + [操作 OperationNumber]
```

---

## 5. DB 存储位置 + XML 节点

🟢 全部通过 `sqlcmd` 直接查询 `AIS20260302144343` 确认。

### 5.1 核心存储：独立表 T_BF_WRITEBACKRULE

反写规则**不存在**于源/目标单据的 `FKERNELXML` 中，而是存放在**独立的元数据表** `T_BF_WRITEBACKRULE`。

| 列名 | 类型 | 说明 |
|------|------|------|
| `FID` | `varchar(36)` | 规则主键（GUID 或自定义字符串如 `"ER_PayBill2Rent_FPayAmt"`） |
| `FMODELTYPEID` | `int` | 固定 `780`（WriteBackRule 对象模型类型 ID） |
| `FKERNELXML` | `xml` | 完整的 `<WriteBackRuleMetadata>` XML（见下） |
| `FSOURCEFORMID` | `varchar(36)` | 源单据 FormId（冗余列，XML 内也有） |
| `FTARGETFORMID` | `varchar(36)` | 目标单据 FormId（冗余列，XML 内也有） |
| `FAUTOFITFREEFLOW` | `char(1)` | 自动适配自由流程（`'1'`/`'0'`） |
| `FAUTOFITALLFLOWS` | `char(1)` | 自动适配所有流程（`'1'`/`'0'`） |
| `FSUPPLIERNAME` | `varchar(100)` | 开发商标识（`'Kingdee'` / `'CMK'` / `'ERX'` / `NULL` 等） |
| `FMODIFIERID` | `int` | 最后修改人 ID |
| `FMODIFYDATE` | `datetime` | 最后修改时间 |
| `FVERSION` | `varchar(20)` | 版本时间戳（`DateTime.Ticks` 字符串） |
| `FSYSSTATUS` | `char(1)` | `'0'` 正常 / `'1'` 系统禁用 |
| `FMAINVERSION` | `varchar(100)` | 主版本（同 `FVERSION`） |
| `FPACKAGEID` | `varchar(36)` | 包 ID |
| `FSUBSYSID` | `varchar(36)` | 子系统 ID |
| `FDEVTYPE` | `smallint` | 开发类型 |
| `FINHERITPATH` | `nvarchar(255)` | 继承路径 |
| `FBASEOBJECTID` | `varchar(36)` | 基础对象（多数为空） |

### 5.2 本地化表 T_BF_WRITEBACKRULE_L

| 列名 | 类型 | 说明 |
|------|------|------|
| `FID` | `varchar(36)` | 规则 FID（外键） |
| `FLOCALEID` | `int` | 语言 ID（2052 = zh-CN） |
| `FNAME` | `nvarchar(255)` | 规则名称 |
| `FDESCRIPTION` | `nvarchar(255)` | 规则描述 |
| `FKERNELXMLLANG` | `xml` | 多语言 XML 片段 |

### 5.3 用户自定义覆盖表 T_BF_WRITEBACKRULECUST

| 列名 | 类型 | 说明 |
|------|------|------|
| `FID` | `varchar(36)` | 主键 |
| `FENTRYID` | `varchar(36)` | 关联 ID |
| `FFORBIDSTATUS` | `char(1)` | `'A'` 启用 / `'B'` 禁用 |
| `FREMARK` | `nvarchar(2000)` | 备注 |
| `FWBID` | `varchar(36)` | 关联的规则 FID |
| `FWBNETWORKCTRLTYPE` | `char(1)` | 网络控制类型 |

> 🟡 用途推测：允许用户在不改原始规则的情况下禁用/备注某条规则（类似 `T_META_OBJECTTYPE_E` 对原厂表单的扩展覆盖机制）。

### 5.4 FKERNELXML 结构

```xml
<WriteBackRuleMetadata>
  <Rule>
    <WriteBackRule>
      <!-- WriteBackRuleElement 所有属性序列化为子节点 -->
      <Id>...</Id>
      <TargetFormId>...</TargetFormId>
      <SourceFormId>...</SourceFormId>
      <Condition>...</Condition>
      <ConditionDesc>...</ConditionDesc>
      <OperationNumber>Save</OperationNumber>
      <WriteBackType>Lessen</WriteBackType>
      <!-- ... 其余属性 ... -->
    </WriteBackRule>
  </Rule>
  <!-- WriteBackRuleMetadata 自身属性 -->
  <Id>...</Id>
  <ModelTypeId>780</ModelTypeId>
  <Name>...</Name>
</WriteBackRuleMetadata>
```

序列化器：`WriteBackRuleDcxmlBinder`（绑定 `WriteBackRuleElement` 和 `WriteBackRuleMetadata` 两个类型），通过 `DcxmlSerializer` 读写。

### 5.5 T_META_WRITEBACKFIELD（字段级跟踪元数据）

此表存在于 DB 但在本次查询时为空（`0 rows`），推测是动态跟踪字段注册表，由运行时引擎管理，不需要手动写入。

---

## 6. 实现路径：k3cloud_add_write_back_rule / _list / _delete

### 6.1 总体评估

🟡 **实现可行性：中等复杂度**。

与 BOS 扩展字段相比（只需改 `FKERNELXML`），反写规则是**独立对象**，INSERT 到 `T_BF_WRITEBACKRULE` + `T_BF_WRITEBACKRULE_L`，无需修改源单据或目标单据的 `FKERNELXML`。

关键差异：反写规则属于 **`T_BF_*` 命名空间**，而非 `T_META_*`。这意味着需要扩展**写白名单**才能允许写入。

### 6.2 k3cloud_list_write_back_rules

```sql
-- 列出某源单据的所有反写规则
SELECT 
    w.FID,
    w.FSOURCEFORMID,
    w.FTARGETFORMID,
    w.FSUPPLIERNAME,
    w.FSYSSTATUS,
    l.FNAME,
    w.FKERNELXML
FROM T_BF_WRITEBACKRULE w
LEFT JOIN T_BF_WRITEBACKRULE_L l ON w.FID = l.FID AND l.FLOCALEID = 2052
WHERE w.FSOURCEFORMID = @sourceFormId
  AND w.FSYSSTATUS = '0'   -- 仅正常状态
ORDER BY l.FNAME
```

- **parallelSafe**: `true`（只读）
- 参数：`sourceFormId`（必填，如 `"SAL_SaleOrder"`），可选 `targetFormId` 进一步过滤
- 返回字段建议：`id`, `name`, `sourceFormId`, `targetFormId`, `operationNumber`, `writeBackType`, `sourceCommitFieldKey`, `formula`, `supplierName`, `sysStatus`

### 6.3 k3cloud_add_write_back_rule — 写入流程

🔴 以下为基于 decompile + DB 逆向的推断实现路径，**未经写入验证**。

#### Step 1：构造 WriteBackRuleElement

必填字段：
- `Id`：新 GUID
- `SourceFormId`：源单据 FormId
- `TargetFormId`：目标单据 FormId
- `OperationNumber`：触发操作（`"Save"` 或 `"Audit"`）
- `WriteBackType`：`Add` / `Lessen` / `Cover`
- `Formula`：目标单据行字段表达式（如 `"FBaseUnitQty"`）
- `SourceCommitFieldKey`：源单据累计字段 Key（如 `"FStockBaseStockOutQty"`）
- `Condition`：过滤条件（可为空字符串，但建议设置 `FSrcType == 'XXX'`）

可选字段（安全默认值）：
- `MaxDistributeFormula`：留空则不限分配量
- `ExcessCheckType`：`CanExcellAlways`（宽松）
- `EntityCloseFieldKey` / `BillCloseFieldKey`：留空则不驱动关闭状态

#### Step 2：序列化为 FKERNELXML

参考标准格式（见 4.1 节 XML 示例），自行拼接 XML 字符串。无需调用 DcxmlSerializer（.NET 内部对象），直接按 XML 格式手写即可。

#### Step 3：backup + INSERT

```sql
-- Backup（强制，见 CLAUDE.md 白名单规则）
-- 保存到 ~/.opendeploy/projects/<pid>/bos-backups/<ts>_add_wb_<id>.json

-- INSERT 主表
INSERT INTO T_BF_WRITEBACKRULE (
    FID, FMODELTYPEID, FKERNELXML,
    FSOURCEFORMID, FTARGETFORMID,
    FAUTOFITFREEFLOW, FAUTOFITALLFLOWS,
    FSUPPLIERNAME, FMODIFIERID, FMODIFYDATE,
    FVERSION, FSYSSTATUS, FMAINVERSION,
    FPACKAGEID, FSUBSYSID
) VALUES (
    @id, 780, @kernelXml,
    @sourceFormId, @targetFormId,
    '1', '1',
    NULL, 0, GETDATE(),
    CAST(DATEDIFF(s,'1970-01-01',GETDATE())*10000000+621355968000000000 AS varchar),
    '0', CAST(DATEDIFF(s,'1970-01-01',GETDATE())*10000000+621355968000000000 AS varchar),
    'K3Cloud_ERP', NULL
)

-- INSERT 本地化表
INSERT INTO T_BF_WRITEBACKRULE_L (FID, FLOCALEID, FNAME, FDESCRIPTION)
VALUES (@id, 2052, @name, @description)
```

> ⚠️ **注意**：`T_BF_WRITEBACKRULE` 不在现有 CLAUDE.md 写白名单（仅列出 `T_META_*` 8 张表）。**Plan 5.12.5 需要在 Plan 6 白名单扩展时同步添加 `T_BF_WRITEBACKRULE` 和 `T_BF_WRITEBACKRULE_L`**。

#### Step 4：缓存刷新

与 BOS 扩展对象一样，写入 DB 后需要用户在 BOS Designer 中刷新（F5 或重开页面）才能看到新规则生效。

### 6.4 k3cloud_delete_write_back_rule

```sql
-- Backup 先行（保存待删除行）

-- DELETE 本地化表
DELETE FROM T_BF_WRITEBACKRULE_L WHERE FID = @id

-- DELETE 主表  
DELETE FROM T_BF_WRITEBACKRULE WHERE FID = @id
  AND FSUPPLIERNAME IS NULL  -- 安全门：只允许删除产品自己创建的规则（NULL supplier）
  AND FSYSSTATUS = '0'
```

安全约束：
- 只允许删除 `FSUPPLIERNAME IS NULL` 的规则（排除 Kingdee 原厂规则）
- 删除前必须 backup

### 6.5 白名单扩展要求（Plan 6 gate）

当前 `src/main/erp/validator.ts` 写白名单仅含 8 张 `T_META_*` 表。新增反写规则工具需要在 Plan 6 将以下表加入**写白名单**：

```
T_BF_WRITEBACKRULE        — 写入新规则
T_BF_WRITEBACKRULE_L      — 写入本地化名称
```

删除同理（`DELETE` 白名单）。

### 6.6 工具设计建议

```typescript
// k3cloud_list_write_back_rules
{
  parallelSafe: true,
  params: { sourceFormId: string, targetFormId?: string }
}

// k3cloud_add_write_back_rule  
{
  parallelSafe: false,  // 写 DB
  params: {
    sourceFormId: string,        // 必填：被写入单据
    targetFormId: string,        // 必填：触发写回的单据
    operationNumber: string,     // 必填：'Save' | 'Audit' | 'UnAudit' | ...
    writeBackType: 'Add' | 'Lessen' | 'Cover',  // 必填
    formula: string,             // 必填：增量值表达式（来自目标单据行）
    sourceCommitFieldKey: string, // 必填：源单据累计字段 Key
    name: string,                // 必填：规则名称（zh-CN）
    condition?: string,          // 可选：触发条件表达式
    maxDistributeFormula?: string, // 可选：可分配上限
    excessCheckType?: 'StrictControl' | 'CanExcessOneTime' | 'CanExcellAlways',
    entityCloseFieldKey?: string, // 可选：行关闭字段
    billCloseFieldKey?: string,  // 可选：单据关闭字段
  }
}

// k3cloud_delete_write_back_rule
{
  parallelSafe: false,
  params: { ruleId: string }
}
```

---

## 实证级别汇总

| 章节 | 内容 | 级别 | 来源 |
|------|------|------|------|
| WriteBackRuleElement 属性树 | 完整属性列表 | 🟢 | decompile line 137959 |
| WriteBackType 枚举 | Add/Lessen/Cover | 🟢 | decompile line 134998 + 1238 条 DB 规则验证 |
| DistributeType 枚举 | TopDown/Weight | 🟢 | decompile line 135004 + DB `Weight` 实例 |
| ExcessCheckType 枚举 | 4 个值 | 🟢 | decompile line 135009 + DB 多实例 |
| OperationNumber 常量 | Save/Audit 等 | 🟢 | decompile line 211985 + DB 规则触发字段 |
| T_BF_WRITEBACKRULE 表结构 | 22 列完整列名 | 🟢 | DB `INFORMATION_SCHEMA.COLUMNS` |
| T_BF_WRITEBACKRULE_L 表结构 | 6 列 | 🟢 | DB `INFORMATION_SCHEMA.COLUMNS` |
| FKERNELXML 格式 | `<WriteBackRuleMetadata>` | 🟢 | DB 真实 XML 多条提取 |
| FID 可自定义字符串 | 如 `ER_PayBill2Rent_FPayAmt` | 🟢 | DB 实际 FID 值 |
| T_BF_WRITEBACKRULECUST | 禁用覆盖表 | 🟡 | DB 表结构已确认，语义推断 |
| INSERT 写入流程 | FVERSION 时间戳格式等 | 🟡 | 从现有 CMK 规则逆向，未写入验证 |
| 白名单扩展要求 | T_BF_* 不在现有白名单 | 🟢 | CLAUDE.md + DB 表名确认 |
