---
name: business-rules-corrected
title: BOS 业务规则 (IronPython) — 反编译实证
description: K/3 Cloud BOS 业务规则的真实工程模型,IronPython 2.7 子集 + FuncDefine 内置函数库 + DependencyRules 触发模型 + FKERNELXML 序列化形态。来源:Kingdee.BOS.Core.dll V9 客户端反编译。修正了 business-rules.md 的训练数据幻觉。
---

# BOS 业务规则的真实工程模型

> **修正背景**: 同目录 `business-rules.md` 写"SQL 风格 DSL 函数表"全是训练数据幻觉 — 函数名、参数签名、使用方式均错误。本文件用 `Kingdee.BOS.Core.dll` 反编译实证替换。
> **侦察日期**: 2026-04-25
> **数据源**: `Kingdee.BOS.Core.dll` (V9 客户端) ILSpy 反编译产物 `/tmp/bos-decompile/out-core/Kingdee.BOS.Core.decompiled.cs` (305,584 行)
> **IronPython 版本**: **IronPython 2.7.12** (实证: DLL 文件版本 `2.7.12.1000`, 安装于 `C:\Program Files (x86)\Kingdee\K3Cloud\DeskClient\K3CloudClientX86\IronPython.dll`)

---

## 1. 触发器模型 (RaiseEventType + EntityServiceRule)

### 1.1 什么是"业务规则"

BOS 业务规则有**两个层次**:

1. **字段级 UpdateActions** — 挂在单个 `Field` 上 (`CollectionProperty UpdateActions: List<FormBusinessService>`, line 12110)。当该字段值变化时触发配置的服务列表。这是 BOS Designer → 字段属性 → "值更新事件" 配置的内容。

2. **实体级 EntityServiceRule** — 挂在 `Entity` 上 (`CollectionProperty EntityServiceRules: List<EntityServiceRule>`, line 54192)。有条件表达式 (`PreCondition`)、条件成立时服务列表 (`WhenTrueBusinessServices`)、条件不成立时服务列表 (`WhenFalseBusinessServices`)。这是 BOS Designer → 单据头/体属性 → "实体服务规则" tab 配置的内容。

### 1.2 RaiseEventType 位标志 (🟢 反编译 line 10831–10838 + 🟢 客户环境 XML 实证 2026-04-26)

`RaiseEventType` 是一个位标志枚举，用于在内存中标记服务在哪些事件时触发:

| 位值 | C# 枚举名 | XML 子元素名 |
|---|---|---|
| `1` | `RaiseValueChanged` | `<RaiseValueChanged>` |
| `2` | `RaiseInitialized` | `<RaiseInitialized>` |
| `4` | `RaiseItemAdded` | `<RaiseItemAdded>` |
| `8` | `RaiseItemReset` | `<RaiseItemReset>` |
| `16` | `RaiseItemRemoved` | `<RaiseItemRemoved>` |
| `32` | `RaiseReset` | `<RaiseReset>` |
| `64` | `RaiseSelectRowChanged` | `<RaiseSelectRowChanged>` |
| `256` | `RaiseSelectRowExtChanged` | `<RaiseSelectRowExtChanged>` |

**🟢 XML 序列化形态实证**:
- **每个事件是独立的子元素**, **不是单一整数位掩码**
- 元素值是字符串 `EnableRaise` 或 `DisableRaise`
- **只在覆盖默认时序列化** — 默认值（推测 `EnableRaise`）的事件根本不出现在 XML 里
- 实证片段（用户字段级 UpdateActions 中禁用了 3 个事件）:

```xml
<FormBusinessService>
  <Parameters>[" FExchangeRate = 0"]</Parameters>
  <ActionId>2</ActionId>
  <RaiseValueChanged>DisableRaise</RaiseValueChanged>
  <RaiseItemReset>DisableRaise</RaiseItemReset>
  <RaiseReset>DisableRaise</RaiseReset>
  <Id>...</Id>
</FormBusinessService>
```

> 🟢 **来源**:
> - 位值: 反编译 line 10831–10838 `ApplyRaiseMode` 硬编码常量
> - XML 形态: 客户 dev 环境实证（扩展 FID `a4ad49d2-61c2-4000-9650-20e27c701675`，2026-04-26 配置）

### 1.3 BOSRule / EntityRule 执行流 (🟢 反编译 line 185763)

`EntityRule` 是 `BOSRule` 的具体子类 (line 185763)。核心 `Execute` 方法:
1. 遍历触发数据行
2. 用 `ConditionParser.VerifyExpression(_expression, dynamicRowModel, functionLib)` 评估前置条件表达式
3. 条件为真 → 执行 `WhenTrueBusinessServices` 列表; 条件为假 → 执行 `WhenFalseBusinessServices` 列表
4. 每个 `FormBusinessService` 通过 `FormBusinessServiceUtil.ExceuteServices` 执行

> 🟢 **来源**: `EntityRule.Execute()` method body, line 185811–185900

