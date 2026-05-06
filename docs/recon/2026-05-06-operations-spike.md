# Operations / 工具栏按钮 wire format 实证（Plan 5.12.6 实施前 spike）

> **实证日期**：2026-05-06
> **完整证据链**：`.scratch/captures/decoded/req-{96,117,137,212}/`
> **capture session**：`.scratch/captures/2026-05-06T08-26-22-516Z.log`
> **抓包对象**：BOS Designer (V9.0.553.12，patched legacy login) → `MetadataServiceV9Proxy.SaveForIDEV9`
> **抓包目标**：销售订单扩展上"自定义操作 + 工具栏按钮"完整生命周期（创建 → 删操作 → 删按钮 → 加 Python 操作）

## Scope

5.12.6 v0.1 范围 = "自定义操作 + 工具栏按钮"。本 spike 用 4 份 capture 覆盖：

| capture | 用户在 BOS Designer 做的事 | wire 主要差异 |
|---|---|---|
| req-96 | 新建扩展 + 加 1 个 FormOperation `TESTCopy` (OperationId=2 复制变体) + 加 1 个 BarButtonItem `UNW_tbButton` 绑该操作 + 保存 | baseline（操作 + 按钮都在）|
| req-117 | 删除 TESTCopy 操作 | FormOperations 整段消失；按钮 ClickActions 被剥离成空壳 |
| req-137 | 删除按钮 | 整个 LayoutInfos 段消失 |
| req-212 | 新加一个 OperationId=45 自定义操作 `TestPyOp` + 「服务插件」面板填 Python 插件（ClassName=`测试插件`，PyScript=`#测试插件`）+ 保存 | FormOperation 含 ServicePlugins 子节点 |

---

## §1 capture 矩阵

| req | 状态 | FormOperation 数 | BarButtonItem 数 | action="remove" 数（父对象 SubEntryEntity 副作用）|
|---|---|---|---|---|
| **req-96** | 操作 + 按钮 baseline | 1 (`TESTCopy`, OperationId=2) | 1 (`UNW_tbButton` 含 ClickActions) | 16（1 SubEntryEntity + 15 字段）|
| **req-117** | 删操作后保存 | 0（FormOperations 整段消失）| 1（按钮仍在但 **ClickActions 被剥离**）| 16 |
| **req-137** | 删按钮后保存 | 0 | 0（整个 LayoutInfos 段都不发了）| 16 |
| **req-212** | 加 Python 插件操作（OperationId=45）| 1 (`TestPyOp`, OperationId=45, 含 ServicePlugins) | 0 | 16 |

> **`action="remove"` 16 行的来源**：4 份 capture 都看到同一组 `<SubEntryEntity action="remove" oid="..."/>` + 15 个 `<XxxField action="remove" oid="FSaleOrderEntry_Link_..."/>`。这是**扩展 SAL_SaleOrder 时的默认副作用**——BOS Designer 自动从父对象删了 `FSaleOrderEntry_Link` 子单据体（信用管控相关），跟 5.12.6 的操作/按钮无关。

证据：
- req-96 第 1 行：`<FormOperations><FormOperation><Id>TESTCopy</Id>...<OperationId>2</OperationId>...` 后接 `<BarItems><BarButtonItem...>`
- req-117 第 1 行：`<Form action="edit" oid="BOS_BillModel" ...><Id>...</Id></Form>`（Form 内**只剩 Id**，FormOperations 整段消失）
- req-137 第 1 行：`...</BusinessInfo></BusinessInfo></FormMetadata>`（**没有** `<LayoutInfos>` 段）
- req-212 第 1 行：`<FormOperations><FormOperation><Id>TestPyOp</Id>...<OperationId>45</OperationId>...<ServicePlugins><PlugIn ElementType="0"...>`

---

## §2 stateful baseline diff 模型（DCXML 工作模式）

**最重要的发现**：DCXML 是 **stateful baseline diff vs 父对象 SAL_SaleOrder**，不是 incremental（"差量增量"）。每次 save ship 的是"扩展跟父对象当前 baseline 的全部差异"。

### 2.1 删除信号 = "下次不再 ship 该 element"，**没有命令式 remove**

证据链：

