<!-- 来源:open.kingdee.com 二开规范 + help.open.kingdee.com dokuwiki;实证状态:🟡 主流程;非客户环境实测 -->
# K/3 Cloud DLL 插件 6 种类型深入版

> 本文是 `bos-features-index` 中 `plugin-types.md`(浅版)的深入版。浅版只列基类和场景,本文列每种插件的**事件方法签名 / 触发顺序 / 事件参数类 / 注册到哪个元数据节点**。

**约定**:所有事件都是基类的 `virtual` 方法,子类 `override` 使用;事件参数类名省略命名空间时默认在 `Kingdee.BOS.Core.<类别>.PlugIn.Args`。

---

## 1. 业务单据插件 `AbstractBillPlugIn`

<!-- 来源:https://open.kingdee.com/k3cloud/SDK/CreateBillPlugIn.html;fetched 2026-04-23 -->

- **完整命名空间**:`Kingdee.BOS.Core.Bill.PlugIn.AbstractBillPlugIn`
- **执行端**:客户端(winform + web)
- **注册元数据节点**:`<FormPlugins>` → `<PlugIn>` 下,`<ClassName>` 填完整类型名
- **Python 插件本质上注册到同一节点**,只是多一个 `<PlugInType>1</PlugInType>` 标记

### 关键事件(触发顺序)

| 顺序 | 事件方法 | EventArgs 类 | 用途 |
|---|---|---|---|
| 1 | `OnBillInitialize` | `EventArgs` | 单据初始化——可读系统参数、配置 |
| 2 | `PreOpenForm` | `PreOpenFormEventArgs`(`e.Cancel = true` 可取消打开) | 表单打开前 |
| 3 | `AfterBindData` | `EventArgs` | 数据绑定后——初始化 UI、设默认值 |
| — | `DataChanged` | `DataChangedEventArgs` | 字段值变化(**最常用,做联动**) |
| — | `BeforeUpdateValue` | `BeforeUpdateValueEventArgs`(可 Cancel) | 字段更新前校验 |
| — | `BeforeF7Select` | `BeforeF7SelectEventArgs` | F7 弹选基础资料前——设过滤 |
| — | `ButtonClick` | `ButtonClickEventArgs` | 自定义按钮点击 |
| — | `BeforeSave` | `BeforeSaveEventArgs`(可 Cancel) | 保存前客户端校验 |
| — | `AfterSave` | `AfterSaveEventArgs` | 保存后 |
| — | `BeforeSubmit` / `AfterSubmit` | `SubmitEventArgs` | 提交前后 |
| — | `BeforeSetStatus` / `AfterSetStatus` | `SetStatusEventArgs` | 状态变更前后 |
| — | `EntryBarItemClick` | `BarItemClickEventArgs` | 子表工具栏按钮 |
| — | `SaveBillFailed` | `SaveBillFailedEventArgs` | 保存失败 |

### 何时挂哪个事件

- **字段联动**(A 变 B 跟着变)→ `DataChanged`
- **客户端校验**(不需要查 DB)→ `BeforeSave` 或 `BeforeUpdateValue`
- **默认值 / UI 控制**(按条件隐藏按钮等)→ `AfterBindData`
- **过滤 F7 列表**(只能选客户 X 的)→ `BeforeF7Select`

> **注意**:此类插件的所有事件 Python 也能做——BOS Designer 把 Python 脚本包装成同一套事件 dispatch。需要 DLL 的场景在下面 2-6 号。

---

## 2. 操作服务插件 `AbstractOperationServicePlugIn` ⭐

<!-- 来源:https://open.kingdee.com/K3Cloud/SDK/CreateOperationServicePlugIn.html;fetched 2026-04-23 -->

