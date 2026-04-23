# K/3 Cloud WebAPI 认证

<!-- 来源:vip.kingdee.com 文档 + 社区文章;实证状态:🟡 主流程,字段名 / Cookie 键名 / 错误码非客户环境实测 -->

K/3 Cloud WebAPI 的认证有 **3 种方式**,选哪一种取决于客户的**部署形态**(公有云 / 私有云)和**版本**(8.0 之前 / 8.0+)。**先问清楚再发指引**——上错认证方式会反复跳错。

---

## 三种登录方式速选表

| 方式 | 端点 | 适用场景 | 凭据 |
|---|---|---|---|
| **账号密码登录** | `AuthService.ValidateUser` | 私有部署 V8.0 之前 / 测试环境 / 一次性运维 | 账号 + 密码 |
| **AppSecret 登录** | `AuthService.LoginByAppSecret` | V8.0+ / 公有云新租户(强制) / 长期集成 | AppId + AppSecret + 用户账号 |
| **AppSign 签名登录** | `AuthService.LoginBySignature`(✅ 在 V6.0 文档列出,具体形态 <!-- 待用户实证 -->) | 高安全场景(避免 AppSecret 直接传输) | AppId + 时间戳 + 签名 |

> **公有云**(金蝶云开放平台,`*.kingdee.com`)新租户**禁用**账号密码方式,只能 AppSecret / OpenAPI 流。
> 来源:[金蝶云星空系统集成汇总贴](https://vip.kingdee.com/article/76278025062688512) fetched 2026-04-23

---

## 1. 账号密码登录 — `ValidateUser`

### URL 模板

```
POST http(s)://<服务器>/K3Cloud/Kingdee.BOS.WebApi.ServicesStub.AuthService.ValidateUser.common.kdsvc
Content-Type: application/json
```

### 请求 body

```json
{
  "acctID": "<账套 ID,GUID>",
  "username": "<金蝶账号>",
  "password": "<密码,明文>",
  "lcid": 2052
}
```

| 参数 | 类型 | 说明 |
|---|---|---|
| `acctID` | string (GUID) | **账套 ID**,即 `T_BAS_DATACENTER.FDATACENTERID`。客户管理中心可看,或 `select FDATACENTERID, FNUMBER from T_BAS_DATACENTER` 查 |
| `username` | string | 金蝶账号(不是数据库账号) |
| `password` | string | **明文密码**,这是 V8.0 之前默认行为,V8.0+ 已经废弃这条路 |
| `lcid` | int | 语言 ID,中文 = 2052,英文 = 1033 |

### 典型响应

```json
{
  "LoginResultType": 1,
  "Context": {
    "UserId": "10000",
    "UserName": "demo",
    "UserToken": "...",
    "DBId": "..."
  },
  "Message": ""
}
```

| `LoginResultType` | 含义 |
|---|---|
| `1` | 登录成功 |
| `-1` | 账号或密码错误 |
| `-2` | 账号被禁用 |
| `-3` | 账号被锁定 |
| `-5` | Session 失效 / 账号已被踢下线 <!-- 准确描述待实证 --> |
| `0` | 其他业务异常,看 `Message` |

> ⚠️ 数值映射来自社区文章,**精确值以客户环境实测为准**。来源:[金蝶 WebAPI 登录接口案例](https://vip.kingdee.com/article/266939799507084032) fetched 2026-04-23

### 防踢下线 — `ValidateUser2`

K/3 Cloud 默认开启**单点登录**(同一账号在新位置登录会踢掉旧 session)。集成场景下需用 **`ValidateUser2`** 显式指定不踢:

```json
{
  "acctID": "...", "username": "...", "password": "...", "lcid": 2052,
  "isKickOff": false
}
```

来源:[金蝶云星空 WebAPI 接口说明书 V6.0](https://vip.kingdee.com/article/490771221039228672) fetched 2026-04-23

---

## 2. AppSecret 登录 — `LoginByAppSecret`

### URL 模板

```
POST http(s)://<服务器>/K3Cloud/Kingdee.BOS.WebApi.ServicesStub.AuthService.LoginByAppSecret.common.kdsvc
Content-Type: application/json
```

### 请求 body

```json
{
  "acctID": "<账套 ID>",
  "username": "<金蝶账号>",
  "appId": "<应用 ID>",
  "appSecret": "<应用密钥>",
  "lcid": 2052
}
```

| 参数 | 说明 |
|---|---|
| `appId` | 第三方应用注册时金蝶分配的 ID |
| `appSecret` | 配套密钥 |
| `username` | **仍需要**——AppSecret 是应用级凭据,但 K/3 Cloud 业务上下文还需要绑到一个具体用户身份(决定权限 / 操作日志归属) |

### AppId / AppSecret 怎么来

客户操作步骤(顾问引导,**不是 OpenDeploy 自动化**):

1. 用 administrator 登录 K/3 Cloud 业务账套
2. 进入"系统服务" → "第三方系统登录授权"
3. 新增应用 → 填名称 → 系统生成 AppId + AppSecret
4. **必须设置二次验权密码**——遗忘后只能数据库重置(`T_BAS_USERPARAMETER` 里 `FPARAMETEROBJID='SEC_CHECKIDENTITY'`)

来源:[金蝶云星空第三方系统登录授权密钥重置](https://blog.csdn.net/qq_33881408/article/details/133891440) fetched 2026-04-23

### 优势 vs 账号密码

- ✅ **不传明文密码**,密钥泄露可单独重置不影响用户
- ✅ **可针对应用收回授权**,审计粒度更细
- ✅ **公有云强制**——V8.0+ 唯一可用
- ❌ 仍非真正的 OAuth2(没有 token 短期有效期 / refresh 机制),AppSecret 长期有效

---

## 3. Session / Cookie 处理

### 登录后拿到的 Cookie

成功响应的 HTTP 头里,`Set-Cookie` 字段会返回**至少 2 个 Cookie**:

| Cookie 名 | 作用 |
|---|---|
| `kdservice-sessionid` | K/3 Cloud 业务 session,核心身份凭据 |
| `ASP.NET_SessionId` | ASP.NET 框架 session(共享底层) |

> 后续**所有** API 调用必须带上这 2 个 Cookie。
> 来源:[K/3 Cloud Web API 集成开发 Java 完整例](https://vip.kingdee.com/article/157985) fetched 2026-04-23

### 客户端实现要点

```python
# Python 示例(伪代码,非 OpenDeploy 工具产物)
import requests
session = requests.Session()  # 关键:用 Session 自动携带 Cookie
resp = session.post(login_url, json=login_body)
# 后续所有 API 都用同一个 session
data = session.post(query_url, json=query_body).json()
```

C# / Java 等同理:用 **持久 HTTP 客户端**(`HttpClient` + `CookieContainer` / `CookieManager`),**不要**每次新建。

### Session 何时失效

- **闲置超时**——默认 20 分钟无请求自动断(可在 `Web.config` 改,通常不动)
- **账号被踢**——同账号在另一处登录(除非用 `isKickOff:false`)
- **服务端重启**——所有 session 丢
- **强制 Logout**——主动调 `AuthService.Logout`

失效后调用任何业务 API 会返回 `MsgCode = 1`(session 丢),需重新登录。

---

## 4. 多账套切换

K/3 Cloud 一个数据库实例可挂多个账套(`T_BAS_DATACENTER` 多行)。**同一个 Cookie session 只能绑一个账套**——切账套必须**重新登录**:

```python
session_a = login(acctID="账套A的GUID", ...)  # 操作账套 A
session_b = login(acctID="账套B的GUID", ...)  # 操作账套 B,独立 session
# 不能在同一 session 内切换
```

集成层做法:**为每个账套维护一个 session 池**,按账套 ID 拿对应的 client。

---

## 常见认证错误

| 现象 | 根因 | 处理 |
|---|---|---|
| `LoginResultType = -1` | 账号或密码错 | 提醒用户用 BOS 客户端先登录验证一次 |
| `LoginResultType = -2` | 账号在 K/3 Cloud 里被禁用 | 客户管理员去"用户管理"启用 |
| `acctID 错误`(自定义提示) | 账套 ID 拼错 / 账套未启用 / 账套未做数据库初始化 | `select FNUMBER, FNAME, FENABLE from T_BAS_DATACENTER` 核对 |
| `IP 不在白名单`(8.1+) | 客户在"系统参数"里启用了 IP 白名单 | 让客户加白集成机的出口 IP |
| `AppSecret 不正确` | 密钥过期 / 二次验权密码错 / 应用被禁 | 客户管理中心重新生成 AppSecret + 重置二次密码 |
| `503` / 长时间无响应 | 服务端 IIS 应用池回收 / 数据库连接耗尽 | 让客户查 K3Cloud 服务端日志,集成端做指数退避重试 |

> 具体错误码以客户 K3Cloud 服务端日志为准——HTTP code + Message 文本组合定位。

---

## OpenDeploy 角色边界

- ❌ **不工具化登录**——不持有 AppSecret / 账号密码
- ❌ **不维护 session 池**——不是集成中间件
- ✅ **指引用户**——告诉用户用哪个端点 / 怎么拿凭据 / 失败怎么诊断
- ✅ **辅助生成代码**——用户要 Python/C# 集成模板时给参考实现(标注"非实证")

---

## 临时话术

> "K/3 Cloud WebAPI 有 3 种登录方式:`ValidateUser`(账号密码,V8.0 前可用)、`LoginByAppSecret`(应用密钥,V8.0+ 必须)、`LoginBySignature`(签名,高安全场景)。**你们环境是哪个版本?是私有部署还是公有云?**确认后我给你具体的登录请求体和后续 Cookie 处理示例。"