- **req-96**（baseline）：`<FormOperations><FormOperation><Id>TESTCopy</Id>...<OperationId>2</OperationId>...</FormOperation></FormOperations>` 出现在 `<Form action="edit" oid="BOS_BillModel">` 内
- **req-117**（删 TESTCopy 后）：`<Form action="edit" oid="BOS_BillModel" ElementType="100" ElementStyle="0"><Id>8dc51623-...</Id></Form>` —— `<FormOperations>` **整段消失**，**没有** `<FormOperation action="remove" oid="TESTCopy"/>`，**没有** `<FormOperations action="setnull"/>`
- **req-137**（删按钮后）：`</BusinessInfo></BusinessInfo></FormMetadata>` —— `<LayoutInfos>` 段**整段消失**，**没有** `<BarButtonItem action="remove" oid="..."/>`

> 这跟 Plan 5.12.3a Phase 1 的 §3 "EntityServiceRule 删除走整段 HeadEntity omit"是同一规律的另一个证据。

### 2.2 `<Form action="edit" oid="BOS_BillModel">` 的 oid 是字符串 form key 不是 GUID

四份 capture 全部一致：`<Form action="edit" oid="BOS_BillModel" ElementType="100" ElementStyle="0">`。

`BOS_BillModel` 是父对象 SAL_SaleOrder 的 form 类型字符串 key（继承自 BOS_BillModel 这个 form 模型类型），**不是** GUID。这跟 EntityServiceRule 容器 `<HeadEntity action="edit" oid="be8f270b-...">` 用 GUID 不一样——Form 节点用 form key 字符串。

证据：req-96/117/137/212 均含 `oid="BOS_BillModel"`（4/4 一致）。

### 2.3 `action="remove"` 只用于"删父对象本来有的 element"

四份 capture 都看到 16 行 remove：

```xml
<SubEntryEntity action="remove" oid="<新 GUID 每次保存都换>" />
<TextField action="remove" oid="FSaleOrderEntry_Link_FFlowId" />
<IntegerField action="remove" oid="FSaleOrderEntry_Link_FFlowLineId" />
<TextField action="remove" oid="FSaleOrderEntry_Link_FRuleId" />
<IntegerField action="remove" oid="FSaleOrderEntry_Link_FSTableId" />
<TextField action="remove" oid="FSaleOrderEntry_Link_FSTableName" />
<TextField action="remove" oid="FSaleOrderEntry_Link_FSBillId" />
<TextField action="remove" oid="FSaleOrderEntry_Link_FSId" />
<BaseQtyField action="remove" oid="FSaleOrderEntry_Link_FBaseUnitQtyOld" />
<BaseQtyField action="remove" oid="FSaleOrderEntry_Link_FBaseUnitQty" />
<BaseQtyField action="remove" oid="FSaleOrderEntry_Link_FPriceBaseQtyOld" />
<BaseQtyField action="remove" oid="FSaleOrderEntry_Link_FPriceBaseQty" />
<BaseQtyField action="remove" oid="FSaleOrderEntry_Link_FStockBaseQtyOld" />
<BaseQtyField action="remove" oid="FSaleOrderEntry_Link_FStockBaseQty" />
<BaseQtyField action="remove" oid="FSaleOrderEntry_Link_FPurBaseQtyOld" />
<BaseQtyField action="remove" oid="FSaleOrderEntry_Link_FPurBaseQty" />
```

注意 `<SubEntryEntity action="remove">` 的 oid 在 req-96 (`3765e1da1c8b413194ccdc425b743019`) / req-117 (`66d26bd0167347f99c3de551d8157201`) / req-137 (`38f749517d8948bd9bd94a41d1bfb311`) / req-212 (`93e9aaede28642648511b217f3d7be3d`) **每次都不一样**——这是 BOS Designer 客户端每次重新 reload baseline 时为父对象 SubEntryEntity 分配的新 GUID（baseline 漂移），不是扩展自己的状态。

**结论**：扩展的"我加了什么"靠"ship 该 element 完整出现在 DCXML"，扩展的"我删了什么自己加的"靠"ship 时不再出现"（**整段 omit**）。`action="remove"` **仅** 用于扩展去删 _父对象本来有的_ element（如 SubEntryEntity 整段下线）。

### 2.4 对 5.12.6 实施的核心约束

bridge 添加操作/按钮：序列化 ship 该 element。
bridge 删除操作/按钮：**反序列化 baseline → 修改对象图（从 collection 移除）→ 重新序列化 SaveForIDEV9**。**不能** ship `<FormOperation action="remove" oid=...>`——wire 里这种语法对扩展自己加的 element 不存在。

---