- **完整命名空间**:`Kingdee.BOS.Core.DynamicForm.PlugIn.AbstractOperationServicePlugIn`
- **执行端**:**服务端**(IIS / AppServer)
- **注册元数据节点**:`<OperationServicePlugins>` → `<OperationServicePlugin>` 下,绑定到**特定操作**(Save / Submit / Audit / UnAudit / Delete 等)
- **这是 DLL 最常用的场景**——Python 做不了

### 关键事件(触发顺序)

| 顺序 | 事件方法 | EventArgs 类 | 用途 |
|---|---|---|---|
| 1 | `OnPreparePropertys` | `PreparePropertysEventArgs`(`e.FieldKeys` 集合) | 声明本次操作需要从 DB 加载哪些字段到内存 |
| 2 | `OnAddValidators` | `AddValidatorsEventArgs`(`e.Validators` 集合) | 注册自定义校验器(继承 `AbstractValidator`) |
| 3 | `BeginOperationTransaction` | `BeginOperationTransactionArgs` | 事务开始前、校验完成后 |
| 4 | `BeforeExecuteOperationTransaction` | `BeforeExecuteOperationTransactionArgs`(`e.SelectedRows` / `e.DataEntitys`) | **事务内、实际执行前**——最常用的拦截点 |
| 5 | *(框架执行审核 / 反审核 / 删除等核心逻辑)* | — | — |
| 6 | `EndOperationTransaction` | `EndOperationTransactionArgs`(`e.DataEntitys`) | **事务内、核心逻辑执行后**——可更新关联表 |
| 7 | *(事务提交)* | — | — |
| 8 | `AfterExecuteOperationTransaction` | `AfterExecuteOperationTransactionArgs`(`e.DataEntitys`) | 事务提交后回调——适合发通知、写日志 |

### 反审核拦截<!-- BeforeCancelData 事件签名待反编译核实 -->

> 反审核(UnAudit 操作)在 K/3 Cloud 底层通过**同一套** `AbstractOperationServicePlugIn` 事件体系实现,而**不是**独立的 `BeforeCancelData` / `AfterCancelData` 事件。拦截反审核的标准姿势是挂 `BeforeExecuteOperationTransaction`,在里面判断当前操作是否为 `UnAudit`(`this.BusinessInfo.GetForm().Id` + `this.OperationName` 联合判断)然后 `AddError` 阻断。
>
> 网上流传的 `BeforeCancelData` / `AfterCancelData` 事件签名可能来自其他金蝶产品(EAS / K/3 WISE)或早期版本,K/3 Cloud 当前版本**未证实存在这两个事件**。<!-- 待用户实证 -->

### 如何阻断操作

`AbstractOperationServicePlugIn` **没有** `e.Cancel` 属性。阻断姿势是**通过校验器报错**:

```csharp
// 在自定义 Validator 的 Validate 方法内
validateContext.AddError(
  dataEntity,
  new ValidationErrorInfo(
    "",                     // fieldKey 空字符串——整行错
    pkValue,                // 主键
    rowIndex,
    0,                      // errorLevel 0
    "errCode",              // 自定义错误编码
    "错误标题",
    "具体错误消息"));
```

`AddError` 被调用后,框架自动中止当前行的后续事件,并把错误推到前端提示。

> `AfterExecuteOperationTransaction` 内想阻断**已经来不及**——事务已提交。想阻断必须在 `BeforeExecuteOperationTransaction` 或校验器里。

### 注册到元数据

```xml
<!-- FKERNELXML 中 -->
<OperationServicePlugins>
  <OperationServicePlugin OperationName="Audit">
    <PlugIn>
      <ClassName>ABC.SAL.SaleOrderAuditOp</ClassName>
      <AssemblyName>ABC.SAL.BusinessPlugIn</AssemblyName>
    </PlugIn>
  </OperationServicePlugin>
</OperationServicePlugins>
```

`OperationName` 常见值:`Save` / `Submit` / `Audit` / `UnAudit` / `Delete` / `Close` / `UnClose` / `Invalid` / 自定义操作 Key。

---

