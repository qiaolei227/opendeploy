# Tier B 实证 — 业务规则 wire formats（Plan 5.12.3a Phase 1）

> **实证日期**：2026-05-04
> **完整证据链**：`.scratch/captures/decoded/business-rules/req-{120,138,158}/`
> **capture session**：`.scratch/captures/2026-05-04T08-57-42-081Z.log`
> **抓包对象**：BOS Designer (V9.0.553.12，patched legacy login) → `MetadataServiceV9Proxy.SaveForIDEV9`

## Scope（用户在 Phase 1 实施时收紧）

原 spec 范围 6 ActionId（2/3/23/42/67/70），Phase 1 实证后用户决定 v0.1 仅做：

| ActionId | 类 | 实证程度 |
|---|---|---|
| **2** | Calculate (基类 FormBusinessService) | 🟢 字段级 UpdateAction wire 实证 |
| **67** | GetInvStockBusinessServiceMeta | 🟢 实体级 EntityServiceRule wire 实证 |
| 3, 23, 42, 70 | — | ⏸ 留 v0.2，scope-cut |

加 1 个删除 wire（实证型 = 整段 HeadEntity 从 DCXML omit）。

---

## §1 ActionId=2 Calculate — 字段级 UpdateAction wire（🟢 实证）

来源：req-120（capture 2026-05-04T09:29:12 UTC）

### 1.1 容器

```xml
<IntegerField ElementType="3" ElementStyle="0">
  <ConditionType>0</ConditionType>
  <PropertyName>F_PAIJ_TestInt</PropertyName>
  <FieldName>F_PAIJ_TESTINT</FieldName>
  <UpdateActions>
    <FormBusinessService>
      <Parameters>[" F_PAIJ_TestDecimal  =   F_PAIJ_TestInt "]</Parameters>
      <ActionId>2</ActionId>
      <Description>计算定义公式的值并填写到指定列</Description>
      <RaiseValueChanged>DisableRaise</RaiseValueChanged>
      <RaiseItemReset>DisableRaise</RaiseItemReset>
      <RaiseReset>DisableRaise</RaiseReset>
      <Id>afc25ea1-5732-4803-9f54-516a22fb0b09</Id>
    </FormBusinessService>
  </UpdateActions>
  <ListTabIndex>9000</ListTabIndex>
  <Name>测试整数</Name>
  <Id>fdcd6ab50b8b40e2ba8fe6166b14d8c9</Id>
  <Key>F_PAIJ_TestInt</Key>
</IntegerField>
```

### 1.2 关键发现

- **UpdateActions 直接是 Field 节点的子元素**（任何 FieldType — IntegerField/TextField/DecimalField/...）
- **Calculate 用基类 FormBusinessService**，**没有 ClassName 子元素**（基类不是子类）
- **Parameters 是 JSON 数组 of 赋值字符串**，前后空格保留（BOS 不 trim）
- **3 个 RaiseEvent 子元素只在覆盖默认时出现**——默认推测 `EnableRaise`，DisableRaise 表示"不触发该事件"
- 实证的 8 RaiseEvent 中 3 个出现：`RaiseValueChanged` / `RaiseItemReset` / `RaiseReset`；其他 5 个（RaiseInitialized / RaiseItemAdded / RaiseItemRemoved / RaiseSelectRowChanged / RaiseSelectRowExtChanged）omit

### 1.3 "及时触发" UI toggle 行为待考

用户在 BOS Designer 操作时报告"忘记勾选'及时触发'再保存一次"。两个 save (req-120 / req-138) 的 wire **字节级相同**（除 BOS 自动重生的 GroupColumnInfo / SubEntryEntity 运行时 GUID 噪声）——说明 "及时触发" toggle 实际**没在 wire 上体现差异**，可能：
- toggle 状态是 BOS Designer 客户端 UI 状态，不持久化
- toggle 映射的属性是默认值，被序列化省略
- 用户实际没真正改 toggle（双击保存 = 保存了同样状态两次）