### 1.4 表单插件事件 (IDynamicFormModelPlugIn, 🟢 line 5560)

这不是"业务规则"本身，但与它相关 — Python 表单插件可以响应这些事件:

| 事件方法 | EventArgs 类型 | 关键属性 |
|---|---|---|
| `DataChanged(e)` | `DataChangedEventArgs` (line 284642) | `e.Field` / `e.NewValue` / `e.OldValue` / `e.Row` |
| `AfterDeleteRow(e)` | `AfterDeleteRowEventArgs` (line 210531) | `e.EntityKey` / `e.Row` / `e.DataEntity` |
| `AfterCreateNewEntryRow(e)` | `CreateNewEntryEventArgs` | `e.Entity` / `e.Row` |
| `BeforeDeleteRow(e)` | `BeforeDeleteRowEventArgs` | `e.EntityKey` / `e.Row` (可 `Cancel`) |
| `BeforeF7Select(e)` | `BeforeF7SelectEventArgs` (line 206870) | `e.FieldKey` / `e.FormId` (F7弹窗) |
| `AfterF7Select(e)` | `AfterF7SelectEventArgs` | `e.FieldKey` / `e.SelectRows` / `e.Row` |

> 🟢 `DataChangedEventArgs` 完整属性确认: line 284642–284688
> 🟢 `AfterDeleteRowEventArgs` 完整属性确认: line 210531–210549

---

## 2. 内置函数库 (FuncDefine + AbstractFunction)

BOS 表达式引擎通过 `FunctionManage`（line 229313）注册和查找函数。函数分两类:

- **`AbstractFuncDefine`** (line 50235): 通过 `GetFuncDefine()` 返回一个 .NET delegate，由表达式引擎调用
- **`AbstractFunction`** (line 194797): 通过 `Eval()` 方法计算结果

### 2.1 完整函数目录 (🟢 全部反编译实证)

| 调用名 (推断) | C# 类 | 行号 | 签名 (反编译确认) | 返回类型 | 语义 |
|---|---|---|---|---|---|
| `GetFlexDetailValue` | `GetFlexDetailValueFuncDefine` | 50261 | `(flexDynamicRow, propKey: str, type: int=1)` | `object` | 取辅助属性(核算维度)字段值; type=1 取编号, type=2 取名称 |
| `GetPKValue` | `GetPKValueFuncDefine` | 50394 | `(baseFieldDynamic, number: str)` | `object` | 按编号反查基础资料主键(FID); `baseFieldDynamic` 可以是字段 key 字符串或 BaseFieldDynamicRow |
| `GetAcronym` (新版) | `GetAcronymNewFuncDefine` | 50564 | `(chineseCharacters: str, generationType: int, caseType: int)` | `str` | 中文转拼音首字母; generationType: 1=仅汉字首字母,2=包括标点,3=全部; caseType: 1=大写,其他=小写 |
| `GetAcronym` (旧版) | `GetAcronymFuncDefine` | 96400 | `(chineseCharacters: str)` | `str` | 中文转拼音首字母(小写), 旧版单参数 |
| `BillTypeParam` | `BillTypeParamFuncDefine` | 96141 | `(billTypeFieldKey: str, propertyName: str)` | `object` | 取单据类型参数属性值 |
| `BillTypeParam` (新版) | `BillTypeParamNewFuncDefine` | 96229 | `(billTypeFieldKey: str, propertyName: str, paramFormId: str)` | `object` | 取指定表单的单据类型参数属性值 |
| `IsFloatUnitConvert` | `IsFloatUnitConvert` | 96531 | `(materialIdKey: str, sourceUnitKey: str, targetUnitKey: str)` | `bool` | 判断物料的两个计量单位之间是否存在浮动换算关系 |
| `OperationStatus` | `OperationStatusFuncDefine` | 228475 | `()` | `str` | 当前单据操作状态字符串 (如 `"Add"` / `"Edit"` / `"Display"`) |
| `SysParam` | `SysParamFuncDefine` | 228549 | `(orgFieldKey: str, acctBookFieldKey: str, parameterObjId: str, parameterName: str)` | `object` | 取系统参数; orgFieldKey/acctBookFieldKey 可传字段 key 或组织/账套 ID 字符串 |
| `Avg` | `AVGFuncDefine` | 229202 | `(value: iterable)` | `decimal` | 对可迭代对象求平均值 (sum/count) |
| `Count` | `CountFunctionDefine` | 229253 | `(value: iterable)` | `int` | 对可迭代对象计数 |
| `IsDraw` | `IsDrawFuncDefine` | 229564 | `()` | `bool` | 当前单据是否存在来源行 (即是否为下推生成的单据) |
| `IsPush` | `IsPushFuncDefine` | 229791 | `()` | `bool` | 当前单据是否已下推生成子单据 |
| `GetCurrOrg` | `GetCurrOrgFunction` | 194881 | `()` 或 `("ID")` | `long` 或 `null` | 无参返回当前组织ID(`long`); 传 `"ID"` 同效; 其他参数返回 `null` |
| `GetUser` | `GetUserFunction` | 195079 | `("ID")` | `long` 或 `null` | 传 `"ID"` 返回当前用户 ID; 其他参数返回 `null` |
| `GetFieldValue` | `GetFieldValueFunction` | 195031 | `(fieldKey: str)` | `object` | 取当前行指定字段的值 (通过 Model.GetValue) |
| `GetDate` | `AbstractGetDateFunction` 子类 | 194929 | 多重载 (见下) | `DateTime` | 取当前日期/时间，支持时区转换 |
| `GetTime` | `AbstractGetTimeFunction` 子类 | 195056 | `("system"?)` | `str` or `null` | 取系统时间字符串 |

