<!-- 来源:open.kingdee.com 二开规范 + help.open.kingdee.com dokuwiki;实证状态:🟡 主流程;非客户环境实测 -->
# DLL 插件开发环境搭建 + 部署

> 本文回答用户的 4 类问题:
> 1. **VS 工程怎么搭** — 命名规范 / 引用 / 框架版本
> 2. **协同开发平台(CDP)怎么用** — 在线发布流程
> 3. **客户环境怎么部署** — DLL 放哪、要不要重启
> 4. **元数据注册和插件 DLL 的关系** — 为什么仅放 DLL 不够

<!-- 主源:https://open.kingdee.com/k3cloud/open/DevelopStandard.html;fetched 2026-04-23 -->
<!-- 副源:https://open.kingdee.com/k3cloud/open/aboutcdp.aspx;fetched 2026-04-23 -->
<!-- 副源:https://open.kingdee.com/k3cloud/open/developspecs.html;fetched 2026-04-23 -->

---

## 1. VS 工程命名规范

<!-- 来源:https://open.kingdee.com/k3cloud/open/DevelopStandard.html;fetched 2026-04-23 -->

二开规范要求**严格**的命名:

### 1a. 工程命名

`{开发商标识}.{项目}.{工程归类}[.{模块名}]`

- **开发商标识**:你在金蝶协同开发平台注册的开发商代码(如 `ABC` / `K3CTOP`)。**这是 BOS 元数据里 `FSUPPLIERNAME` 字段的来源**——但 OpenDeploy v0.1 写元数据**不盖** `FSUPPLIERNAME`(留 NULL),所以**只在写 DLL 时用此命名**
- **项目**:产品 / 项目代号(如 `K3Cloud` / `MyProject`)
- **工程归类**:`BusinessPlugIn` 是最常见的(业务插件总工程)
- **模块名**:可选,大项目按模块拆(如 `.SAL` / `.PUR` / `.STK`)

**示例工程名**:
- `ABC.K3Cloud.BusinessPlugIn` ← 单工程(简单二开)
- `ABC.K3Cloud.BusinessPlugIn.SAL` + `ABC.K3Cloud.BusinessPlugIn.PUR` ← 多模块(大二开项目)

### 1b. 类名命名

| 插件类型 | 类名后缀模式 | 示例 |
|---|---|---|
| 业务单据插件 | `XxxxxBusinessPlugIn` | `SaleOrderBusinessPlugIn` |
| 服务操作插件 | `XxxxxServicePlugIn` | `SaleOrderAuditServicePlugIn` |
| 转换插件 | `XxxxxConvertPlugin` | `SaleOrderToDeliveryConvertPlugin` |
| 列表插件 | `XxxxxListPlugIn` | `SaleOrderListPlugIn` |
| 报表插件 | `XxxxxReportPlugIn` | `CreditAnalysisReportPlugIn` |
| 打印插件 | `XxxxxPrintPlugIn` <!-- 后缀习惯待实证 --> | `SaleOrderPrintPlugIn` |

### 1c. 命名空间

完整类名 = 工程名(命名空间) + 类名,例如:`ABC.K3Cloud.BusinessPlugIn.SAL.SaleOrderAuditServicePlugIn`。

注册到 `FKERNELXML` 时用此**完整类名**。

### 1d. 字段名(自定义字段)

如果插件用到自定义字段(BOS Designer 加的):

- 字段标识:`F_{ISV标识符}_xxxxx`(如 `F_ABC_CreditLimit`)
- 表名(如果加自定义表):`{ISV标识符}_T_{名称}`
- 字段名(物理字段):`F_{ISV标识符}_{名称}`,≤ 30 字符

---

## 2. .NET Framework 版本

K/3 Cloud V9.x 系列要求 **.NET Framework 4.5+**(建议直接 .NET Framework 4.6.1 / 4.7.2)。

⚠️ **不要用 .NET Core / .NET 5+** —— K/3 Cloud 服务端基于 ASP.NET WebForms / .NET Framework,Core 程序集不兼容。

VS 工程类型:**Class Library(.NET Framework)**,不是 .NET Core Class Library。

---

## 3. 引用金蝶 DLL

<!-- 来源:https://open.kingdee.com/k3cloud/SDK/Kingdee.BOS.Core.html;fetched 2026-04-23 -->

