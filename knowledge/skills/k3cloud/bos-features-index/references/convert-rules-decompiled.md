---
name: convert-rules-decompiled
title: BOS 单据转换规则 — 反编译 + RPC 实证
description: T_META_CONVERTRULE 表结构、ConvertRuleElement 属性模型、10 个 ConvertPolicy 子类语义、字段映射模型 + Plan 5.12.4 RPC 实现路径(GetAllPaths / GetConvertRule JSON 端点 + summarizer)。基于 Kingdee.BOS.Core.decompiled.cs + 2026-04-29 BOS Designer 抓包 + 真实 240KB JSON 实证。
fetched: 2026-04-25, RPC 路径补全 2026-04-29
---

# BOS 单据转换规则的完整工程模型

> 反编译来源: `Kingdee.BOS.Core.decompiled.cs` (305 584 行) + `Kingdee.BOS.ServiceFacade.KDServiceClient.decompiled.cs`(ConvertServiceProxy line 5679)
> DB 实证: `AIS20260302144343` (SQL Server localhost:1433, 2026-04-25)
> RPC 实证: BOS Designer 抓包 `.scratch/captures/2026-04-29T14-58-59-032Z.log` + JSON 样本 `.scratch/convert-rule-recon/`
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
**对 agent 意义**：`k3cloud_list_convert_rules` 应查 `T_META_CONVERTRULE`，而不是 `T_META_CONVERTLOOKUP`。

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

## 5. k3cloud_list_convert_rules / k3cloud_describe_convert_rule 实现路径（RPC）

> 🟢 **Plan 5.12.4 实证完成**（2026-04-29）：走 `Metadata.ConvertService` 的两个 JSON-emitting 方法，**无需 SQL 直连**。代码：`src/main/erp/k3cloud/rpc/convert-rules.ts` + `convert-rule-summarizer.ts` + 工具 `k3cloud_list_convert_rules` / `k3cloud_describe_convert_rule`。

### 5.0 为什么走这两个端点（其他端点为什么不行）

`ConvertServiceProxy`（`Kingdee.BOS.ServiceFacade.KDServiceClient.dll` line 5679）暴露 17 个方法，按返回类型分两类：

| 方法 | 返回类型 | 序列化 | 可用? |
|---|---|---|---|
| `GetAllPaths()` | `List<ConvertRulePath>` | DataContract JSON | ✅ |
| `GetConvertRule(id)` | `ConvertRuleMetaData`（含 ConvertRuleElement.Policies POCO 树）| DataContract JSON + `___InstClassType__` 多态标记 | ✅ |
| `GetRuleDatas(src, tgt)` | `DynamicObjectCollection` | .NET BinaryFormatter (`<KingdeeXMLPack>`) | ❌ Node 不可读 |
| `GetConvertRuleByRunTime(id, rt)` | `ConvertRuleMetaData` | BinaryFormatter（同名类不同方法走不同序列化器，BOS 内部决定）| ❌ |
| `GetRulesByFormId(src, tgt)` | `List<ConvertRuleMetaData>` | BinaryFormatter | ❌ |
| `MetadataServiceProxy.LoadByModelTypeIdV9(id, 790, false)` | object graph | BinaryFormatter | ❌ |
| `SQLScriptServiceV9Proxy.GetBusinessObjectMetaData(id)` | `Dictionary<string,string>` JSON | JSON | ❌（"对象不存在"——只接受 `T_META_OBJECTTYPE` 表行）|
| `SQLScriptServiceV9Proxy.Execute / ExecuteSafe / ExecuteDataSet` | string / DataSet | — | ❌ 服务端废弃，回错"请使用 SafeDoService.SafeDoWithParams" |
| `DB.SafeDoService.SafeDo(DataSet)?WithParams(GUID, params)` | JSON DataSet | JSON | ❌ ap0 是预注册 SQL 模板 GUID 不是任意 SQL，闭集 RPC |

**关键洞察**：同名类（`ConvertRuleMetaData`）在不同方法下走不同序列化器。判断"能不能用"必须按方法名实测，不能按类名一刀切。

### 5.1 k3cloud_list_convert_rules(sourceFormId?)

