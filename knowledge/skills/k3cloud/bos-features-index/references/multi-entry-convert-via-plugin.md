<!--
来源:
  - K/3 Cloud VIP 知识库文章《单据转换实现多单据体到目标单的携带和关联》
    作者 eris,2022-09-19,https://vip.kingdee.com/knowledge/359660229883514368
  - 2026-04-30 反编译 Kingdee.BOS.Core.dll 实证 PythonConvertPlugIn 基类存在

实证状态:
  🟡 主流程 — 限制描述 + 默认关联行为 基于 VIP 公开文章
  🟢 实证   — Python 转换插件路径(PythonConvertPlugIn)反编译确认
  🔴 骨架   — eris 文章给的 DLL 代码 → Python 翻译版未在客户环境跑通,仅做参考
-->

# 多单据体到目标单的携带和关联(转换插件方案)

## 限制三句话

1. **K/3 标准转换规则只支持 1 主单据体携带** — 单据头 + 1 个单据体 + 1 个子单据体(子单据体可配多个但每个只能携带 1 行)
2. **关联只用主关联实体匹配** — 默认 单据头→单据头,单据体→单据体;**插件可干预 子单据体→单据体,但不能 单据体→子单据体**(目标单只用关联主实体去关联)
3. **超出标准能力 → 必须写转换插件**(`PythonConvertPlugIn` 或 `AbstractConvertPlugIn` DLL,2026-04-30 反编译实证两条路径都可行)

---

## 决策:Python 还是 DLL?

| 维度 | Python(`PythonConvertPlugIn`)| DLL(`AbstractConvertPlugIn`) |
|---|---|---|
| OpenDeploy v0.1 一键写入 | ✅ `k3cloud_add_convert_plugin(pyScript=...)` | ❌(代码生成 + 编译 + 部署都要客户做) |
| 能挂的事件 | 22 个虚方法全部(实证) | 22 个虚方法全部 |
| 能调的 ServiceHelper | 全部(`clr.AddReference("Kingdee.BOS")` + `from ... import ...`) | 全部 |
| 性能 | IronPython 解释执行,慢 5-20 倍 | 原生 .NET |
| 热更新 | ✅(改完保存即生效) | ❌ 需重启 K3 应用池 |

**默认选 Python**:除非数据量极大(批量处理上万单)或团队已有 .NET 工程要复用,否则一律 Python。

---

## 实现方案(两种途径,VIP 文章原文)

### 方式 1:写转换插件,在 `OnAfterCreateLink` 事件里手动处理

挂在源单→目标单的转换规则的 `<PlugIn>` 节点上,事件触发时:

1. 通过 `e.SourceBusinessInfo.GetEntity("FEntity2")` 取第二个源单单据体(标准转换规则没带过来的那个)
2. `QueryServiceHelper.GetDynamicObjectCollection(this.Context, queryParam)` 查源单第二单据体数据包
3. 把数据塞到目标单的关联父实体(`targetLinConfig.ParentEntityKey`)的 DynamicObjectCollection
4. 同时构造**关联数据包**(挂在关联实体下),写 6 个关键字段:`FlowId` / `FlowLineId` / `RuleId` / `STableName` / `SBillId` / `SId`,让正向反查 + 反写规则能找到关联

### 方式 2:配置多条转换规则 + 合并数据包

配置 A→B 的多条转换规则(每条只带一个单据体),然后在转换插件里自己合并数据包。比方式 1 更复杂,优先选方式 1。

---

## Python 骨架代码(方式 1,翻译自 eris 文章 DLL 版)

