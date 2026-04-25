---
name: convert-rules-decompiled
title: BOS 单据转换规则 — 反编译 + DB 实证
description: T_META_CONVERTRULE 表结构、ConvertRuleElement 属性模型、10 个 ConvertPolicy 子类语义、字段映射模型、kingdee_list_convert_rules / _describe_convert_rule 实现路径。基于 Kingdee.BOS.Core.decompiled.cs + AIS20260302144343 实证。
fetched: 2026-04-25
---

# BOS 单据转换规则的完整工程模型

> 反编译来源: `Kingdee.BOS.Core.decompiled.cs` (305 584 行)  
> DB 实证: `AIS20260302144343` (SQL Server localhost:1433)  
> 本文只描述**读取**路径；创建/修改转换规则延至 v0.2。

---

## 1. 数据存储位置（DB 表）

🟢 **实证 — 2026-04-25, AIS20260302144343**

### 主表

| 表名 | 行数（本库） | 说明 |
|---|---|---|
| `T_META_CONVERTRULE` | 764 | 每条转换规则一行，含 FKERNELXML |
| `T_META_CONVERTRULE_L` | 多对一 | 多语言名称（FLOCALEID=2052 为简体中文） |
| `T_META_CONVERTLOOKUP` | 114 | 转换流程图画布索引；**不等于**转换规则全集 |

### T_META_CONVERTRULE 列

```
FID          varchar(36)   规则标识（非 GUID，业务语义字符串，如 "SaleOrder-OutStock"）
FMODELTYPEID int           固定 = 790  (const ModelTypeId_ConvertRule = 790, line 285642)
FSOURCEFORMID varchar(36)  源单据 FormId，如 "SAL_SaleOrder"
FTARGETFORMID varchar(36)  目标单据 FormId，如 "SAL_OUTSTOCK"
FSTATUS      char(1)       '1' = 启用，'0' = 禁用
FISDEFAULT   char(1)       '1' = 默认规则，'0' = 备用/特殊规则
FINVISIBLE   char(1)       '1' = 不在 UI 转换按钮中显示（隐式下推用）
FKERNELXML   xml           完整规则定义，根节点 <ConvertRuleMetaData>
FBASEOBJECTID varchar(36)  所属父对象 FID（通常为源单据对象 FID）
FDEVTYPE     smallint      开发类型
FSUPPLIERNAME varchar(100) 开发商标识（可为 NULL）
FMAINVERSION varchar(100)  版本戳（毫秒时间戳字符串，如 "634703641059182961"）
FINHERITPATH nvarchar(255) 继承路径
FPACKAGEID   varchar(36)   包 ID
```

### T_META_CONVERTRULE_L 列

```
FPKID       varchar(36)   PK
FID         varchar(36)   → T_META_CONVERTRULE.FID
FLOCALEID   int           2052 = 简体中文
FNAME       nvarchar(255) 规则显示名称，如 "销售订单->销售出库单"
FKERNELXMLLANG xml        多语言扩展 XML（通常为空）
```

### T_META_CONVERTLOOKUP 列

```
FFLOWID      varchar(36)  转换流程图 FID（T_META_OBJECTTYPE 里的旧 FlowMetaData 行，已 Obsolete）
FRULEID      varchar(36)  对应转换规则的内部 GUID（≠ T_META_CONVERTRULE.FID，是 XML 内 <Id> 的值）
FSOURCEFORMID varchar(36) 源单据 FormId
FTARGETFORMID varchar(36) 目标单据 FormId
FSTATUS      char(1)      '1' = 启用
FISDEFAULT   char(1)      '1' = 默认（97/114 为默认，17 为非默认）
```

**CONVERTLOOKUP 的用途**：转换流程设计器的"画布"索引，只记录在流程图里**显式建图**的转换路径。`SAL_SaleOrder` 有 35 条规则但 CONVERTLOOKUP 只有 6 条，其余规则（如财务联动的隐式规则）不在流程图里。  
**对 agent 意义**：`kingdee_list_convert_rules` 应查 `T_META_CONVERTRULE`，而不是 `T_META_CONVERTLOOKUP`。

### 关键计数（本库实证）