**RPC**：`POST /k3cloud/Kingdee.BOS.ServiceFacade.ServicesStub.Metadata.ConvertService.GetAllPaths.common.kdsvc`
- 入参：无（`apFields: {}`）
- 返回：~173KB JSON 数组（全系统下推路径），每条形如 `{SourceFormId, TargetFormId, SourceFormName: [{Key, Value}], TargetFormName: [{Key, Value}]}`
- 客户端按 `sourceFormId` 过滤（trivial filter，零 RPC 成本）

**返回结构**（agent 拿到的）：
```json
{
  "count": 35,
  "paths": [
    { "sourceFormId": "SAL_SaleOrder", "targetFormId": "SAL_OUTSTOCK",
      "sourceFormName": "销售订单", "targetFormName": "销售出库单" }
  ]
}
```

**注意**：列表里**没有 `ruleId`** —— BOS 用业务命名约定 `<SourceShort>-<TargetShort>`（如 `SaleOrder-OutStock`）。同一条 `(source, target)` 路径理论上可挂多条规则（默认 + 备用），`GetAllPaths` 只列路径不区分。要描述特定规则需要 agent 按约定拼 ruleId 或问用户在 BOS Designer 里看到的名字。

**parallelSafe**：`true`

### 5.2 k3cloud_describe_convert_rule(ruleId)

**RPC**：`POST /k3cloud/Kingdee.BOS.ServiceFacade.ServicesStub.Metadata.ConvertService.GetConvertRule.common.kdsvc`
- 入参：`ap0 = ruleId`（raw app-layer string，如 `"SaleOrder-OutStock"`）
- 返回：~240KB JSON `ConvertRuleMetaData`（含 28 个顶层字段 + `Rule` 字段嵌套 ConvertRuleElement + 10 Policy）
- 字段命名：完全对齐第 2-4 节反编译的 ConvertRuleElement / FieldMapElement / 各 Policy 子类 attribute 表

**JSON 形态示意**（已实证 240KB sample）：
```json
{
  "Id": "SaleOrder-OutStock",
  "ModelTypeId": 790,
  "Name": [{"Key": 2052, "Value": "销售订单至销售出库单"}],
  "SourceFormId": "SAL_SaleOrder",
  "Rule": {
    "___InstClassType__": "Kingdee.BOS.Core.Metadata.ConvertElement.ConvertRuleElement,Kingdee.BOS.Core",
    "SourceFormId": "SAL_SaleOrder",
    "TargetFormId": "SAL_OUTSTOCK",
    "Status": false, "IsDefault": true, "ConvertType": 0,
    "Policies": [
      { "___InstClassType__": "...DefaultConvertPolicyElement,...",
        "SourceEntryKey": "FSaleOrderEntry",
        "TargetEntryKey": "FEntity",
        "FieldMaps": [/* 273 个 FieldMap */] },
      // ... 9 个其他 Policy
    ]
  }
}
```

**摘要器策略**（`convert-rule-summarizer.ts`）：240KB → ~5KB，规则：
- DefaultConvertPolicy.FieldMaps：**丢 Auto 默认映射**（`ValueConvertMode === 0`，占 264/273 是 noise），保留 Formula 映射 + 各类聚合映射
- 各 Policy 抽出关键字段，丢 Id / Key / IsKingdeeElement / OriginKey 等 BOS 内部 metadata
- enum int → string 反映射（ValueConvertMode：0=Auto / 6=Formula / ...，GroupByMode：2=GroupByField / ...，见 Section 4 的两张反映射表）

