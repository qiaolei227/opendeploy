---
name: operations-decompiled
title: BOS 操作/按钮 — 反编译 + DB 实证
description: FormOperation 完整属性模型、内置 OperationId 目录、Plugin 绑定形态、BarButtonItem 与 FormOperation 的关联关系、FKERNELXML 节点形态实证。为 k3cloud_add_custom_operation / _list_operations / _delete_operation 工具提供工程蓝图。
---

<!-- fetched: 2026-04-25, source: Kingdee.BOS.Core.decompiled.cs line 52189 + DB AIS20260302144343 SAL_SaleOrder / extension a4ad49d2 -->

# BOS 操作/按钮的完整工程模型

---

## 1. FormOperation 属性模型（完整）

**来源** 🟢：`Kingdee.BOS.Core.Metadata.FormElement.FormOperation` 反编译，line 52189。

```csharp
[Serializable]
[DataEntityType]
public class FormOperation : IInheritProperty, IKingdeeProperty
{
    // --- 身份 ---
    [SimpleProperty(true)]       string  Id           // 序列化时若 AbstractElement._bUpdateIdToKey=true 则等于 Operation
    [SimpleProperty]             string  Operation    // 操作 Key（字符串，如 "HideSonItem"/"Save"/"Submit"）
    [SimpleProperty]             long    OperationId  // 内置类型枚举值；自定义操作固定写 45（DoNothing）
    [SimpleProperty]             LocaleValue OperationName  // 显示名称（多语言 LocaleValue）

    // --- 参数 ---
    [ComplexProperty]            OperationParameter Parmeter   // 操作参数，含 ExpressValue（如 "IsShowMes:0;IsForbidWFService:0"）

    // --- 校验 ---
    [CollectionProperty]         List<AbstractValidation> Validations  // 前置校验列表

    // --- 提示文本 ---
    [SimpleProperty]             LocaleValue BeforeOpAlterInfo  // 执行前提示
    [SimpleProperty]             LocaleValue AfterOpAlterInfo   // 执行后提示
    [SimpleProperty]             LocaleValue AfterOpFailedInfo  // 失败提示

    // --- 权限 ---
    [SimpleProperty][DefaultValue("")]  string PermissionItemId  // 权限功能项 ID

    // --- 服务实现 ---
    [CollectionProperty]         List<PlugIn> ServicePlugins   // 操作服务插件（DLL 实现）
    string ServiceClass          // 服务类全限定名（自定义操作通常为空，走 Python FormPlugin 的 AfterDoOperation）
    string ServiceDesignerClass  // 设计器辅助类

    // --- 业务服务 ---
    [CollectionProperty]         List<FormBusinessService> AppBusinessService

    // --- 行为 ---
    [SimpleProperty][DefaultValue(true)]   bool WriteOperateLog    // 是否写操作日志
    [SimpleProperty][DefaultValue(false)]  bool ShowAffectInfo     // 是否显示影响范围
    [SimpleProperty][DefaultValue(false)]  bool IsConfirm          // 执行前是否弹确认框
    string ConfirmInfo           // 确认框文本
    string OperEleIds            // 关联元素 ID
    [SimpleProperty][DefaultValue("null")] string LoadKeys         // 操作后需重载的字段 Key 列表（JSON 数组字符串）

    // --- 继承标记 ---
    bool IsInheritElement
    bool IsKingdeeElement
}
```

**序列化注意**：
- `Parmeter`（非 `Parameter`，K/3 Cloud 的拼写 bug，已固化）子节点为 `<OperationParameter>`
- `BeforeOpAlterInfo` / `AfterOpAlterInfo` 为空时写 `<BeforeOpAlterInfo/>` 占位
- `AfterOpFailedInfo` 为空时写 `action="setnull"` 属性，如 `<AfterOpFailedInfo action="setnull"/>`
- `LoadKeys` 默认写 `[]`（空 JSON 数组字符串）

---

## 2. AbstractFormOperation vs AbstractBillOperation

**来源** 🟢：反编译 line 195323 / 279457。

| 维度 | AbstractFormOperation | AbstractBillOperation |
|---|---|---|
| 继承链 | → `IFormOperation` | → `AbstractFormOperation` → `IFormOperation` |
| 适用视图 | 泛表单（含列表视图 `IListView`） | **单据视图（`IBillView`）**，`BillView` / `ListView` 属性方便访问 |
| `ExecuteOperation()` | abstract（子类实现） | 默认 `return true`（空实现），子类按需 override |
| 主要辅助属性 | `View`、`SelectedRows`、`SelectedIDs`（deprecated）| 额外暴露 `BillView`、`ListView` |
| `GetPermissionItemId()` | 不含 | 含：NEW/VIEW/EDIT 三态返回不同权限 ItemId |
| DLL 插件开发选择 | 用于通用操作插件 | 用于标准单据操作插件（更常用）|