## §3 FormOperation wire schema（来自 req-96 + req-212 实证）

### 3.1 容器路径

```
FormMetadata
└── BusinessInfo
    └── BusinessInfo
        └── Elements
            └── Form action="edit" oid="BOS_BillModel" ElementType="100" ElementStyle="0"
                ├── Id (Form GUID, 扩展 FID)
                └── FormOperations
                    └── FormOperation (一条操作一个节点，可多个)
```

### 3.2 子节点完整顺序（req-96 TESTCopy + req-212 TestPyOp 双份对照）

```xml
<FormOperation>
  <Id>TESTCopy</Id>                                   <!-- ① 必填，user key -->
  <Operation>TESTCopy</Operation>                     <!-- ② 必填，等于 Id -->
  <BeforeOpAlterInfo />                               <!-- ③ 必出现，空自闭合 -->
  <AfterOpAlterInfo />                                <!-- ④ 必出现，空自闭合 -->
  <AfterOpFailedInfo action="setnull" />              <!-- ⑤ 必出现，action="setnull" -->
  <OperationId>2</OperationId>                        <!-- ⑥ 必填，long，操作类型枚举 -->
  <OperationName>TEST复制</OperationName>             <!-- ⑦ 必填，显示名 -->
  <Parmeter>                                          <!-- ⑧ 必出现 (注意 typo: Parmeter 不是 Parameter) -->
    <OperationParameter>
      <Id>05556021-01b7-40d0-a75b-ec17c80a7605</Id>   <!--    OperationParameter GUID -->
      <ExpressValue>IsCopyLinkEntry:0</ExpressValue>  <!--    分号分隔 key:value -->
    </OperationParameter>
  </Parmeter>
  <OperEleIds>34</OperEleIds>                         <!-- ⑨ req-96 出现，req-212 不出现 -->
  <LoadKeys>[]</LoadKeys>                             <!-- ⑩ 必出现，JSON array literal -->
  <ServicePlugins>...</ServicePlugins>                <!-- ⑪ 可选，仅当配 Python/DLL 服务插件 -->
</FormOperation>
```

**子节点出现次序对照**（按 wire 实际序）：

| # | 节点 | req-96 (OperationId=2 复制) | req-212 (OperationId=45 Python 插件) | 备注 |
|---|---|---|---|---|
| 1 | `Id` | `TESTCopy` | `TestPyOp` | 必填 |
| 2 | `Operation` | `TESTCopy` | `TestPyOp` | 必填，与 Id 同值 |
| 3 | `BeforeOpAlterInfo` | `<BeforeOpAlterInfo />` | `<BeforeOpAlterInfo />` | 必出现，空 |
| 4 | `AfterOpAlterInfo` | `<AfterOpAlterInfo />` | `<AfterOpAlterInfo />` | 必出现，空 |
| 5 | `AfterOpFailedInfo` | `action="setnull"` 空自闭合 | `action="setnull"` 空自闭合 | 必出现，**带 action="setnull"** |
| 6 | `OperationId` | `2` | `45` | 必填 |
| 7 | `OperationName` | `TEST复制` | `测试Python插件操作` | 必填，中文 ok |
| 8 | `Parmeter` | 含 OperationParameter | 含 OperationParameter | 必出现（注意 typo）|
| — | └ `OperationParameter.Id` | `05556021-...` GUID | `030983cc-...` GUID | 服务端分配 |
| — | └ `OperationParameter.ExpressValue` | `IsCopyLinkEntry:0` | `IsShowMes:0;IsForbidWFService:0` | 分号分隔 key:value 串 |
| 9 | `OperEleIds` | `34` | （未出现）| **可选**：req-96 出现 req-212 不出现 |
| 10 | `LoadKeys` | `[]` | `[]` | 必出现，JSON array 字面量 |
| 11 | `ServicePlugins` | （未出现）| 含 1 PlugIn | **可选**，仅在用户配服务插件时出现 |

### 3.3 OperationId 是操作类型枚举 long，不限于"自定义"

实证两个值：

- **OperationId=2**（req-96，TESTCopy）—— **复制**操作的内置 id；用户复用此 id 加自己的 `<ExpressValue>IsCopyLinkEntry:0</ExpressValue>` 覆盖参数（这是"复制时不复制下推关联子表"的标志）。这意味着 OperationId 不仅是"自定义操作的占位 id"，而是 BOS 操作类型的全局枚举值，扩展可在此基础上做"操作变体"——同一个内置操作 id + 不同 Parmeter。
- **OperationId=45**（req-212，TestPyOp）—— **DoNothing / 自定义** 类操作的 id（典型用法：业务上没有内置操作的语义，纯靠 ServicePlugins 里的 Python/DLL 插件实现行为）；ExpressValue 为 `IsShowMes:0;IsForbidWFService:0`。