**摘要返回结构**（agent 拿到的）：
```json
{
  "ruleId": "SaleOrder-OutStock",
  "displayName": "销售订单至销售出库单",
  "sourceFormId": "SAL_SaleOrder", "targetFormId": "SAL_OUTSTOCK",
  "isDefault": true, "isActive": false, "convertType": 0,
  "pushRunCondition": null,
  "defaultConvert": {
    "sourceEntry": "FSaleOrderEntry", "targetEntry": "FEntity",
    "fieldMapCount": 273,
    "formulaMaps": [
      { "target": "FBaseUnitQty", "mode": "Formula",
        "formula": "FStockBaseCanOutQty if (FStockBaseCanOutQty > 0 ...) else 0",
        "formulaDesc": "..." }
      // ...9 个共
    ],
    "aggregateMaps": []
  },
  "groupBy": { "mode": "GroupByField", "fields": ["FCustId","FSettleModeId",...], "formula": null },
  "filter": { "alertMessage": null, "customFilter": null },
  "plugins": ["Kingdee.K3.SCM.App.Sal.ServicePlugIn.OutStock.StraightOrderToOutStockCheckManmul, ..."],
  "billTypeMaps": [{"source": "guid-1", "target": "guid-2"}, ...],
  "linkEntity": { "controlEntity": "FEntity", "fieldMapCount": 3 },
  "attachment": {"header": false, "entry": false, "subEntry": false, "deduplication": false},
  "tailDiff": { "enabled": false, "markField": null, "recordField": null },
  "orderByField": null
}
```

**parallelSafe**：`true`

### 5.3 实现注意事项

1. **响应体积管理**：`GetConvertRule` 返回 ~240KB JSON（约 60K tokens），**禁止整发给 LLM** —— 必须通过 summarizer 压到 ~5KB（实测 SaleOrder-OutStock：239,645 → 5,188 bytes，2.16% = 1/46）。

2. **ruleId 命名约定**：业务字符串（如 `SaleOrder-OutStock`），不是 GUID。同一条 (source, target) 路径可挂多规则；当前工具只支持按 ruleId 描，没做"按 source+target 列规则"——需要会用到时再加（候选：实现 MS-NRBF 解析或找新 JSON 端点）。

3. **enum 反映射表**：`ValueConvertMode` / `GroupByMode` 的 int 值见 Section 4 末尾的反映射表，summarizer 用这两张表把 0/2/6 翻成 `Auto`/`GroupByField`/`Formula`。未知值返回 `Unknown(N)` 不抛错。

4. **`ConvertType=1`**（反向勾稽）：源/目标可能同一张单（如 `CN_BILLPAYABLE` 互转），summarizer 直透 0/1，agent 看到 `convertType: 1` 时知道是反向。

5. **BillTypeId GUID 不翻译**：`BillTypeMaps` 直出 GUID，agent 想要中文要追加查 BillType 主数据（v0.2 范围）。

6. **不存在规则的处理**：`GetConvertRule(unknownId)` 服务端返 `response_error: ...不存在`，工具层 catch 后返 `{found: false, ruleId, message: "..."}`，不抛 stack。

### 5.4 与原 SQL 路径的等价关系（参考）

下表把第 2-4 节描述的 DB schema 对应到 RPC 路径，便于对比：

| 数据来源（SQL 时代）| 等价 RPC 拿到（BOS-only）|
|---|---|
| `T_META_CONVERTRULE` 行 | `GetConvertRule(id)` 返回的顶层包装（Id/ModelTypeId/Name/SourceFormId/.../Rule）|
| `T_META_CONVERTRULE_L` zh-CN 行 | 顶层 `Name: [{Key:2052, Value:...}]` |
| `FKERNELXML` 解析后的 ConvertRuleElement | `Rule` 字段（直接 POCO，无需 XML 解析）|
| 全表 `GROUP BY FSOURCEFORMID/FTARGETFORMID` | `GetAllPaths()` 全表 + 客户端 `filter` |
| `T_META_CONVERTLOOKUP`（画布子集，非全集）| 不需要查（GetAllPaths 已是全集）|

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
| ConvertService.GetAllPaths 端点 + 入参 + JSON 形态 | 🟢 | smoke `smoke-convert-rule-element.ts` + capture #0072 (173KB JSON), 2026-04-29 |
| ConvertService.GetConvertRule 端点 + 入参 + JSON 形态 | 🟢 | smoke 实证 + 240KB JSON sample 落 `.scratch/convert-rule-recon/`, 2026-04-29 |
| GetRuleDatas / GetConvertRuleByRunTime / LoadByModelTypeIdV9 走 BinaryFormatter（不可用）| 🟢 | capture #0073 / #0074 / #0080 全是 `<KingdeeXMLPack>` 包装, 2026-04-29 |
| Plan 5.12.4 RPC 实现路径 + summarizer 240KB → 5.2KB | 🟢 | 完整代码 + 真实 sample 实证, 2026-04-29 |
