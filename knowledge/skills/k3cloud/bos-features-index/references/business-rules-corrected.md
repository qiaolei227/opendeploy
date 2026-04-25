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

### 1.2 RaiseEventType 位标志 (🟢 反编译 line 10831–10838)

`RaiseEventType` 是一个位标志枚举，用于指定服务在哪些事件时触发。在 `FormBusinessService` 的 `RaiseEventType` 属性 getter 中通过 `ApplyRaiseMode` 组合:

| 位值 | 含义 | C# 枚举值 |
|---|---|---|
| `1` | 字段值变化 (`RaiseValueChanged`) | `(RaiseEventType)1` |
| `2` | 初始化/新增数据时 (`RaiseInitialized`) | `(RaiseEventType)2` |
| `4` | 行被添加 (`RaiseItemAdded`) | `(RaiseEventType)4` |
| `8` | 行被重置 (`RaiseItemReset`) | `(RaiseEventType)8` |
| `16` | 行被删除 (`RaiseItemRemoved`) | `(RaiseEventType)16` |
| `32` | 集合重置 (`RaiseReset`) | `(RaiseEventType)32` |
| `64` | 选中行变化 (`RaiseSelectRowChanged`) | `(RaiseEventType)64` |
| `256` | 选中行扩展变化 (`RaiseSelectRowExtChanged`) | `(RaiseEventType)256` |

> 🟢 **来源**: line 10831–10838 `ApplyRaiseMode` 调用序列中的硬编码 `(RaiseEventType)N` 值。

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

## 4. FKERNELXML 序列化形态

### 4.1 架构层次

BOS 元数据通过 `[SimpleProperty]` / `[CollectionProperty]` / `[ComplexProperty]` 注解驱动 JSON/XML 序列化 (BOS 自研序列化框架，非标准 XmlSerializer)。

**业务规则相关的序列化树** (🟡 基于属性注解推断 + capability-catalog.md 现有知识):

```
FormMetadata
└─ BusinessInfo      [ComplexProperty, line 225750]
   └─ Entrys/HeadEntity/EntryEntity
      └─ EntityServiceRules  [CollectionProperty, line 54192]
         └─ EntityServiceRule
            ├─ Id              [SimpleProperty]
            ├─ Description     [SimpleProperty LocaleValue]
            ├─ IsEnabled       [SimpleProperty DefaultValue=true]
            ├─ PreCondition    [SimpleProperty] ← IronPython 条件表达式文本
            ├─ Seq             [SimpleProperty DefaultValue=0]
            ├─ WhenTrueBusinessServices  [CollectionProperty]
            │  └─ FormBusinessService
            │     ├─ ActionId     [SimpleProperty]
            │     ├─ ClassName    [SimpleProperty] ← 服务类全名
            │     ├─ Parameters   [SimpleProperty]
            │     ├─ IsEnabled    [SimpleProperty DefaultValue=true]
            │     ├─ Name         [SimpleProperty]
            │     └─ Seq          [SimpleProperty]
            └─ WhenFalseBusinessServices  [CollectionProperty]
               └─ FormBusinessService (同上)

   Field
   └─ UpdateActions  [CollectionProperty, line 12110]
      └─ FormBusinessService (同上结构)
```

### 4.2 FKERNELXML 中的业务规则 XML 示例 (🟡)

> ⚠️ 以下 XML 形态基于 C# 序列化注解推断，XML tag 名与 C# 属性名对应（BOS 序列化框架约定），但**未在真实 FKERNELXML 中直接验证**。如需确认，在客户环境导出有业务规则的扩展的 FKERNELXML 后比对。

```xml
<!-- 在 FKERNELXML 的 BusinessInfo > Entrys > EntryEntity 节点内 -->
<EntityServiceRules>
  <EntityServiceRule>
    <Id>a1b2c3d4-1234-5678-abcd-000000000001</Id>
    <Description>
      <Value lang="zh-CN">金额 = 数量 × 单价</Value>
    </Description>
    <IsEnabled>true</IsEnabled>
    <!-- IronPython 前置条件; 空 = 永真 -->
    <PreCondition></PreCondition>
    <Seq>0</Seq>
    <WhenTrueBusinessServices>
      <FormBusinessService>
        <!-- ActionId=2 = Calculate (反编译 line 11406: ACTION_Calculate=2) -->
        <ActionId>2</ActionId>
        <!-- 服务类全名; 计算公式服务的类名需客户环境实证 -->
        <ClassName>Kingdee.BOS.Core.DynamicForm.Business.CalculateFormService</ClassName>
        <!-- Parameters: JSON 数组, 含目标字段 key 和公式表达式 -->
        <Parameters>[{"TargetField":"FAmount","Expression":"FQty * FPrice"}]</Parameters>
        <IsEnabled>true</IsEnabled>
        <Seq>0</Seq>
      </FormBusinessService>
    </WhenTrueBusinessServices>
    <WhenFalseBusinessServices/>
  </EntityServiceRule>
</EntityServiceRules>
```

> 🟡 `ClassName` 字段的具体类名需在 BOS Designer 配置完后 SELECT FKERNELXML 获取真实值。`ACTION_Calculate=2` 已反编译确认 (line 11406)。`ACTION_TakeBaseData=22` 已确认 (line 11413)。`ACTION_CallBillFunction=23` 已确认 (line 10618)。

### 4.3 字段 UpdateActions XML 示例 (🟡)

