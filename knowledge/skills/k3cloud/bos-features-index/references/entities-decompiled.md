---
name: entities-decompiled
title: BOS Entity 模型 — 反编译 + DB 实证
description: BOS 表单的 HeadEntity/EntryEntity/SubEntryEntity 完整工程模型：类属性（反编译）、FKERNELXML 序列化形态（DB 实证）、SQL 表蓝图、T_META_OBJECTTYPEREF/TRACKERBILLTABLE row pattern。Plan 5.12.2 的实施依据。
---

# BOS Entity 模型（1:N 子表）完整工程模型

> 数据来源：
> - 反编译：`Kingdee.BOS.Core.dll` → `/tmp/bos-decompile/out-core/Kingdee.BOS.Core.decompiled.cs`
> - DB 实证：`AIS20260302144343`，查询时间 2026-04-25
> - 对照：SAL_SaleOrder（FKERNELXML 1,027,570 字节）

---

## 1. 类层级 + 完整属性（反编译）

### 1.1 类继承树

```
Element
└── Entity                       (line 54067)  — 所有 entity 基类
    ├── HeadEntity               (line 255549)  ElementType=34, Key 默认 "FBillHead"
    └── EntryEntity              (line 54373)   ElementType=35
        ├── SubEntryEntity       (line 54661)   1:N 子单据体（挂在某 EntryEntity 下）
        │   ├── TreeSubEntryEntity               ElementType=88
        │   ├── SNSubEntryEntity                 ElementType=60531（序列号子单据体）
        │   └── TaxDetailSubEntryEntity          ElementType=60528（税务明细）
        ├── SingleRowEntity      (line 227465)  单行实体（属性面板风格，无行序）
        └── TreeEntryEntity      (line 227888)  树形单据体 ElementType=48
```

🟢 反编译确认，行号引用自 `Kingdee.BOS.Core.decompiled.cs`。

---

### 1.2 Entity 基类（line 54067）—— 共享属性

| 属性 | 注解 | 类型 | 默认值 | 说明 |
|------|------|------|--------|------|
| `SchemaType` | `[SimpleProperty]` `[DefaultValue(0)]` | int | 0 | — |
| `EntryName` | `[SimpleProperty]` | string | — | 表对象名，对应 XML `<EntryName>` |
| `EntryPkFieldName` | `[SimpleProperty]` | string | "" | 主键字段名，如 `FEntryID`、`FDetailID` |
| `Seq` | `[SimpleProperty]` | int | — | 单据体在表单中的顺序号 |
| `TableName` | `[SimpleProperty]` | string | — | DB 物理表名，如 `T_SAL_ORDERENTRY` |
| `SeqFieldKey` | `[SimpleProperty]` | string | — | 行序字段 Key，如 `FSeq` |
| `SrcEntityDisaFieldKey` | `[SimpleProperty]` | string | — | — |
| `GroupColumnInfo` | `[ComplexProperty]` | GroupColumnInfo | new() | 分组列信息 |
| `EntityServiceRules` | `[CollectionProperty]` | List\<EntityServiceRule\> | new() | 联动规则集合 |
| `DefaultRows` | `[SimpleProperty]` `[DefaultValue(1)]` | int | 1 | 默认行数 |
| `MustInput` | `[SimpleProperty]` | int | — | 是否必填整个单据体 |
| `EntityType` | `[SimpleProperty]` virtual | int | — | 0=Head 1=Entry 2=Link |
| `SplitTables` | `[CollectionProperty]` | List\<SplitTable\> | new() | 分表 |
| `ListDefaultShow` | `[SimpleProperty]` `[DefaultValue(0)]` | int | 0 | — |
| `Fields` | `[JsonIgnore]` | List\<Field\> | — | 字段集合，运行时用，**不序列化入 XML** |

🟢 反编译 line 54067-54372。

---

### 1.3 EntryEntity（line 54373）—— 明细单据体

在 Entity 基础上新增：