> **对 LLM 工具的影响**：5.12.6 不能假设"自定义操作 = 固定 OperationId=45"。工具必须暴露 OperationId 输入参数，并在文档/索引里列常见值（45 自定义、2 复制等）。具体值的确切语义查 Kingdee 反编译 + 后续场景实证补 cheatsheet。

### 3.4 ServicePlugins 子树（仅 req-212 出现）

```xml
<ServicePlugins>
  <PlugIn ElementType="0" ElementStyle="0">
    <ClassName>测试插件</ClassName>
    <PlugInType>1</PlugInType>
    <PyScript><![CDATA[#测试插件]]></PyScript>
  </PlugIn>
</ServicePlugins>
```

**实证要点**：
- `<PlugIn>` 节点带 `ElementType="0" ElementStyle="0"` 属性
- `<ClassName>` 是**任意简短名**——req-212 用户填的是中文 `测试插件`，wire **原样接受**；不是 .NET FQN
- `<PlugInType>1</PlugInType>` —— **1 = Python**，**0 = DLL**（与 K/3 现有 form-level Python plugin wire 一致）
- `<PyScript>` —— **Python 源码 inline 在 CDATA 段**。req-212 的 CDATA 内容是 `#测试插件`（一行注释），证明：
  - PyScript 用 CDATA 包裹（不需要 XML 实体转义）
  - 哪怕只有一行注释也会被 ship（不会被 BOS Designer 当成"空插件"过滤）
  - inline 源码直接在 wire 里，**不像 DLL 走 ClassName FQN 引用外部程序集**

> **对 LLM 工具的影响**：bridge 设计 `add_form_operation` 的 `servicePlugins?: { className: string; plugInType: 0|1; pyScript?: string; }[]` 时，Python 路径直接传源码字符串；DLL 路径传 .NET FQN（plugInType=0 不带 PyScript，参考 form-level 已实证形态）。Python plugin 的 `kingdee_create_form_plugin` / `kingdee_create_python_plugin` 系列工具有现成的源码持久化路径，5.12.6 ServicePlugins 只是把同样的 "PluginType=1 + ClassName + PyScript inline" 三元组塞到 FormOperation 子树而非 form 顶层。

---

## §4 BarButtonItem wire schema（来自 req-96 baseline + req-117 删空壳）

### 4.1 容器路径

```
FormMetadata
└── LayoutInfos
    └── LayoutInfo action="edit" oid="<LayoutInfo GUID>"
        └── Appearances
            └── FormAppearance action="edit" oid="<FormAppearance GUID>" ElementType="100" ElementStyle="1"
                └── Menu
                    └── BarDataManager
                        ├── BarItems
                        │   └── BarButtonItem (一个按钮一个节点，可多个)
                        └── BarItemLinks
                            └── BarItemLink (按钮挂工具栏的引用)
```

### 4.2 BarButtonItem 子节点完整顺序（来自 req-96）

```xml
<BarButtonItem ElementType="2005" ElementStyle="1">
  <ImageKey />                                           <!-- ① 必出现，可空自闭合 -->
  <Shortcut />                                           <!-- ② 必出现，可空自闭合 -->
  <Seq>1006</Seq>                                        <!-- ③ 必填，序号 -->
  <Description>按钮</Description>                        <!-- ④ 必填，描述 -->
  <IsShowTitle>True</IsShowTitle>                        <!-- ⑤ 必填，True/False 字符串 -->
  <ClickActions>                                         <!-- ⑥ 可选（绑操作时存在）-->
    <FormBusinessService>
      <ConfirmInfo />                                    <!--    空自闭合 -->
      <Parameters>["TESTCopy"]</Parameters>              <!--    JSON array of operation key -->
      <ActionId>23</ActionId>                            <!--    23 = 调用表单操作 -->
      <Description>调用表单操作--TEST复制</Description>  <!--    "调用表单操作--{OperationName}" -->
      <Id>ab6f87b7-a698-4e07-960a-360e9e7195ac</Id>      <!--    FormBusinessService GUID -->
    </FormBusinessService>
  </ClickActions>
  <Caption>按钮</Caption>                                <!-- ⑦ 必填，显示标题 -->
  <Id>a11b0062de1c41dba837401ad202fc22</Id>              <!-- ⑧ 必填，BarButtonItem GUID -->
  <Key>UNW_tbButton</Key>                                <!-- ⑨ 必填，按钮 key（受 ISV DevCode 前缀约束）-->
</BarButtonItem>
```

