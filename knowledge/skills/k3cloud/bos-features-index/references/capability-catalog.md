# BOS 平台能力全景图（V9 反编译实证）

> **数据来源**：`Kingdee.BOS.Core.dll`（V9 客户端）反编译产物（ILSpy 10.0），在 `D:\Project\opendeploy\` 本地侦察。**所有行号引用是反编译输出的行号**——同一份 DLL 二次反编译可能行号略变（编译器版本影响），但类层级稳定。
>
> **侦察日期**：2026-04-25
>
> **实证级别约定**（`knowledge/CONTRIBUTING.md` 同款）
>
> - 🟢 **实证**：从 IL 字节码反编译出来的字段属性 / 类层级 / 枚举常量 / 命名空间，是 BOS 工程真相，比官方手册更准
> - 🟡 **主流程**：基于公开手册整理（help.open.kingdee.com / vip.kingdee.com）+ 反编译类名匹配，未在客户环境跑过
> - 🔴 **骨架**：仅知道存在，未验证语义
>
> **本文件的定位**：BOS 16 大能力的入口索引，每条 ≤ 40 行。详细模型在各自的 `references/<topic>.md` 子文件里。**任何"BOS 能不能做 X"的问题先来这里查表，再去对应子文件。**

---

## 0. 总览：BOS 用 Element 元模型组织一切

BOS 的几乎所有可定制能力都建在两个基类上：

```
Element（基类）
├─ Entity（数据载体）
│  ├─ HeadEntity / SubHeadEntity（1:1）
│  └─ EntryEntity / SubEntryEntity（1:N，可嵌套）
└─ <CapabilityName>Element（能力载体）
   ├─ ConvertRuleElement / ConvertPolicyElement（15 种策略）
   ├─ StateTrackerElement / StateLinkElement / BusinessStateElement
   ├─ WriteBackRuleElement
   ├─ BillTrackerElement
   └─ ...（其他 Element 共 38 个，见各能力章节）
