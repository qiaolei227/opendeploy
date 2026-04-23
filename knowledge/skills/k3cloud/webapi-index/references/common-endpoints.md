# K/3 Cloud WebAPI 高频端点

<!-- 来源:vip.kingdee.com WebAPI V6.0 接口说明书 + 社区集成文章;实证状态:🟡 主流程,具体字段 / 边界值非客户环境实测 -->

K/3 Cloud WebAPI 全部端点都挂在 `/K3Cloud/Kingdee.BOS.WebApi.ServicesStub.<Service>.<Method>.common.kdsvc` 这个路径模板下。本文件覆盖**实施集成最常用的 12 个端点**,按"查 → 存 → 提交审核 → 下推 → 删 → 附件"的业务流分组。

> **统一约定**(下文所有端点适用):
> - HTTP 方法:`POST`
> - Content-Type:`application/json`
> - 必须带上登录拿到的 Cookie(`kdservice-sessionid` + `ASP.NET_SessionId`,见 `references/authentication`)
> - 响应顶层一律是 `{ "Result": { ... } }` 结构
> - **所有 `formid` / `FormId` 是单据元数据 ID**——`SAL_SaleOrder` / `STK_InStock` / `BD_MATERIAL` 这类字符串(`T_META_OBJECTTYPE.FID`)

---

## 端点速选表

| 业务动作 | 端点 | 何时用 |
|---|---|---|
| 查列表 / 报表数据 | `ExecuteBillQuery` | 大批量轻字段拉取(同步到 BI / 数仓) |
| 查报表数据 | `GetSysReportData` | 带钻取的标准报表查询 |
| 看单据详情 | `View` | 拿一张单的完整字段 |
| 保存单条单据 | `Save` | 创建 / 修改单条 |
| 批量保存 | `BatchSave` | 一次 ≤ 20 条 |
| 提交单据 | `Submit` | 触发审批流前置态 |
| 审核 | `Audit` | 落账生效 |
| 反审核 | `UnAudit` | 撤回 |
| 下推 | `Push` | 销售订单 → 出库通知单等关联生成 |
| 删除 | `Delete` | 物理删 |
| 工作流审批 | `WorkflowAudit` | 审批流节点处理 |
| 通用操作 | `ExecuteOperation` | 自定义操作触发 |
| 附件上传 | `AttachmentUpLoad` | 绑文件到单 |
| 附件下载 | `AttachmentDownLoad` | 拉文件 |