> 🟢 所有函数均通过 `GetFuncDefine()` 返回的 delegate 签名确认 (如 `Func<object, string, int, object>` = 3参数返回 object)

### 2.2 GetDate 函数的多重载 (🟡 AbstractGetDateFunction Eval 逻辑确认, line 194956)

`AbstractGetDateFunction.Eval()` 支持以下模式:
- 无参: 返回当前时间 (转换为用户时区)
- `GetDate("yyyy-MM-ddTHH:mm:ss")`: 按 ISO 格式解析
- `GetDate("yyyy-MM-ddTHH:mm:ss", "system")`: 返回系统时区时间
- `GetDate("yyyy-MM-ddTHH:mm:ss", "max")`: 返回最大系统时间 (`KDTimeZone.MaxSystemDateTime`)
- `GetDate("yyyy-MM-ddTHH:mm:ss", "min")`: 返回最小系统时间
- `GetDate("yyyy-MM-dd")`: 只返回日期部分
- `GetDate("任意日期字符串")`: 解析为 `DateTime`

> 🟡 具体函数名 (如 `GetDate` vs `GetCurrentDate` vs `Now`) 需要在客户环境确认; C# 方法名是 `GetCurrentUserTime()`/`GetCurrentSystemTime()` (抽象方法); 表达式引擎注册时使用的字符串 key 在 `AbstractFunctionLoader._functionType` 中赋值但受 obfuscation 影响无法直读 (line 194839–194845)

---

## 3. IronPython 2.7 子集

### 3.1 运行时架构 (🟢)

```
Python.CreateEngine()           ← IronPython.Hosting (line 46, using)
  → ScriptEngine                ← 池化, 按线程 ID 分配 (line 272291)
    → ScriptScope               ← 每次执行独立 scope
      → basePyCode.Execute()    ← 注入基础脚本 (从 embedded resource 加载, line 294618)
      → pyCode.Execute()        ← 执行用户脚本
      → scope.SetVariable("xxx", this)  ← 注入宿主对象 (如 FormPlugin 实例)
```

`PythonUtil.GetScriptEngine()` 用 `ConcurrentDictionary<int, ScriptEngine>` + 轮转计数器池化引擎 (line 272291–272340)。池大小由 `KDConfiguration.Current.PythonEngineMaxNum` 控制。

### 3.2 支持的语言特性 (🟢 IronPython 2.7.12 实证)

IronPython 2.7 实现 Python 2.7 语言规范。以下在 BOS 表达式 / Python 表单插件中**支持**:

**数据类型**:
- `int`, `long`, `float`, `bool`, `str`, `unicode`, `NoneType`
- `list`, `tuple`, `dict`, `set`
- `Decimal` — 金额计算推荐用 `.NET` 的 `System.Decimal` 或显式转换

**控制流**:
- `if` / `elif` / `else`
- `for ... in ...` / `while`
- `break` / `continue` / `pass`
- `try` / `except` / `finally`

**函数 / 类**:
- `def func(...):` 定义函数
- `lambda x: expr` 匿名函数
- `class Foo:` 定义类 (继承 .NET 类也可)

**运算符**:
- 四则运算: `+` `-` `*` `/` `//` `%` `**`
- 比较: `==` `!=` `<` `<=` `>` `>=`
- 逻辑: `and` `or` `not` (必须小写)
- 成员测试: `in` / `not in`
- 三目: `值A if 条件 else 值B`

**内置函数** (Python 2.7 built-ins, 🟡 BOS 沙箱不保证全放行):
- `len(x)`, `str(x)`, `int(x)`, `float(x)`, `bool(x)`
- `round(x, n)`, `abs(x)`, `max(...)`, `min(...)`
- `sum(iterable)`, `sorted(iterable)`
- `isinstance(x, type)`, `type(x)`
- `range(n)`, `list(iterable)`, `dict(...)`, `set(...)`
- `map(func, iterable)`, `filter(func, iterable)`, `reduce(func, iterable)`

**.NET 互操作**:
```python
import System
import System.DateTime as DateTime
now = DateTime.Now              # System.DateTime 实例
now.AddDays(7)                  # .NET 实例方法
now.Year / now.Month / now.Day  # .NET 属性
System.Math.Round(x, 2)        # .NET 静态方法
```