| 属性 | 注解 | 类型 | 默认值 | 说明 |
|------|------|------|--------|------|
| `ElementType` | `[DefaultValue(35)]` `[SimpleProperty]` | int | 35 | 节点类型常量 |
| `EntityType` override | `[SimpleProperty]` `[DefaultValue(1)]` | int | 1 | ENTRY_TYPE=1 |
| `KeyField` | `[SimpleProperty]` | string | — | 关键字段（如 FMaterialId），对应 XML `<KeyField>` |
| `IsKeyEntry` | `[SimpleProperty]` `[DefaultValue(0)]` | int | 0 | 是否为 Key 单据体 |
| `ForbidCopy` | `[SimpleProperty]` `[DefaultValue(false)]` | bool | false | 禁止复制 |
| `AllowCopy` | `[SimpleProperty]` `[DefaultValue(true)]` | bool | true | 允许复制行 |
| `IsFilterDisplay` | `[SimpleProperty]` `[DefaultValue(1)]` | int | 1 | 是否过滤显示 |
| `ShowFilterRow` | `[SimpleProperty]` `[DefaultValue(0)]` | int | 0 | 显示过滤行 |
| `IsFilterPanelUnVsibile` | `[SimpleProperty]` | bool | — | 过滤面板不可见 |
| `ForceSort` | `[SimpleProperty]` `[DefaultValue(0)]` | int | 0 | 强制排序 |
| `ChildEntitys` | `[JsonIgnore]` | List\<SubEntryEntity\> | — | 子单据体列表，运行时用，**不序列化** |

> 注意：`ChildEntitys` 上有 `[JsonIgnore]`，子单据体在 XML 中是**独立节点**（`<SubEntryEntity>`），通过 `ParentEntityKey` 引用父体，而非嵌套在 `<EntryEntity>` 内。

🟢 反编译 line 54373-54660。

---

### 1.4 SubEntryEntity（line 54661）—— 子单据体

在 EntryEntity 基础上新增：

| 属性 | 注解 | 类型 | 默认值 | 说明 |
|------|------|------|--------|------|
| `ParentEntityKey` | `[SimpleProperty]` | string | — | 父 EntryEntity 的 Key，如 `FSaleOrderEntry` |
| `ParentEntity` | `[NonSerialized]` | EntryEntity | — | 运行时引用，不序列化 |

继承 EntryEntity 所有属性（KeyField、AllowCopy、EntityType 等）。

🟢 反编译 line 54661-55460（class body 含 TreeSubEntryEntity, SNSubEntryEntity, TaxDetailSubEntryEntity）。

---

### 1.5 HeadEntity（line 255549）

| 属性 | 注解 | 类型 | 默认值 |
|------|------|------|--------|
| `ElementType` | `[DefaultValue(34)]` `[SimpleProperty]` | int | 34 |
| `Key` override | `[DefaultValue("FBillHead")]` `[SimpleProperty]` | string | "FBillHead" |

特殊：`GetDataEntityTypeAttribute()` 追加 `SingleRowEntityAttribute`，标记为 ORM 单行实体。无 TableName（HeadEntity 数据存在 head 表中，如 T_SAL_ORDER，通过 Form 级的配置关联，不在 HeadEntity 节点本身设）。

🟢 反编译 line 255549-255605。

---

### 1.6 TreeEntryEntity（line 227888）—— 树形单据体

在 EntryEntity 基础上新增：

| 属性 | 注解 | 类型 | 说明 |
|------|------|------|------|
| `KeyFieldName` | `[SimpleProperty]` | string | 节点 key 字段（不同于 EntryPkFieldName） |
| `ParentFieldName` | `[SimpleProperty]` | string | 父节点 FK 字段 |
| `TreeEntityMaxRows` | `[SimpleProperty]` | int | 最大行数 |
| `RowTypeFieldName` | `[SimpleProperty]` | string | 行类型字段 |
| `ImageFieldName` | `[SimpleProperty]` | string | 图标字段 |
| `SourceFieldName` | `[SimpleProperty]` | string | 来源字段 |

🟢 反编译 line 227888-228058。

---

### 1.7 常量

```csharp
// Entity class (line 54068-54074)
public const int HEAD_TYPE   = 0;  // HeadEntity 的 EntityType 值
public const int ENTRY_TYPE  = 1;  // EntryEntity 的 EntityType 值
public const int LINK_TYPE   = 2;  // 关联单据体（如 SubEntryEntity EntityType）
public const string ALIAS_PREFIX = "t";  // SQL 表别名前缀
```

🟢 反编译 line 54068-54074。

---

## 2. FKERNELXML 序列化形态（DB 实证）

### 2.1 整体文档结构