### 4.3 BarItemLinks（按钮挂到工具栏的引用关系）

```xml
<BarItemLinks>
  <BarItemLink>
    <Id>3cce5895-faf8-44af-b1d6-b7f8ac607378</Id>   <!-- BarItemLink 自己的 GUID -->
    <BarItemKey>UNW_tbButton</BarItemKey>           <!-- 引用 BarButtonItem.Key -->
  </BarItemLink>
</BarItemLinks>
```

**关系**：`BarButtonItem` 是按钮**定义**（在 BarItems 集合内），`BarItemLink` 是按钮**摆放**（挂到 BarDataManager 工具栏区域）。一个按钮要可见**两个集合都得 ship**——光定义不挂等于按钮藏起来。

### 4.4 ClickActions 的 ActionId=23 = "调用表单操作"

```xml
<FormBusinessService>
  <ConfirmInfo />
  <Parameters>["TESTCopy"]</Parameters>      <!-- JSON array; [0] = 操作 key -->
  <ActionId>23</ActionId>                    <!-- 23 = CallFormOperation -->
  <Description>调用表单操作--TEST复制</Description>
  <Id>ab6f87b7-...</Id>
</FormBusinessService>
```

ActionId=23 是 K/3 业务规则系统里的"调用表单操作"动作 id（与 5.12.3a Phase 1 见过的 ActionId=2 Calculate / 67 GetInvStock 是同一枚举空间）。`Parameters` 是 JSON array of string，第 0 项是要调用的 FormOperation.Id（操作 key）。

> **对 LLM 工具的影响**：bridge `add_bar_button_item` 接受 `bindOperation?: string`（操作 key）参数；如果传了，wire 里组装 ClickActions/FormBusinessService/Parameters=`[operationKey]`/ActionId=23/Description=`调用表单操作--{operationName}`/Id=GUID；如果没传，按钮就是无操作的空壳按钮（合法但通常没意义，除非用户后续编辑）。

### 4.5 删按钮路径下的"空壳"形态（req-117 的关键洞察）

req-117 删了 TESTCopy 操作但**没删按钮**。wire 里的按钮长这样：

```xml
<BarButtonItem ElementType="2005" ElementStyle="1">
  <ImageKey />
  <Shortcut />
  <Seq>1006</Seq>
  <Description>按钮</Description>
  <IsShowTitle>True</IsShowTitle>
  <Caption>按钮</Caption>
  <Id>10d17f8656fd4361b87b05e45e84fb4f</Id>
  <Key>UNW_tbButton</Key>
</BarButtonItem>
```

**关键差异**：跟 req-96 baseline 对比，**`<ClickActions>` 整段消失**——BOS Designer 检测到按钮绑的 OperationKey `TESTCopy` 在新 baseline 不存在，**自动剥离孤儿引用**，按钮降级为"无操作的空壳"，但**节点本身仍 ship**（按钮本身没被用户删）。

注意 `<Id>` 也变了（req-96 `a11b0062de1c41dba837401ad202fc22` → req-117 `10d17f8656fd4361b87b05e45e84fb4f`），但 `<Key>UNW_tbButton</Key>` 不变——说明 BarButtonItem 的稳定身份是 Key 不是 Id，BOS Designer 在 baseline reload 时可能为 Id 重生 GUID。

> **对 LLM 工具的影响**：bridge 删除操作时如果该操作被 ClickActions 引用，**不要**先报错让 LLM 处理——客户端有"自动剥离"副作用，让它发生即可。但 bridge `list_bar_button_items` 的输出应能区分"绑了操作"和"空壳"，避免 LLM 把空壳当成绑了的按钮。

### 4.6 删按钮 = 整个 LayoutInfos 段消失（req-137）

req-117 → req-137 的差异：用户在 BOS Designer 删了按钮。req-137 wire 里：

- `<LayoutInfos>` 段**整段消失**
- `<FormAppearance>` / `<BarDataManager>` / `<BarItems>` / `<BarButtonItem>` / `<BarItemLinks>` / `<BarItemLink>` 都不出现

