<!--
来源:open.kingdee.com 二开规范 + help.open.kingdee.com dokuwiki + 2026-04-30 反编译 K/3 Cloud 服务端 DLL 全谱实证
实证状态:🟢 全实证(K/3 现有 10 个 Python<X>PlugIn 派生类,本表覆盖其中 5 个核心场景)
-->

# Python 表单插件 vs DLL 插件 决策指南

> agent 在"要不要写 Python"分叉点必读。

---

> **2026-04-30 反编译全谱实证(必读)**
>
> 本文件 Plan 5.8 初版直接照搬"Python 插件不能做服务端"这条普遍误解,导致大半行错。两轮反编译 `Kingdee.BOS.Core.dll` 后,**K/3 服务端 Python 插件能力远比初版以为的广**:
>
> - **`PythonConvertPlugIn : AbstractConvertPlugIn`** — 转换插件,22 个虚方法转发 IronPython
> - **`PythonOperationServicePlugIn : AbstractOperationServicePlugIn`** — 操作插件(审核/反审核/删除/提交全部覆盖)
> - **`PythonListPlugIn : AbstractListPlugIn`** — 列表插件
> - **`PythonReportPlugIn : AbstractSysReportPlugIn`** — 报表插件(注:基类是 `AbstractSysReportPlugIn`,不是 Plan 5.8 写的 `SysReportBaseService`)
> - 顺手发现的另外 5 个:`PythonBillPlugIn` / `PythonCommonFilterPlugIn` / `PythonFormBuilderPlugIn` / `PythonBusinessFlowServicePlugIn` / `PythonMetadataBosCheckPlugIn` — 未在本表展开
>
> **唯一例外**:**打印插件**。K/3 套打用 `Kingdee.BOS.NotePrinting.dll` 的 `AbstractPrintWidget` + `AbstractPrintDataProvider` widget 框架,**不是 PlugIn 体系**,Python 不可注册。打印动态化的 Python 路径是挂在表单的 `BeforePrint` 事件(`PythonBillPlugIn`),不挂打印 widget 本身。
>
> **使用纪律**:本表所有 🟢 行经反编译验证。**性能 / .NET 类库依赖 / 多线程**等 Python 限制(IronPython 引擎特性)依然真实,选 Python 还是 DLL 看这些维度,不是看"能不能挂上去"。

---

## 1. 一张决策表

| 场景 | Python 表单插件 | DLL 操作 / 转换 / 打印插件 | 备注 |
|---|---|---|---|
| 单据保存前客户端校验(只看本表字段) | ✅ | ✅ 但 Python 即可 | Python 已够 |
| 字段联动(A 变 B 跟着变) | ✅ | 不必 | DataChanged 事件 |
| F7 选择前过滤 | ✅ | 不必 | BeforeF7Select 事件 |
| 默认值 / UI 控制(隐藏按钮等) | ✅ | 不必 | AfterBindData 事件 |
| 自定义按钮点击逻辑 | ✅(轻逻辑) | ✅(重逻辑) | 涉及多表更新走 DLL |
| 弹窗交互 | ✅ | ✅ | 客户端事件 |
| **审核 / 反审核拦截** | 🟢 ✅ | ✅ | `PythonOperationServicePlugIn`(2026-04-30 反编译实证) |
| **删除拦截** | 🟢 ✅ | ✅ | 同上 |
| **提交 / 撤销提交拦截** | 🟢 ✅ | ✅ | 同上 |
| **下推前服务端校验** | 🟢 ✅ | ✅ | `PythonConvertPlugIn.OnBeforeFieldMapping` / `OnGetSourceData` 等;反编译实证 2026-04-30 |
| **下推时字段复杂映射** | 🟢 ✅ | ✅ | `PythonConvertPlugIn.OnFieldMapping` / `OnAfterFieldMapping`;反编译实证 |
| **打印时动态条码 / 动态选模板** | ⚠️ 间接可 | ✅ | K/3 套打用 widget 框架不走 PlugIn,Python 不可挂 widget;但 `PythonBillPlugIn.BeforePrint` 事件可干预数据 / 选模板 |
| **列表自定义过滤 / 行格式** | 🟢 ✅ | ✅ | `PythonListPlugIn`(2026-04-30 反编译实证) |
| **报表自定义取数逻辑** | 🟢 ✅ | ✅ | `PythonReportPlugIn : AbstractSysReportPlugIn`(实证;**纠正基类**:不是 `SysReportBaseService`) |
| **保存事务内的多表更新**(原子性) | ❌(BeforeSave 不在事务内) | ✅ AbstractOperationServicePlugIn 在事务内 | 数据一致性要求高时必须 DLL |
| **高频循环 + 大数据量**(批量审核 1000 单) | ❌(IronPython 慢 5-20 倍) | ✅(原生 .NET) | 性能 |
| **调外部 HTTP API** | ⚠️(IronPython 限制 + 客户端发起,网络) | ✅(服务端,可控) | 调外部用 DLL |
| **多线程 / 并发处理** | ❌(IronPython GIL) | ✅ | |
| **使用复杂 .NET 类型**(Linq / EF / 反射深用) | ⚠️(IronPython 兼容差) | ✅ | |
| **使用第三方 NuGet 包** | ❌ | ✅ | |
| **跨 AppDomain 通信** | ❌ | ✅ | |
| **修改打印 PDF / Word 输出** | ❌ | ⚠️(看报表插件,不一定是 DLL 直接做) | |