**AbstractDynamicFormOperation**（line 196048）：`AbstractFormOperation` + `IInteractiveOperation`，增加了 `DoInteraction` / `DoSimpleInteraction` / `DoComplextInteraction` 等交互方法，适合需要弹确认框 / 二次交互的操作。

**结论**（对 `k3cloud_add_custom_operation` 工具的影响）：自定义操作元数据不需要选服务类；Python 插件通过 `AfterDoOperation(e)` 中判断 `e.Operation.Operation == "MyKey"` 响应操作，无需给 `<ServiceClass>` 赋值。

---

## 3. 内置 Operation 类型目录（OperationId 完整表）

**来源** 🟢：`FormOperation` 静态构造函数，反编译 line 53143-53300。

| OperationId | Operation 常量名 | 说明 |
|---|---|---|
| 1 | Audit | 审核 |
| 2 | Copy | 复制 |
| 3 | Delete | 删除 |
| 4 | DeleteEntry | 删除分录 |
| 5 | Edit | 修改 |
| 6 | New | 新增 |
| 7 | NewEntry | 新增分录 |
| 8 | Save | 保存 |
| 9 | Submit | 提交 |
| 10 | View | 查看 |
| 11 | Print | 打印 |
| 12 | ConvertDraw | 转换（引入） |
| 13 | First | 首条 |
| 14 | Previous | 上一条 |
| 15 | Next | 下一条 |
| 16 | Last | 末条 |
| 17 | ConvertPush | 转换（下推） |
| 18 | Close | 关闭窗口 |
| 19 | InsertEntry | 插入分录 |
| 20 | Disable | 禁用 |
| 21 | Enable | 反禁用 |
| 22 | ImportEntry | 导入分录 |
| 26 | UnAudit | 反审核 |
| 27 | ShowFlowChart | 显示流程图 |
| 28 | ShowApproveResult | 显示审批结果 |
| 29 | Refresh | 刷新 |
| 30 | Export | 导出 |
| 31 | CopyEntryRow | 复制分录行 |
| 32 | CopyEntryColumn | 复制分录列 |
| 33 | RelateBill | 关联单据 |
| 34 | ReturnData | 返回数据 |
| 35 | Filter | 过滤 |
| 36 | Allocate | 分配 |
| 37 | Share | 共享 |
| 38 | StatusConvert | 状态转换 |
| 39 | CancelAllocate | 取消分配 |
| 40 | Draft | 暂存 |
| 41 | FirstEntry | 分录首行 |
| 42 | PreviousEntry | 分录上一行 |
| 43 | NextEntry | 分录下一行 |
| 44 | LastEntry | 分录末行 |
| **45** | **DoNothing** | **自定义操作用此值** — 不触发内置系统服务 |
| 46 | WizardIssue | 向导下达 |
| 47 | WizardCancelIssue | 向导取消下达 |
| 48 | PrintPreview | 打印预览 |
| 52 | Push | 下推 |
| 53 | Draw | 引入 |
| 60 | Issue | 下达 |
| 61 | CancelIssue | 取消下达 |
| 62 | AttachmentMgr | 附件管理 |
| 64 | ExportData | 导出数据 |
| 65 | ImportData | 导入数据 |
| 66 | Track | 追踪 |
| 300 | PrintMergeAll | 合并打印全部 |
| 310 | PrintSelect | 选择打印 |
| 400 | LangTextTranslate | 多语言翻译 |
| 777 | AutoAllocate | 自动分配 |
| 1200 | YunZhiJiaCosmic | 云之家协同 |
| 34134 | AbortProcInst | 终止流程实例 |
| 34136 | VisualIdentity | 可视化标识 |
| ... | 其余略 | 参见反编译 line 53143-53300 |

**关键结论**：BOS 扩展对象上用户自定义的操作（按钮）**统一使用 `OperationId=45`（DoNothing）**。这个值告诉运行时"不要执行任何系统内置服务，只触发插件事件"。

---

## 4. Plugin 绑定形态