```

每个 Element 有自己的 XML 序列化形态（FKERNELXML 里的节点）、自己的 `T_META_*` 配置表，和自己的 PlugIn 扩展点。

---

## 1. 字段类型（Field types）🟢

**用户场景**：在单据上加自定义字段（金额、数量、引用基础资料、附件等）

**入口**：`Kingdee.BOS.Core.Metadata.FieldElement` 命名空间。基类 `Field : Element`（line 11974）。30+ 子类。

**完整层级**：详见 `references/field-types-decompiled.md`（待建）。摘要：

| 父类 | 主要子类 | 最常用 |
|---|---|---|
| `TextField` | ScanField / TextDBEncryptField / LargeRichTextField / FileServerField / AttachmentField / PictureField / ImageFileServerField | 文本 / 大文本 / 附件 / 图片 |
| `TextField`（特殊） ★ | **`BasePropertyField`（基础资料属性, line 277850, ElementType=14）** / `BaseDataPropertyField`（旧 stub, line 296825） | **基础资料属性带值**（高频，必做） |
| 独立 ★ | **`ReferencePropertyField : Field, ILookUpField`（引用属性, line 251302, ElementType=250）** | 高级版基础资料属性，可分组 / 多语言 |
| `DecimalField` | IntegerField / AmountField / QtyField / DiscountField | 整数 / 金额 / 数量 / 折扣 |
| `DateTimeField` | PrintDateField | 日期 / 日期时间 |
| `BaseDataField` ★ | BaseDataTextField / EditBaseDataField / UserField / UnitField / PostField / BusinessFlowField | 基础资料引用（最高频） |
| `ComboField` | MulComboField / MulSelOrgListField / PrivateComboField | 下拉 / 多选下拉 |
| `SelectField` | SelectImageField / SelectAttachmentField / SelectCombinedField | 选择列表 |
| 独立类 | ColorField / RichEditField / CombinedField / MobileField / FileUpdateField | 颜色 / 富文本 / 组合 / 手机号 / 文件 |

**`BasePropertyField` 关键属性**（基础资料属性带值的工程模型）：

```csharp
public class BasePropertyField : TextField    // ElementType = 14
{
    public Field SourceField { get; set; }            // 必填：链接到同一单据上的某个 BaseDataField
    public string SrcDisplayFieldName { get; set; }   // 必填：要带出的源基础资料属性名（如 "Name" / "FAddress"）
    public string SrcBaseDataDisplayType { get; set; } // 显示类型（默认空）
    public int SummaryType { get; set; }              // 汇总类型 (-1 = 不汇总)
    public int DefaultSizeGetType { get; set; }       // 大小取值方式
    public int FunControl { get; set; }               // 默认 62575（位掩码）
}
```

**语义**：这不是用户自由输入的文本字段——值是当 SourceField（一个已存在的 BaseDataField）变化时**自动从源基础资料带出来**的。例：销售订单上 F客户简称 = SourceField=F客户 + SrcDisplayFieldName=Name。

**Agent 接口含义**：`k3cloud_add_base_property_field` 必须先验证 SourceField 真的是单据上的 BaseDataField，再校验 SrcDisplayFieldName 在 SourceField 指向的基础资料的 schema 里存在——否则插完用户保存表单会报错。**反查需要新工具**：`k3cloud_describe_basedata(refBaseDataObjectKey)` 列出某基础资料有哪些可带的属性。

**XML 形态**：`<TextField key="..." ...>` / `<IntegerField .../>` 等，**类名 = XML 标签名**。

**OpenDeploy 当前覆盖**：`k3cloud_add_fields`（仅 type=text）→ Plan 5.12 P0：扩到 8 主流类型 + BaseDataField 子类。

**反编译位置**：line 11974（基类）+ 上述子类各自的 line 号。

---

## 2. 实体类型（Entity types — 1:N 子表本质）🟢

**用户场景**：销售订单的"明细行"= EntryEntity；明细行下的"序列号子表"= SubEntryEntity。每个 Entity 在物理上 = 独立 SQL 表（`T_<bill>_E*`）。

**入口**：`Kingdee.BOS.Core.Metadata.EntityElement` 命名空间。基类 `Entity : Element`（line 54067）。

**完整层级**：

```
Entity（line 54067, 含常量 HEAD_TYPE=0 / ENTRY_TYPE=1 / LINK_TYPE=2）
├─ HeadEntity（单头, line 255549）
├─ SubHeadEntity（子头, line 250362, 罕见）
├─ EntryEntity ★（单据体 1:N, line 54373）
│  ├─ SingleRowEntity（单行, line 227465）
│  ├─ TreeEntryEntity（树形, line 227888）
│  └─ SubEntryEntity（子单据体嵌套 1:N, line 54661）
│     ├─ TreeSubEntryEntity（line 54731）
│     ├─ SNSubEntryEntity（序列号子体, line 227646）
│     └─ TaxDetailSubEntryEntity（税额明细, line 227745）
├─ ScheduleChartEntity（日程表, line 114414）
└─ GanttChartEntity（甘特图, line 230594）
```

**EntryEntity 关键属性**：`TableName` / `EntryName` / `EntryPkFieldName` / `Fields: List<Field>` / `Seq` / `DefaultRows` / `ChildEntitys: List<SubEntryEntity>` / `KeyField` / `AllowCopy` / `EntityServiceRules`。

**XML 形态**：`<Entity>` / `<EntryEntity>` / `<SubEntryEntity>`，每个含自己的 `<Fields>` 集合。

**OpenDeploy 当前覆盖**：❌ 当前 `k3cloud_add_fields` 默认加到 head，没法指定 entity；`k3cloud_get_extension_fields` 也按 head 维度返回。

**Plan 5.12 必做**：
- `k3cloud_get_form_layout` + `k3cloud_add_fields` 加 `entityKey` 参数
- `k3cloud_create_entry`（创建新 1:N 子表，含 SQL CREATE TABLE + XML 节点 + tracker 行）

---

## 3. 字段验证（Field validation）🟢

**用户场景**：必填、长度限、格式、字段间一致性。

**入口**：`Kingdee.BOS.Core.Metadata.FieldValidationElement` + `Kingdee.BOS.Core.Validation`。

**类层级**（已实证）：

```
AbstractValidation（line 21704）
├─ SingleFieldValidation（line 56976）
│  ├─ MustInputValidation（必填, line 102744）
│  ├─ MustInputAllMultiLangValidation（多语言必填, line 57034）
│  ├─ TextLegalityValidation（文本合法性, line 102640）
│  ├─ FieldBillConsistencyValidation（字段一致性, line 101440）
│  ├─ FieldModifyValidation（修改校验, line 56963）
│  ├─ StringFormatValidation（字符串格式, line 236207）
│  ├─ CMICFormatValidation / DefaultDataValidation / CompositePKValidation
│  └─ BillLinkValidation / LotInputValidation
├─ CompositeFieldValidation（多字段联合, line 102666）
├─ FileUpdateValidation（line 102582）
├─ BillExistValidation（line 102615）
├─ BudgetCtrlValidation（预算管控, line 102628）
├─ IsPushValidation（line 102653）
├─ MoveInstToCurrTableValidation
├─ DoNothingValidation / EntryEntityValidationBase / MulRowSumValidation
└─ ObjectTypePermission : AbstractPreInsertData（权限式校验, line 239552）
```

**XML 形态**：🟡 估计是 `<Validations>` / `<Validation type="..." ...>`（待客户环境实证）。

**OpenDeploy 当前覆盖**：❌

**v0.2+ 路线图**：`k3cloud_add_field_validation(field, ruleType, params)` — 至少覆盖 `MustInputValidation` / `TextLegalityValidation` / `StringFormatValidation` 三类。**v0.1 现状**:`MustInput` 已通过 `k3cloud_add_fields` 的字段 schema 暴露(Plan 5.12.7,加字段时直接在 `fields[i].mustInput=true`);其他 validation 类型仍走 BOS Designer 手工配置或 Python 表单插件 `BeforeSave`。

---

## 4. 业务规则 / 公式（Business rules / Expressions）🟢⚠️

**用户场景**：`F金额 = F数量 * F单价` 自动计算；某字段填了 → 另一字段自动带值；行级条件触发。

**⚠️ 重大修正**：当前 skill 的 `business-rules.md` 写"SQL 风格 DSL 函数表"是**训练数据幻觉**。反编译实证：

**入口**：`Kingdee.BOS.Core.Metadata.Expression` + `Metadata.Expression.FuncDefine` + `DependencyRules`。

**实际语法 = IronPython 子集 + .NET 实例方法 + BOS 内置函数（FuncDefine）**

**Expression 类层级**（line 135794+）：

```
AbstractExpression（line 135794）
├─ ScriptExpression（脚本表达式, line 135800）
├─ ConstExpression（常量, line 135842）
└─ VariableExpression（变量, line 135889）
```

**BOS 内置函数（FuncDefine 类，目前实证 18 个）**：

| C# 类 | 表达式中调用形态（推测） | 用途 |
|---|---|---|
| `GetCurrOrgFunction` | `GetCurrOrg()` | 当前组织 |
| `GetUserFunction` | `GetUser()` | 当前用户 |
| `GetFieldValueFunction` | `GetFieldValue(...)` | 取字段值 |
| `GetPKValueFuncDefine` | `GetPKValue()` | 取主键 |
| `GetAcronymFuncDefine` / `GetAcronymNewFuncDefine` | `GetAcronym(text)` | 拼音首字母 |
| `BillTypeParamFuncDefine` / `BillTypeParamNewFuncDefine` | `BillTypeParam(...)` | 单据类型参数 |
| `OperationStatusFuncDefine` | `OperationStatus()` | 操作状态 |
| `SysParamFuncDefine` | `SysParam(...)` | 系统参数 |
| `AVGFuncDefine` / `CountFunctionDefine` | `Avg(...)` / `Count(...)` | 聚合 |
| `IsDrawFuncDefine` / `IsPushFuncDefine` | `IsDraw()` / `IsPush()` | 状态判断 |
| `GetFlexDetailValueFuncDefine` | `GetFlexDetailValue(...)` | 核算维度值 |
| `AbstractGetDateFunction` / `AbstractGetTimeFunction` | `GetDate()` / `GetTime()` 等 | 日期时间（多个具体子类未列） |

**EntityServiceRule**（line 226994）— 行级业务规则触发器，挂在 EntryEntity 上。

**XML 形态**：🟡 估计是 `<BusinessRules>` / `<DependencyRules>` / `<Rule expression="..." ...>`。

**OpenDeploy 当前覆盖**：❌

**Plan 5.12 P0**：`k3cloud_add_calculate_rule(target, when, action, expression)` — agent 接口设计是难点（让 LLM 稳定生成可执行 IronPython 子集）。

**子文件待建**：`references/business-rules-corrected.md`（替换原 `business-rules.md`）。

---

## 5. 单据转换（Convert rules）🟢

**用户场景**：销售订单 → 发货通知单 → 出库单的下推链路。

**入口**：`Kingdee.BOS.Core.Metadata.ConvertElement`。

**类层级**（已实证）：

```
ConvertRuleElement（line 209361, 一条转换规则）
└─ ConvertPolicyElement（abstract, line 26853, 策略基类）
   ├─ DefaultConvertPolicyElement（默认, line 209806）
   ├─ ConvertTailDiffPolicyElement（尾差, line 26913）
   ├─ ConvertAttachmentPolicyElement（附件, line 27699）
   ├─ ConvertOrderByPolicyElement（排序, line 84193）
   ├─ BillTypeMapPolicyElement（单据类型映射, line 146202）
   ├─ ConvertFormBusinessPolicyElement（表单业务, line 146535）
   ├─ ConvertFilterPolicyElement（过滤, line 146841）
   ├─ ConvertGroupByPolicyElement（分组, line 146975）
   ├─ ConvertPlugInPolicyElement（插件, line 147020）
   └─ LinkEntityPolicyElement（链表, line 147356）