```
总规则数：764 条
SAL_SaleOrder 规则：35 条（含 FSTATUS=0 的禁用规则）
SAL_SaleOrder 活跃+默认：16 条（FSTATUS='1' AND FISDEFAULT='1'）
规则最多的对象：PRD_PPBOM（37 条）、SAL_SaleOrder（32 条活跃）
```

---

## 2. ConvertRuleElement 属性模型

🟢 **实证 — decompiled.cs line 209361，对应 XML 形态 DB 实证**

`ConvertRuleElement` 存在 `FKERNELXML` 内，根路径：`/ConvertRuleMetaData/Rule/ConvertRule`

| 属性 | XML 元素名 | 类型 | 默认值 | 语义 |
|---|---|---|---|---|
| `SourceFormId` | `<SourceFormId>` | string | — | 源单据 FormId |
| `TargetFormId` | `<TargetFormId>` | string | — | 目标单据 FormId |
| `Status` | `<Status>` | bool | false | 规则是否启用（true = 启用） |
| `IsDefault` | `<IsDefault>` | bool | false | 是否为默认规则 |
| `Invisible` | `<Invisible>` | bool | false | true = 下推按钮中不展示此规则 |
| `IsRandom` | `<IsRandom>` | bool | **true** | 是否允许随机顺序处理行（默认 true） |
| `FreePush` | `<FreePush>` | bool | false | 是否允许自由下推（不校验关联关系） |
| `CheckLinkSet` | `<CheckLinkSet>` | bool | **true** | 是否校验关联设置（默认 true） |
| `Formula` | `<Formula>` | string | null | 规则级公式（较少用） |
| `PushRunCondition` | `<PushRunCondition>` | string | null | 下推前置条件（IronPython 布尔表达式，如 `FBUSINESSTYPE = 'FY'`） |
| `PushRunConditionExt` | `<PushRunConditionExt>` | string | null | 前置条件扩展 |
| `ConvertType` | `<ConvertType>` | int | **0** | 0 = 标准下推；1 = 反向勾稽（如付款单→收款单互转，见 CN_BILLPAYABLE 实证） |
| `EnabledTakeFailTip` | — | bool | false | 取数失败时是否弹提示 |
| `ExtCtrl` | `<ExtCtrl>` | string | null | 扩展控制 JSON（`[SimpleProperty(ExtendUnDeser = true)]`） |
| `Policies` | `<Policies>` | Collection | — | 下挂所有策略子元素 |

**XML 根结构实证**（`FID='SaleOrder-OutStock'`）：

```xml
<ConvertRuleMetaData>
  <Rule>
    <ConvertRule ElementType="6000" ElementStyle="0">
      <SourceFormId>SAL_SaleOrder</SourceFormId>
      <TargetFormId>SAL_OUTSTOCK</TargetFormId>
      <Status>True</Status>
      <IsDefault>True</IsDefault>
      <Policies>
        <!-- 10 个 Policy 子元素 -->
      </Policies>
    </ConvertRule>
  </Rule>
</ConvertRuleMetaData>
```

---

## 3. 10 个 ConvertPolicy 子类语义对照

🟢 **全部实证——`SaleOrder-OutStock` 的 XML 里 10 个 PolicyType 全部出现（DB query 确认）**

执行顺序由 `OrderNo` 属性决定（越小越先执行）：