**来源** 🟢：DB 实证，SAL_SaleOrder FKERNELXML `<FormPlugins>` 节点，含 Python 实例。

### 4.1 FormPlugins（表单生命周期插件）绑定操作

Python 插件在 `<FormPlugins>` 中注册，通过 `AfterDoOperation(e)` 事件响应按钮点击。操作 Key 通过 `e.Operation.Operation` 取得：

```xml
<!-- 在 <Form> 元素的 <FormPlugins> 内 -->
<PlugIn ElementType="0" ElementStyle="0">
  <ClassName>我的按钮插件(通用)</ClassName>
  <PlugInType>1</PlugInType>          <!-- 1 = Python；0 或缺省 = DLL -->
  <PyScript>
def AfterDoOperation(e):
    if e.Operation.Operation == "HideSonItem":
        this.View.GetControl("FSaleOrderEntry").SetFilterString("FROWTYPE in ('标准产品','非标准品','服务','')")
    if e.Operation.Operation == "ShowSonItem":
        this.View.GetControl("FSaleOrderEntry").SetFilterString("")
  </PyScript>
  <OrderId>16</OrderId>
</PlugIn>
```

**关键点**：
- `FormPlugins` 插件的 `AfterDoOperation` 对**该表单上所有操作**都会触发，需要用 `if e.Operation.Operation == "MyKey"` 过滤
- 同一 Python 插件可以处理多个操作，无需为每个操作单独注册插件
- `PlugInType=1` 表示 Python 插件（DLL 插件省略此元素或写 `0`）

### 4.2 ServicePlugins（操作服务插件）

`<FormOperation>` 元素内的 `<ServicePlugins>` 用于 DLL 服务插件（不适用于 Python 场景）：

```xml
<FormOperation>
  <Id>Delete</Id>
  <ServicePlugins>
    <PlugIn ElementType="0" ElementStyle="0">
      <ClassName>Kingdee.K3.SCM.App.Sal.ServicePlugIn.SaleOrder.Delete, Kingdee.K3.SCM.App.Sal.ServicePlugIn</ClassName>
      <OrderId>1</OrderId>
    </PlugIn>
  </ServicePlugins>
</FormOperation>
```

**结论**：v0.1 只需处理 `<FormPlugins>` 中的 Python 插件（已有工具支持）。`<ServicePlugins>` 是 DLL 插件的领域，`k3cloud_add_custom_operation` 不需要写入 `<ServicePlugins>`。

---

## 5. Toolbar / BarItem 关系（按钮 vs 操作）

**来源** 🟢：DB 实证，SAL_SaleOrder FKERNELXML `<BarItems>` 节点 + 反编译 `BarItem` 类 line 218007。

### 5.1 核心关系

**一个操作（FormOperation）对应一个 BarButtonItem**。两者通过 `ClickActions` 中的 `Parameters` 松耦合：

```
FormOperation.Operation = "HideSonItem"
        ↑
BarButtonItem.ClickActions[0].Parameters[0] = "HideSonItem"   (ActionId=23)
```

- `ActionId=23` = "执行操作（Execute Operation）"，参数数组第一元素是 Operation Key
- **无外键约束**：BarButtonItem 与 FormOperation 之间没有数据库级别的 FK，靠 Key 字符串匹配
- 一个 BarButtonItem 可以对应零个 FormOperation（纯 UI 菜单项），但带逻辑的按钮必须有对应 FormOperation

### 5.2 BarButtonItem 完整属性（实证）

```xml
<BarButtonItem ElementType="2005" ElementStyle="1">
  <ImageKey/>              <!-- 图标 Key，空 = 默认图标 -->
  <Shortcut/>              <!-- 快捷键，空 = 无 -->
  <Enabled>6</Enabled>     <!-- 可见性/可用性 bitmask；默认 -1（继承）；6 = 新增+修改状态可用 -->
  <Seq>20</Seq>            <!-- 在工具栏中的排序序号 -->
  <Description>隐藏子产品</Description>
  <IsShowTitle>True</IsShowTitle>  <!-- 是否在按钮上显示文字 -->
  <ClickActions>
    <FormBusinessService>
      <ConfirmInfo/>        <!-- 点击前确认提示，空 = 不提示 -->
      <Parameters>["HideSonItem"]</Parameters>  <!-- 操作 Key，JSON 数组格式 -->
      <ActionId>23</ActionId>   <!-- 23 = 执行操作 -->
      <Description>设置按钮操作--隐藏子产品</Description>
      <Id>8edb2fe2-8ef1-4d5a-8a41-f9dd8585cf26</Id>  <!-- UUID -->
    </FormBusinessService>
  </ClickActions>
  <Caption>隐藏子产品</Caption>   <!-- 按钮显示名称（多语言 LocaleValue，此处简化） -->
  <Id>4b9f284e48fb4c52bbf894d6196fcf3f</Id>  <!-- BarButtonItem 自身 UUID -->
  <Key>tbHideSonItem</Key>   <!-- 按钮唯一 Key，通常 tb 前缀 -->
</BarButtonItem>
```