```xml
<FormMetadata>
  <BusinessInfo>
    <BusinessInfo>
      <Elements>
        <Form ...>                         <!-- Form 节点：表单基本信息 + 插件 -->
          <Id>SAL_SaleOrder</Id>
          <FormPlugins>...</FormPlugins>
          <FormIdFieldName>FOBJECTTYPEID</FormIdFieldName>
          <PkFieldType>INT</PkFieldType>
          ...
        </Form>
        <HeadEntity action="edit" oid="..." ElementType="34" ElementStyle="0">
          <!-- 无 TableName/EntryPkFieldName（HeadEntity 不单独有这些） -->
          <EntityServiceRules>...</EntityServiceRules>
        </HeadEntity>
        <EntryEntity ElementType="35" ElementStyle="0">
          <KeyField>FMaterialId</KeyField>
          <IsKeyEntry>1</IsKeyEntry>
          <EntryName>SaleOrderEntry</EntryName>
          <EntryPkFieldName>FEntryID</EntryPkFieldName>
          <Seq>2</Seq>
          <TableName>T_SAL_ORDERENTRY</TableName>
          <SeqFieldKey>FSeq</SeqFieldKey>
          <GroupColumnInfo>...</GroupColumnInfo>
          <EntityServiceRules>...</EntityServiceRules>
          <DefaultRows>1</DefaultRows>
          <Name>销售订单明细</Name>
          <Id>...</Id>
          <Key>FSaleOrderEntry</Key>
          <!-- Fields 不序列化 — 字段各自是独立 <TextField>/<ComboField> 等子节点 -->
        </EntryEntity>
        <SubEntryEntity ElementType="60502" ElementStyle="0">
          <ParentEntityKey>FSaleOrderEntry</ParentEntityKey>
          <ElementType>60502</ElementType>
          <EntryName>OrderEntryPlan</EntryName>
          <EntryPkFieldName>FDetailID</EntryPkFieldName>
          <Seq>3</Seq>
          <TableName>T_SAL_ORDERENTRYDELIPLAN</TableName>
          <SeqFieldKey>FSeq</SeqFieldKey>
          <GroupColumnInfo>...</GroupColumnInfo>
          <DefaultRows>0</DefaultRows>
          <Name>发货计划</Name>
          <Id>af008603-...</Id>
          <Key>FOrderEntryPlan</Key>
        </SubEntryEntity>
        <!-- Fields are sibling nodes under <Elements>, NOT nested in Entity -->
        <TextField ElementType="1" ElementStyle="0">
          <ConditionType>0</ConditionType>
          <PropertyName>FNAME</PropertyName>
          <FieldName>FNAME</FieldName>
          <Name>...</Name>
          <Id>...</Id>
          <Key>FName</Key>
        </TextField>
        ...
      </Elements>
    </BusinessInfo>
  </BusinessInfo>
  <LayoutInfos>...</LayoutInfos>
</FormMetadata>
```

🟢 DB 实证：SAL_SaleOrder FKERNELXML（1,027,570 chars），查询 2026-04-25。

---

### 2.2 SAL_SaleOrder 的 Entity 清单（DB 实证）

| 节点类型 | Key | EntryName | TableName | EntryPkFieldName | Seq | KeyField |
|---------|-----|-----------|-----------|-----------------|-----|---------|
| HeadEntity | FBillHead | — | — | — | — | — |
| EntryEntity | FSaleOrderClause | SaleOrderClause | T_SAL_ORDERCLAUSE | FEntryID | 1 | — |
| **EntryEntity** | **FSaleOrderEntry** | **SaleOrderEntry** | **T_SAL_ORDERENTRY** | **FEntryID** | **2** | **FMaterialId** |
| SubEntryEntity | FOrderEntryPlan | OrderEntryPlan | T_SAL_ORDERENTRYDELIPLAN | FDetailID | 3 | — |
| EntryEntity | FSaleOrderPlan | SaleOrderPlan | T_SAL_ORDERPLAN | FEntryID | 6 | — |
| SubEntryEntity | FSaleOrderPlanEntry | SAL_ORDERPLANENTRY | T_SAL_ORDERPLANENTRY | FDETAILID | 7 | — |
| EntryEntity | FSalOrderTrace | SalOrderTrace | T_SAL_ORDERTRACE | FEntryID | 8 | FLogComId |
| SubEntryEntity | FSalOrderTraceDetail | SalOrderTraceDetail | T_SAL_ORDERTRACEDETAIL | FDetailID | 9 | — |
| EntryEntity | FRecMentEntry | RecMentEntry | T_V_FIN_SALORDERRECENTRY | FEntryID | 11 | — |