---

## 2. 决策树(agent 内化用)

```
用户需求
  ├── 是表单字段联动 / UI 控制 / F7 过滤?
  │     → ✅ Python 表单插件(AbstractBillPlugIn 客户端事件)
  │
  ├── 是保存前简单校验(不查 DB / 不跨表)?
  │     → ✅ Python 表单插件(BeforeSave)
  │
  ├── 是审核 / 反审核 / 删除 / 提交拦截?
  │     → ✅ **Python 优先**(`PythonOperationServicePlugIn`,无需编译部署)
  │     → DLL 备选(团队已有 .NET 工程 / 性能极致 / 需 NuGet 包)
  │
  ├── 是下推时字段映射 / 跨单据校验?
  │     → ✅ **Python 优先**(`PythonConvertPlugIn`)
  │     → DLL 备选(同上)
  │
  ├── 是打印模板动态化(条码 / 大写 / 选模板)?
  │     → ⚠️ K/3 套打用 widget 框架,不是 PlugIn 体系,Python 不可注册 widget
  │     → 优先尝试模板设计器的公式字段
  │     → 间接路径:`PythonBillPlugIn.BeforePrint` 事件干预数据 / 选模板
  │     → 复杂 widget 定制 → DLL widget(`AbstractPrintWidget` / `AbstractPrintDataProvider`)
  │
  ├── 是列表 / 报表的高级定制?
  │     → ✅ **Python 优先**(`PythonListPlugIn` / `PythonReportPlugIn`)
  │     → DLL 备选
  │
  ├── 是大数据量循环 / 高频操作?
  │     → ❌ Python 性能不够 → DLL 操作插件
  │
  └── 介乎之间?(比如:保存时跨表写一条记录,但不严格原子)
        → 选 Python 试,如果出问题再升级到 DLL 操作插件
```

---

## 3. agent 话术模板

### 场景 A:用户描述"销售订单审核时检查信用额度"

**判定**:审核 = 服务端操作 → **Python 优先**(`PythonOperationServicePlugIn`,2026-04-30 反编译实证),DLL 也可

> 你这个需求是**审核拦截**——可以用 Python 操作插件(`PythonOperationServicePlugIn`),也可以走 DLL(`AbstractOperationServicePlugIn`),能力等价。
>
> 实现方向:挂在销售订单的 `Audit` 操作上,在 `OnAddValidators` 里注册一个校验器,校验器内查信用额度表 + 当前已用额度,超限 `validateContext.AddError(...)` 阻断。
>
> **推荐 Python**:OpenDeploy 一键写入 + 无需编译 + 无需重启 K3 服务。除非团队已有 .NET 工程要复用 / 单次审核要循环上千分录(IronPython 5-20 倍慢),否则走 Python。

### 场景 B:用户描述"销售订单上选了客户后,自动填默认收货地址"

**判定**:字段联动 = 客户端 → Python

