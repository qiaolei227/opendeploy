# K/3 Cloud WebAPI 错误处理

<!-- 来源:vip.kingdee.com 文档 + CSDN / 社区踩坑文章;实证状态:🟡 主流程,错误码数值 / 限流阈值非客户环境实测 -->

K/3 Cloud WebAPI 的错误**不走标准 HTTP 状态码**——绝大多数错误返回 `HTTP 200` + `ResponseStatus.IsSuccess:false` + 业务错误消息。这导致客户端如果只判 HTTP 200 就认为成功会误判。**真正的成功判据是 `ResponseStatus.IsSuccess === true`**。

---

## 错误分层模型

K/3 Cloud 错误分 3 层,**排查顺序**也是这个顺序:

| 层 | 特征 | 典型定位 |
|---|---|---|
| **传输层** | HTTP 非 200(500 / 502 / 503 / 超时 / DNS 错) | 网络 / 服务端 IIS / 应用池回收 |
| **会话层** | HTTP 200 + `MsgCode: 1` | Session 失效 / 用户被踢 / IP 白名单 |
| **业务层** | HTTP 200 + `IsSuccess: false` + `Errors[].Message` | 字段校验 / 权限 / 数据冲突 |

---

## 1. 传输层错误

| HTTP | 含义 | 常见原因 | 处理 |
|---|---|---|---|
| `500 Internal Server Error` | 服务端异常 | 插件崩溃 / 数据库连接失败 / JSON 字段顺序错触发内部异常 | **不建议无差别重试**——500 有可能是**幂等不安全**(Save 已经写入部分表,重试会重复)。先看服务端日志定位 |
| `502 / 503` | 网关 / 后端过载 | 应用池回收 / IIS 重启 / 集群节点下线 | 指数退避重试:1s → 2s → 4s → 放弃 |
| `504 / timeout` | 请求超时 | 大批量查询 / 复杂下推 / 网络抖动 | 超时不等于失败——幂等的查询重试,非幂等的(Save / Audit)**必须先查状态再决定** |
| DNS / TCP 错 | 域名解析 / 连接被拒 | 客户 VPN 断 / 服务器宕 | 重试,同时告警运维 |