### 3.3 在 BOS 表达式/规则中引用字段

字段引用通过 `BOSDynamicRow.TryGetMember` 动态解析 (line 241645 VerifyExpression 中 `BindGetField`)。字段 key 直接作为变量名引用:

```python
# 字段值引用 (直接用字段 Key)
F_金额 = F数量 * F单价          # 字段 Key 作为变量名
F客户.FName                     # 基础资料字段.属性名 (点分隔)

# 也可用 GetFieldValue 函数 (更明确)
GetFieldValue("FQty") * GetFieldValue("FPrice")
```

### 3.4 不支持的特性 (🟢 + 🟡)

**明确不支持** (🟢 系统层面禁止或不存在):
- `import os` / `import sys` / `import subprocess` — 文件/系统访问 (BOS 不注入这些模块)
- `open(file)` — 文件 I/O
- `socket` / 网络访问
- `threading` — 多线程
- `async` / `await` — Python 2.7 不存在此语法
- `print(x)` 作为函数 — Python 2.7 中是语句 `print x`

**SQL 风格写法** (不存在, 🟢):
- `IIF(...)` — 用 `值A if 条件 else 值B`
- `CONCAT(...)` — 用 `+` 拼接字符串
- `DATEADD(field, n, 'd')` — 用 `field.AddDays(n)` (.NET)
- `LEN(x)` — 用 `len(x)` (小写)
- `ROUND(x, n)` — 用 `round(x, n)` (小写)
- `ISNULL(x, default)` — 用 `x if x is not None else default`
- `LIKE '%xxx%'` — 在条件表达式里 (不是 Filter/SQL); 用 `'xxx' in x` 或 `x.find('xxx') >= 0`

**尚不确定** (🟡 需客户环境实测):
- Python 标准库 `math`, `datetime`, `decimal` 模块能否 `import`
- `print` 输出是否在日志中可见
- 递归深度限制
- `__import__()` 动态导入

---

## 4. FKERNELXML 序列化形态 (🟢 客户 dev 环境实证 2026-04-26)

> **实证扩展**: FID `a4ad49d2-61c2-4000-9650-20e27c701675`（dev SAL_SaleOrder 扩展，含 1 条实体规则 + 1 条字段 UpdateActions）。
> **导出工具**: `pnpm dlx tsx scripts/extract-business-rule-xml.ts <fid>`

### 4.1 序列化框架行为速记

BOS 用自研序列化框架（非 .NET XmlSerializer），通过 `[SimpleProperty]` / `[CollectionProperty]` / `[ComplexProperty]` 注解驱动。**关键约定（实证）**:

1. **DefaultValue 的属性会跳过序列化** — `IsEnabled=true` 默认值，从不出现在 XML 里
2. **空集合不序列化** — `WhenFalseBusinessServices` 空时整个节点不存在，不是 `<WhenFalseBusinessServices/>` 空元素
3. **`Description`、`PreConditionDesc` 是直接文本节点** — 不是 LocaleValue 嵌套结构（中文直接写在文本里）
4. **`ClassName` / `Name` 不出现在 XML** — `FormBusinessService` 由 `ActionId` 唯一标识 service 类型，`ClassName` 是运行时 lookup 出来的，不持久化
5. **每个 `Raise<EventName>` 是独立子元素** — 仅当用户覆盖默认值时序列化

### 4.2 实体级业务规则 XML（实证形态 🟢）

```xml
<!-- 在 FKERNELXML 的 Entity 节点内 -->
<EntityServiceRules>
  <EntityServiceRule>
    <Id>802ab974-ac16-485d-921e-bcc617036060</Id>
    <Description>测试-永真规则</Description>
    <PreCondition>OperationStatus() == 'Add'</PreCondition>
    <PreConditionDesc>OperationStatus() == 'Add'描述</PreConditionDesc>
    <Seq>12</Seq>
    <WhenTrueBusinessServices>
      <FormBusinessService>
        <Parameters>[" FBillAllAmount = 100"]</Parameters>
        <ActionId>2</ActionId>
        <Description>计算定义公式的值并填写到指定列</Description>
        <Id>2ecb49b7-9405-4184-aa10-91fb7e957976</Id>
      </FormBusinessService>
    </WhenTrueBusinessServices>
    <!-- WhenFalseBusinessServices 节点不存在(默认空集合不序列化) -->
    <!-- IsEnabled 节点不存在(默认 true 不序列化) -->
  </EntityServiceRule>
</EntityServiceRules>
```

**节点字段含义**（实证）:

| 节点 | 含义 | 如何生成 |
|---|---|---|
| `<Id>` | GUID，规则唯一标识 | 写工具用 `crypto.randomUUID()` |
| `<Description>` | 中文描述（直接文本，不是 LocaleValue）| 用户输入的规则名 |
| `<PreCondition>` | IronPython 条件表达式文本（空字符串 = 永真）| LLM 输出 |
| `<PreConditionDesc>` | PreCondition 的中文描述（BOS Designer 自动填）| 写工具可填空，BOS 自己加 |
| `<Seq>` | 同 entity 多条规则的执行顺序 | 工具按 N+1 自增 |
| `<WhenTrueBusinessServices>` | 条件成立时执行的服务列表 | 必填 |
| `<WhenFalseBusinessServices>` | 条件不成立时执行的服务列表（空时不序列化）| 可选 |

### 4.3 FormBusinessService 节点（实证形态 🟢）

```xml
<FormBusinessService>
  <!-- Parameters: JSON 数组,每条字符串 = 1 个 IronPython 赋值语句 -->
  <Parameters>[" FBillAllAmount = 100"]</Parameters>
  <!-- ActionId=2 = Calculate (反编译 line 11406) -->
  <ActionId>2</ActionId>
  <!-- BOS Designer 自动加的中文描述 -->
  <Description>计算定义公式的值并填写到指定列</Description>
  <Id>2ecb49b7-9405-4184-aa10-91fb7e957976</Id>
</FormBusinessService>
```

**🟢 `<Parameters>` 真实形态**: JSON 数组，每个元素是一个 IronPython 赋值字符串

```
Parameters JSON: [" FBillAllAmount = 100"]
                 ─┬─ ─────────────────────
                  │  └─ 赋值表达式 (前面的空格无关紧要,BOS Designer 写时随手加)
                  └─ JSON 数组,可放多条赋值

多条动作示例 (LLM 应该这样生成):
Parameters JSON: ["F金额 = F数量 * F单价", "F税额 = F金额 * 0.13"]
```

> ⚠️ **重要纠正**: subagent 之前推断的 `[{"TargetField":"FAmount","Expression":"FQty * FPrice"}]` 对象数组形式 **不是真的**。真实是赋值字符串数组——BOS 在运行时直接把字符串喂 IronPython 引擎执行，左侧自动是赋值目标，右侧是表达式。

### 4.4 字段级 UpdateActions XML（实证形态 🟢）

```xml
<!-- 在 Field 节点内 (字段属性"值更新事件"配置) -->
<UpdateActions>
  <FormBusinessService>
    <Parameters>[" FExchangeRate = 0"]</Parameters>
    <ActionId>2</ActionId>
    <Description>计算定义公式的值并填写到指定列</Description>
    <!-- 用户在 BOS Designer 里禁用了这 3 个事件; 其他 5 个事件保持默认(EnableRaise) -->
    <RaiseValueChanged>DisableRaise</RaiseValueChanged>
    <RaiseItemReset>DisableRaise</RaiseItemReset>
    <RaiseReset>DisableRaise</RaiseReset>
    <Id>7e19f9ad-d0c2-4d59-903f-1c97cb6220fb</Id>
  </FormBusinessService>
</UpdateActions>
```

**🟢 与 EntityServiceRule 的关键差异**:
1. UpdateActions 没有 `<PreCondition>` — 字段值更新事件不需要前置条件（事件本身就是触发条件）
2. UpdateActions 没有 `<WhenTrue/False>` 分支 — 直接列服务
3. **`<Raise{Event}>` 子元素存在**: 每个事件独立元素，值 `EnableRaise` / `DisableRaise`，仅当覆盖默认时存在

---

## 5. 给 agent 写规则的实践纪律

以下规则是 `k3cloud_add_calculate_rule` (Plan 5.12.3) 工具的生成和验证基础:

1. **字段引用直接用 Key**: `FQty * FPrice` 而不是 `GetFieldValue("FQty") * GetFieldValue("FPrice")`；前者是 BOS Designer 的标准写法，后者也可用但冗长。

2. **算术一定用内置函数做精度控制**: 金额计算必须 `round(FQty * FPrice, 2)`，浮点直接相乘会有尾数误差。

3. **空值检查用 Python 2 风格**: `FField is None` 或 `FField == None`；不是 `ISNULL()`，不是 `is null`。

4. **字符串拼接用 `+` 或 `str.format()`**: `FCode + "-" + FName`；不用 `CONCAT()`。

5. **条件表达式用三目**: `'VIP' if FAmt > 1000000 else 'General'`；不用 `IIF()`。

6. **基础资料属性访问用点分隔**: `FCustId.FNumber`（获取客户编号）；对比字段类型用 `FUnit.FNumber == 'PCS'`。

7. **日期运算用 .NET 方法**: `FDate.AddDays(7)` 加 7 天；`(FEndDate - FStartDate).Days` 求天数差；不用 `DATEADD()`。

8. **`OperationStatus()` 判断新增/修改**: `OperationStatus() == 'Add'` 仅新增时触发。

---

## 6. validator (Plan 5.12.3) 输入

`k3cloud_add_calculate_rule` 工具的 validate-and-retry loop 验证依据:

### 函数白名单 (可在 PreCondition 和 action 赋值表达式中调用)