> 你这个需求是**字段联动**(客户字段变 → 收货地址跟着变),用 Python 表单插件就够了——挂 `DataChanged` 事件,判断 `e.Field.Key == "FCustomer"` 时去查客户的默认地址,塞到 `FAddress` 字段。
>
> 我可以直接帮你写 Python 插件代码,通过 `k3cloud_register_python_plugins` 工具一键安装到扩展对象上。

### 场景 C:用户描述"销售订单下推到出库单时,把客户简称拼到出库单备注里"

**判定**:下推映射 = 服务端转换 → **Python 优先**(无需编译部署),DLL 也可

> 你这个需求是**下推时字段映射加工**——可以走 Python 转换插件(`PythonConvertPlugIn`,2026-04-30 反编译实证),也可以走 DLL(`AbstractConvertPlugIn`),能力等价。
>
> 简单的字段直映射或表达式 BOS Designer 的转换规则就能配,但**拼接其他单据(客户档案)的字段**到目标单据的备注,需要写代码——挂 `OnAfterFieldMapping` 事件,在里面读源数据的客户 ID,查 `T_BD_CUSTOMER` 拿简称,拼到目标的 `FRemarks`。
>
> **推荐 Python**:OpenDeploy 一键写入 + 无需编译 + 无需重启。除非团队已有 .NET 工程要复用,否则走 Python。
>
> 不过先核实:能不能在销售订单里加个"客户简称"自定义字段(BOS Designer 配公式),下推时直映射这个字段?如果可以,根本不用插件。

### 场景 D:用户描述"批量审核 1000 个订单时,要给每个订单的客户加积分"

**判定**:审核拦截 + 大数据量 → **DLL 优先(性能)**

> Python 路径(`PythonOperationServicePlugIn`)能挂上去,但**性能不够**:1000 单批处理时 IronPython 比原生 .NET 慢 5-20 倍,会拖慢用户体验。
>
> 实现:`AbstractOperationServicePlugIn` 挂 Audit,在 `EndOperationTransaction`(事务内、核心审核已完成)里**批量**(不是循环单个)给每个客户加积分——SQL 直接 `UPDATE T_BD_CUSTOMER SET F_ABC_Points = F_ABC_Points + ... WHERE FID IN (...)`。
>
> v0.1 不代写 DLL 代码 / 不编译 / 不部署 — 给骨架,客户拿去 VS 实现。
>
> **如果数据量其实不大(<100 单)**,Python 路径也能跑,优先 Python(一键写入)。

---

## 4. 当 agent 不确定时

如果用户描述模糊(比如只说"销售订单加点逻辑"):

1. **先问**:"是表单上的字段联动 / UI 控制,还是审核 / 下推 / 打印这些操作的拦截?"——这一问能 80% 分流
2. **再问**:"需要查别的表 / 调外部接口吗?"——决定要不要走服务端
3. **再问**:"是单笔单据触发,还是批量(每天上百单)?"——决定性能层级

把"决策依据"摆给用户看,不要替用户决定。

---

## 5. 升级路径

如果先用 Python 实现,后来发现需要的能力 Python 做不了:

1. **Python 部分**继续保留(管表单的 UI / 联动)
2. **新增 DLL 部分**管服务端逻辑(审核 / 下推等)
3. 两者通过**单据数据**协作——Python 在 BeforeSave 设个标记字段,DLL 操作插件在 BeforeExecuteOperationTransaction 读这个字段决定走向

这种 hybrid 模式很常见——别一开始就拿 DLL 砸所有需求。

---

## 临时话术(agent 引用)

> 我帮你判定下这个需求:
>
> - 触点:【表单事件 / 服务端操作 / 转换 / 打印 / 列表 / 报表】
> - 数据范围:【本单 / 跨单 / 跨表 / 批量】
> - 性能要求:【单笔 / 批量(>100)】
>
> 综合下来这个属于 **【Python 表单插件 ✅ / DLL XX 插件 ❌】** 场景,理由:
> 1. ......
> 2. ......
>
> 走 Python 的话我可以**直接帮你做**(`k3cloud_register_python_plugins` 工具一键写到扩展对象);走 DLL 的话**需要你用 Visual Studio 写代码**,我可以给开发方向、工程命名、样例骨架——但写代码、编译、部署 DLL 不在 v0.1 自动化范围。
>
> 你倾向哪种?