```xml
<!-- 在 Field 节点内 -->
<UpdateActions>
  <FormBusinessService>
    <ActionId>2</ActionId>
    <ClassName>...</ClassName>
    <Parameters>[{"TargetField":"FSelf","Expression":"FQty * FPrice"}]</Parameters>
    <IsEnabled>true</IsEnabled>
    <!-- RaiseValueChanged=1, RaiseInitialized=2 -->
    <!-- 具体 RaiseEventType 值如何存入 XML 待实证 -->
  </FormBusinessService>
</UpdateActions>
```

---

## 5. 给 agent 写规则的实践纪律

以下规则是 `kingdee_add_business_rule` (Plan 5.12.3) 工具的生成和验证基础:

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

`kingdee_add_business_rule` 工具的 validate-and-retry loop 验证依据:

### 函数白名单 (可在 PreCondition 和 Expression 中调用)

```
GetFlexDetailValue  GetPKValue  GetAcronym  BillTypeParam
IsFloatUnitConvert  OperationStatus  SysParam
Avg  Count  IsDraw  IsPush
GetCurrOrg  GetUser  GetFieldValue  GetDate  GetTime
```

### 字段引用模式 (合法的字段引用形式)

```regex
# 直接字段 key (以 F 开头,含字母数字下划线)
\bF[A-Za-z][A-Za-z0-9_]*\b

# 点分隔基础资料属性
\bF[A-Za-z][A-Za-z0-9_]*\.[A-Za-z][A-Za-z0-9_]*\b

# GetFieldValue 函数调用
GetFieldValue\(\s*["']F\w+["']\s*\)
```

### 禁止模式 (应触发 LLM retry)

```
# SQL 风格函数
\bIIF\(  \bCONCAT\(  \bDATEADD\(  \bISNULL\(  \bDATEDIFF\(
\bLEN\(  \bROUND\(  \bSUBSTR\(  \bUPPER\(  \bLOWER\(

# 危险 import
\bimport\s+os\b  \bimport\s+sys\b  \bimport\s+subprocess\b  \bimport\s+socket\b

# Python 3 语法 (IronPython 是 2.7)
\bprint\s*\(  \bf-string|f"  async\s+def  await\s
```

### 类型限制

- `PreCondition` 必须是 **布尔表达式** (返回 `True`/`False`); 例如 `FQty > 0 and FPrice > 0`
- 计算公式 (`Expression` for ActionId=2) 必须是**值表达式** (返回要赋值的结果); 例如 `FQty * FPrice`
- `EntityServiceRule.PreCondition` 为空字符串 = 永真 (所有行都触发)

---

## 实证级别汇总

### 🟢 反编译方法体直接确认

- `IronPython 2.7.12` 版本 (DLL 文件头 `FileVersion: 2.7.12.1000`)
- `PythonUtil.GetScriptEngine()` 使用 `Python.CreateEngine()` 池化 + `ConcurrentDictionary<int, ScriptEngine>` (line 272291)
- `PythonPlugIn` 的初始化流程: `basePyCode.Execute(scope)` → `pyCode.Execute(scope)` → `scope.SetVariable("xxx", this)` (line 205310–205320)
- 全部 16 个 FuncDefine/Function 类存在 + `GetFuncDefine()` 返回 delegate 签名 (各类 GetFuncDefine override)
- `EntityServiceRule` 属性: `Id` `Description` `IsEnabled` `PreCondition` `Seq` `WhenTrueBusinessServices` `WhenFalseBusinessServices` (line 227060–227130)
- `Entity.EntityServiceRules: List<EntityServiceRule>` 以 `[CollectionProperty]` 修饰 (line 54192)
- `Field.UpdateActions: List<FormBusinessService>` 以 `[CollectionProperty]` 修饰 (line 12110)
- `RaiseEventType` 8 个位值 (line 10831–10838)
- `FormBusinessService.ACTION_Calculate=2`, `ACTION_TakeBaseData=22`, `ACTION_CallBillFunction=23` (line 11406, 11413, 10618)
- `DataChangedEventArgs` 属性 (`Field` `NewValue` `OldValue` `Row`) (line 284642)
- `AfterDeleteRowEventArgs` 属性 (`EntityKey` `Row` `DataEntity`) (line 210531)
- `BOSExpression` 构造: `new BOSExpression(condition, (ExpressionKind)1, null, false)` (line 241622)

### 🟡 类名/接口推断，未直读执行路径

- XML tag 名与 C# 属性名的对应关系 (BOS 序列化框架是自研的，tag 可能有别名)
- `FormBusinessService.ClassName` 的具体值 (如计算公式服务的全名; 受 obfuscation 影响)
- `GetDate`/`GetTime` 函数在表达式引擎中注册的字符串 key (line 194839 受 obfuscation)
- Python 标准库模块 (`math`, `datetime`) 是否可 import
- 条件表达式 (`PreCondition`) 的具体字段引用模式

### 🔴 需客户环境实证

- 完整的 FKERNELXML XML 结构验证 (需导出有规则的扩展)
- `FormBusinessService.ClassName` 具体类名列表 (需从真实配置中 SELECT)
- `Parameters` JSON 结构 (需从真实 BOS Designer 配置后的 DB 读取)
- `RaiseEventType` 在 XML 中的存储格式 (int? 还是名称字符串?)
- IronPython 沙箱的 `import` 白名单/黑名单