req-137 的 BusinessInfo 段结尾直接是 `</BusinessInfo></BusinessInfo></FormMetadata>`，没有 LayoutInfos。

**结论**：扩展若没有任何 LayoutInfo 修改（按钮删了 + 没有别的字段布局调整），整个 LayoutInfos 段不 ship。这跟"FormOperations 没了就整段 omit"是同一规律——没有命令式 remove，只靠"不 ship 即不存在"。

---

## §5 删除路径分析

### 5.1 为什么 path A "字符串模板 overlay" 不工作

假设的 path A：bridge 用模板字符串拼 `<FormOperation action="remove" oid="TESTCopy"/>` 注入 DCXML 让服务端识别为"删除信号"。

**实证否决**：4 份 capture 都没有任何 `action="remove"` 加在扩展自己加的 element 上（所有 16 行 remove 都是父对象 element 如 `FSaleOrderEntry_Link_*`）。BOS 服务端的 DCXML 解析器对"扩展自加 FormOperation 的 action='remove'"行为未实证，强行模拟有两个风险：

1. 服务端可能直接 ignore 这个语法（不报错也不删，silent drop——跟 BasePropertyField 早期实证类似）
2. 服务端可能报错 NRE 或 "未能找到对应的数据类型"（参考 `bos_extension_field_inline_updateactions.md` 实证："对扩展字段必须 inline，对父对象字段才能 overlay"）

更根本的问题：bridge 只有 raw DCXML 没有完整的"对象图状态"，做不到"我现在到底有几个 FormOperation"。即使 overlay 删除信号正确，**新增**和**编辑**仍需要拿当前 baseline 重组——不绕"序列化整个对象图"这一步。

### 5.2 .NET bridge 是必然选择

必须做一个 .NET 进程持有 `Kingdee.BOS.Core.dll` 等 BOS 私有 DLL，复用 BOS 自己的：

1. **Load** ：HTTP RPC 调用 `*.common.kdsvc` 的 `Kingdee.BOS.ServiceFacade.KDServiceFx.MetaData.LoadMeta` 或同类端点拉当前扩展 metadata，**反序列化为 BOSObject 对象图**
2. **Mutate**：在对象图上做 collection 操作（`form.FormOperations.Add(...)` / `form.FormOperations.Remove(op)` / `form.LayoutInfo.Appearances[0].Menu.BarDataManager.BarItems.Add(...)`）
3. **Save**：`MetadataServiceV9Proxy.SaveForIDEV9` 让 BOS 自己 DCXML 序列化 + 服务端 diff 应用

这条路径的好处：
- bridge 不接触 DCXML 文本（不用复刻奇怪的子节点顺序、typo 名称如 `Parmeter`、CDATA 包装等）
- BOS 自己的序列化器知道"这个 collection 我有 2 个 → 现在剩 1 个 → 应该 ship"，自动产出正确的 stateful baseline diff
- 所有 5.12.3a / 5.12.3b 已经决策的 .NET bridge 路径（business-rules ops）跟这里复用同一进程

### 5.3 与 5.12.3a 删除 wire 实证一致

5.12.3a Phase 1 §3.3 删除 EntityServiceRule 的实施路径已经定为：

> v0.1 简化路径：bridge 删除 op 不靠"客户端 diff 算法"，而是：
> 1. 通过 HTTP RPC 拉当前 metadata（Load.common.kdsvc）
> 2. 反序列化 → 修改 EntityServiceRules collection 删掉目标 rule
> 3. 调用 MetadataServiceV9Proxy.SaveForIDEV9 推回（让 BOS server 自己 diff）

5.12.6 删除 FormOperation / BarButtonItem 走**完全一样的路径**，只是 collection 路径不同（`form.FormOperations` / `form.LayoutInfo.Appearances[0].Menu.BarDataManager.BarItems`）。

---

## §6 对 5.12.6 实施的影响

### 6.1 v0.1 工具范围（5 个 LLM 工具）