🟢 DB 实证：`pnpm dlx tsx scripts/query-subentry.ts` 2026-04-25。

---

### 2.3 扩展 FKERNELXML 的 Entity 编辑形态

扩展不新建 entity，只通过 `action="edit" oid="<parentObjectId>"` 引用父对象的已有 entity 节点并追加内容：

```xml
<!-- 扩展 a4ad49d2 FKERNELXML（3154 chars）— 实证 -->
<FormMetadata>
  <BusinessInfo><BusinessInfo><Elements>
    <Form action="edit" oid="BOS_BillModel" ...>
      <Id>a4ad49d2-61c2-4000-9650-20e27c701675</Id>
      <FormPlugins>
        <PlugIn ElementType="0" ElementStyle="0">
          <ClassName>opendeploy_auto_test_1</ClassName>
          <PlugInType>1</PlugInType>
          <PyScript># auto-created by OpenDeploy...</PyScript>
        </PlugIn>
      </FormPlugins>
    </Form>
    <!-- 引用父对象 HeadEntity 节点来追加规则 -->
    <HeadEntity action="edit" oid="be8f270b-6aab-446a-9e11-7fcc39084958" ElementType="34" ElementStyle="0">
      <EntityServiceRules>...</EntityServiceRules>
    </HeadEntity>
    <!-- 字段直接作为 Elements 子节点，带 EntityKey 属于哪个 entity -->
    <TextField ElementType="1" ElementStyle="0">
      <PropertyName>F_DEMO</PropertyName>
      <FieldName>F_DEMO</FieldName>
      <Name>演示字段</Name>
      <Id>0249e98f767f40318820d85fce664b1b</Id>
      <Key>F_DEMO</Key>
    </TextField>
  </Elements></BusinessInfo></BusinessInfo>
  <LayoutInfos>
    <LayoutInfo action="edit" oid="<parentLayoutId>">
      <Appearances>
        <TextFieldAppearance ...>
          <Key>F_DEMO</Key>
          <Container>FTAB_P0</Container>  <!-- 放置到哪个 Tab 面板 -->
          <Left>10</Left><Top>180</Top>
          ...
        </TextFieldAppearance>
      </Appearances>
    </LayoutInfo>
  </LayoutInfos>
</FormMetadata>
```

> **关键**：扩展字段的 XML 节点**没有显式 EntityKey 属性**。BOS 推断字段归属 entity 的方式是：布局中 `<Container>` 指定面板 → 面板对应的 entity。HeadEntity 字段放在 head 面板（FTAB_P0），EntryEntity 字段放在对应的 Entry 面板或明细列。

🟢 DB 实证：extension a4ad49d2 完整 XML（3154 chars），2026-04-25。

---

### 2.4 EntryEntity 中字段的归属方式

字段节点本身**不携带 EntityKey**，而是在 `<LayoutInfos>` 里通过 `<Container>` 关联到对应面板：

- Head 字段 → `<Container>FTAB_P0</Container>`（或 `FTAB_Head` 等 head panel）
- Entry 字段 → `<Container>FSaleOrderEntry</Container>`（直接是 EntryEntity 的 Key）

`k3cloud_add_fields` 在写 TextField 节点时，`FieldName` 对应 EntryEntity 下表的实际列名（如 `T_SAL_ORDERENTRY.F_MY_TEXT`），`PropertyName` 同列名。

---

## 3. SQL CREATE TABLE 蓝图（DB 实证）

### 3.1 EntryEntity 系统列（以 T_SAL_ORDERENTRY 为例）

| 位置 | COLUMN_NAME | DATA_TYPE | DEFAULT | IS_NULLABLE | 说明 |
|------|-------------|-----------|---------|-------------|------|
| 1 | FENTRYID | int | `((0))` | NO | Entry PK（EntryEntity.EntryPkFieldName） |
| 2 | FID | int | `((0))` | NO | 单据头 FID，外键回 T_SAL_ORDER.FID |
| 3 | FSEQ | int | `((0))` | NO | 行序号（Entity.SeqFieldKey） |

其余列均为业务字段（FMATERIALID, FQTY, FUNITID 等）。

🟢 DB 实证：`INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='T_SAL_OrderEntry'`，2026-04-25。

---