### 5.3 BarItem 类的关键属性（反编译）

```csharp
public class BarItem : Appearance {
    // 可见性/可用性 bitmask 常量（用于 Enabled / Visible 字段）
    const int MENUENABLE_VIEW = 1;    // 查看状态可用
    const int MENUENABLE_NEW  = 2;    // 新增状态可用
    const int MENUENABLE_EDIT = 4;    // 修改状态可用
    // 组合：6 = NEW+EDIT，7 = VIEW+NEW+EDIT，-1 = 继承父级（默认）

    [SimpleProperty][DefaultValue(-1)] int Enabled    // 按钮可用性 bitmask
    [SimpleProperty][DefaultValue(-1)] int Visible    // 按钮可见性 bitmask
    [SimpleProperty]                   string ImageKey       // 图标
    [SimpleProperty]                   string Shortcut       // 快捷键
    [SimpleProperty]                   int Seq               // 排序
    [SimpleProperty]                   bool IsShowTitle      // 显示文字
    [SimpleProperty]                   bool IsBeginGroup     // 前面加分隔线
    [SimpleProperty]                   LocaleValue ToolTip
    [SimpleProperty]                   LocaleValue Description
    [CollectionProperty]               List<FormBusinessService> ClickActions
    long OperationId                   // 对应的 FormOperation.OperationId（运行时关联，非 XML 属性）
}
```

### 5.4 BarItemLinks（菜单层级）

`<BarItemLinks>` 定义按钮在下拉菜单中的父子层级关系：

```xml
<BarItemLinks>
  <BarItemLink>
    <Id>4c597061-8ef7-4ec1-b233-014b91b8d21d</Id>
    <BarItemKey>tbQueryCredit</BarItemKey>      <!-- 子按钮 Key -->
    <ParentKey>tbSplitBussinessQuery</ParentKey> <!-- 父按钮（下拉菜单）Key -->
  </BarItemLink>
</BarItemLinks>
```

**结论**：`k3cloud_add_custom_operation` v0.1 写顶层按钮，不需要写 BarItemLinks。

---

## 6. FKERNELXML 节点形态（实证）

**来源** 🟢：DB 实证，SAL_SaleOrder `FID='SAL_SaleOrder'`，DB `AIS20260302144343`，2026-04-25。

### 6.1 完整自定义操作的 FormOperation XML

```xml
<!-- 在 <FormOperations> 内，完整的自定义操作节点 -->
<FormOperation>
  <Id>HideSonItem</Id>
  <Operation>HideSonItem</Operation>
  <BeforeOpAlterInfo/>
  <AfterOpAlterInfo/>
  <AfterOpFailedInfo action="setnull"/>
  <OperationId>45</OperationId>
  <OperationName>隐藏子产品</OperationName>
  <Parmeter>
    <OperationParameter>
      <Id>780597b2-4da9-403d-96c0-03fb6a6e007c</Id>
      <ExpressValue>IsShowMes:0;IsForbidWFService:0</ExpressValue>
    </OperationParameter>
  </Parmeter>
  <PermissionItemId>66d0595c1bcfbf</PermissionItemId>
  <LoadKeys>[]</LoadKeys>
</FormOperation>
```

### 6.2 最简自定义操作（BOS 扩展对象中，agent 最小写入量）

```xml
<FormOperation>
  <Id>MyCustomOp</Id>
  <Operation>MyCustomOp</Operation>
  <BeforeOpAlterInfo/>
  <AfterOpAlterInfo/>
  <AfterOpFailedInfo action="setnull"/>
  <OperationId>45</OperationId>
  <OperationName>我的自定义操作</OperationName>
  <Parmeter>
    <OperationParameter>
      <Id>{{new-uuid}}</Id>
      <ExpressValue>IsShowMes:0;IsForbidWFService:0</ExpressValue>
    </OperationParameter>
  </Parmeter>
  <LoadKeys>[]</LoadKeys>
</FormOperation>
```