| 工具 | 说明 | 主要参数 | bridge op |
|---|---|---|---|
| `kingdee_add_form_operation` | 加自定义操作（含可选服务插件）| extensionFid, operationKey, operationName, operationId (long), expressValue?, servicePlugins? | `add_form_operation` |
| `kingdee_add_bar_button_item` | 加工具栏按钮（form 顶层 / entry 级）| extensionFid, key, caption, location: 'form' \| 'entry:<entityKey>', bindOperation?, seq?, isShowTitle? | `add_bar_button_item` |
| `kingdee_remove_form_operation` | 删自定义操作 | extensionFid, operationKey | `remove_form_operation` |
| `kingdee_remove_bar_button_item` | 删按钮 | extensionFid, key, location: 'form' \| 'entry:<entityKey>' | `remove_bar_button_item` |
| `kingdee_list_form_operations_and_buttons` | 列表查询 | extensionFid | `list_form_operations_and_buttons` |

### 6.2 架构选 .NET bridge（不走字符串模板）

如 §5 实证：所有 mutation 都走 "Load → 改对象图 → SaveForIDEV9"。bridge 的最小责任面：

```
opendeploy-bridge/
├── BridgeCore.cs          # HTTP RPC client (cookie / auth / SaveForIDEV9 wrapper)
├── Operations/
│   ├── AddFormOperation.cs
│   ├── RemoveFormOperation.cs
│   ├── AddBarButtonItem.cs
│   ├── RemoveBarButtonItem.cs
│   └── ListOperationsAndButtons.cs
└── ...
```

bridge IPC 由 OpenDeploy 主进程 spawn `dotnet bridge.dll <op-name> <json-args>`（参考 5.12.4 v2 Task 已选定的 .NET bridge 整体方向）。

### 6.3 ServicePlugins 内嵌 Python 路径

5.12.6 自定义操作的 Python 插件（OperationId=45 + ServicePlugins/PlugIn/PlugInType=1）跟现有 form-level Python plugin（5.12.4 v2 已稳定）走**同一套源码持久化机制**：

- LLM 通过 `kingdee_write_plugin` 把 Python 源码写到 `~/.opendeploy/projects/<pid>/plugins/<name>.py`
- 加操作时 `kingdee_add_form_operation` 接 `servicePlugins: [{ className, plugInType: 1, pyFile: 'xxx.py' }]`
- bridge 在序列化 `<PyScript>` 时**读 .py 文件内容 inline 进 CDATA**

这样保证：
- LLM 跟 .py 文件交互（write_plugin / read_plugin / list_plugins），不直接面对 BOS 的 CDATA 字符串
- bridge 收到 op 时一次性把源码 inline 进 wire（重启服务无状态依赖）
- 用户在文件管理器里能看到 .py 文件（一致性 UX）

### 6.4 v0.1 支持的"按钮位置"两个

按 §4.1，FormAppearance 是 form 顶层工具栏的 menu 容器。已知历史 capture（req-77，5.12.7 inventory spike）见过**EntryEntityAppearance** 类型，是分录工具栏对应的 menu。Plan 5.12.6 v0.1 决定支持：

- **form 顶层**（FormAppearance）—— req-96 实证
- **entry 级**（EntryEntityAppearance）—— req-77 已实证（不在本 spike 范围，但 bridge 实现需支持）

bridge `add_bar_button_item` 的 `location` 参数取这两种值，序列化时挂到不同 Appearance 节点；wire schema（BarButtonItem 子节点 + BarItemLinks）两种 location **完全一样**，只是 parent 节点不同。

### 6.5 ISV DevCode 前缀约束

req-96 / req-117 / req-137 / req-212 的 paras `ISV.DevCode` = `UNW`。按钮 Key（`UNW_tbButton`）和操作 Key（`TESTCopy`，TestPyOp 没显式带前缀）的命名约束待补：

- **按钮 key 必须带 ISV DevCode 前缀**（req-96/117 的 `UNW_tbButton`）—— 这跟 K/3 BOS 通用扩展命名规范一致
- **操作 key 没看到前缀强制**（req-96 `TESTCopy` / req-212 `TestPyOp`）—— 但作为可读性约定，5.12.6 工具应该建议 LLM 加前缀（`UNW_xxx`）

bridge 入参校验：按钮 key 必须以 `<DevCode>_` 开头（从扩展 paras 读 ISV.DevCode 自动校验），不符合就 reject 让 LLM 修正。

### 6.6 实证标记总结