## 3. 单据转换插件 `AbstractConvertPlugIn`

<!-- 来源:https://open.kingdee.com/K3cloud/SDK/CreateConvertPlugin.html;fetched 2026-04-23 -->

- **完整命名空间**:`Kingdee.BOS.Core.Metadata.ConvertElement.PlugIn.AbstractConvertPlugIn`
- **执行端**:服务端
- **注册元数据节点**:`<ConvertPlugins>`——挂在**转换规则**(BOS Designer 里的"转换规则")上,不是挂在单据上

### 关键事件(触发顺序)

| 顺序 | 事件方法 | 用途 |
|---|---|---|
| 1 | `OnInitVariable` | 初始化业务信息和变量 |
| 2 | `OnBeforeGetSourceData` | 获取源单数据前——可改 SQL |
| 3 | `OnGetSourceData` | 执行 SQL 获取源数据 |
| 4 | `OnGetDrawSourceData` | 界面选择下推时获取数据 |
| 5 | `OnBeforeGroupBy` | 分组前——可改分组策略 |
| 6 | `OnBeforeFieldMapping` | 字段映射前 |
| 7 | `OnFieldMapping` | 字段映射中——可改映射值 |
| 8 | `OnAfterFieldMapping` | 字段映射后(**最常用**)——复杂映射逻辑 |
| 9 | `OnCreateLink` | 建立源单-目标单关联 |
| 10 | `OnAfterCreateLink` | 关联建立后 |
| 11 | `OnParseFilter` / `OnParseFilterOptions` | 筛选条件解析 |
| 12 | `AfterConvert` | 转换全部完成后 |

### 何时挂哪个事件

- **字段复杂映射**(源 A * 汇率 → 目标 B)→ `OnAfterFieldMapping`
- **下推前跨表校验**(库存不足不让下推)→ `OnBeforeGetSourceData` 或 `OnInitVariable`
- **自定义分组**(按供应商 + 币别合并行)→ `OnBeforeGroupBy`
- **改 SQL**(加自定义过滤)→ `OnGetSourceData`

---

## 4. 打印控件插件 `AbstractPrintControlPlugIn`

<!-- 基类名和签名待反编译核实。以下基于文档引用的通用模式 -->

- **完整命名空间**<!-- 签名待反编译核实 -->:`Kingdee.BOS.Core.Print.PlugIn.AbstractPrintControlPlugIn` <!-- 待用户实证 -->
- **执行端**:服务端(报表数据组装在服务端,渲染在客户端)
- **注册元数据节点**:`<PrintPlugins>` <!-- 节点名待用户实证 -->

### 关键事件<!-- 事件列表待反编译核实 -->

| 事件方法 | 用途 |
|---|---|
| `OnDataLoadComplete` <!-- 签名待核实 --> | 打印数据加载完成——可改数据源行 |
| `OnPreparePrintData` <!-- 签名待核实 --> | 准备打印数据前 |
| `OnGetTemplate` <!-- 签名待核实 --> | 动态选择打印模板 |

> ⚠️ 打印插件的基类 / 事件签名在金蝶开放平台文档里**没有独立的 SDK 页**——网上大量资料是从 DLL 反编译或社区经验来的。本 skill 不编造签名,如果 agent 需要写代码请:
> 1. 先让用户在 BOS Designer 里找到"打印模板"→"插件"按钮,看标准产品 / ISV 示例插件引用了哪个基类
> 2. 或用 ILSpy 反编译 `WebSite\Bin\Kingdee.BOS.Core.dll` 查 `Kingdee.BOS.Core.Print.PlugIn` 命名空间
> 3. 本产品确认:v0.1 不代替开发者写打印插件代码

---

## 5. 列表插件 `AbstractListPlugIn`

<!-- 来源:https://open.kingdee.com/K3Cloud/Open/About/OperationsGuide/ListPlugin.html + open.kingdee.com SDK;fetched 2026-04-23 -->