来源:[金蝶云星空 WebAPI 接口说明书 V6.0](https://vip.kingdee.com/article/490771221039228672) fetched 2026-04-23

---

## 1. ExecuteBillQuery — 查询单据列表

最常用的"拉数据到外部系统"端点。支持分页 / 过滤 / 排序 / 字段选择。

### URL

```
/K3Cloud/Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.ExecuteBillQuery.common.kdsvc
```

### 请求 body

```json
{
  "data": {
    "FormId": "SAL_SaleOrder",
    "FieldKeys": "FBillNo,FDate,FCustId.FNumber,FAmount,FApproveStatus",
    "FilterString": "FDate>='2026-04-01' AND FApproveStatus='C'",
    "OrderString": "FDate DESC",
    "TopRowCount": 0,
    "StartRow": 0,
    "Limit": 1000
  }
}
```

| 参数 | 必填 | 说明 |
|---|---|---|
| `FormId` | ✅ | 单据元数据 ID |
| `FieldKeys` | ✅ | **逗号分隔**的字段名,基础资料用 `.` 取属性(`FCustId.FNumber`)|
| `FilterString` | ❌ | SQL 风格 WHERE,引号是单引号 |
| `OrderString` | ❌ | 排序 |
| `TopRowCount` | ❌ | 仅取前 N 条,`0` = 不限 |
| `StartRow` | ❌ | 分页起始行(0-based)|
| `Limit` | ❌ | 单次最大返回行数,**默认 2000,可改到 10000**(改更大要在服务端 `Web.config` 调)|

### 典型响应

返回**二维数组**(每行是字段值数组,**顺序对应 `FieldKeys`**),不是对象数组:

```json
{
  "Result": [
    ["XSDD000001", "2026-04-22 00:00:00", "C001", 1000.00, "C"],
    ["XSDD000002", "2026-04-22 00:00:00", "C002", 2500.00, "C"]
  ]
}
```

> 客户端必须**按 `FieldKeys` 顺序映射**为对象,这点容易踩坑。

### 注意事项

- **大表慎用**——单查询超过 10 万条建议分多次或走 ETL 工具
- **管理员 user 查报表字段(单价 / 金额)可能为空**——用有报表权限的业务用户登录
- **基础资料字段**用 `FCustId.FNumber` / `FCustId.FName` 而不是直接 `FCustId`(后者拿到的是内码 GUID 不可读)
- **性能**:`FieldKeys` 列越少越快,**别全选**

来源:[使用 ExecuteBillQuery 接口优化数据提取](https://www.qeasy.cloud/dataintegration/041c2078-ecb0-3466-9afc-ec6011dd1c21) fetched 2026-04-23

---

## 2. View — 查单据详情

```
/K3Cloud/Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.View.common.kdsvc
```

```json
{
  "formid": "SAL_SaleOrder",
  "data": {
    "Number": "XSDD000001"
  }
}
```

`data` 里二选一:`Number`(单据编号)或 `Id`(单据内码 FID)。

返回完整 `Result` 对象,包含表头 + 所有分录行,字段全部带 `F` 前缀(原始数据库列名)。

---

## 3. Save / BatchSave — 保存

```
/K3Cloud/Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Save.common.kdsvc
/K3Cloud/Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.BatchSave.common.kdsvc
```

### Save 请求 body(单条)

```json
{
  "formid": "SAL_SaleOrder",
  "data": {
    "Creator": "",
    "NeedUpDateFields": [],
    "NeedReturnFields": ["FBillNo", "FID"],
    "IsDeleteEntry": "true",
    "SubSystemId": "23",
    "IsVerifyBaseDataField": "false",
    "IsAutoAdjustField": "false",
    "InterationFlags": "",
    "IsEntryBatchFill": "true",
    "Model": {
      "FBillTypeID": { "FNUMBER": "XSDD01_SYS" },
      "FDate": "2026-04-22",
      "FSaleOrgId": { "FNumber": "100" },
      "FCustId": { "FNUMBER": "C001" },
      "FSaleOrderEntry": [
        {
          "FMaterialId": { "FNUMBER": "M001" },
          "FQty": 10,
          "FPrice": 100.00
        }
      ]
    }
  }
}
```

| 关键参数 | 说明 |
|---|---|
| `formid` | 单据元数据 ID |
| `Creator` | 创建人金蝶账号(为空 = 用当前 session user) |
| `NeedUpDateFields` | **修改场景**指定要更新的字段(空 = 全字段)|
| `NeedReturnFields` | 响应里要返回的字段 |
| `IsDeleteEntry` | 修改时是否删除未传的分录行(`true` = 替换,`false` = 增量)|
| `SubSystemId` | 子系统 ID(销售=23 / 库存=21 / 采购=20),决定权限校验范围 |
| `IsVerifyBaseDataField` | 启用基础资料校验——失效物料 / 客户会报错而非静默忽略 |
| `IsAutoAdjustField` | **JSON 字段顺序自动调整**——但建议手动排序更稳 |
| `InterationFlags` | 交互校验标志(如 `STK_InvCheckResult` 跳过负库存确认弹窗)|
| `IsEntryBatchFill` | 批量填充分录行(套件 / 多行依赖场景设 `false`)|
| `Model` | **业务数据**,字段对应单据 schema |

### BatchSave 请求 body

把 `Model` 换成 `Model: [...]`(数组),并加 `BatchCount`:

```json
{
  "formid": "SAL_SaleOrder",
  "data": {
    "NeedUpDateFields": [],
    "Model": [ { ... }, { ... }, ... ],
    "BatchCount": 5
  }
}
```

| `BatchCount` | 服务端**并行**保存的分组数,**最大 10**,建议 ≤ 5。值过大会撑爆数据库连接 |

### 响应

```json
{
  "Result": {
    "ResponseStatus": {
      "IsSuccess": true,
      "Errors": [],
      "SuccessEntitys": [ { "Id": "188888", "Number": "XSDD000099" } ],
      "MsgCode": 0
    }
  }
}
```

| `MsgCode` | 含义 |
|---|---|
| `0` | 正常 |
| `1` | session 失效,需重新登录 |
| 其他 | 业务异常,看 `Errors[].Message` |

---

## 4. Submit / Audit / UnAudit — 提交 / 审核

3 个端点结构完全相同,只是动作不同:

```
.../DynamicFormService.Submit.common.kdsvc
.../DynamicFormService.Audit.common.kdsvc
.../DynamicFormService.UnAudit.common.kdsvc
```

```json
{
  "formid": "SAL_SaleOrder",
  "data": {
    "Numbers": ["XSDD000001", "XSDD000002"],
    "Ids": "",
    "InterationFlags": "",
    "NetworkCtrl": "",
    "IgnoreInterationFlag": ""
  }
}
```

| 参数 | 说明 |
|---|---|
| `Numbers` | **单据编号数组**(和 `Ids` 二选一)|
| `Ids` | 单据内码,**逗号分隔的字符串**(注意不是数组)|
| `InterationFlags` | 同 Save——跳过特定校验 |
| `NetworkCtrl` | 网控开关 |

> ⚠️ **不要在 Save 里用 `IsAutoSubmitAndAudit:true` 一把过**——金蝶官方说明高并发下会失败,**建议拆 3 个独立调用**(Save → Submit → Audit),每个有独立的执行计划和重试。
> 来源:[浅谈通过 WebAPI 实现金蝶云单据对接](https://vip.kingdee.com/article/11179) fetched 2026-04-23

---

## 5. Push — 单据下推

下推 = 关联生成下游单据(销售订单 → 发货通知单 → 销售出库单)。

```
/K3Cloud/Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Push.common.kdsvc
```

```json
{
  "formid": "SAL_SaleOrder",
  "data": {
    "Ids": "188888,188889",
    "EntryIds": "",
    "RuleId": "<转换规则内码>",
    "TargetBillTypeId": "",
    "TargetOrgId": 100,
    "TargetFormId": "SAL_DELIVERYNOTICE",
    "IsEnableDefaultRule": "false",
    "IsDraftWhenSaveFail": "false",
    "CustomParams": {}
  }
}
```

| 参数 | 必填 | 说明 |
|---|---|---|
| `Ids` | ✅ (或 Numbers / EntryIds) | 源单内码 |
| `RuleId` | △ | 转换规则内码,**未启用默认规则时必填** |
| `IsEnableDefaultRule` | ❌ | 默认 `false`,设 `true` 让 BOS 自动选规则 |
| `TargetFormId` | ✅ | 下游单据元数据 ID |
| `TargetOrgId` | △ | 多组织时指定目标组织 |
| `IsDraftWhenSaveFail` | ❌ | 失败时存暂存态便于排查 |
| `CustomParams` | ❌ | 字典,传给转换插件的自定义参数 |
| `EntryIds` | ❌ | **按分录下推**(精确到行)的分录内码 |

来源:[67.2 WebApi 下推接口](https://vip.kingdee.com/article/72414858930472704) + [WebAPI 下推接口示例](https://vip.kingdee.com/article/363761596797169152) fetched 2026-04-23

### 注意

- 下推**不通过 UI 事件**,服务端按转换规则配置走,UI 上的"下推时弹窗"等交互**不触发**
- 转换规则插件可读到 `CustomParams`,这是 WebAPI 给插件传上下文的唯一通道
- 下游单据保存失败默认**抛错回来**,不是静默——`IsDraftWhenSaveFail:true` 会把失败的存暂存而不是丢

---

## 6. Delete — 删除

```
/K3Cloud/Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Delete.common.kdsvc
```

```json
{
  "formid": "SAL_SaleOrder",
  "data": {
    "Numbers": ["XSDD000099"],
    "NetworkCtrl": ""
  }
}
```

> ⚠️ 物理删,**不可恢复**。集成场景里删除**应该走反审 → 删,不要直接对已审核单 Delete**——会跳过下游联动校验。

---

## 7. WorkflowAudit — 工作流审批

审批流节点处理(同意 / 拒绝 / 终止)。

```
/K3Cloud/Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.WorkflowAudit.common.kdsvc
```

```json
{
  "FormId": "SAL_SaleOrder",
  "BusinessKey": "188888",
  "UserId": "10000",
  "ApprovalType": 1,
  "Comment": "同意"
}
```

| `ApprovalType` | 含义 |
|---|---|
| `1` | 同意(Approve) |
| `2` | 拒绝(Reject) |
| `3` | 终止流程(Terminate) |

集成 OA / 钉钉审批回写常用此端点。

---

## 8. ExecuteOperation — 通用操作

万能逃生通道。当上面端点都没覆盖你要触发的操作(如自定义按钮 / 特殊业务动作)时:

```
/K3Cloud/Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.ExecuteOperation.common.kdsvc
```

```json
{
  "formid": "SAL_SaleOrder",
  "opNumber": "<操作编码>",
  "data": { ... }
}
```

`opNumber` 在 BOS Designer 单据"操作"页签查得到。**慎用**——这条路绕过了端点级的参数校验,容易踩坑。

---

## 9. AttachmentUpLoad / AttachmentDownLoad — 附件

### 上传(绑定到单据)

```
/K3Cloud/Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.AttachmentUpLoad.common.kdsvc
```

```json
{
  "FileName": "合同.pdf",
  "FormId": "SAL_SaleOrder",
  "InterId": "188888",
  "BillNO": "XSDD000099",
  "SendByte": "<base64 编码的文件内容>"
}
```

> **大文件分片**:`SendByte` 一次性传完一个文件,**单次请求建议 ≤ 5MB**。超过用 `UpLoadFile` + 切片(<!-- 切片接口具体参数待用户实证 -->)。

### 下载

```
/K3Cloud/Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.AttachmentDownLoad.common.kdsvc
```

```json
{
  "FileId": "<附件 ID>",
  "StartIndex": 0
}
```

返回 base64 流。

---

## 字段顺序极其重要(全局通用)

K/3 Cloud WebAPI 模拟"按顺序填字段触发联动事件",所以**字段在 JSON 里的顺序和填单顺序等价**:

| 错序导致的现象 | 正确顺序 |
|---|---|
| 单价被覆盖为 0 | 先填客户 / 物料 → 再填数量 → **最后**填单价 |
| 客户必填报错 | 客户字段放**最前**,在所有引用它的字段之前 |
| 套件子项只第一行成功 | `IsEntryBatchFill: false` + 分录字段按依赖关系排 |

**对策**:
1. 用 `IsAutoAdjustField: true` 让服务端自动排(但**不可控**,大批量时仍建议手动)
2. 在 BOS UI 里**手工录一次**对照字段输入顺序

来源:[销售管理常见 WEBAPI 问题汇总](https://vip.kingdee.com/article/208667621993517568) fetched 2026-04-23

---

## OpenDeploy 工具覆盖

**全部 ❌ 不工具化**——这些端点是**客户的集成层**调用,不是 OpenDeploy 调用。Agent 的角色是给用户**正确的请求体模板和参数解释**。

如果用户问"OpenDeploy 能不能帮我调"——明确告诉:**不能,这是客户业务系统的运行期接口,产品定位是设计 + 部署**。需要的话给参考 Python / C# 代码片段,标注"非实证,以客户环境为准"。

---

## 临时话术

> "这个集成需求走 K/3 Cloud WebAPI 的 `<端点>` 端点。我给你一个请求体模板,**字段顺序很重要**——特别是涉及单价 / 客户 / 物料的,要按 `<具体顺序>` 排。这些字段名 / 端点 URL 来自 [WebAPI V6.0 说明书](https://vip.kingdee.com/article/490771221039228672),具体在你们环境跑通前,**先用 1 条数据 Postman 测**,确认拿到 `IsSuccess:true` 再批量。"
