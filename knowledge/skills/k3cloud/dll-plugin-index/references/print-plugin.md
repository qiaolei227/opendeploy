<!-- 来源:open.kingdee.com 二开规范 + help.open.kingdee.com dokuwiki;实证状态:🟡 主流程;非客户环境实测 -->
# 打印插件深入版

> 打印插件用于:动态条码 / 动态二维码、大写金额、运行时选模板、按数据动态加/删行。

<!-- 打印插件基类和事件签名在金蝶开放平台文档里未有独立 SDK 页,以下基于二开规范 + 社区惯例 -->
<!-- 主源:https://open.kingdee.com/k3cloud/open/developspecs.html;fetched 2026-04-23 -->

## 1. 基类

- **完整命名空间**<!-- 签名待反编译核实 -->:`Kingdee.BOS.Core.Print.PlugIn.AbstractPrintControlPlugIn` <!-- 待用户实证 -->
- **执行端**:服务端取数 + 客户端渲染(插件事件在服务端跑)
- **注册节点**:`<PrintPlugins>` <!-- 节点名待用户实证 -->——挂在**打印模板**上,不是挂单据

## 2. 打印插件 vs BOS 报表列定制 vs 打印模板设计器

用户常常混:

| 需求 | 工具 |
|---|---|
| 打印时加一列(固定字段) | **打印模板设计器**(BOS Designer 里)—— 不需要插件 |
| 大写金额(合计转汉字) | **打印模板设计器**的公式字段 — 有内置 `UpperMoney()` 表达式<!-- 表达式名待实证 --> |
| 动态条码(EAN128 / QRCode) | **打印插件**(模板本身渲染不了条码图,插件把数据加工成二维码 URL / Base64) |
| 按客户类型选不同模板 | **打印插件**的 `OnGetTemplate` <!-- 事件名待实证 --> |
| 按数据动态增加明细行 | **打印插件** + 数据源修改 |
| 打印日志(谁打的、几点打的) | **打印插件**的 `OnPrintComplete` <!-- 事件名待实证 --> |

**关键**:能用模板设计器搞定的**不要**用插件。插件只处理"运行时数据/模板需要根据单据内容变化"的场景。

---

## 3. 关键事件<!-- 完整事件列表待反编译核实 -->

| 事件方法 | 触发时机 | 用途 |
|---|---|---|
| `OnGetTemplate` <!-- 签名待核实 --> | 选模板前 | 根据单据数据动态返回不同模板 ID(如:进口客户走英文模板) |
| `OnPreparePrintData` <!-- 签名待核实 --> | 准备数据前 | 提前查关联数据,塞到数据源 |
| `OnDataLoadComplete` <!-- 签名待核实 --> | 数据加载完、渲染前 | **最常用**——对打印数据源的行做加工(加字段、改值、拼凑条码) |
| `OnPrintComplete` <!-- 签名待核实 --> | 打印完成 | 写日志、发通知 |

### 示例框架(签名待核实,语义正确)

```csharp
using Kingdee.BOS.Core.Print.PlugIn;   // 命名空间待核实

public class SaleOrderPrintPlugin : AbstractPrintControlPlugIn   // 基类名待核实
{
    public override void OnDataLoadComplete(...)   // 签名待核实
    {
        // 1. 从 e 中获取打印数据源(数据行集合)
        // 2. 对每行计算二维码内容,写到自定义字段 F_QRCodeText
        //    (模板设计器里把 F_QRCodeText 绑到条码控件)
        // 3. 对合计金额计算大写,写到 F_AmountInWords
    }
}
```

---

## 4. 常见需求模式

### 4a. 动态二维码

1. BOS Designer 里在单据 / 打印模板加一个自定义字段 `F_QRCodeText`(字符串)
2. 打印模板里用"条码控件"(一维/二维码)绑定此字段
3. 插件在 `OnDataLoadComplete` 里计算字符串(如 `$"SO:{FBillNo}|Cust:{FCustomerId}"`)写入
4. 框架把字符串渲染成二维码图

### 4b. 大写金额

优先用模板设计器的 `UpperMoney(FAmount)` 公式。复杂场景(如要自定义字符)走插件:

1. 模板里加 `F_AmountUpper` 字段
2. 插件 `OnDataLoadComplete` 里:`row["F_AmountUpper"] = ConvertToChineseCurrency(row["FAmount"]);`

### 4c. 按客户动态选模板

```csharp
public override void OnGetTemplate(...)   // 签名待核实
{
    var customerCountry = ...;  // 从单据读客户国家
    if (customerCountry == "US")
        return GetEnglishTemplateId();
    else
        return GetChineseTemplateId();
}
```

### 4d. 打印日志

```csharp
public override void OnPrintComplete(...)   // 签名待核实
{
    // 写一条记录到自定义日志表
    // 字段:单据 FID / 打印人 FUserId / 打印时间 / 模板 Id / 份数
}
```

---

## 5. 文档空缺说明 & 实证建议

打印插件是 6 种 DLL 插件里**开放平台文档最稀薄**的一类。建议 agent 在用户真要落地时:

1. 让用户打开 BOS Designer → 单据 → 打印 → 查看现有模板的"插件"字段,记下基类和程序集
2. 或让用户用 ILSpy 反编译 `WebSite\Bin\Kingdee.BOS.Core.dll`,查 `Kingdee.BOS.Core.Print.PlugIn` 命名空间——有什么基类一目了然
3. 或直接找社区帖:`https://vip.kingdee.com/` 有大量金蝶二开问答

**OpenDeploy v0.1 原则**:不编造 API。本 reference 已经把"**是什么 / 为什么 / 大致怎么做**"讲清楚,具体签名由开发者在 VS 里点进去看或反编译获得。

---

## 6. 注册到元数据

<!-- 打印模板的元数据表和 FKERNELXML 节点结构待实证 -->

打印模板的注册通常通过 BOS Designer 的"打印"→"打印模板"→ 右键"插件"完成。元数据落在打印模板自身的配置里,**不在** `T_META_OBJECTTYPE.FKERNELXML`。

**OpenDeploy v0.1 不自动化此步骤**——打印插件的注册路径比扩展对象复杂得多,需要反编译理解元数据表。

---

## 7. 常见坑

- **在 `OnDataLoadComplete` 里改源数据**——不影响 DB,只影响本次打印
- **二维码图不出**——模板里条码控件的"字段"要绑到字符串字段,不是直接绑到二维码图片字段(金蝶的条码控件会自己渲染字符串为二维码)
- **大数据量打印 OOM**——打印上千页时不要在插件里保留大对象

---

## 临时话术(agent 引用)

> 你这个需求是【打印时动态条码 / 大写金额 / 选模板 / 按数据加行】,要用**打印插件**:
>
> - 基类(待实证):`Kingdee.BOS.Core.Print.PlugIn.AbstractPrintControlPlugIn`
> - 核心做法:模板里加个自定义字符串字段,插件在 `OnDataLoadComplete` 给它赋值
>
> ⚠️ 实事求是:金蝶开放平台**没有独立的打印插件 SDK 文档页**,完整事件签名需要开发者用 ILSpy 反编译 `Kingdee.BOS.Core.dll` 或参考客户环境已有示例。
>
> **在决定写之前先确认**:能不能用模板设计器的公式字段搞定?(大写金额 / 简单条码 / 固定列加减)——这些**不需要**写插件。
>
> 代码需要 VS 写,本产品 v0.1 不代办。