```python
import clr
clr.AddReference("Kingdee.BOS")
clr.AddReference("Kingdee.BOS.Core")
clr.AddReference("Kingdee.BOS.App")
# DynamicObject / DynamicObjectCollection 在独立的 Kingdee.BOS.DataEntity.dll 里,不带这条 import 直接 "No module named Orm"(2026-05-02 实证)
clr.AddReference("Kingdee.BOS.DataEntity")

from Kingdee.BOS.Core.Const import BOSConst
from Kingdee.BOS.Orm.DataEntity import DynamicObject, DynamicObjectCollection
from Kingdee.BOS.ServiceHelper import (
    BusinessDataServiceHelper,
    QueryServiceHelper,
    BusinessFlowServiceHelper,
)
from Kingdee.BOS.Core.SqlBuilder import QueryBuilderParemeter, SelectorItemInfo

def OnAfterCreateLink(e):
    # 1. 检查目标单是否配置了关联实体
    target_link_set = e.TargetBusinessInfo.GetForm().LinkSet
    if not target_link_set or not target_link_set.LinkEntitys or target_link_set.LinkEntitys.Count == 0:
        return

    # 2. 取目标单的关联主实体配置(平台只支持 1 个,取第 0 个)
    target_link_config = target_link_set.LinkEntitys[0]
    target_link_entity = e.TargetBusinessInfo.GetEntity(target_link_config.Key)
    target_parent_entity = e.TargetBusinessInfo.GetEntity(target_link_config.ParentEntityKey)

    # 3. 拿源单第二单据体(假设 key 叫 FEntity2)
    src_entity2 = e.SourceBusinessInfo.GetEntity("FEntity2")
    src_pk_field = e.SourceBusinessInfo.GetForm().PkFieldName

    # 4. 收集所有目标数据包对应的源单 ID
    target_ex_datas = e.TargetExtendedDataEntities.FindByEntityKey("FBillHead")
    src_pk_values = []
    for ex_data in target_ex_datas:
        src_objs = ex_data[BOSConst.ConvSourceExtKey]
        for o in src_objs:
            src_pk_values.append(int(o[src_pk_field]))

    # 5. 一次性查源单第二单据体数据包
    src_entity2_objs = _query_entity2(self.Context, e.SourceBusinessInfo, src_entity2, src_pk_values)
    if src_entity2_objs.Count == 0:
        return

    # 6. 对每个目标数据包,把对应的第二单据体数据塞进关联父实体 + 创建关联数据包
    for ex_data in target_ex_datas:
        # ... 见 eris 原文 OnAfterCreateLink 后半段 ...
        pass

# 注:6 个关联字段(FlowId / FlowLineId / RuleId / STableName / SBillId / SId)
# 必须正确填写,否则正向反查 / 反写规则会错位。
# 对应 DynamicProperty 在 target_link_entity.DynamicObjectType.Properties 里取
```

**完整 Python 翻译版(含 _query_entity2 helper)**:本文件不展开,推荐参照 eris 原文 + 项目交付时让 agent 现场生成。Python 写到这一步主要为了证明可行性,生产代码请 agent 按当前需求精确生成。

## ⚠️ 必踩坑:Entity.Key vs Entity.EntryName

Convert rule field mapping(`<TargetEntryKey>` 等)用的是 **Entity.Key**(`FEntity` / `F_PAIJ_Entity_jo3`),但 runtime 在 DynamicObject 上访问 entry 数据时**必须用 Entity.EntryName**(`SAL_OUTSTOCKENTRY` / `PAIJ_Cust_Entry100018`)—— 两个 identifier 不同场合。直接 `target_obj["F_PAIJ_Entity_jo3"]` 会报 "实体类型 SAL_OUTSTOCK 中不存在名为 F_PAIJ_Entity_jo3 的属性"(2026-05-02 实证)。

正确写法:

```python
entity = e.TargetBusinessInfo.GetEntity("F_PAIJ_Entity_jo3")  # by Key
collection = target_obj[entity.EntryName]                      # use EntryName
```

## ⚠️ 必踩坑:用 LoadSingle 接口取源单数据,不要 SQL

**eris 文章说"`ex_data[BOSConst.ConvSourceExtKey]` 拿源单数据" 错** —— 客户实战代码没人这么用,2026-05-02 实证 `ex_data["ConvertSource"]` 返回的是 `tempObject` 临时容器,不含完整源 entry 数据。

**正确路径**(参照客户 sarcah/JSJXCloud2025 + 天宇药业 HTypePlugin 模式):

1. 通过目标单标准 entry 的 `FEntity_Link[0]["SBillId"]` 拿源单 FID
2. **`BusinessDataServiceHelper.LoadSingle(ctx, sbillId, sourceBusinessInfoType)`** 读完整源单
3. 源单 DynamicObject 用 `source_bill[srcEntity.EntryName]` 拿到 entry 的 DynamicObjectCollection,字段访问全走 DynamicObject 属性名(没列名猜测)