```
GetFlexDetailValue  GetPKValue  GetAcronym  BillTypeParam
IsFloatUnitConvert  OperationStatus  SysParam
Avg  Count  IsDraw  IsPush
GetCurrOrg  GetUser  GetFieldValue  GetDate  GetTime
```

### LLM 输出约定（基于实证 XML 形态）

LLM 在 `k3cloud_add_calculate_rule` 工具的 input 里给两个东西:

**实体级规则**:
```typescript
{
  description: "测试-永真规则",          // 中文规则名
  preCondition: "OperationStatus() == 'Add'",  // 空字符串 = 永真
  whenTrueActions: [                    // 条件成立的赋值列表
    "F金额 = F数量 * F单价",
    "F税额 = F金额 * 0.13"
  ],
  whenFalseActions: []                  // 可选,默认空
}
```

工具拼装出的 XML:
- `<EntityServiceRule>` 包含 `<Id>` (生成) + `<Description>` + `<PreCondition>` + `<Seq>` (递增)
- `<WhenTrueBusinessServices>` 含 1 个 `<FormBusinessService>`
  - `<Parameters>` = `JSON.stringify(whenTrueActions)` 即 `["F金额 = F数量 * F单价", "F税额 = F金额 * 0.13"]`
  - `<ActionId>2</ActionId>` (Calculate)
  - `<Id>` (生成)

**字段级 UpdateActions**:
```typescript
{
  fieldKey: "F单价",
  actions: ["F金额 = F数量 * F单价"],
  disabledEvents: ["RaiseValueChanged"]  // 可选,只列要禁用的事件
}
```

### 字段引用模式 (合法的赋值左右两边形态)

> 中文字符用 Unicode 属性 `\p{Script=Han}` 表示，纯 ASCII 可读 (匹配所有 CJK 汉字)。
> TypeScript 实现: `new RegExp(pattern, 'u')` 启用 Unicode 模式 — 不带 `'u'` flag 此语法无效。
> **不要用** `[一-龥]` 这种历史写法 — 端点 `龥` (U+9FA5) 是生僻字,可读性极差。

```regex
# 直接字段 key (以 F 开头,含字母数字下划线/汉字)
\bF[\p{Script=Han}A-Za-z0-9_]+\b

# 点分隔基础资料属性
\bF[\p{Script=Han}A-Za-z0-9_]+\.F?[A-Za-z][A-Za-z0-9_]*\b

# GetFieldValue 函数调用
GetFieldValue\(\s*["']F[\p{Script=Han}A-Za-z0-9_]+["']\s*\)
```

### 禁止模式 (应触发 LLM retry)

```
# SQL 风格函数 (训练数据幻觉常见)
\bIIF\(  \bCONCAT\(  \bDATEADD\(  \bISNULL\(  \bDATEDIFF\(
\bLEN\(  \bROUND\(  \bSUBSTR\(  \bUPPER\(  \bLOWER\(

# 危险 import
\bimport\s+os\b  \bimport\s+sys\b  \bimport\s+subprocess\b  \bimport\s+socket\b

# Python 3 语法 (IronPython 是 2.7)
\bprint\s*\(  \bf-string|f"  async\s+def  await\s
```

### 类型限制

- `preCondition` 必须是 **布尔表达式** (返回 `True`/`False`); 例如 `FQty > 0 and FPrice > 0`
- `whenTrueActions` 每条必须是 **赋值语句** `<TargetField> = <Expression>`; 单纯的值表达式（如 `FQty * FPrice` 不带等号）会失败
- 空 `preCondition`（空字符串）= 永真，所有行都触发

---

## 实证级别汇总

### 🟢 已实证（反编译 + 客户 dev 环境 XML 双重验证）

**反编译实证（`Kingdee.BOS.Core.dll` V9）**:

- `IronPython 2.7.12` 版本 (DLL 文件头 `FileVersion: 2.7.12.1000`)
- `PythonUtil.GetScriptEngine()` 池化 (line 272291)
- `PythonPlugIn` 初始化流程: `basePyCode.Execute(scope)` → `pyCode.Execute(scope)` → `scope.SetVariable("xxx", this)` (line 205310–205320)
- 全部 16 个 FuncDefine/Function 类存在 + `GetFuncDefine()` 返回 delegate 签名 (各类 GetFuncDefine override)
- `EntityServiceRule` C# 属性: `Id` `Description` `IsEnabled` `PreCondition` `Seq` `WhenTrueBusinessServices` `WhenFalseBusinessServices` (line 227060–227130)
- `RaiseEventType` 8 个位值 (line 10831–10838)
- `FormBusinessService.ACTION_Calculate=2`, `ACTION_TakeBaseData=22`, `ACTION_CallBillFunction=23` (line 11406, 11413, 10618)
- `DataChangedEventArgs` 属性 (line 284642)
- `AfterDeleteRowEventArgs` 属性 (line 210531)

**客户 dev 环境 FKERNELXML 实证（2026-04-26，扩展 FID `a4ad49d2-61c2-4000-9650-20e27c701675`）**:

- `<EntityServiceRules>` 容器 + `<EntityServiceRule>` 节点形态（见 4.2）
- `<Description>` 是直接文本节点（**不是** LocaleValue 嵌套）
- `<IsEnabled>` 不序列化（DefaultValue=true 跳过）
- `<WhenFalseBusinessServices>` 空集合不序列化（**不是** 空元素 `<...>`）
- **`<ClassName>` 不序列化** — 由 `<ActionId>` 唯一标识 service 类型，`ClassName` 是运行时 lookup 值，不持久化（subagent 之前推断 ClassName 在 XML 里是错的）
- `<PreConditionDesc>` 子元素存在（PreCondition 的中文描述，BOS Designer 自动填）
- `<Parameters>` 是 **JSON 数组 of 赋值字符串** — `[" F金额 = F数量 * F单价"]`，**不是** `{TargetField,Expression}` 对象数组（subagent 之前推断错）
- `<UpdateActions>` 在 Field 节点内的形态（见 4.4）
- `<Raise{Event}>` **每个事件独立子元素**，值 `EnableRaise` / `DisableRaise`，仅覆盖默认时序列化（**不是** 单一整数位掩码）

### 🟡 类名/接口推断（部分确认）

- `GetDate`/`GetTime` 函数在表达式引擎中注册的字符串 key（class name 找到了，但 string key 受 obfuscation 影响）
- Python 标准库模块 (`math`, `datetime`, `decimal`) 是否可 `import`
- 条件表达式 (`PreCondition`) 中的字段引用模式（已实证 `OperationStatus() == 'Add'` 模式工作；其他模式如 `F字段 > 100` 推断有效但未单独跑过）
- `<Raise{Event}>` 默认值是 `EnableRaise` 还是 `DisableRaise`（推测前者，未验证）

### 🔴 需后续实证

- ActionId=22 (TakeBaseData) 和 ActionId=23 (CallBillFunction) 的 Parameters JSON schema（计算公式服务 ActionId=2 已实证赋值字符串数组形态）
- IronPython 沙箱 `import` 白名单（`import System` 实证可用，但其他模块未试）
- 多条规则在同一 entity 上的 `<Seq>` 排序行为（用户当前 `Seq=12` 可能是 BOS 内部分配的位置标识）

---

## 7. SaveForIDEV9 wire format（🟢 实证 2026-05-04 / Plan 5.12.3a Phase 1）

> 完整 capture 证据：`docs/recon/2026-05-04-business-rules-tier-b.md` + `.scratch/captures/decoded/business-rules/req-{120,138,158}/`
> 与 §4 (FKERNELXML 形态) 的差别：§4 是**持久化形式**（DB 中存的），本节是**SaveForIDEV9 wire form**（BOS Designer 客户端 → 服务端的 baseline-diff DCXML），两者节点结构有细微差异。

### 7.1 关键校正（FKERNELXML §4 vs DCXML wire）

| §4 FKERNELXML 旧描述 | 本节 wire 实证 |
|---|---|
| `<ClassName>` 不序列化, 由 `<ActionId>` 唯一标识 service 类型 | **仅对 Calculate (ActionId=2 / 基类 FormBusinessService) 成立**。**特化 ServiceMeta 子类（GetInvStockBusinessServiceMeta / GetPriceBusinessServiceMeta / ...）的 C# 类名直接当 XML 元素名**（不是 `<FormBusinessService><ClassName>X</ClassName>` 而是 `<X>...</X>`） |
| `<PreConditionDesc>` BOS Designer 自动填 | **用户必须填**（实证：BOS Designer 不会自动生成中文描述，原 §4.2 说"自动填"是误解） |
| 默认 `<EntityServiceRule>` 包含 `<IsEnabled>true</IsEnabled>` 跳过序列化 | 同上（保持） |

### 7.2 ActionId=2 Calculate — 字段级 UpdateAction（🟢 实证）

```xml
<IntegerField ElementType="3" ElementStyle="0">
  <PropertyName>F_PAIJ_TestInt</PropertyName>
  <FieldName>F_PAIJ_TESTINT</FieldName>
  <UpdateActions>
    <FormBusinessService>                           <!-- 基类元素名 -->
      <Parameters>[" F_PAIJ_TestDecimal  =   F_PAIJ_TestInt "]</Parameters>
      <ActionId>2</ActionId>
      <Description>计算定义公式的值并填写到指定列</Description>
      <RaiseValueChanged>DisableRaise</RaiseValueChanged>
      <RaiseItemReset>DisableRaise</RaiseItemReset>
      <RaiseReset>DisableRaise</RaiseReset>
      <Id>afc25ea1-5732-4803-9f54-516a22fb0b09</Id>
    </FormBusinessService>
  </UpdateActions>
  <Name>测试整数</Name>
  ...
</IntegerField>
```