| 类名 | XML 元素名 | OrderNo | ElementType | 语义 |
|---|---|---|---|---|
| `LinkEntityPolicyElement` | `<LinkEntityPolicy>` | 1 | 7008 | 关联实体字段映射（勾稽关系控制） |
| `BillTypeMapPolicyElement` | `<BillTypeMapPolicy>` | 2 | 7009 | 单据类型映射（哪种源单类型→哪种目标单类型） |
| `DefaultConvertPolicyElement` | `<DefaultConvertPolicy>` | 3 | 7002 | **主字段映射**（源条目→目标条目，含 FieldMaps 集合） |
| `ConvertGroupByPolicyElement` | `<ConvertGroupByPolicy>` | 4 | 7005 | 分组合并策略（按字段合并多张源单→一张目标单） |
| `ConvertFilterPolicyElement` | `<ConvertFilterPolicy>` | 5 | 7004 | 过滤/前置校验（含提示语 + 自定义过滤条件 + 跨组织基础资料过滤） |
| `ConvertPlugInPolicyElement` | `<ConvertPlugInPolicy>` | 6 | 7003 | 转换插件（DLL 或 Python，在转换时机点注入自定义逻辑） |
| `ConvertFormBusinessPolicyElement` | `<ConvertFormBusinessPolicy>` | 7 | 7006 | 表单业务规则（转换后对目标单据执行 FormBusinessService 动作） |
| `ConvertAttachmentPolicyElement` | `<ConvertAttachmentPolicy>` | 8 | 60003 | 附件传递（是否将源单附件带到目标单，可按表头/行/子行控制） |
| `ConvertTailDiffPolicyElement` | `<ConvertTailDiffPolicy>` | 10 | 60006 | 尾差处理（数量拆分时金额尾差分摊到最后一行） |
| `ConvertOrderByPolicyElement` | `<ConvertOrderByPolicy>` | 5 | 7010 | 选单排序（下推弹框里源单列表的排序字段） |

### 关键 Policy 详解

**DefaultConvertPolicyElement**（OrderNo=3，最核心）
- `SourceEntryKey`：源单据哪个分录参与映射，如 `FSaleOrderEntry`
- `SourceSubEntryKey`：源子分录，如 `FTaxDetailSubEntity`
- `TargetEntryKey`：目标分录，如 `FEntity`
- `TargetSubEntryKey`：目标子分录
- `FieldMaps`：字段映射集合（见第 4 节）

**ConvertGroupByPolicyElement**（OrderNo=4）
- `GroupByMode` 枚举：`None` / `OneToOne`（一对一不合并）/ `GroupByField`（按字段合并）/ `GroupByFormula`（按公式合并）
- `GroupByField`：逗号分隔字段列表，如 `FCustId,FSettleModeId,FSettleOrgIds,FSettleCurrId,FStockOrgId`
- `GroupByField2` / `GroupByField3`：附加分组字段
- `GroupByFormula`：分组公式表达式

**ConvertFilterPolicyElement**（OrderNo=5）
- `AlertMessage`：下推前提示语（LocaleValue 多语言）
- `JsonSetting`：过滤 JSON 配置
- `CustFilter`：自定义过滤表达式（IronPython）
- `CustFilterDesc`：过滤表达式描述
- `TargetOrgBDFilterList`：目标组织基础资料过滤列表

**BillTypeMapPolicyElement**（OrderNo=2）
- `BillTypeMaps`：Collection\<BillTypeMapElement\>
- 每个 `BillTypeMapElement` 含：
  - `SourceBillTypeId`：源单类型 ID（`"(All)"` = 匹配任意，`"(None)"` = 禁止）
  - `TargetBillTypeId`：目标单类型 ID（GUID 格式）

**ConvertPlugInPolicyElement**（OrderNo=6）
- `Plugs`：List\<PlugIn\>
- 每个 PlugIn 含 `ClassName`（DLL 全限定类名）、`OrderId`（执行顺序）
- 实证：`SaleOrder-OutStock` 挂了多个 `Kingdee.K3.SCM.App.Sal.ServicePlugIn.*` DLL 类

**LinkEntityPolicyElement**（OrderNo=1）
- `ControlEntityKey`：被控实体 Key，如 `FEntity`（控制勾稽关系的分录）
- `FieldMaps`：关联字段映射集合（同 DefaultConvert 的 FieldMapElement 格式）

**ConvertAttachmentPolicyElement**（OrderNo=8）
- `EnabledHeader`：传递表头附件
- `EnabledEntry`：传递行附件
- `EnabledSubEntry`：传递子行附件
- `Deduplication`：附件去重

**ConvertTailDiffPolicyElement**（OrderNo=10）
- `IsEnabled`：是否启用尾差处理
- `MarkFieldKey`：尾差标记字段
- `RecordFieldKey`：尾差记录字段
- `FieldMaps`：TailFieldMapElement 集合（每条含源/目标的金额字段 + 因子字段）
- `BaseFieldMaps`：TailBaseFactorFieldMapElement 集合（基础因子类型：UnitPrice/ExchangeRate/TaxRate/DisCountRate/CustomFactor）