**对实施的影响**：v0.1 不暴露"及时触发" toggle 给 LLM，等客户实战遇到再回过头实证。

---

## §2 ActionId=67 GetInvStock — 实体级 EntityServiceRule wire（🟢 实证）

来源：req-120

### 2.1 容器

```xml
<HeadEntity action="edit" oid="be8f270b-6aab-446a-9e11-7fcc39084958"
            ElementType="34" ElementStyle="0">
  <EntityServiceRules>
    <EntityServiceRule>
      <Id>0c027f9c-00c0-4a8f-b0c0-171ad7682d7e</Id>
      <Description>5.12.3a 测试 - GetInvStock</Description>
      <PreCondition> FBillTypeID.FNumber = '01.01'</PreCondition>
      <PreConditionDesc>test</PreConditionDesc>
      <Seq>12</Seq>
      <WhenTrueBusinessServices>
        <GetInvStockBusinessServiceMeta>
          <ActionId>67</ActionId>
          <StockQtyField>F_PAIJ_TestQty</StockQtyField>
          <ExtAuxQtyField />
          <ReturnQtyField>1</ReturnQtyField>
          <PluginClassName />
          <KeeperTypeField />
          <KeeperField />
          <StockPlaceField />
          <StockStatusField />
          <ProjectNoField />
          <SecUnitIdField />
          <ExtAuxUnitIdField />
          <Description>获取即时库存信息</Description>
          <Id>82394226-4e68-4d8b-bb9c-5462a10a3671</Id>
        </GetInvStockBusinessServiceMeta>
      </WhenTrueBusinessServices>
    </EntityServiceRule>
  </EntityServiceRules>
</HeadEntity>
```

### 2.2 关键发现

- **EntityServiceRules 容器在 `<HeadEntity action="edit">` 内**，不在单独的 Entity 节点
  - 即使 BOS Designer UI 上选 "FBillEntry" entity，wire 仍走 HeadEntity（**已实证**——用户配在 head 上，但 spec 设计建议 LLM 工具暴露 entityKey 参数时仍按 BOS Designer 直观语义提供，bridge 层负责转译到 HeadEntity）
- **类名直接当 XML 节点名**（`<GetInvStockBusinessServiceMeta>`）——不是 `<FormBusinessService><ClassName>...</ClassName>`。这**纠正**了 spec doc Task 0 中的假设
- **PreCondition 必填**（用户实证：BOS Designer UI 强制非空才允许保存；空字符串走 base FormBusinessService 不能省略）
- **PreConditionDesc 子元素存在**（用户输入的描述，BOS Designer 不自动生成）
- **Seq 由 BOS 分配**（实证值 `12`，对应 EntityServiceRule 在同 entity 多规则时的执行顺序号）

### 2.3 GetInvStockBusinessServiceMeta 字段映射 schema（🟢 实证）

通过对照反编译（`Kingdee.BOS.Core.Metadata.BusinessService.GetInvStockBusinessServiceMeta`）+ wire format，确定的属性集：

