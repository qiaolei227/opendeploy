<!-- 来源:open.kingdee.com 二开规范 + help.open.kingdee.com dokuwiki;实证状态:🟡 主流程;非客户环境实测 -->
# 单据转换插件(下推)深入版

> 用于下推场景:销售订单 → 发货通知单 → 销售出库单 → 销售发票。标准 BOS 转换规则 + 字段映射搞不定的复杂逻辑,走此插件。

<!-- 主源:https://open.kingdee.com/K3cloud/SDK/CreateConvertPlugin.html;fetched 2026-04-23 -->
<!-- 副源:https://help.open.kingdee.com/dokuwiki/doku.php?id=%E5%8D%95%E6%8D%AE%E8%BD%AC%E6%8D%A2%E8%A7%84%E5%88%99;fetched 2026-04-23 -->

## 1. 基类

- **完整命名空间**:`Kingdee.BOS.Core.Metadata.ConvertElement.PlugIn.AbstractConvertPlugIn`
- **执行端**:**服务端**(下推操作在服务端完成,客户端只发起)
- **注册节点**:`<ConvertPlugins>`——挂在 **BOS Designer 里的"转换规则"** 上,不是挂单据;同一对源/目标单据可以配多条转换规则,每条规则可以单独挂插件

## 2. 转换插件 vs 标准 BOS 字段映射的边界

BOS Designer 的转换规则界面可以:
- 源字段 → 目标字段直接映射
- 源字段 * 常量 → 目标字段
- 源字段 + if/else 表达式 → 目标字段(低代码表达式)
- 分组策略(按供应商合并 / 按日期合并)
- 排序策略

**搞不定的事**——这才是转换插件的战场:

| 场景 | 标准转换规则 | 转换插件 |
|---|---|---|
| A 字段 → B 字段(直映射) | ✅ | 不必 |
| A * 汇率(查当天汇率表)→ B | ⚠️ 需要用户写表达式 + 汇率预先查好 | ✅ `OnAfterFieldMapping` 里查 `T_BD_EXCHANGERATE` |
| 下推前校验(库存不足不让下推) | ❌ 不支持前置校验 | ✅ `OnInitVariable` / `OnBeforeGetSourceData` |
| 跨单据合并(按客户 + 月份汇总) | ⚠️ 分组策略有限 | ✅ `OnBeforeGroupBy` |
| 调外部 API(转换时查 WMS 库存) | ❌ | ✅ 任意事件 |
| 目标单据加自定义行(源没有,目标加) | ❌ | ✅ `OnAfterFieldMapping` |

---

## 3. 完整事件生命周期

用户点"下推" → 选择目标单据 → 选择转换规则 → 下推执行:

```
[1] OnInitVariable(InitVariableEventArgs e)
     // 初始化:读取业务参数、汇率表、系统配置
     // 最早的钩子,可提前终止转换

[2] OnBeforeGetSourceData(BeforeGetSourceDataEventArgs e)
     // 获取源数据前——可改 SQL
     // e.SQL 是字符串,可直接拼装追加 WHERE

[3] OnGetSourceData
     // 框架执行 SQL 取源数据
     // 一般不 override,除非 CreateDraw 特殊场景

[4] OnGetDrawSourceData(GetDrawSourceDataEventArgs e)
     // 界面选择下推的源数据获取(点选时)
     // 和 OnGetSourceData 二选一

[5] OnBeforeGroupBy(BeforeGroupByEventArgs e)
     // 分组前——可改分组策略
     // 典型:按供应商 + 币别合并

[6] OnBeforeFieldMapping(BeforeFieldMappingEventArgs e)
     // 字段映射前

[7] OnFieldMapping(FieldMappingEventArgs e)
     // 字段映射中——框架调一次/一行目标数据
     // 可改映射值

[8] OnAfterFieldMapping(AfterFieldMappingEventArgs e) ⭐
     // 字段映射后——最常用的钩子
     // 所有标准映射已做完,可处理复杂逻辑

[9] OnCreateLink(CreateLinkEventArgs e)
     // 建立源单-目标单关联行

[10] OnAfterCreateLink(AfterCreateLinkEventArgs e)
     // 关联建立完

[11] OnParseFilter(ParseFilterEventArgs e)
[12] OnParseFilterOptions(ParseFilterOptionsEventArgs e)
     // 解析过滤条件

[13] AfterConvert(AfterConvertEventArgs e)
     // 全部转换完成后回调
```

---

## 4. 常见场景代码示例

### 4a. 跨单据校验(下推前查库存)

```csharp
using Kingdee.BOS.Core.Metadata.ConvertElement.PlugIn;
using Kingdee.BOS.Core.Metadata.ConvertElement.Args;

public class SaleOrderToDeliveryConvertPlugin : AbstractConvertPlugIn
{
    public override void OnInitVariable(InitVariableEventArgs e)
    {
        base.OnInitVariable(e);
        // 遍历源单收集物料 ID
        // 查库存 SQL,判断是否可下推
        // 如果不行:抛 KDException 或记录到 e.Cancel <!-- e.Cancel 待用户实证 -->
    }
}
```

### 4b. 复杂字段映射