辅助类：
- BillTypeMapElement / TailFieldMapElement / TailBaseFactorFieldMapElement
- ConvertBillElement / ConvertPathElement / ConvertFlowElement / FieldMapElement / FieldOptionElement
```

**XML 形态**：🟡 `<ConvertRules>` / `<ConvertRule>` / `<ConvertPolicies>`（待实证）。

**OpenDeploy 当前覆盖**：❌

**复杂度**：极高（10+ 策略类，每个有自己的字段映射 / 过滤 / 分组配置）。**留 v0.2+**。

---

## 6. 反写规则（Write-back）🟢

**用户场景**：发货单审核 → 反写销售订单"已发货数量"。

**入口**：`Kingdee.BOS.Core.Metadata.WriteBackRule`。

**类**：`WriteBackRuleElement`（line 137959）。

**XML 形态**：🟡 `<WriteBackRules>`（待实证）。

**OpenDeploy 当前覆盖**：❌（v0.2+）

---

## 7. 业务流程（BusinessFlow）🟡

**用户场景**：完整的业务链路定义（如：销售订单 → 发货 → 出库 → 开票 → 收款）。

**入口**：`Kingdee.BOS.Core.BusinessFlow.*`（6 子命名空间）：
- `BusinessFlow` 主体
- `BusinessFlow.DistributeLogic`（分配逻辑）
- `BusinessFlow.Extend`（扩展）
- `BusinessFlow.FreeFlow`（自由流转）
- `BusinessFlow.PlugIn` / `PlugIn.Args`
- `BusinessFlow.ReserveLogic`（预留逻辑）
- `BusinessFlow.ServiceArgs`

**关键类**：
- `FlowElement`（line 86080） / `FreeFlowElement : FlowElement`（line 87195）
- `LineElement` / `NodeElement` / `BillNodeElement` / `PartnerFlowNodeElement`（line 137205+）
- `BusinessflowElement`（abstract）

**OpenDeploy 当前覆盖**：❌（v0.3+，复杂度极高）

---

## 8. 操作 / 按钮（Operations）🟢

**用户场景**：单据上的"保存"/"提交"/"审核"/"下推" 等按钮 + 自定义按钮（"导出 Excel"/"调用第三方 API"）。

**入口**：`Kingdee.BOS.Core.Metadata.Operation` + `Kingdee.BOS.Core.DynamicForm.Operation`。

**类层级**：

```
IFormOperation（接口）
└─ AbstractFormOperation（line 195323）
   ├─ AbstractDynamicFormOperation : IInteractiveOperation（line 196048）
   └─ AbstractBillOperation（line 279457）