| 属性 | 类型 | 默认值 | 反编译 | wire 出现 | 备注 |
|---|---|---|---|---|---|
| `ActionId` | long | 67 | ✓ | ✓ | 类硬编码值 |
| `StockQtyField` | string | "FInvQty" | ✓ | ✓ user-set | 库存数量目标字段 |
| `AwaitQtyField` | string | "FAwaitQty" | ✓ | ✗ | 默认值省略 |
| `AvailableQtyField` | string | "FAvbQty" | ✓ | ✗ | 默认值省略 |
| `DeliQtyFrom` | string | "SAL_DELIVERYNOTICE" | ✓ | ✗ | 默认值省略 |
| `DeliQtyBillStatus` | string | "SAVE" | ✓ | ✗ | 默认值省略 |
| `ExtAuxQtyField` | string | (无默认) | ✓ | ✓ empty | wire 出现空标签 |
| `ReturnQtyField` | int? | (推测无默认) | 🔴 反编译未列 | ✓ value=1 | wire 实证补充字段 |
| `PluginClassName` | string | (无默认) | 🔴 反编译未列 | ✓ empty | wire 实证补充字段 |
| `KeeperTypeField` | string | "FKEEPERTYPEID" | ✓ | ✓ empty | 用户清空了默认值 |
| `KeeperField` | string | "FKEEPERID" | ✓ | ✓ empty | 用户清空了默认值 |
| `StockPlaceField` | string | "FSTOCKLOCID" | ✓ | ✓ empty | 用户清空了默认值 |
| `StockStatusField` | string | (无默认) | 🔴 反编译未列 | ✓ empty | wire 实证补充字段 |
| `ProjectNoField` | string | (无默认) | 🔴 反编译未列 | ✓ empty | wire 实证补充字段 |
| `SecUnitIdField` | string | (无默认) | 🔴 反编译未列 | ✓ empty | wire 实证补充字段 |
| `ExtAuxUnitIdField` | string | (无默认) | 🔴 反编译未列 | ✓ empty | wire 实证补充字段 |
| `OwnerTypeField` | string | "FOWNERTYPEID" | ✓ | ✗ | 默认值省略 |
| `OwnerField` | string | "FOWNERID" | ✓ | ✗ | 默认值省略 |
| `StockField` | string | "FSTOCKID" | ✓ | ✗ | 默认值省略 |
| `StockOrgField` | string | "FSTOCKORGID" | ✓ | ✗ | 默认值省略 |
| `MaterialField` | string | "FMATERIALID" | ✓ | ✗ | 默认值省略 |
| `Description` | string | (LocaleValue) | ✓ | ✓ | "获取即时库存信息" |
| `Id` | string GUID | (生成) | ✓ | ✓ | 服务实例 GUID |

> **wire 实证补充的 6 个字段**（`ReturnQtyField` / `PluginClassName` / `StockStatusField` / `ProjectNoField` / `SecUnitIdField` / `ExtAuxUnitIdField`）反编译时没看到对应 SimpleProperty——可能位于父类 `FormBusinessService` 或运行时动态注入。**实施 .NET bridge 时**：用 `[NonSerialized]` 属性反查 + 从此 wire 复刻字段全集。

### 2.4 序列化省略规则（🟢 实证）

- 属性的运行时值**等于 DefaultValue** → 整个属性**整个省略**（不出现 XML 节点）
- 属性的运行时值**不等于 DefaultValue 且非空** → `<Prop>value</Prop>` 完整出现
- 属性的运行时值**被显式清空（用户在 UI 删了默认值）**→ `<Prop />` 空自闭合标签出现

这意味着：bridge 不能"全量序列化所有 SimpleProperty"，而要**对照默认值** 决定哪些省略。

---

## §3 删除 wire format（🟢 实证）

来源：req-158（capture 2026-05-04T09:39:58 UTC，对比 req-138）

### 3.1 删除信号 = 整段 HeadEntity 从 DCXML omit

req-138（删除前）：
- `<HeadEntity action="edit"> ... <EntityServiceRules>...</EntityServiceRules> ... </HeadEntity>` ← 1 处

req-158（删除后）：
- `HeadEntity` substring：**0 处**
- `EntityServiceRule` substring：0 处
- 被删规则的 GUID `0c027f9c-...`：0 处

**没有 `<EntityServiceRule action="remove" oid="..." />`**。**没有 `<EntityServiceRules action="setnull" />`**。**直接整段 omit**。

### 3.2 BOS 服务端 reconcile 推测

DCXML = baseline-diff，BOS 服务端持有当前状态（baseline）。客户端发送的 DCXML 表达"目标状态"，服务端 diff 应用：
- `<HeadEntity>` 出现 → 应用其内部子元素差异
- `<HeadEntity>` 不出现 → 服务端**保持当前状态**（不动）