### 3.2 SubEntryEntity 系统列（以 T_SAL_ORDERENTRYDELIPLAN 为例）

| 位置 | COLUMN_NAME | DATA_TYPE | DEFAULT | IS_NULLABLE | 说明 |
|------|-------------|-----------|---------|-------------|------|
| 1 | FDETAILID | int | `((0))` | NO | SubEntry PK（SubEntryEntity.EntryPkFieldName） |
| 2 | FENTRYID | int | `((0))` | NO | 父 EntryEntity PK（T_SAL_ORDERENTRY.FEntryID） |
| 3 | FSEQ | int | `((0))` | NO | 行序号 |

父子关联：SubEntry 用 `FENTRYID` 指向 `EntryEntity.EntryPkFieldName` 对应列（SAL_SaleOrder 中 = `FENTRYID`）。

🟢 DB 实证：`INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='T_SAL_ORDERENTRYDELIPLAN'`，2026-04-25。

---

### 3.3 新 EntryEntity 建表 SQL 蓝图

为扩展对象添加一个新 entry entity（假设新表 `T_EXT_MYENTRY`）：

```sql
-- 最简新 EntryEntity 表结构
CREATE TABLE T_EXT_MYENTRY (
    FENTRYID   int  NOT NULL DEFAULT(0),   -- PK，与 EntryPkFieldName 对应
    FID        int  NOT NULL DEFAULT(0),   -- FK 回 head 表（父对象的 head table FID）
    FSEQ       int  NOT NULL DEFAULT(0),   -- 行序，与 SeqFieldKey 对应
    -- ... 业务字段 ...
    CONSTRAINT PK_T_EXT_MYENTRY PRIMARY KEY (FENTRYID)
);
```

> **注意**：BOS v0.1 现有工具不支持创建新 entry entity（需新建物理表 + 注册 T_META_TRACKERBILLTABLE + 修改 FKERNELXML 添加 `<EntryEntity>` 节点）。`k3cloud_add_fields` 目前只支持向**已有** head entity 添加扩展字段（写入 TextField/ComboField 节点到已有扩展的 FKERNELXML）。

🟡 蓝图基于 T_SAL_ORDERENTRY 实证推断，**新建 entry entity 未经 UAT 验证**。

---

## 4. T_META_OBJECTTYPEREF Row Pattern（DB 实证）

### 4.1 表结构

```
T_META_OBJECTTYPEREF (4 列)
  FOBJECTTYPEID    varchar  NOT NULL  -- 哪个对象（SAL_SaleOrder 或扩展 FID）
  FREFOBJECTTYPEID varchar  NOT NULL  -- 被引用的基础资料对象（BD_Customer 等）
  FTABLENAME       varchar  NOT NULL  -- 哪张物理表含有这个 FK
  FFIELDNAME       varchar  NOT NULL  -- FK 字段名
```

🟢 DB 实证：`INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='T_META_OBJECTTYPEREF'`，2026-04-25。

---

### 4.2 SAL_SaleOrder 的 77 行概览

SAL_SaleOrder 共有 **77 行** T_META_OBJECTTYPEREF 记录，涉及 **13 张物理表**：

```
T_SAL_ORDER              (head 表)
T_SAL_ORDERCLAUSE        (EntryEntity Seq=1)
T_SAL_ORDERENTRY         (主 EntryEntity Seq=2)
T_SAL_ORDERENTRY_D       (_D 扩展表)
T_SAL_ORDERENTRY_E       (_E 扩展表)
T_SAL_ORDERENTRY_F       (_F 扩展表)
T_SAL_ORDERENTRYDELIPLAN (SubEntryEntity Seq=3)
T_SAL_ORDERENTRYTAX      (税务子表)
T_SAL_ORDERFIN           (财务分录)
T_SAL_ORDERPLAN          (EntryEntity Seq=6)
T_SAL_ORDERPLANENTRY     (SubEntryEntity Seq=7)
T_SAL_ORDERTRACE         (EntryEntity Seq=8)
T_V_FIN_SALORDERRECENTRY (只读视图 Entry Seq=11)
```

🟢 DB 实证：`SELECT DISTINCT FTABLENAME FROM T_META_OBJECTTYPEREF WHERE FOBJECTTYPEID='SAL_SaleOrder'`，2026-04-25。

---

### 4.3 Entry 表的 FK row 样例（前 20 行中选 Entry 相关）