```python
import clr
clr.AddReference("Kingdee.BOS")
clr.AddReference("Kingdee.BOS.Core")
clr.AddReference("Kingdee.BOS.DataEntity")        # DynamicObject 在这
clr.AddReference("Kingdee.BOS.ServiceHelper")     # BusinessDataServiceHelper 在这,不是 Kingdee.BOS.App

from Kingdee.BOS.Orm.DataEntity import DynamicObject, DynamicObjectCollection
from Kingdee.BOS.ServiceHelper import BusinessDataServiceHelper

def AfterConvert(e):
    target_entity = e.TargetBusinessInfo.GetEntity("<目标custom entry Key>")
    source_entity = e.SourceBusinessInfo.GetEntity("<源 custom entry Key>")
    if target_entity is None or source_entity is None:
        return
    src_type = e.SourceBusinessInfo.GetDynamicObjectType()  # 不用再 GetFormMetaData

    cache = {}
    for ex_data in e.Result.FindByEntityKey("FBillHead"):
        target_obj = ex_data.DataEntity
        std_rows = target_obj["<目标标准entry的EntryName>"]  # 例如 SAL_OUTSTOCKENTRY
        if std_rows is None or std_rows.Count == 0:
            continue
        # 拿任一行的 FEntity_Link 都行,同一个目标单源 FID 一致
        sbill_id = None
        for r in std_rows:
            links = r["FEntity_Link"]
            if links is not None and links.Count > 0:
                sbill_id = links[0]["SBillId"]
                break
        if not sbill_id:
            continue

        # API 缓存避免 N 个目标 entry 行查 N 次源单
        cache_key = str(sbill_id)
        source_bill = cache.get(cache_key)
        if source_bill is None:
            source_bill = BusinessDataServiceHelper.LoadSingle(e.Context, sbill_id, src_type)
            cache[cache_key] = source_bill
        if source_bill is None:
            continue

        src_rows = source_bill[source_entity.EntryName]
        if src_rows is None: continue
        target_collection = target_obj[target_entity.EntryName]
        for src_row in src_rows:
            new_row = DynamicObject(target_entity.DynamicObjectType)
            # primitive 字段直接 indexer 拷贝
            new_row["FFooQty"] = src_row["FFooQty"]
            # BaseDataField 用 _Id 后缀(简单引用)或整 DynamicObject 赋值(完整引用)
            new_row["FUnitId_Id"] = src_row["FUnitId_Id"]
            target_collection.Add(new_row)
```

**别学**:`DBServiceHelper.ExecuteDynamicObject(ctx, "SELECT ... FROM <源表>")` —— 列名猜测 / 无权限校验 / 跳过 ORM cache。客户代码里有用 SQL 是因为做跨表 JOIN 接口给不出来,**简单"拿源单数据"一律走 LoadSingle**。

---

## 关联数据包的 6 个关键字段

| 属性名 | 含义 | 取值来源 |
|---|---|---|
| `FlowId` | 业务流程图内码 | 一般空字符串 |
| `FlowLineId` | 流程路线 | 一般 0 |
| `RuleId` | 当前转换规则 ID | `self.Option.GetVariableValue[ConvertRuleElement]("Rule").Id` |
| `STableName` | 源单据体表编码 | `BusinessFlowServiceHelper.LoadTableDefine(ctx, formId, entityKey).TableNumber` |
| `SBillId` | 源单单据 ID | 源数据包的 `FID` |
| `SId` | 源单被关联实体内码(分录内码) | 源数据包的 `<EntityKey>_<EntryPkFieldName>` |

漏写或写错任何一个,K/3 客户端"正向查"和反写规则都会找不到关联。

---

## DLL 版完整代码

参照 VIP 原文:https://vip.kingdee.com/knowledge/359660229883514368

OpenDeploy v0.1 不支持 DLL 工程化(代码生成 + 编译 + 部署),需要走 DLL 时让用户拿 eris 原文骨架去 VS 开新工程。**优先选 Python 路径**。