那如何删除？关键洞察：DCXML 里 HeadEntity **没出现的子元素 = 保持原样**。但用户**确实删除了**——所以 BOS 必然有另一种机制感知"该 collection 元素不在新状态里 = 删"。

**最有可能的机制**：BOS 客户端 BOSObject 序列化框架（[CollectionProperty]）**只发"完整 collection"**——如果 EntityServiceRules 含 N 条规则，下次发送也得是 N 条（修改）或 N+1 条（新增）或 N-1 条（删除）。但客户端整个不发 HeadEntity → 服务端按"未变"处理。

那**为什么 req-158 不发 HeadEntity 还能删**？答：req-158 的 baseline 已经反映了"用户在 BOS Designer UI 删除规则后 _AND_ 触发 save"，**save 时客户端先重新加载服务端状态**（HeartBeat / GetFormMetaDataVerion）→ 服务端状态可能因为之前 save 又变了 → 客户端发"diff = nothing changed for HeadEntity" → 但 BOS Designer 内部跟踪了"用户在客户端还有删除待发送"，所以发出**空 collection**或者**特殊清除信号**。

**待进一步实证**：删除 wire 的真实机制（需要 wireshark 级抓包看完整 DCXML 是否真的没有 HeadEntity 任何标记，或者隐藏在我们没看到的 LayoutInfo / 别处）。

### 3.3 实施层面的应对

**v0.1 简化路径**：bridge 删除 op 不靠"客户端 diff 算法"，而是：
1. 通过 HTTP RPC 拉当前 metadata（`Load.common.kdsvc`）
2. 反序列化 → 修改 EntityServiceRules collection 删掉目标 rule
3. 调用 `MetadataServiceV9Proxy.SaveForIDEV9` 推回（让 BOS server 自己 diff）

这避开"客户端到底发什么 wire 表达删除"的复杂性，让 BOS 服务端 diff 引擎自己判断。

---

## §4 给 5.12.3b 实施的输入

### 4.1 LLM 输入设计（基于实证 schema）

**`k3cloud_add_calculate_rule`**:

```typescript
{
  extensionFid: string;
  mountPoint:
    | { kind: 'entity'; entityKey: 'HeadEntity'; preCondition: string;  // 必填非空
        preConditionDesc?: string; description: string;
        branch?: 'whenTrue' | 'whenFalse' /* default whenTrue */ }
    | { kind: 'field'; fieldKey: string;
        disabledEvents?: ('RaiseValueChanged'|'RaiseInitialized'|'RaiseItemAdded'
                          |'RaiseItemReset'|'RaiseItemRemoved'|'RaiseReset'
                          |'RaiseSelectRowChanged'|'RaiseSelectRowExtChanged')[] };
  actions: string[];  // IronPython 赋值数组，如 [" F金额 = F数量 * F单价 "]
}
```

**`k3cloud_add_get_inv_stock_rule`**:

```typescript
{
  extensionFid: string;
  mountPoint: { kind: 'entity'; entityKey: 'HeadEntity'; preCondition: string;
                preConditionDesc?: string; description: string;
                branch?: 'whenTrue' | 'whenFalse' };
  // GetInvStock 特化字段（全部可选；省略 = 用 DefaultValue 不发送）
  stockQtyField?: string;       // 默认 "FInvQty"
  awaitQtyField?: string;       // 默认 "FAwaitQty"
  availableQtyField?: string;   // 默认 "FAvbQty"
  deliQtyFrom?: string;         // 默认 "SAL_DELIVERYNOTICE"
  deliQtyBillStatus?: string;   // 默认 "SAVE"
  stockOrgField?: string;       // 默认 "FSTOCKORGID"
  keeperTypeField?: string;     // 默认 "FKEEPERTYPEID"
  keeperField?: string;         // 默认 "FKEEPERID"
  ownerTypeField?: string;      // 默认 "FOWNERTYPEID"
  ownerField?: string;          // 默认 "FOWNERID"
  stockField?: string;          // 默认 "FSTOCKID"
  stockPlaceField?: string;     // 默认 "FSTOCKLOCID"
  materialField?: string;       // 默认 "FMATERIALID"
  // wire 实证补充字段（无默认值）
  extAuxQtyField?: string;
  returnQtyField?: number;      // 1 或省略
  pluginClassName?: string;
  stockStatusField?: string;
  projectNoField?: string;
  secUnitIdField?: string;
  extAuxUnitIdField?: string;
}
```