VS 工程必引用的金蝶程序集(都在客户的 `WebSite\Bin\` 目录里):

| DLL 名 | 用途 | 必引? |
|---|---|---|
| `Kingdee.BOS.dll` | 框架核心(`Context` / 事务) | ✅ |
| `Kingdee.BOS.Core.dll` | **所有插件基类**(`AbstractBillPlugIn` / `AbstractOperationServicePlugIn` 等) | ✅ |
| `Kingdee.BOS.App.dll` | 业务对象服务 | 大多数场景需要 |
| `Kingdee.BOS.ServiceHelper.dll` | 标准服务调用包装(`SaveBillResult` 等) | 写操作用 |
| `Kingdee.BOS.Contracts.dll` | 接口契约(报表插件继承的 `SysReportBaseService` 在这里) | 报表插件需要 |
| `Kingdee.BOS.DataEntity.dll` | DynamicObject 数据模型 | ✅ |
| `Kingdee.BOS.Util.dll` | 工具类 | 常用 |
| `Kingdee.BOS.Resource.dll` | 多语种资源 | 多语场景 |

**实操**:把客户环境 `WebSite\Bin\` 的 DLL 拷一份到 VS 工程旁的 `lib\` 目录,在工程里"添加引用"→ 浏览到 `lib\Kingdee.BOS.Core.dll`,**Copy Local 设为 False**(部署时这些 DLL 已经在客户环境里,不要重复拷贝)。

---

## 4. 协同开发平台(CDP)发布流程

<!-- 来源:https://open.kingdee.com/k3cloud/open/aboutcdp.aspx;fetched 2026-04-23 -->

### 4a. CDP 是什么

**协同开发云**(Collaborative Development Platform,CDP) = 集**单据开发 + 插件开发 + 源码管理 + 项目构建 + 在线发布**的金蝶官方二开平台,部署到 `https://open.kingdee.com/k3cloud/cdpportal/`。

CDP 提供:
- **应用源码服务**——所有二开源码必须放 CDP 内置的 SVN(**禁止上传 GitHub**,见二开规范)
- **在线构建**——服务端编译,保证编译环境一致
- **质量分析**——质量报告必须 ≥70 分才放行
- **公有云上线审批**——公有云客户的二开必须走此流程

### 4b. CDP 完整流程(公有云客户)

1. **注册账号**——开发者注册云之家账号,绑定金蝶云星空 ISV 身份
2. **创建应用**——在 CDP 后台 → 应用管理 → 新建应用,设参与者权限
3. **关联源码库**——平台分配 SVN 库地址,本地用 TortoiseSVN 检出
4. **本地开发**——VS 写代码 → 编译 → 通过本地 BOS Designer 调试
5. **同步代码** — `svn commit` 提交到 CDP 的 SVN
6. **在线构建**——CDP 后台触发构建,服务端编译 + 打包
7. **质量报告**——构建完成后查看质量分,严重 / 阻断问题必须修
8. **提交上线申请** — 走客户 IT 管理员审批
9. **金蝶运维审核** — 公有云特有
10. **发布到生产** — 一键部署

### 4c. CDP 流程(私有云客户 / 非公有云)

私有部署的客户**没有强制 CDP 上线流程**,通常:

1. 开发者本地 VS 写代码 → 编译出 DLL
2. 通过 SVN / 共享文件夹 / 邮件 把 DLL 拷给客户运维
3. 客户运维拷到生产环境 `WebSite\Bin`
4. **手动**改 BOS Designer 把插件注册到元数据(或 OpenDeploy 帮做扩展对象的元数据写入,但 v0.1 不写 DLL 引用)

**OpenDeploy v0.1 适用场景就是私有云**(`docs/2026-04-19-设计文档.md`)。

---

## 5. 本地 SVN Workspace

<!-- 来源:https://open.kingdee.com/K3Cloud/Open/About/Migrate/XTJCDifferent.html;fetched 2026-04-23 -->

CDP 给的 SVN 工作区典型结构:

```
D:\WorkSpace\
└── <开发商代码>\
    └── <应用代码>\
        ├── BusinessPlugIn\               ← VS 工程目录
        │   ├── ABC.K3Cloud.BusinessPlugIn.csproj
        │   ├── SAL\
        │   │   └── SaleOrderAuditServicePlugIn.cs
        │   └── bin\Debug\
        │       └── ABC.K3Cloud.BusinessPlugIn.dll
        ├── Metadata\                     ← BOS Designer 同步导出的元数据
        │   ├── *.dym                     单据元数据
        │   └── *.dymx                    扩展元数据
        └── Sql\                          ← 自定义表 / 视图脚本
            └── create_t_abc_xxx.sql
```

BOS Designer 的"同步"按钮做的事:把内存里改的元数据导出到 `Metadata\*.dym`,然后开发者手动 `svn commit`。

**OpenDeploy 写元数据走的是 DB 直写,不经过 dym 文件**——所以提示用户"改完再去 BOS Designer 点同步"才能把 DB 状态导成文件供 SVN 提交。

---

## 6. DLL 部署到客户环境的方式

### 6a. 私有云(OpenDeploy 主战场)

**最直接**:

1. 开发者把编译产物 `ABC.K3Cloud.BusinessPlugIn.dll` 拷到客户的:
   ```
   D:\K3Cloud\WebSite\Bin\ABC.K3Cloud.BusinessPlugIn.dll
   ```
2. **重启 IIS 应用池**或直接 `iisreset` —— K/3 Cloud 服务端不会热加载 DLL,必须重启
3. 同步把对应的元数据(扩展对象的 `FKERNELXML` 里 `<OperationServicePlugins>`)写入数据库
4. 客户端**强制刷新元数据缓存**(BOS Designer 工具栏有"刷新元数据缓存"按钮,或重启客户端)

### 6b. 通过 BOS Designer 上传<!-- 待用户实证 -->

部分版本支持通过 BOS Designer "插件管理" 上传 DLL,自动放到 `WebSite\Bin`——具体路径和功能依版本而异。

### 6c. 通过部署包

如果走 CDP 在线构建,产物是一个 `.kdpkg` 部署包,客户运维 双击 `部署包.exe` → 选环境 → 自动安装(包含 DLL + 元数据脚本)。

---

## 7. 配置文件和插件注册的关系

很多新手以为**只要把 DLL 拷到 Bin 就生效**——错。完整的"启用一个 DLL 插件"需要 **3 步**:

1. **DLL 物理就位** — `WebSite\Bin\ABC.K3Cloud.BusinessPlugIn.dll`
2. **元数据注册** — `T_META_OBJECTTYPE.FKERNELXML` 里有 `<OperationServicePlugin OperationName="Audit"><PlugIn><ClassName>ABC.SAL.SaleOrderAuditServicePlugIn</ClassName>...</PlugIn></OperationServicePlugin>`
3. **缓存刷新** — IIS 重启 + BOS Designer 刷新缓存 + 客户端重登

漏哪一步插件都不工作。

**OpenDeploy v0.1 只能做第 2 步,且仅限我们自己创建的扩展对象**——DLL 物理部署 + IIS 重启永远是开发者 / 运维的事,本产品不代办。

---

## 8. 调试方式

| 方式 | 适用 |
|---|---|
| **附加进程**(VS → Debug → Attach to Process → `w3wp.exe`) | 服务端插件(操作 / 转换 / 报表数据源) |
| **客户端附加** — Attach 到 `K3Cloud.exe` | 表单插件 / 列表插件(WinForm 端) |
| **Trace 日志** — `Logger.Write(LogLevel.Info, ...)` 写到 `WebSite\App_Data\` | 生产环境无 VS 时 |
| **BOS 性能分析器** | 性能瓶颈定位 |

附加调试要求 VS 和 K/3 Cloud 同机或共享调试端口,**不适合远程客户环境**。

---

## 9. OpenDeploy 与 DLL 开发的关系

| 工作 | 工具 / 责任方 |
|---|---|
| 写 C# 代码 | **开发者** + Visual Studio |
| 编译 DLL | **开发者** + VS / MSBuild |
| 拷贝 DLL 到 `WebSite\Bin` | **运维** / 部署包 |
| 重启 IIS | **运维** |
| 写元数据(`<OperationServicePlugins>` 节点) | **OpenDeploy** ✅(扩展对象,通过 `kingdee_*` 工具),**v0.1 限于 Python 插件节点**(DLL 节点未实现) |
| 刷新客户端缓存 | **用户**(F5 或重登) |
| 上 CDP 流程(公有云) | **开发者** + CDP UI |

**v0.1 明确边界**:OpenDeploy 让 agent 教会用户**如何决策 + 如何做**,不代替开发者写代码 / 不代替运维拷贝 DLL。

---

## 临时话术(agent 引用)

> 你需要的是 DLL 插件开发,需要做这些事:
>
> 1. **新建 VS 工程**:Class Library (.NET Framework 4.6+),命名 `{你的开发商代码}.K3Cloud.BusinessPlugIn`
> 2. **添加引用**:从客户的 `WebSite\Bin\` 拷出 `Kingdee.BOS.dll` / `Kingdee.BOS.Core.dll` / `Kingdee.BOS.DataEntity.dll`(必引)+ 按需添加 ServiceHelper / Contracts
> 3. **写继承**(取决于插件类型,见 `plugin-types-deep.md`)
> 4. **编译产物**:`bin\Debug\<工程名>.dll`
> 5. **部署**:拷 DLL 到客户 `WebSite\Bin` → `iisreset`
> 6. **注册元数据**:在扩展对象的 `FKERNELXML` 加 `<OperationServicePlugins>`/`<ConvertPlugins>` 节点(此步骤 OpenDeploy v0.1 不自动化 DLL 部分,需要你手动改或用 BOS Designer)
> 7. **刷新缓存**:BOS Designer "刷新元数据缓存" + 客户端重登
>
> 如果你是公有云客户,5-7 步走**协同开发平台**(CDP)的在线构建 + 上线审批,而不是手动拷贝。
>
> 我可以给:工程命名建议 / 引用 DLL 列表 / 样例代码骨架。但**写代码本身和打包部署是你的事**,本产品不代办。