---

## 4. 字段映射模型（FieldMap / BillTypeMap）

🟢 **实证 — decompiled.cs line 209882 + SaleOrder-OutStock XML**

### FieldMapElement 属性

`FieldMapElement` 用于 `DefaultConvertPolicyElement.FieldMaps` 和 `LinkEntityPolicyElement.FieldMaps`：

| 属性 | XML 元素名 | 类型 | 默认值 | 语义 |
|---|---|---|---|---|
| `TargetFieldKey` | `<TargetFieldKey>` | string | — | 目标字段 Key（必填） |
| `SourceFieldKey` | `<SourceFieldKey>` | string | null | 源字段 Key（留空=不映射，目标字段留默认） |
| `ValueConvertMode` | `<ValueConvertMode>` | enum | **Auto** | 映射模式（见下表） |
| `Formula` | `<Formula>` | string | null | 自定义公式（IronPython 表达式） |
| `FormulaDesc` | `<FormulaDesc>` | string | null | 公式中文描述（UI 显示用） |
| `IsFilter` | `<IsFilter>` | bool | false | 是否参与关联过滤（决定"查找源单"的 where 条件） |
| `OnlyAgain` | — | bool | false | 是否只在再次下推时执行 |
| `IsExtendUnEdit` | — | bool | false | 扩展字段是否不可编辑 |
| `BreakForNoDistribute` | — | bool | false | 无分配时是否中断 |
| `OnlyTakeApprovedData` | — | bool | **true** | 只取已审核数据（默认 true） |
| `OnlyTakeUsedData` | — | bool | false | 只取已使用数据 |

### ValueConvertMode 枚举

```
Auto       - 自动（默认，按源字段类型决定）
Sum        - 求和
Average    - 平均
Count      - 计数
Max        - 最大值
Min        - 最小值
Formula    - 公式（需填 Formula 字段）
Join       - 连接（字符串拼接）
SumFormula - 先求和再用公式
```

**公式实证**（`FBussinessType` 字段映射）：

```xml
<FieldMap ElementType="60002" ElementStyle="0">
  <TargetFieldKey>FBussinessType</TargetFieldKey>
  <ValueConvertMode>Formula</ValueConvertMode>
  <Formula>"NORMAL" if FBusinessType = 'RETURNSO' else FBusinessType</Formula>
  <FormulaDesc>"NORMAL" if 业务类型 = 'RETURNSO' else 业务类型</FormulaDesc>
</FieldMap>
```

### BillTypeMapElement

```
SourceBillTypeId - "(All)" 匹配所有源单类型; "(None)" 禁止该类型下推; 具体 GUID = 特定单据类型
TargetBillTypeId - 同上逻辑，用于目标单据类型映射
```

---

## 5. kingdee_list_convert_rules / kingdee_describe_convert_rule 实现路径

### 5.1 kingdee_list_convert_rules(sourceFormId)

**目的**：列出某源单据的所有（或活跃）转换规则，供 agent 了解"这张单能下推到哪些目标单"。

**SQL**（🟢 实证可执行）：

```sql
SELECT
  cr.FID               AS rule_id,
  cr.FSOURCEFORMID     AS source_form,
  cr.FTARGETFORMID     AS target_form,
  cr.FSTATUS           AS status,       -- '1' = active
  cr.FISDEFAULT        AS is_default,   -- '1' = default rule
  cr.FINVISIBLE        AS invisible,    -- '1' = hidden from push button
  l.FNAME              AS display_name  -- zh-CN name
FROM T_META_CONVERTRULE cr
LEFT JOIN T_META_CONVERTRULE_L l
  ON cr.FID = l.FID AND l.FLOCALEID = 2052
WHERE cr.FSOURCEFORMID = @sourceFormId
  AND cr.FSTATUS = '1'          -- active only (可选参数控制是否过滤)
ORDER BY cr.FISDEFAULT DESC, l.FNAME
```

**参数**：
- `sourceFormId`：required，如 `SAL_SaleOrder`
- `activeOnly`：optional，默认 true（过滤 `FSTATUS='1'`）

**返回结构（建议 JSON 数组）**：