- UpdateActions **直接是任一 Field 节点子元素**（IntegerField / TextField / DecimalField / ... 都行）
- Calculate 走基类 → 元素名 `<FormBusinessService>`，无 ClassName
- Parameters JSON 数组前后空格保留

### 7.3 ActionId=67 GetInvStock — 实体级 EntityServiceRule（🟢 实证）

```xml
<HeadEntity action="edit" oid="be8f270b-..." ElementType="34" ElementStyle="0">
  <EntityServiceRules>
    <EntityServiceRule>
      <Id>0c027f9c-...</Id>
      <Description>5.12.3a 测试 - GetInvStock</Description>
      <PreCondition> FBillTypeID.FNumber = '01.01'</PreCondition>
      <PreConditionDesc>test</PreConditionDesc>
      <Seq>12</Seq>
      <WhenTrueBusinessServices>
        <GetInvStockBusinessServiceMeta>          <!-- 子类名 = 元素名 -->
          <ActionId>67</ActionId>
          <StockQtyField>F_PAIJ_TestQty</StockQtyField>
          <ExtAuxQtyField />                      <!-- 无默认值的属性，user 未填 → 空自闭合 -->
          <ReturnQtyField>1</ReturnQtyField>
          <PluginClassName />
          <KeeperTypeField />                     <!-- user 清掉了默认值 FKEEPERTYPEID -->
          <KeeperField />
          <StockPlaceField />
          <StockStatusField />
          <ProjectNoField />
          <SecUnitIdField />
          <ExtAuxUnitIdField />
          <Description>获取即时库存信息</Description>
          <Id>82394226-...</Id>
        </GetInvStockBusinessServiceMeta>
      </WhenTrueBusinessServices>
    </EntityServiceRule>
  </EntityServiceRules>
</HeadEntity>
```

- **EntityServiceRules 容器在 `<HeadEntity action="edit">` 内**（即使 BOS Designer UI 里选了某 entry，wire 仍走 HeadEntity 容器——已实证）
- **PreCondition 必填非空**（BOS Designer UI 强制；实证：用户告知"实体服务规则必须录入条件，不然不允许确定"）
- **PreConditionDesc 用户输入**（BOS Designer 不自动生成）
- 实证补充字段（反编译漏掉的）：`ReturnQtyField` / `PluginClassName` / `StockStatusField` / `ProjectNoField` / `SecUnitIdField` / `ExtAuxUnitIdField`

### 7.4 BOS 序列化省略规则（🟢 实证）

| 属性运行时值 | wire 表现 |
|---|---|
| 等于 DefaultValue（attribute 上有 `[DefaultValue(...)]`）| **整个属性 omit**（不出现 XML 节点）|
| 不等于 DefaultValue 且非空 | `<Prop>value</Prop>` 完整出现 |
| 被显式清空（用户 UI 里删了默认值）| `<Prop />` 空自闭合 |
| 没有 DefaultValue 的属性 + 未填 | `<Prop />` 空自闭合 |

→ 实施 .NET bridge 时 **不能"全量序列化所有 SimpleProperty"**，要对照默认值决定。BOS Core 自带的 BOSObject 序列化器会自动处理；bridge 直接调用即可。

### 7.5 删除 wire format（🟢 实证）

- **删除信号 = 整段 HeadEntity 从 DCXML omit**——**没有 `<EntityServiceRule action="remove" oid="..." />`** 也**没有 `<EntityServiceRules action="setnull" />`**
- BOS 服务端用 **baseline-diff reconcile**：比较"客户端发的目标状态" vs "服务端当前 baseline"，发现 EntityServiceRule 在新状态里不存在 → 删除
- v0.1 实施推荐路径：bridge 走 **Load → 修改对象集合 → SaveForIDEV9** 三步，让 BOS Core 自己生成正确 DCXML，**不复刻 wire 文本**

### 7.6 反编译漏字段对实施的启示

GetInvStock 反编译给出 13 个 SimpleProperty，但 wire 出现 22 个字段。差异 6+3 来自 [NonSerialized] 字段或父类继承。

**实施纪律**：bridge 端**不要硬编码字段表**——直接 invoke `MetadataServiceV9Proxy.SaveForIDEV9` 并传入 `GetInvStockBusinessServiceMeta` 实例，让 BOS Core 序列化器读 reflection 自决定哪些字段进 wire。我们的 LLM 输入 schema 走"已知有 default 的字段 ≈ 13 个 + wire 实证补充字段 ≈ 6 个 = ~19 个 typed param"，留余地给客户实战时发现 v0.2 补充字段。

### 7.7 留 v0.2 实证

- ActionId=42 GetPrice / 70 InvMinusCheck / 3 MulUnitConvert / 23 CallBillFunction wire format
- 多条规则同一 entity 时 `<Seq>` 分配规则
- "及时触发" UI toggle 真实映射（实证 wire 里没看到差异，可能 toggle 不持久化或映射至默认值省略的属性）
- 删除多条规则时是否仍走 HeadEntity omit（v0.1 实证仅 1 条删除）