| FOBJECTTYPEID | FREFOBJECTTYPEID | FTABLENAME | FFIELDNAME |
|---|---|---|---|
| SAL_SaleOrder | BD_BatchMainFile | T_SAL_ORDERENTRY | FLOT |
| SAL_SaleOrder | BD_Customer | T_SAL_ORDERENTRY | FOWNERID |
| SAL_SaleOrder | BD_FLEXSITEMDETAILV | T_SAL_ORDERENTRY | FAUXPROPID |
| SAL_SaleOrder | BD_FLEXVALUESDETAIL | T_SAL_ORDERENTRY | FSOSTOCKLOCALID |
| SAL_SaleOrder | BD_MATERIAL | T_SAL_ORDERENTRY | FMATERIALID |
| SAL_SaleOrder | BD_MATERIAL | T_SAL_ORDERENTRY_E | FPARENTMATID |
| SAL_SaleOrder | BD_CUSTCONTACTION | T_SAL_ORDERENTRYDELIPLAN | FDETAILLOCID |

🟢 DB 实证：前 20 行，2026-04-25。

---

### 4.4 扩展对象的 T_META_OBJECTTYPEREF 行数

扩展 `a4ad49d2-61c2-4000-9650-20e27c701675` 当前有 **77 行**（从 SAL_SaleOrder 克隆而来）。这是 `create-extension-full.ts` 事务中写入 T_META_OBJECTTYPEREF 的 77 行（见 CLAUDE.md 中"8 张表 91 行"说明）。

扩展的 T_META_OBJECTTYPEREF 行中 `FOBJECTTYPEID = 扩展FID`，其余 3 列与父对象相同。

🟢 DB 实证 + `create-extension-full.ts` 代码审阅。

---

## 5. T_META_TRACKERBILLTABLE Row Pattern（DB 实证）

### 5.1 表结构

```
T_META_TRACKERBILLTABLE (4 列)
  FTABLEID       int      NOT NULL  -- 全局唯一整数（PK），必须 >= 900000（BOS 扩展专属区间）
  FTABLENAME     varchar  NOT NULL  -- 物理表名
  FPKFIELDNAME   varchar  NULL      -- 主键字段名（null 或 'FID' / 'FEntryID'）
  FOBJECTTYPEID  varchar  NULL      -- 所属对象 FID 或 ObjectTypeId
```

🟢 DB 实证：`INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='T_META_TRACKERBILLTABLE'`，2026-04-25。

---

### 5.2 SAL_SaleOrder 的 tracker rows（原厂）

| FTABLEID | FTABLENAME | FPKFIELDNAME | FOBJECTTYPEID |
|---|---|---|---|
| 10201 | T_SAL_ORDERENTRY | null | SAL_SaleOrder |
| 10202 | T_SAL_ORDER | null | SAL_SaleOrder |
| 10335 | T_SAL_ORDER | FID | SAL_SaleOrder |
| 10336 | T_SAL_ORDERENTRY | FEntryID | SAL_SaleOrder |

**模式**：每张物理表有 2 行：
1. `FPKFIELDNAME = null`（跟踪用，无 PK 绑定）
2. `FPKFIELDNAME = <pk_column>`（如 `FID` 或 `FEntryID`）

🟢 DB 实证 2026-04-25。

---

### 5.3 扩展的 tracker rows（BOS 扩展区间）

| FTABLEID | FTABLENAME | FPKFIELDNAME | FOBJECTTYPEID |
|---|---|---|---|
| 900001 | T_SAL_ORDERENTRY | null | 96d3fbdd-... |
| 900002 | T_SAL_ORDER | null | 96d3fbdd-... |
| 900003 | T_SAL_ORDER | FID | 96d3fbdd-... |
| 900004 | T_SAL_ORDERENTRY | FEntryID | 96d3fbdd-... |
| 900005 | T_SAL_ORDERENTRY | null | a4ad49d2-... |
| 900006 | T_SAL_ORDER | null | a4ad49d2-... |
| 900007 | T_SAL_ORDER | FID | a4ad49d2-... |
| 900008 | T_SAL_ORDERENTRY | FEntryID | a4ad49d2-... |

**全局 MAX(FTABLEID) = 900008**（截至 2026-04-25）。

🟢 DB 实证 2026-04-25。

---

### 5.4 扩展 tracker 分配规则