辅助：
- FormOperation（具体配置, line 52189, 含属性 Key/Caption/Icon/Plugin/Visibility 等）
- BillGlobalParamOperation（全局参数, line 129824）
- MobileInteractionViewOperation（移动端交互, line 37476）
```

**XML 形态**：🟡 `<Operations>` / `<Operation key="..." ...>`（待实证）。

**OpenDeploy 当前覆盖**：❌（Plan 5.12 P1）

---

## 9. 过滤方案（Filter scheme）🟢

**用户场景**：列表页的"我未审核的"/"本月新增"等保存的过滤条件 + 默认过滤。

**入口**：`Kingdee.BOS.Core.CommonFilter` + `Metadata.PreInsertData.FilterScheme`。

**类**：
- `BPFilterScheme : FilterScheme`（业务伙伴过滤, line 24766）
- `SQLFilterScheme`（SQL 过滤）
- `FilterField` / `QkFilterField` / `QuickFilterLookupField`（line 138551+）
- `FilterEntity`（line 144616）
- `ListFilterSchemeEntity` / `SQLFilterSchemeEntity` / `SysReportFilterSchemeEntity` / `WNReportFilterSchemeEntity`
- `FilterSchemePreData_L` / `FilterSchemePreDatas_L`（多语言预置）

**OpenDeploy 当前覆盖**：❌（Plan 5.12 P1）

---

## 10. 状态机 / 单据跟踪（State tracking）🟢

**用户场景**：单据状态流转（暂存 → 已提交 → 已审核 → 已关闭）+ 状态变化时触发的逻辑。

**入口**：`Kingdee.BOS.Core.Metadata.StateTracker`。

**类层级**：

```
StateTrackerElement（line 268036, 状态跟踪元数据）
├─ BusinessStateElement（业务状态, line 266700）
├─ ViewStateElement（视图状态, line 267421）
└─ StateLinkElement（状态链接, line 267791）