```json
[
  {
    "ruleId":       "SaleOrder-OutStock",
    "sourceFormId": "SAL_SaleOrder",
    "targetFormId": "SAL_OUTSTOCK",
    "displayName":  "销售订单->销售出库单",
    "isDefault":    true,
    "isActive":     true,
    "isInvisible":  false
  }
]
```

**parallelSafe**：`true`（只读查询）

### 5.2 kingdee_describe_convert_rule(ruleId)

**目的**：读取一条转换规则的完整定义，包括主字段映射、分组策略、过滤条件等，供 agent 理解规则内容。

**SQL**（🟢 实证可执行）：

```sql
SELECT
  cr.FID, cr.FSOURCEFORMID, cr.FTARGETFORMID,
  cr.FSTATUS, cr.FISDEFAULT, cr.FINVISIBLE,
  l.FNAME,
  CONVERT(NVARCHAR(MAX), cr.FKERNELXML) AS kernel_xml
FROM T_META_CONVERTRULE cr
LEFT JOIN T_META_CONVERTRULE_L l
  ON cr.FID = l.FID AND l.FLOCALEID = 2052
WHERE cr.FID = @ruleId
```

**XML 解析策略**（用 TypeScript 或 XML parser）：

```
/ConvertRuleMetaData/Rule/ConvertRule
  ├── <SourceFormId>, <TargetFormId>, <Status>, <IsDefault>, <Invisible>
  ├── <ConvertType>     -- 0=标准, 1=反向勾稽
  ├── <PushRunCondition> -- 前置条件表达式
  ├── <Policies>
  │   ├── <DefaultConvertPolicy ElementType="7002">
  │   │   ├── <SourceEntryKey>, <TargetEntryKey>
  │   │   └── <FieldMaps>
  │   │       └── <FieldMap> × N
  │   │           ├── <TargetFieldKey>, <SourceFieldKey>
  │   │           ├── <ValueConvertMode>  -- 缺省 = Auto
  │   │           ├── <Formula>           -- ValueConvertMode=Formula 时
  │   │           └── <IsFilter>          -- 关联过滤字段
  │   ├── <ConvertGroupByPolicy ElementType="7005">
  │   │   ├── <GroupByMode>   -- None/OneToOne/GroupByField/GroupByFormula
  │   │   └── <GroupByField>  -- 逗号分隔字段列表
  │   ├── <ConvertFilterPolicy ElementType="7004">
  │   │   ├── <AlertMessage>  -- 下推前提示
  │   │   └── <CustFilter>    -- 自定义过滤表达式
  │   ├── <ConvertPlugInPolicy ElementType="7003">
  │   │   └── <Plugs> → <PlugIn> × N → <ClassName>
  │   ├── <BillTypeMapPolicy ElementType="7009">
  │   │   └── <BillTypeMaps> → <BillTypeMap> × N
  │   │       ├── <SourceBillTypeId>  -- GUID 或 "(All)"/"(None)"
  │   │       └── <TargetBillTypeId>
  │   ├── <LinkEntityPolicy ElementType="7008">
  │   │   ├── <ControlEntityKey>
  │   │   └── <FieldMaps> → <FieldMap> × N
  │   ├── <ConvertAttachmentPolicy ElementType="60003">
  │   │   ├── <EnabledHeader>, <EnabledEntry>, <EnabledSubEntry>
  │   ├── <ConvertTailDiffPolicy ElementType="60006">
  │   │   ├── <IsEnabled>, <MarkFieldKey>
  │   │   └── <FieldMaps> → <TailFieldMap> × N
  │   └── <ConvertOrderByPolicy ElementType="7010">
  │       └── <OrderByField>
```

**返回结构（建议）**：