SAL_SaleOrder 扩展含 head + 1 个主 entry entity，每个对象需要写 **4 行 tracker**（head 表 2 行 + entry 表 2 行）。

```
分配公式：start_id = MAX(899999, global_max) + 1
- 第 1 行：start_id    FTABLENAME=<entry_table> FPKFIELDNAME=null
- 第 2 行：start_id+1  FTABLENAME=<head_table>  FPKFIELDNAME=null
- 第 3 行：start_id+2  FTABLENAME=<head_table>  FPKFIELDNAME=FID
- 第 4 行：start_id+3  FTABLENAME=<entry_table> FPKFIELDNAME=FEntryID
```

> **如果父对象有多个 entry entity**（如用户指定 entityKey），则每增加一个 entry entity 需要再加 2 行 tracker（null 行 + pkFieldName 行）。具体：每张新 entry 表 = 2 行。

🟢 行数和起点（900001/900005）经两个扩展实证，模式一致。

---

## 6. 给 `k3cloud_create_entry` 工具的实施清单

> 本节是 Plan 5.12.2 的直接实施依据。`k3cloud_get_form_layout` 为读工具，`k3cloud_create_entry` 为写工具（需事务）。

### 6.1 `k3cloud_get_form_layout` 实施

**输入：** `extensionFid` （可选；不传则读父对象 entities）

**SQL：**
```sql
-- 从 FKERNELXML 解析出 entity 清单
-- 使用已有的 FKERNELXML 查询 + XML 解析（复用 bos-writer.ts 或 parse-xml 方式）
SELECT CAST(FKERNELXML AS NVARCHAR(MAX)) as xml
FROM T_META_OBJECTTYPE
WHERE FID = @objectFid
```

解析出每个 `<EntryEntity>` / `<SubEntryEntity>` 节点的：
- `Key`（entity key，如 `FSaleOrderEntry`）
- `EntryName`
- `TableName`
- `EntryPkFieldName`
- `Seq`
- `KeyField`（可选）
- `ParentEntityKey`（SubEntryEntity 专用）
- entity 类型（EntryEntity / SubEntryEntity）

**返回格式：**
```json
{
  "entities": [
    {
      "key": "FSaleOrderEntry",
      "type": "EntryEntity",
      "entryName": "SaleOrderEntry",
      "tableName": "T_SAL_ORDERENTRY",
      "entryPkFieldName": "FEntryID",
      "seq": 2,
      "keyField": "FMaterialId"
    },
    {
      "key": "FOrderEntryPlan",
      "type": "SubEntryEntity",
      "parentEntityKey": "FSaleOrderEntry",
      "entryName": "OrderEntryPlan",
      "tableName": "T_SAL_ORDERENTRYDELIPLAN",
      "entryPkFieldName": "FDetailID",
      "seq": 3
    }
  ]
}
```

🟢 XML 节点结构实证（SAL_SaleOrder FKERNELXML）。

---

### 6.2 `k3cloud_add_fields` 的 `entityKey` 参数

当前 `k3cloud_add_fields` 写字段到 head（默认）。新增 `entityKey` 可选参数：

- 不传或 `entityKey = "FBillHead"` → 当前行为（Head 字段）
- `entityKey = "FSaleOrderEntry"` → 字段放到该 EntryEntity 对应的面板

**XML 变化（新增到 EntryEntity 的字段）：**
```xml
<!-- Elements 里增加字段定义节点（与 EntryEntity 同级，不嵌套） -->
<TextField ElementType="1" ElementStyle="0">
  <ConditionType>0</ConditionType>
  <PropertyName>F_EXT_MYFIELD</PropertyName>
  <FieldName>F_EXT_MYFIELD</FieldName>
  <Name>我的扩展字段</Name>
  <Id>...</Id>
  <Key>F_EXT_MYFIELD</Key>
</TextField>

<!-- LayoutInfos 里的 Appearances 里增加外观节点 -->
<TextFieldAppearance ElementType="1" ElementStyle="1">
  <Key>F_EXT_MYFIELD</Key>
  <Container>FSaleOrderEntry</Container>  <!-- entityKey 值 -->
  <Left>10</Left><Top>10</Top>
  <Width>300</Width><LabelWidth>100</LabelWidth>
  <ZOrderIndex>99</ZOrderIndex>
  <Visible>1023</Visible>
  <Caption>我的扩展字段</Caption>
  <Id>...</Id>
</TextFieldAppearance>
```