### 6.3 对应的 BarButtonItem XML（顶层按钮）

```xml
<BarButtonItem ElementType="2005" ElementStyle="1">
  <ImageKey/>
  <Shortcut/>
  <Seq>{{next-seq}}</Seq>
  <Description>{{caption}}</Description>
  <IsShowTitle>True</IsShowTitle>
  <ClickActions>
    <FormBusinessService>
      <ConfirmInfo/>
      <Parameters>["MyCustomOp"]</Parameters>
      <ActionId>23</ActionId>
      <Description>设置按钮操作--{{caption}}</Description>
      <Id>{{new-uuid}}</Id>
    </FormBusinessService>
  </ClickActions>
  <Caption>{{caption}}</Caption>
  <Id>{{new-uuid}}</Id>
  <Key>tb{{OperationKey}}</Key>
</BarButtonItem>
```

### 6.4 XML 位置关系

```
<FormMetadata>
  <BusinessInfo>
    <BusinessInfo>
      <Elements>
        <Form ...>
          <FormPlugins>          ← Python 表单插件在这里（AfterDoOperation 响应按钮）
          </FormPlugins>
          <FormOperations>       ← 操作定义在这里
            <FormOperation>      ← 每个自定义操作一个节点
          </FormOperations>
        </Form>
      </Elements>
    </BusinessInfo>
  </BusinessInfo>
  <LayoutInfos>
    ...                          ← 字段布局（已有工具处理）
  </LayoutInfos>
  <BarItems>                     ← 工具栏按钮在这里（独立于 BusinessInfo）
    <ToolBar .../>
    <BarButtonItem .../>          ← 每个按钮一个节点（含 ClickActions 指向 Operation Key）
    <BarSeperator .../>           ← 分隔线
  </BarItems>
  <BarItemLinks>                 ← 菜单层级关系（下拉菜单的父子关联）
  </BarItemLinks>
</FormMetadata>
```

**关键发现**：
- `<FormOperations>` 在 `<BusinessInfo>/<Elements>/<Form>` 内
- `<BarItems>` 在 `<FormMetadata>` 根级，与 `<BusinessInfo>` 平级
- 两者完全分离，通过 Operation Key 字符串关联
- BOS 扩展对象的 FKERNELXML 是 **delta**，初始没有 `<FormOperations>` 和 `<BarItems>` 节点，添加操作时需要在 XML 中插入

---

## 7. k3cloud_add_custom_operation / _list / _delete 工具实现路径

### 7.1 `k3cloud_list_operations`

**SQL**：
```sql
DECLARE @xml NVARCHAR(MAX);
SELECT @xml = CONVERT(NVARCHAR(MAX), FKERNELXML) FROM T_META_OBJECTTYPE WHERE FID = @extFid;
-- 提取 <FormOperations> 段，解析每个 <FormOperation> 的 Id / OperationId / OperationName
```

返回字段：`operationKey`、`operationName`、`operationId`（45 = 自定义）、是否有 BarButtonItem。

**parallelSafe**: `true`（只读）

### 7.2 `k3cloud_add_custom_operation`

**步骤**：

1. **backup** — 同现有 `bos-backup.ts` 模式，写 `bos-backups/<timestamp>_add_op_<extFid>.json`
2. **读取当前 FKERNELXML**（`CONVERT(NVARCHAR(MAX), FKERNELXML)`）
3. **操作 XML**：
   a. 若无 `<FormOperations>` 节点，在 `<Form ...>` 关闭标签 `</Form>` 前插入 `<FormOperations>...</FormOperations>`
   b. 若已有 `<FormOperations>`，在 `</FormOperations>` 前追加新的 `<FormOperation>` 节点
   c. 计算 `<Seq>` = 现有 `<BarButtonItem>` 最大 Seq + 10（防冲突留间隔）
   d. 在 `</BarItems>` 前追加新的 `<BarButtonItem>` 节点；若无 `<BarItems>` 则在 `</FormMetadata>` 前插入
4. **UPDATE** `T_META_OBJECTTYPE SET FKERNELXML = @newXml WHERE FID = @extFid`
5. **UPDATE** `T_META_OBJECTTYPE SET FMODIFYDATE = GETDATE()` （触发 BOS 缓存失效）

**必填参数**：`extFid`（扩展对象 FID）、`operationKey`（操作 Key，ASCII，无空格）、`caption`（显示名称）