> 来源:[金蝶云 WebAPI 开发权威文档](https://blog.csdn.net/weixin_42453228/article/details/152535811) fetched 2026-04-23

### HTTP 500 + `errorCode:500` 的常见陷阱

**"字段 xx 是必填项"**——典型案例:明明 JSON 里传了客户 ID,仍报"字段'客户'是必填"。

原因:**字段顺序错了**,客户字段放在了单价 / 物料之后,被后续自动化逻辑覆盖成空。

对策:
1. 在 `Save` 请求里加 `IsAutoAdjustField: "true"`
2. 或手工把客户字段放 `Model` 最前,必填主数据(组织 / 客户 / 币别)永远最先

来源:[对接金蝶 Open API 500 字段必填](https://blog.csdn.net/Monarchess_1234/article/details/122563222) fetched 2026-04-23

---

## 2. 会话层错误

```json
{
  "Result": {
    "ResponseStatus": {
      "IsSuccess": false,
      "MsgCode": 1,
      "Errors": [{ "Message": "Session 已失效,请重新登录" }]
    }
  }
}
```

**`MsgCode: 1` = session 失效**。原因:

- 闲置 20 分钟无请求(默认)
- 账号在别处登录把当前 session 踢了
- 服务端 IIS 重启

**对策**:集成层**统一包装**登录 + 业务调用,检测到 `MsgCode:1` 自动**重新登录后重试一次**(注意:**只重试一次**,避免 AppSecret 错时死循环)。

---

## 3. 业务层错误

响应形态:

```json
{
  "Result": {
    "ResponseStatus": {
      "IsSuccess": false,
      "MsgCode": 0,
      "Errors": [
        {
          "FieldName": "FPrice",
          "Message": "含税单价为 0",
          "DIndex": 0
        }
      ],
      "SuccessEntitys": []
    }
  }
}
```

### 常见业务错误速查

| 错误消息(模糊匹配) | 根因 | 对策 |
|---|---|---|
| "字段'客户'是必填" | 客户状态被禁 / 字段顺序错 / 客户 Number 打错 | 先查客户状态,再调字段顺序 |
| "含税单价为 0" / "非赠品价格不能为 0" | 后续字段触发自动定价覆盖 | 价格字段放分录尾部,或禁用自动定价服务 |
| "整单收款计划应收金额合计不等于整单价税合计" | 自动定价和传入金额冲突 | **只传物料 + 数量 + 单价**,金额 / 计划由系统算 |
| "销售员是必录项" | 员工组织不对 / 未启用销售员分配 | 重新在对应组织下建立员工任职 |
| "ResolveFiled_InnerEx 解析字段... 异常" | 联系人格式错误 | 参考 [联系人 API 结构](https://vip.kingdee.com/article/84231299908315648) |
| "插件取消了保存操作" | `BeforeSave` 插件 `e.Cancel = true` | WebAPI 不显示详细原因,**让客户看服务端日志**或在插件里加 `Console.WriteLine` |
| "负库存限制" | 仓存参数不允许负库存 | `InterationFlags: "STK_InvCheckResult"` 或改仓存设置 |
| "子系统 xxx 未购买" | `SubSystemId` 对不上实际授权 | 用客户已买模块的 ID(销售=23 / 库存=21 / 采购=20) |
| "物料 xxx 不存在" / 物料行被删 | 基础资料校验 / 关键字段设置导致自动删行 | `IsVerifyBaseDataField: "true"` + 重新检查关键字段配置 |
| "查不到单价 / 金额"(报表场景) | administrator 无报表权限 | 换有业务权限的用户登录 |

来源:[销售管理常见 WEBAPI 问题汇总](https://vip.kingdee.com/article/208667621993517568) + [浅谈 WebAPI 对接](https://vip.kingdee.com/article/11179) fetched 2026-04-23

### 错误码是否稳定?

⚠️ **金蝶官方 K3Cloud WebAPI 没有公开发布稳定的错误码表**。不同版本 / patch 的消息文字会变,**不要对 `Errors[].Message` 做硬编码匹配**。如果必须匹配,匹配**字段名**(`FieldName`)比匹配消息更稳。

<!-- 官方错误码完整列表待用户在客户环境实证 -->

---

## 4. 限流 / 并发控制

### 官方建议

| 场景 | 建议值 | 来源 |
|---|---|---|
| 批量保存(`BatchSave`) | 一次 ≤ 20 条 | [浅谈 WebAPI 对接](https://vip.kingdee.com/article/11179) |
| 服务端并行(`BatchCount`) | ≤ 10,推荐 ≤ 5 | 同上 |
| 客户端线程并发 | 2-10 线程 | 同上 |
| 执行计划周期 | 200 条 / 5 分钟 | 同上 |

### 为什么限?

WebAPI 每次调用都要:
1. 完整走一遍 BOS 单据业务规则(定价 / 权限 / 联动插件)
2. 打开数据库事务,多表写入
3. 触发注册在该单据上的所有插件

比原生 UI 录单**重得多**。超过建议值会:
- 数据库连接池耗尽(默认 100 连接,一半给 UI)
- 应用池内存飙升触发 IIS 回收
- 插件异常拖慢整批

### 限流时的表现

K/3 Cloud **服务端没有显式限流返回码**(不像阿里云那种 429 Too Many Requests)。超载表现是:

- 响应时间拉长到 30s+
- 间歇 HTTP 500
- 客户端 socket timeout

<!-- KDC-01407 等具体错误码见诸于部分云平台材料,客户 K3Cloud V9 私有部署是否返回待实证 -->

### 退避策略

```
retry_delays = [1s, 2s, 4s, 8s]
for attempt, delay in enumerate(retry_delays):
    try:
        resp = call(...)
        if resp.IsSuccess or attempt == len(retry_delays) - 1:
            return resp
    except TimeoutError:
        pass
    sleep(delay)
```

**但:**

- **Save / Audit 等写操作**必须**先查状态再重试**——WebAPI 不保证幂等,盲目重试可能创建重复单
- **查询类**安全,直接重试
- **审核幂等**——对已审核单再 Audit 会返回"已审核"的业务错误,不会重复变更

---

## 5. 事务行为

### BatchSave 部分失败

`BatchSave` **不是全组原子事务**——每条单独走自己的事务,可能出现:

```json
{
  "SuccessEntitys": [ { "Id": "A", "Number": "X1" } ],
  "Errors": [
    { "Message": "第 2 条...", "DIndex": 1 }
  ]
}
```

**第 1 条成功,第 2 条失败,第 1 条不回滚**。集成层要:

1. **记录 `SuccessEntitys`**,知道哪些真的落账
2. 按 `Errors[].DIndex` 定位失败行,单独修后重推
3. 不要简单"失败就整批重跑"——会重复创建已成功的单

### 下推(Push)事务

下推是单据创建 + 关联更新两阶段。默认任一阶段失败整体回滚。设 `IsDraftWhenSaveFail:true` 会把失败的下游单**存成暂存态**(不是回滚也不是成功),供人工修复。

---

## 6. 调试方法

### 第 1 步:对照 UI 手工录

WebAPI 问题 80% 来自字段值 / 顺序 / 联动。**先在 K/3 Cloud 客户端 UI 手工录一条**成功,再对照字段逐个看 API payload。

### 第 2 步:Postman 单条测

不要上来就写批量脚本。Postman / curl 发一条最简 JSON,看 `Result` 响应里:

- `IsSuccess: true` → 字段顺序 / 必填没问题,可上集成
- `IsSuccess: false` → 按 `Errors[0].Message` / `FieldName` 定位

### 第 3 步:查服务端日志

`WebSite\Log\` 下有每日日志,搜:
- 请求时间戳(必须让客户精确到秒)
- 错误堆栈(插件异常 / 数据库超时 / 权限拒绝)
- SQL 执行耗时(慢查询定位)

<!-- 日志文件具体命名 / 路径随金蝶版本可能有差异,待用户实证 -->

### 第 4 步:启用 WebAPI 日志

`WebSite\App_Data\Common.config` 里有 WebAPI 日志开关(具体 key <!-- 待用户实证 -->),开启后每次请求 / 响应落盘,用于重现问题。性能有影响,**上线后务必关**。

---

## 7. 找不到官方错误码时怎么回答

✅ **正确姿势**:

> "这个错误 '<消息>' 我在官方 V6.0 说明书没找到对应错误码。建议:
> 1. 让客户看 `WebSite\Log\` 当天日志的堆栈
> 2. 用业务用户(不是 administrator)在 UI 手工录一条对比
> 3. 如仍无解贴到 `vip.kingdee.com` 问答区,金蝶工程师会回"

❌ **错误姿势**:

> "根据我的经验,这个错误码是 1047,表示 xxx,你应该 yyy"
>
> ← **编造**。训练数据里的错误码多为陈旧 / 拼接,说出来会误导用户反复折腾。

---

## OpenDeploy 工具覆盖

- ❌ **不自动调用 WebAPI**——错误处理由客户集成层做
- ✅ **可用 `kingdee_execute_readonly_query` 查元数据**定位字段名 / 单据结构(仅元数据,不是业务数据)
- ✅ **可生成 Python / C# 客户端参考代码**,含错误处理骨架

---

## 临时话术

> "WebAPI 报错第一步看**成功判据**——不是 HTTP 200 就成功,必须 `ResponseStatus.IsSuccess === true`。你这个错误属于 [传输层 / 会话层 / 业务层] 的哪一层?把完整的响应 JSON 贴一下,我按 `Errors[0].FieldName` 和 `Message` 定位。错误码数值以你们 K3Cloud 版本的服务端日志为准——金蝶没公开统一错误码表。"