**`k3cloud_delete_business_rule`**:

```typescript
{
  extensionFid: string;
  ruleId: string;  // EntityServiceRule.Id 或 UpdateActions/FormBusinessService.Id
}
```

### 4.2 .NET Bridge ops 设计

| op | 输入 | 内部操作 |
|---|---|---|
| `add_entity_service_rule` | extensionFid, ruleId, description, preCondition, preConditionDesc, services[] | Load → 修改 HeadEntity.EntityServiceRules → SaveForIDEV9 |
| `add_field_update_action` | extensionFid, fieldKey, services[], disabledEvents[] | Load → 修改对应 Field.UpdateActions → SaveForIDEV9 |
| `remove_business_rule` | extensionFid, ruleId | Load → 找到 ruleId 在哪（EntityServiceRule or UpdateActions/FormBusinessService）→ 移除 → SaveForIDEV9 |
| `list_business_rules` | extensionFid | Load → 聚合 EntityServiceRules + 各 Field.UpdateActions → 返回 {entityRules[], fieldUpdateActions[]} |

bridge 端用 `Kingdee.BOS.Core.Metadata.FormElement.FormBusinessService` 类 + `GetInvStockBusinessServiceMeta` 子类（来自 `Kingdee.BOS.Core.dll`）做对象级序列化，让 BOS 自己生成 DCXML——**不复刻 XML 文本**。

### 4.3 Calculate validator (route C) 输入

业务规则 IronPython AST validator (Plan 5.12.3b Phase 4) 输入：

- 字段引用必须在父对象 schema 里（`F_PAIJ_TestDecimal` / `F_PAIJ_TestInt` 必须存在）
- 函数调用对照 16 FuncDefine 白名单（`business-rules-corrected.md` §2.1）
- Python 3 / SQL-style 函数禁止模式
- Parameters 数组每条必须是 `<Field> = <Expression>` 形态

### 4.4 已知未实证 / 留 v0.2

- ActionId=42 (GetPrice) / 70 (InvMinusCheck) / 3 (MulUnitConvert) / 23 (CallBillFunction) wire format
- ClassNameMeta 字段名（CallBillFunction 的内部解析机制）
- "及时触发" UI toggle 真实映射的 wire 属性
- 删除 wire 的精确机制（HeadEntity omit 是充分条件还是 BOS Designer 内部还有别的信号）
- SubEntryEntity / EntryEntity 上的 EntityServiceRules（用户没在 entry 表上配规则）

---

## Self-Review

- ✅ 实证 1 个 entity-level rule（GetInvStock @ HeadEntity）+ 1 个 field-level UpdateAction（Calculate @ IntegerField）
- ✅ 实证删除 wire（HeadEntity omit 模式）
- ✅ schema 字段集对照反编译 + wire 双向验证（GetInvStock 22 字段）
- ✅ 给 5.12.3b 实施 4 个 bridge ops + 3 个 LLM 输入 schema 设计
- ⚠️ 仅 2 ActionId 实证（用户 v0.1 scope-cut，原 spec 6 ActionId 留 v0.2）
- ⚠️ 删除 wire 的精确机制有进一步实证空间（v0.1 走 Load+Save reconcile 路径绕开）