🟢 Container = EntityKey 模式：从扩展 XML 实证（F_DEMO → Container=FTAB_P0 for head；预期 entry 字段 Container = entityKey）。🟡 Entry field Container 值未在此 DB 中实证验证，但逻辑上与 head 字段一致。

---

### 6.3 新增 EntryEntity 的完整事务清单（🟡 蓝图未 UAT）

要新增一个真正的新 entry entity（新 tab 页），需：

**Step 1: 建物理表**
```sql
CREATE TABLE <new_table_name> (
    FENTRYID int NOT NULL DEFAULT(0),
    FID      int NOT NULL DEFAULT(0),
    FSEQ     int NOT NULL DEFAULT(0),
    -- 用户自定义字段...
    CONSTRAINT PK_<new_table_name> PRIMARY KEY (FENTRYID)
);
```

**Step 2: 写 T_META_TRACKERBILLTABLE（2 行）**
```sql
-- start_id = MAX(899999, SELECT MAX(FTABLEID) FROM T_META_TRACKERBILLTABLE) + 1
INSERT INTO T_META_TRACKERBILLTABLE VALUES (@start_id,   '<new_table>',  null,         @extFid);
INSERT INTO T_META_TRACKERBILLTABLE VALUES (@start_id+1, '<new_table>',  'FENTRYID',   @extFid);
```

**Step 3: 修改 FKERNELXML 插入 `<EntryEntity>` 节点**

在 `<Elements>` 下插入（与其他 entity 同级）：
```xml
<EntryEntity ElementType="35" ElementStyle="0">
  <EntryName>MyExtEntry</EntryName>
  <EntryPkFieldName>FENTRYID</EntryPkFieldName>
  <Seq>@next_seq</Seq>
  <TableName><new_table_name></TableName>
  <SeqFieldKey>FSEQ</SeqFieldKey>
  <GroupColumnInfo><GroupColumnInfo><Id>@new_uuid</Id></GroupColumnInfo></GroupColumnInfo>
  <DefaultRows>1</DefaultRows>
  <Name>扩展明细</Name>
  <Id>@entity_id</Id>
  <Key>@entity_key</Key>
</EntryEntity>
```

**Step 4: 在 LayoutInfos 中新增 LayoutInfo 节点（面板/列布局）**

🟡 Step 3-4 的 XML 片段结构基于 SAL_SaleOrder 实证推断。建表 DDL（Step 1）和 tracker 行（Step 2）基于现有模式推断，**未经 UAT 验证**。

---

## 实证级别汇总

| 节 | 内容 | 级别 | 依据 |
|---|---|---|---|
| §1 类层级和属性 | 所有 `[SimpleProperty]`/`[CollectionProperty]` 注解 | 🟢 | 反编译 line 54067-55460, 255549-255605, 227465-228058 |
| §2.1-2.2 EntryEntity XML schema | XML tag 名、属性列 | 🟢 | SAL_SaleOrder FKERNELXML DB 实证 |
| §2.3 扩展 XML edit 形态 | HeadEntity action="edit"，Fields 为同级节点 | 🟢 | extension a4ad49d2 FKERNELXML DB 实证 |
| §2.4 字段 Container | Head 字段 Container=FTAB_P0 | 🟢 | extension a4ad49d2 布局 XML |
| §2.4 字段 Container | Entry 字段 Container=entityKey | 🟡 | 逻辑推断，未在 DB 中有对应 entry 字段实证 |
| §3.1-3.2 系统列 | FENTRYID/FID/FSEQ/FDETAILID | 🟢 | T_SAL_ORDERENTRY + T_SAL_ORDERENTRYDELIPLAN schema |
| §3.3 建表蓝图 | 新 entry entity DDL | 🟡 | 基于现有表实证推断，未 UAT |
| §4 OBJECTTYPEREF | 表结构、77行、13张表 | 🟢 | DB 实证 2026-04-25 |
| §5 TRACKERBILLTABLE | 表结构、4行模式、900000+区间 | 🟢 | DB 实证（2 个扩展） |
| §6 工具实施清单 §6.1-6.2 | `k3cloud_get_form_layout` + `add_field entityKey` | 🟢/🟡 | XML 结构 🟢；entry field Container 🟡 |
| §6.3 新建 EntryEntity 事务 | 建表+tracker+XML | 🟡 | 逻辑推断，未 UAT |