```csharp
public override void OnAfterFieldMapping(AfterFieldMappingEventArgs e)
{
    base.OnAfterFieldMapping(e);

    // e.TargetExtendedDataEntities 是目标数据(已经过标准映射)
    foreach (var target in e.TargetExtendedDataEntities)
    {
        var targetRow = target.DataEntity;
        // 源数据通过 target 关联获取
        // 典型:把源的描述字段 + 客户简称拼成目标的备注
        targetRow["FRemarks"] = $"{srcRemarks}|客户:{srcCustomerShortName}";

        // 对基础资料字段赋值(F7 类型)要用 FieldUtils.SetBaseDataFieldValue
        // FieldUtils.SetBaseDataFieldValue(ctx, "FSupplier", targetRow, supplierId);
    }
}
```

### 4c. 调外部 API

```csharp
public override void OnAfterFieldMapping(AfterFieldMappingEventArgs e)
{
    base.OnAfterFieldMapping(e);

    foreach (var target in e.TargetExtendedDataEntities)
    {
        // 查询 WMS 外部系统的可用库存——同步调用会拖慢下推
        // 最佳实践:在 OnInitVariable 里批量查一次,这里读缓存
        decimal availableQty = GetWmsStock(materialId);
        if (availableQty < targetQty)
        {
            // 降级处理:把目标数量改成可用的
            targetRow["FQty"] = availableQty;
        }
    }
}
```

---

## 5. EventArgs 主要字段

### `AfterFieldMappingEventArgs`

| 属性 | 类型 | 含义 |
|---|---|---|
| `TargetExtendedDataEntities` | `ExtendedDataEntity[]` | 已映射的目标数据(可读可改) |
| `SourceExtendedDataEntities` | `ExtendedDataEntity[]` | 源数据(参考用) |
| `Rule` | `ConvertRuleElement` | 当前使用的转换规则对象 |

### `FieldMappingEventArgs`

| 属性 | 类型 | 含义 |
|---|---|---|
| `MappingField` | `string` | 当前映射的目标字段 Key |
| `SourceField` | `string` | 源字段 Key |
| `SourceValue` | `object` | 源值 |
| `TargetValue` | `object` | 目标值(可改) |

---

## 6. FieldUtils 常用方法

基础资料(F7)字段和数量字段的赋值方式不同,金蝶提供 `FieldUtils` 工具类:

```csharp
using Kingdee.BOS.Core.Metadata.FieldElement;

// 基础资料字段(如 FSupplier,F7 类型)
FieldUtils.SetBaseDataFieldValue(ctx, "FSupplier", targetRow, 12345L);

// 数量字段
FieldUtils.SetDecimalFieldValue(ctx, "FQty", targetRow, 100m);
```

<!-- FieldUtils 完整 API 待反编译核实 -->

---

## 7. 注册到元数据

**转换插件不挂单据**,挂**转换规则**。需要查转换规则的元数据表(不是 `T_META_OBJECTTYPE`)。

<!-- 具体表名待实证:T_BAS_CONVERTRULE / T_BAS_CONVERTRULEPLUGIN / FKERNELXML 里的 ConvertRule 节点-->

元数据节点大致结构(引用格式 — 未实证):

```xml
<ConvertRule>
  <SourceFormId>SAL_SaleOrder</SourceFormId>
  <TargetFormId>SAL_DELIVERYNOTICE</TargetFormId>
  <Plugins>
    <PlugIn>
      <ClassName>ABC.SAL.SaleOrderToDeliveryConvertPlugin</ClassName>
      <AssemblyName>ABC.SAL.BusinessPlugIn</AssemblyName>
    </PlugIn>
  </Plugins>
</ConvertRule>
```

**OpenDeploy v0.1 不自动化此步骤**。转换规则通常在 BOS Designer 里打开"转换规则"节点,右键插件——然后手动填完整类名和程序集。

---

## 8. 常见坑

- **不 override `OnInitVariable` 里准备数据**→ 事件里反复查同一张表,下推 100 单下 100 次
- **`OnFieldMapping` 里查数据库**→ 每行都查,下推 1000 行 = 1000 次 DB 往返
- **源数据没声明字段**→ `row["F_xxx"]` 是 null。类似操作插件,转换插件也有类似"字段声明"的逻辑,但走转换规则的字段映射配置<!-- 具体机制待实证 -->
- **转换插件里改源数据**——源数据不会真正写回,改了等于白改,只改目标

---

## 临时话术(agent 引用)

> 你这个需求是【下推时字段复杂映射 / 跨单据校验 / 分组合并】,要用**单据转换插件**:
>
> - 基类:`Kingdee.BOS.Core.Metadata.ConvertElement.PlugIn.AbstractConvertPlugIn`
> - 关键事件:`OnAfterFieldMapping`(最常用)/ `OnInitVariable`(初始化)/ `OnBeforeGroupBy`(改分组)
> - 挂在**转换规则**上(不是挂单据)——在 BOS Designer 的"转换规则"节点配
> - 性能关键:预加载数据放 `OnInitVariable`,不要在 `OnFieldMapping` 里查 DB
>
> 如果只是"源 A 字段 * 常量 → 目标 B 字段",标准转换规则的表达式已经够用,不需要写插件。
>
> 代码需要 VS 写,本产品 v0.1 不代办;如需 VS 工程搭建细节见 `development-setup.md`。