- **完整命名空间**<!-- 待反编译核实 -->:`Kingdee.BOS.Core.List.PlugIn.AbstractListPlugIn` <!-- 待用户实证 -->
- **执行端**:客户端(列表界面)
- **注册元数据节点**:`<ListPlugins>` <!-- 节点名待用户实证 -->

### 关键事件

| 事件方法 | 用途 |
|---|---|
| `OnLoad` | 列表加载——可调行高、列宽 |
| `PrepareFilterParameter` | 过滤条件准备——可追加 WHERE |
| `OnFormatRowConditions` | 格式化行——可改颜色 / 字体 |
| `ButtonClick` | 自定义按钮点击 |
| `BeforeToolBarItemClick` | 工具栏按钮前(可 Cancel) |

### 列表 API

- `this.ListModel.GetData(listcoll)` — 取选中行完整数据
- `listcoll.GetPrimaryKeyValues()` — 取主键列表
- `listcoll.GetEntryPrimaryKeyValues()` — 取子表条目主键

---

## 6. 报表插件 `SysReportBaseService` / `AbstractReportPlugIn`

<!-- 来源:https://open.kingdee.com/K3cloud/SDK/CreateReportSourcePlugIn.html;fetched 2026-04-23 -->

报表插件有**两种**:

### 6a. 报表数据源插件(取数)

- **基类**:`Kingdee.BOS.Contracts.Report.SysReportBaseService`
- **用途**:自定义 SQL / 临时表 / 动态列构造报表数据

**关键方法**:

| 方法 | 用途 |
|---|---|
| `Initialize()` | 配置报表属性(名称、是否汇总) |
| `BuilderReportSqlAndTempTable(IRptParams filter, string tableName)` | 构建 SQL + 填充临时表(**最核心**) |
| `GetReportHeaders(IRptParams filter)` | 动态列头 |
| `GetReportTitles(IRptParams filter)` | 报表标题 |
| `GetSummaryColumnInfo()` | 汇总列定义 |

### 6b. 报表插件(UI 层)

- **基类**<!-- 待反编译核实 -->:`Kingdee.BOS.Core.Report.PlugIn.AbstractReportPlugIn` <!-- 待用户实证 -->
- **用途**:报表界面的按钮事件、双击钻取

> 6a 和 6b 职责不同:6a 管取数(服务端),6b 管展示(客户端)。同一报表可同时注册两个。

---

## 各插件类型元数据节点速查

| 插件类型 | 注册节点(在 `FKERNELXML` 里) | 挂在哪里 |
|---|---|---|
| 业务单据插件 | `<FormPlugins>` → `<PlugIn>` | 单据 / 扩展 |
| 操作服务插件 | `<OperationServicePlugins>` → `<OperationServicePlugin>` | 单据 + 操作 |
| 转换插件 | `<ConvertPlugins>` → `<ConvertPlugin>` | 转换规则 |
| 打印插件 | `<PrintPlugins>` <!-- 待核实 --> | 打印模板 |
| 列表插件 | `<ListPlugins>` <!-- 待核实 --> | 列表 |
| 报表数据源 | 报表元数据 `<SysReportService>` <!-- 待核实 --> | 报表 |

---

## 临时话术(agent 引用)

> 你的需求属于【xxx】场景,对应 K/3 Cloud 的 **【插件类型】**,需要继承 `【完整基类名】`。核心事件是 `【事件方法】`——这个事件在 【触发时机】 触发,你可以在里面 【做的事】。
>
> 注册元数据:需要把插件写入到单据 / 扩展的 `FKERNELXML` 的 `<【节点名】>` 节点。OpenDeploy v0.1 **不自动化 DLL 注册**,代码由开发者用 Visual Studio 写,元数据也需要开发者手动改。
>
> 如需决策要不要走 DLL(vs Python),见 `python-vs-dll.md`;如需 VS 工程搭建细节,见 `development-setup.md`。