**可选参数**：`seq`（工具栏排序）、`imageKey`（图标）、`enabled`（bitmask，默认 6=新增+修改状态）

**parallelSafe**: `false`（写操作）

### 7.3 `k3cloud_delete_operation`

**步骤**：

1. **backup**（同上）
2. **读取 XML**
3. 删除 `<FormOperation>` 节点（`<Id>` 等于 `operationKey`）
4. 删除对应 `<BarButtonItem>`（`ClickActions[0].Parameters[0]` 等于 `operationKey`）
5. **UPDATE**

**parallelSafe**: `false`

### 7.4 与 Python 插件的集成流程（完整用户流程）

```
用户: "给销售订单扩展加一个'检查信用额度'按钮，点击时执行信用检查逻辑"

Agent:
  1. k3cloud_add_custom_operation(extFid, "CheckCredit", "检查信用额度")
     → 写 <FormOperation> + <BarButtonItem> 到 FKERNELXML
  2. k3cloud_register_python_plugins("credit_check.py", python_code)
     → 写 Python 源文件到 ~/.opendeploy/projects/<pid>/plugins/
  3. k3cloud_register_python_plugins(extFid, "credit_check", python_code)
     → 在 <FormPlugins> 追加 <PlugIn PlugInType=1> 节点
     （已有工具：bos-write-tools.ts 的 k3cloud_register_python_plugins）
  4. 提示用户：在 BOS Designer 刷新查看新按钮
```

**Python 插件响应操作的模板**：
```python
def AfterDoOperation(e):
    if e.Operation.Operation == "CheckCredit":
        # 信用检查逻辑
        cust_id = this.Model.GetValue("FCustId")
        # ...
```

### 7.5 已有工具集成点

当前 `bos-write-tools.ts`（Plan 5.5）已有 7 个工具：
- `k3cloud_create_extension` — 创建扩展对象（写 8 张表）
- `k3cloud_register_python_plugins` / `k3cloud_register_python_plugins` — 写/更新 Python 表单插件
- `k3cloud_add_fields` — 添加扩展字段
- `k3cloud_list_extensions` / `k3cloud_get_extension_fields` — 只读工具
- `k3cloud_delete_extension` — 整删扩展回滚(RPC 路径无独立 backup 文件)

新的 3 个工具 (`_add_operation` / `_list_operations` / `_delete_operation`) 接入同一个 `bos-xml.ts` + `bos-backup.ts` 基础设施即可。

---

## 实证级别总结

| 节 | 级别 | 依据 |
|---|---|---|
| FormOperation 属性树 | 🟢 | 反编译 Kingdee.BOS.Core.decompiled.cs line 52189-52700 |
| OperationId 目录（完整） | 🟢 | 反编译 static 构造函数 line 53143-53300 |
| DoNothing=45 作为自定义操作ID | 🟢 | 反编译 line 53192 + DB 实证 SAL_SaleOrder HideSonItem/ShowSonItem |
| AbstractBillOperation vs AbstractFormOperation | 🟢 | 反编译 line 195323 / 279457 |
| FormOperation XML 形态 | 🟢 | DB 实证 SAL_SaleOrder FKERNELXML，2026-04-25 |
| BarButtonItem XML 形态 | 🟢 | DB 实证 SAL_SaleOrder BarItems 节点，2026-04-25 |
| BarItems 与 FormOperations 位置关系 | 🟢 | DB 实证 SAL_SaleOrder FKERNELXML 结构分析 |
| ActionId=23 = 执行操作 | 🟢 | DB 实证多条 BarButtonItem.ClickActions |
| Python 插件通过 AfterDoOperation 响应按钮 | 🟢 | DB 实证 SAL_SaleOrder FormPlugins PyScript |
| BarItemLinks 菜单层级结构 | 🟢 | DB 实证 SAL_SaleOrder BarItemLinks 节点 |
| k3cloud_add_custom_operation 工具实现路径 | 🟡 | 基于以上实证推导，未实际运行 |

### 未知/待验证

- `<FormOperations>` 在完全空的扩展 FKERNELXML 中的插入位置是否正确（当前扩展 XML 无此节点，需实测 BOS Designer 生成）
- `<BarItems>` 为空时的最小骨架（现有扩展无 BarItems，第一次插入时需确认 XML 合法性）
- `Enabled` bitmask 在列表视图 vs 单据视图的行为差异
- BOS Designer 刷新对新加操作的缓存处理时机（F5 还是需要重新登录）