BillTrackerElement（line 267029, 单据跟踪表元数据）
```

**对应 SQL 表**：`T_META_TRACKERBILLTABLE`（已知，扩展时要写）。

**OpenDeploy 当前覆盖**：⚠️ 间接（创建扩展时会插 tracker 行，但不暴露给 agent 改）

---

## 11. 报表（Reports）🟡

**用户场景**：自定义报表 — 简单查询 / 交叉表 / 透视表 / 图表。

**入口**：4 个独立子系统：
- `Kingdee.BOS.Core.Report.EasyReport`（简易报表）
- `Kingdee.BOS.Core.Report.CrossReport`（交叉报表）
- `Kingdee.BOS.Core.Report.PivotReport`（透视报表）
- `Kingdee.BOS.Core.BusinessChart` + `Core.ChartConfig`（图表）
- `Kingdee.BOS.Core.WNReport` / `WNReportFilter` / `WNReport.Helper`（看板预警报表）

**关键类**：`ChartEntity` / `ChartSchemeEntity` / `ChartSchemeEntryEntity`（line 79898+），`ScheduleChartEntity` / `GanttChartEntity`。

**OpenDeploy 当前覆盖**：❌（v0.3+）

---

## 12. 套打 / 打印模板（Print templates）🟡

**用户场景**：销售订单 / 发货单的纸质打印模板。

**入口**：
- `Kingdee.BOS.Core.NotePrint`（票据打印）
- `Kingdee.BOS.Core.ExcelPrint`（Excel 模板打印）

**类**：`PrintTemplateSetting`（line 58749）+ 多个 `PrintXxxField`（PrintActionTimesField / PrintTimesField / PrintExportTimesField / PrintDateField — 自动统计打印次数 / 日期）。

**OpenDeploy 当前覆盖**：❌（v0.2+）

---

## 13. 实时预警（Real-time warnings）🟢

**用户场景**：库存低于安全库存自动报警；应收逾期 30 天发邮件；审批超时推送云之家。

**入口**：`Kingdee.BOS.Core.Warn.*`（10 个子命名空间）：
- `Warn` 主体（含 `WarnSchedule : Schedule` line 300139）
- `Warn.Cycle`（周期性预警）
- `Warn.MailMessage`（邮件渠道）
- `Warn.Message`（消息渠道）
- `Warn.LlightApp`（轻应用渠道）
- `Warn.Time`（时间触发）
- `Warn.Reader` / `Warn.Parser` / `Warn.Util`
- `Warn.Enums`
- `RealTimeWarn`（独立命名空间，实时预警）

**关键类**：
- `WarnMessageTemplate`（line 77236）
- `WarnVariableField` / `WarnNameVariableField` / `LightAppDisplayField` / `WarnAppSettingField` / `WarnCardSetField` / `WarnDisplayField`（line 170861+）

**OpenDeploy 当前覆盖**：❌（v0.3+）

---

## 14. 消息中心（Message center）🟢

**用户场景**：审批通过后给申请人发消息（站内 / 邮件 / 短信 / 云之家）。

**入口**：`Kingdee.BOS.Core.MessageCenter.*`：
- `MessageCenter`（主）
- `MessageCenter.MessageShow` / `MessageTemplate` / `MessageTemplate.Mobile` / `Messageset` / `Plugin` / `Plugin.Arg` / `Variable`

**关键类**（line 43486+）：
- `MessageTemplateInfo`（消息模板, line 46740）
- `MessageTemplateChannelInfo`（渠道基类, line 43486）
  - `MailMessageTemplateChannelInfo` / `MsgMessageTemplateChannelInfo` / `OperateMessageTemplateChannelInfo` / `OperateMessageTemplateLightAppChannelInfo` / `PublicMessageTemplateChannelInfo` / `PublicMessageTemplateLightAppChannelInfo` / `BusNoticeMessageTemplateChannelInfo` / `WarnMessageTemplateChannelInfo`
- `MessageItemRemindElement`（line 43779）
- `AbstractMessageTemplateProviderPlugin`（line 47002）

**OpenDeploy 当前覆盖**：❌

---

## 15. 权限（Permission）🟢

**用户场景**：按角色 / 组织 / 用户控制单据可见 / 字段可编辑 / 操作可执行 / 数据范围。

**入口**：`Kingdee.BOS.Core.Permission` + `Permission.Concurrent` + `Permission.DBDirectAuth` + `Objects.Permission.Objects` + `SensitiveField`。

**类**：
- `RoleDataRule` / `OrgIdDataRule` / `OrgGroupDataRule` / `GroupDataRule` / `FunPermissionDataRule` / `DataRule`（数据规则系列, line 68851+ / 108660+ / 130255）
- `UserPostPermission` / `UserRolePostPermission`（line 109653+）
- `ConcurrentStringDictionaryPermission<TValue>` / `StringDictionaryPermission<TValue>`（运行时权限缓存, line 34855+）
- 敏感字段：`BaseDataSensitiveField` / `CommonSensitiveField` / `DefaultSensitiveField`（line 157192+）

**OpenDeploy 当前覆盖**：❌（v0.2+，但 `k3cloud_query_business_data` 受控读的"对话同意"机制部分对齐，见 Plan 6 #3）

---

## 16. 编码规则（Code rule）🟢

**用户场景**：销售订单号自动生成 `XSDD20260425001` 这种 — 前缀 + 日期 + 序号。

**入口**：`Kingdee.BOS.Core.CodeRule`。

**类**：`BillCodeRule : DynamicObjectView`（line 257056）。

**OpenDeploy 当前覆盖**：❌（Plan 5.12 P1）

---

## 17. 预置数据（PreInsertData — 默认值 / 默认配置）🟡

**用户场景**：扩展上线时附带"默认基础资料"/"默认过滤方案"/"默认权限组"等预设。

**入口**：`Kingdee.BOS.Core.Metadata.PreInsertData.*`（含 Assistant / DataType / FilterScheme / NetWorkCtrl / Permission / Visible / Warn 子命名空间）。

**类层级**：
- `AbstractPreInsertData`（line 102975） + `AbstractPreInsertData_L`（多语言基类, line 103192）
- `AssistantPreData` / `AssistantPreDataEntry` / `AssistantPreDatas`（辅助资料预置, line 237648+）
- `FilterSchemePreData_L` / `FilterSchemePreDatas_L`（过滤方案预置, line 151691+）
- `ReportData` / `ReportData_L`（报表预置, line 103126+）
- `ObjectTypePermission : AbstractPreInsertData`（权限预置, line 239552）

**OpenDeploy 当前覆盖**：❌

---

## 18. 调度任务（Schedules）🟢

**用户场景**：定时跑数据校验 / 定时推送预警 / 定时清理过期数据。

**入口**：`Kingdee.BOS.Core.Schedules` + `TaskWorker.Aysnc`。

**类**：
- `Schedule`（基类, line 265199）+ `WarnSchedule : Schedule`（line 300139）
- `TargetSchedule`（line 158661）
- `CronExpression`（cron 解析, line 70185, .NET 序列化版）
- `AsyncTaskEntity`（line 158736）

**OpenDeploy 当前覆盖**：❌

---

## 边角能力（标记存在不展开）🔴

下列能力 v0.5 之前几乎用不到，仅记录入口位置，将来要做时回 DLL 抠：

- **AI 内置能力** — `Kingdee.BOS.Core.AI`
- **RPA / NLP 机器人** — `Kingdee.BOS.Core.Robot` + `Robot.NLP`
- **云之家 / 微博集成** — `Kingdee.BOS.Core.YunZhiJia` + `YunZhiJia.CollaborativeCloud` + `Weibo`
- **共享中心** — `Kingdee.BOS.Core.ShareCenter.Enum` + `ShareCenter.Parameter`
- **税务管理** — `Kingdee.BOS.Core.TaxManagement` + `TaxRule`（line 91081）
- **业务监控器** — `Kingdee.BOS.Core.BusinessMonitors`
- **客户端 IP 安全** — `Kingdee.BOS.Core.ClientIPSecurity`（含 `RangeIP4MatchRule` / `SingleIPMatchRule`, line 41408+）
- **健康中心** — `Kingdee.BOS.Core.CloudHealthCenter.ClearService` / `CloudService`
- **后台数据 / 试用 / 部署** — `BackData` / `Trial` / `Deploy`
- **看板预警子模块** — `WNReport` / `WNReportFilter` / `WNReportFilterSchemeEntity`
- **消息总线** — `DistributedMessage` / `Cloud`
- **业务图谱** — `BusinessChart`（与 Reports 部分重叠）
- **业务监控** — `BusinessMonitors` / `BosCheck`
- **平台资源** — `Kingdee.BOS.Core.Cabinet`（资源柜）
- **审计日志** — `Kingdee.BOS.Core.SubSystemLog`

---

## 当前 OpenDeploy v0.1 工具覆盖速查

| 能力 | 反编译位置 | OpenDeploy 工具 |
|---|---|---|
| 字段类型（仅 text）| #1 | `k3cloud_add_fields` ⚠️ 部分 |
| 字段反查 | #1 | `k3cloud_get_extension_fields` / `_get_fields` ✅ |
| 实体查询 / 操作 | #2 | ❌ Plan 5.12 必做 |
| 表单插件注册 | (Python plugin, FKERNELXML `<FormPlugins>`) | `k3cloud_register_python_plugins` ✅ |
| 扩展生命周期 | (T_META_OBJECTTYPE 全套) | `k3cloud_create_extension` / `_delete_extension` / `_list_extensions` / `_restore_from_backup` ✅ |
| 字段验证 | #3 | ❌ Plan 5.12 P0 |
| 业务规则 / 公式 | #4 | ❌ Plan 5.12 P0 |
| 单据转换 | #5 | ❌ v0.2+ |
| 反写规则 | #6 | ❌ v0.2+ |
| 业务流程 | #7 | ❌ v0.3+ |
| 操作 / 按钮 | #8 | ❌ Plan 5.12 P1 |
| 过滤方案 | #9 | ❌ Plan 5.12 P1 |
| 状态机 | #10 | ⚠️ 间接（建扩展时写 tracker） |
| 报表 | #11 | ❌ v0.3+ |
| 套打 | #12 | ❌ v0.2+ |
| 实时预警 | #13 | ❌ v0.3+ |
| 消息中心 | #14 | ❌ |
| 权限 | #15 | ❌ v0.2+ |
| 编码规则 | #16 | ❌ Plan 5.12 P1 |
| 预置数据 | #17 | ❌ |
| 调度任务 | #18 | ❌ |

---

## 后续侦察建议（Tier B deep dives）

按客户实施频率 + 反编译产出价值，建议下一步逐个深挖（每个半天到 1 天，timeboxed）：

1. **Field types** — 30+ Field 子类的关键属性（DisplayName / IsAllowEdit / Min / Max / DefaultValue / RefBaseDataObject / 等）+ XML 序列化形态 → 改写 `references/custom-fields.md`，新增 `references/field-types-decompiled.md`
2. **Entity types** — Head / Entry / SubEntry 完整模型 + tracker / refs 的 SQL 蓝图 → 修订 `bos_extension_recipe.md` 加 entity 章节
3. **Business rules / Expression** — 完整 IronPython 子集 + 全部 FuncDefine（含本文件没列全的日期时间函数）+ DependencyRules 触发模型 → **替换错误的 `business-rules.md`**
4. **Field validation** — 各 Validation 类的参数 schema + XML 形态 → 新增 `references/field-validation-decompiled.md`
5. **Operation / 按钮** — `FormOperation` 全字段 + WebService 调用机制 + Plugin 扩展点 → 新增 `references/operations-decompiled.md`
6. **CodeRule** — `BillCodeRule` 编码规则段构造方式 → 新增 `references/code-rule.md`
7. **Convert** — 15 个 ConvertPolicyElement 的语义 + XML 节点 → 改写 `references/convert-rules.md`

侦察完做 Tier C：再开 1 小时 review，根据结果定 Plan 5.12 / v0.2 / v0.3 实际范围。

---

## 反编译产物存放

- `D:\Project\opendeploy\` 是工作仓库，不进 git
- `/tmp/bos-decompile/` (Windows: `C:\Users\28688\AppData\Local\Temp\bos-decompile\`) — 临时反编译产物
  - `out-core/Kingdee.BOS.Core.decompiled.cs` — 7.4 MB，本文件所有行号引用都基于这里
  - `out-dataentity/` `out-formdesigner/` `out-ide-core/` `out-ide-designer/` — 其他子模块

下次 recon 重新生成命令（dotnet SDK + ilspycmd 已装）：

```bash
mkdir -p /tmp/bos-decompile/out-core
"$HOME/.dotnet/tools/ilspycmd.exe" \
  "/c/Program Files (x86)/Kingdee/K3Cloud/DeskClient/K3CloudClientX86/Kingdee.BOS.Core.dll" \
  -o /tmp/bos-decompile/out-core
```