| 断言 | 标记 | 依据 |
|---|---|---|
| FormOperation 子节点顺序 (Id/Operation/.../LoadKeys/ServicePlugins) | 🟢 | req-96 + req-212 双份对照 |
| `Parmeter` 是 typo（不是 Parameter）| 🟢 | req-96 + req-212 4 处出现都是 Parmeter |
| OperationId 是 long 枚举（2 复制 / 45 自定义）| 🟢 | req-96 OperationId=2 / req-212 OperationId=45 实证 |
| ServicePlugins/PlugIn/PlugInType=1 = Python | 🟢 | req-212 实证 |
| ServicePlugins/PlugIn/PyScript inline CDATA | 🟢 | req-212 实证 `<PyScript><![CDATA[#测试插件]]></PyScript>` |
| ServicePlugins/PlugIn/ClassName 接受任意中文短名 | 🟢 | req-212 实证 `<ClassName>测试插件</ClassName>` |
| BarButtonItem ElementType="2005" ElementStyle="1" | 🟢 | req-96 / req-117 实证 |
| ClickActions/FormBusinessService/ActionId=23 = 调用表单操作 | 🟢 | req-96 实证 + 与 5.12.3a 业务规则 ActionId 同枚举空间 |
| BarItemLinks 是按钮挂工具栏的引用 | 🟢 | req-96 实证 |
| 删 element = 下次不 ship（无命令式 remove）| 🟢 | req-117 / req-137 wire diff 直接证实 |
| 按钮删空壳后 ClickActions 自动剥离 | 🟢 | req-117 vs req-96 ClickActions 对比 |
| `<Form action="edit" oid="BOS_BillModel">` oid 是字符串 form key | 🟢 | 4/4 capture 一致 |
| 按钮 key 必须带 ISV DevCode 前缀 | 🟡 | req-96 实证 `UNW_tbButton` 单例，与 K/3 通用扩展命名规范一致；多 ISV 多按钮场景未实证 |
| 操作 key 推荐带 DevCode 前缀（非强制）| 🟡 | req-96 `TESTCopy` / req-212 `TestPyOp` 都没带前缀，BOS 接受 |
| `OperEleIds` 是可选子节点 | 🟡 | req-96 出现 (`34`) req-212 不出现，触发条件未实证（推测与 OperationId 类型相关）|
| `ExpressValue` 分号分隔 key:value 串 | 🟡 | 实证 2 份样本 (`IsCopyLinkEntry:0` / `IsShowMes:0;IsForbidWFService:0`)，完整 grammar 待反编译 OperationParameter |
| 按钮可挂 entry 级（EntryEntityAppearance）| 🟡 | 历史 req-77 见过，本 spike 未抓 |
| 删按钮的 wire 真相是"整个 LayoutInfos 段都不 ship" | 🟢 | req-137 实证 |
| OperationId 完整枚举表 | 🔴 | 仅实证 2 / 45 两个值；其它需反编译 `Kingdee.BOS.Core.Metadata.FormElement.FormOperationEnum` 或同类型 |
| 按钮 ImageKey / Shortcut 非空形态 | 🔴 | 4 份 capture 都是空自闭合，user 没填图标/快捷键 |
| ServicePlugins 多个 PlugIn 并列 | 🔴 | req-212 仅 1 个 PlugIn，多插件场景未实证（推测同 form-level，按 PlugIn 顺序 ship）|

---

## Self-Review

- ✅ 4 份 capture（req-96/117/137/212）全 Read 实证，每条断言都引具体 wire 片段
- ✅ §1 capture 矩阵 + §2 stateful baseline diff 模型 + §3 FormOperation schema + §4 BarButtonItem schema + §5 删除路径 + §6 实施影响六大章齐全
- ✅ FormOperation 11 子节点 + BarButtonItem 9 子节点完整顺序双份对照（req-96 + req-212 / req-96 + req-117）
- ✅ 实证 OperationId=2 (复制变体) + OperationId=45 (Python 自定义) 两个值，ServicePlugins/PlugInType=1 Python inline CDATA 实证
- ✅ 删除路径分析（why path A 不可行 + .NET bridge 是必然选择）+ 与 5.12.3a 删除 wire 实证一致
- ✅ 三档实证标记 🟢/🟡/🔴 总结表
- ⚠️ OperEleIds 触发条件、ExpressValue 完整 grammar、OperationId 完整枚举、entry 级按钮 capture 四项 🟡/🔴 留 5.12.6 实施期或 v0.2 补
- ⚠️ 删除按钮的客户端"自动剥离 ClickActions"副作用是观察到的，BOS Designer 内部触发条件未反编译验证（不影响 v0.1 实施，但 v0.2 list_bar_button_items 输出"空壳 vs 已绑"区分时需关注）