```json
{
  "ruleId":      "SaleOrder-OutStock",
  "displayName": "销售订单->销售出库单",
  "sourceFormId":"SAL_SaleOrder",
  "targetFormId":"SAL_OUTSTOCK",
  "isDefault":   true,
  "convertType": 0,
  "pushRunCondition": null,
  "defaultPolicy": {
    "sourceEntryKey": "FSaleOrderEntry",
    "targetEntryKey": "FEntity",
    "fieldMaps": [
      {
        "targetField": "FSaleOrgId",
        "sourceField": "FSaleOrgId",
        "convertMode": "Auto",
        "isFilter": false
      },
      {
        "targetField": "FBussinessType",
        "sourceField": null,
        "convertMode": "Formula",
        "formula": "\"NORMAL\" if FBusinessType = 'RETURNSO' else FBusinessType"
      }
    ]
  },
  "groupByPolicy": {
    "mode": "GroupByField",
    "fields": ["FCustId","FSettleModeId","FSettleOrgIds","FSettleCurrId","FStockOrgId"]
  },
  "filterPolicy": {
    "alertMessage": "...",
    "custFilter": null
  },
  "plugins": [
    "Kingdee.K3.SCM.App.Sal.ServicePlugIn.OutStock.StraightOrderToOutStockCheckManmul, ..."
  ]
}
```

**parallelSafe**：`true`（只读查询）

### 5.3 实现注意事项

1. **FKERNELXML 体积**：`SaleOrder-OutStock` 的 XML 达 100 788 字节（约 100 KB）。全量返回 XML 给 agent 会超 token。  
   **方案**：解析后只返回结构化摘要；agent 需要看具体字段映射时再做二次 XML 查询（按 XPath 过滤）。

2. **FID 格式非 GUID**：`T_META_CONVERTRULE.FID` 是业务命名字符串（如 `SaleOrder-OutStock`），而 `T_META_CONVERTLOOKUP.FRULEID` 是内部 GUID（对应 XML 里 `<ConvertRule>` 的 `<Id>` 子元素）。  
   `kingdee_list_convert_rules` 用 `FID` 作为 ruleId 参数即可；CONVERTLOOKUP 不需要查。

3. **SQL 白名单**：两个查询均只涉及 `T_META_CONVERTRULE` + `T_META_CONVERTRULE_L`，均属元数据读白名单，无需特殊权限豁免。

4. **`ConvertType=1` 的规则**：反向勾稽规则，源/目标单可能是同一张单（如 `CN_BILLPAYABLE` 互转）。列表时可加注区分。

5. **不需要查 T_META_CONVERTLOOKUP**：该表只有 114 条（SAL_SaleOrder 仅 6 条），是画布子集，不是规则全集；直接查 `T_META_CONVERTRULE` 才能获取全量 764 条规则。

---

## 实证级别

| 内容 | 级别 | 来源 |
|---|---|---|
| 3 张表存在且列结构 | 🟢 | DB `INFORMATION_SCHEMA.COLUMNS` + `sys.tables`, AIS20260302144343, 2026-04-25 |
| 764 条规则总数 | 🟢 | `SELECT COUNT(*) FROM T_META_CONVERTRULE`, 2026-04-25 |
| SAL_SaleOrder 35 条规则 | 🟢 | 直接 SELECT, 2026-04-25 |
| SaleOrder-OutStock XML 结构 | 🟢 | `SELECT FKERNELXML WHERE FID='SaleOrder-OutStock'`, 2026-04-25 |
| 10 个 PolicyType 全部出现 | 🟢 | XML XQuery nodes() 查询确认, 2026-04-25 |
| ConvertRuleElement 所有属性 | 🟢 | decompiled.cs line 209361–209600, 2026-04-25 |
| 10 个 ConvertPolicy 子类定义 | 🟢 | decompiled.cs 逐类读取，line 26853–27100, 84193, 133463, 146202–147450, 209806, 2026-04-25 |
| FieldMapElement 属性 | 🟢 | decompiled.cs line 209882，+ XML 实证, 2026-04-25 |
| ValueConvertMode 枚举 | 🟢 | decompiled.cs + XML Formula 实证, 2026-04-25 |
| GroupByMode 枚举 | 🟢 | decompiled.cs + XML GroupByField 实证, 2026-04-25 |
| CONVERTLOOKUP 为画布子集（非全集） | 🟢 | SAL_SaleOrder 35条 vs 6条对比, 2026-04-25 |
| FKERNELXML 体积约 100KB（SaleOrder-OutStock） | 🟢 | `LEN()` 查询 = 100788 bytes, 2026-04-25 |
| kingdee_describe_convert_rule XML 解析方案 | 🟡 | 基于 XML 结构推断，未实现 TypeScript 解析器验证 |
