# BOS 扩展对象机制

K/3 Cloud BOS **不让你直接改原厂单据**。要定制必须走**扩展对象**——相当于派生一个副本,把客户化的东西(字段、插件、布局)挂在扩展上,原单据保持干净。这样原厂升级不会覆盖你的定制。

---

## 核心概念

### 1. 父对象 ↔ 扩展对象

```
SAL_SaleOrder  (父,原厂)
  └─ <ext-guid-1>  (扩展,客户 A 化)
       ├─ 自定义字段 F_A_XX
       ├─ Python 表单插件
       └─ 界面布局微调
```

- **父对象**唯一,由金蝶发布
- **扩展对象**可多个,每家客户 / 每种业务场景可各有一份
- 打开单据时 BOS 按 **扩展链**(FINHERITPATH)逐级合并 — 底层是父,上面的扩展依次覆盖

### 2. 扩展 = 一行元数据 + 一段 XML delta

扩展的"内容"不是完整单据定义(那要几 MB),而是**相对父对象的 delta**,存在 `T_META_OBJECTTYPE.FKERNELXML` 字段里,典型几百字符到几千字符。

delta 形态(Python 插件注册示例):

```xml
<FormPlugins>
  <PlugIn ElementType="0" ElementStyle="0">
    <ClassName>opendeploy_credit_guard</ClassName>
    <PlugInType>1</PlugInType>        <!-- 1 = Python; 缺省或 0 = DLL -->
    <PyScript>IronPython source inline</PyScript>
  </PlugIn>
</FormPlugins>
```

整个 XML 就这几十字节。**没有完整单据定义**——合并时 BOS 会从父对象 + 继承链上叠加完整形态。

---

## 创建一个扩展涉及 8 张表

实证过的完整足迹(以 `SAL_SaleOrder` 为例,约 91 行事务写入):

| 表 | 典型行数 | 作用 |
|---|---|---|
| `T_META_OBJECTTYPE` | 1 | 扩展主记录 + `FKERNELXML`(delta XML)+ `FBASEOBJECTID`(父)+ `FINHERITPATH`(继承链)|
| `T_META_OBJECTTYPE_L` | 1 | 扩展名本地化(zh-CN 为 `FLOCALEID = 2052`) |
| `T_META_OBJECTTYPE_E` | 1 | 扩展标记 `{FID, FSEQ=0}` |
| `T_META_OBJECTTYPENAMEEX` | 1 | 名称扩展自引用 |
| `T_META_OBJECTTYPENAMEEX_L` | 1 | 名称扩展 zh-CN |
| `T_META_OBJECTFUNCINTERFACE` | 1 | 功能接口(`FFUNCID=2` = 单据编辑) |
| `T_META_OBJECTTYPEREF` | 77 | 从父对象克隆外键引用 |
| `T_META_TRACKERBILLTABLE` | 4 | 从父对象克隆跟踪表(`FTABLEID` **必须 ≥ 900000**,见 known-pitfalls)|

**全部必须事务包裹**。OpenDeploy 的 `kingdee_create_extension_with_python_plugin` 工具已封装好这 8 张表 + 事务 + rollback + backup,**调用方只需提供父单据 ID / 扩展名 / 插件名 / pyBody 四个参数**。

---

## `FKERNELXML` 正确解析姿势

这是 K/3 Cloud BOS 的核心数据结构之一。它是**子元素式** XML,**不是属性式**:

```xml
<!-- ✅ 真实形态(子元素) -->
<Field>
  <Key>FCustId</Key>
  <Name>客户</Name>
  <Type>BasedataField</Type>
</Field>

<!-- ❌ 错误假设(属性) -->
<Field Key="FCustId" Name="客户" Type="BasedataField" />
```

很多二开教程是错的,**以真实 DLL 反序列化结果为准**。OpenDeploy 的 `k3cloud/queries.ts` 在 Plan 5 修过这个解析 bug。

---

## `FINHERITPATH` 继承链

扩展可以再被扩展(多级继承)。`FINHERITPATH` 用 `^` 分隔列出链条:

```
SAL_SaleOrder^<ext-level-1-guid>^<ext-level-2-guid>
```

合并顺序从左到右,后面的覆盖前面的。

**OpenDeploy v0.1 建议**:只创建**一级扩展**(直接继承原厂单据)。多级扩展管理复杂,出事排查难。

---

## 开发商标识(`FSUPPLIERNAME`)—— **不再盖章(2026-04-23 实证作废)**

早期版本的"必须盖开发商章 + 反查 FUSERID + 提示用户先登协同平台" 的整套机制 **已经全部作废**。

- **现状**:写入时 `FSUPPLIERNAME = NULL` + `FMODIFIERID = 0`,BOS Designer 把这种"无主"扩展视为任何开发者都能编辑,**没有副作用**
- **不需要**问用户 BOS 用户 ID、不需要反查 developer code、不需要让用户先登录协同平台
- **不需要** `kingdee_probe_bos_environment` 返回 `ready=false` 阻塞写入

详见 `references/known-pitfalls.md` 的 "FUSERID / FSUPPLIERNAME 机制作废" 段。

---

## SVN 同步与运行时无关

BOS Designer 的"同步"按钮把扩展元数据导出为 `.dym` / `.dymx` 放本地 SVN 工作区(`D:\WorkSpace\<DEV>\<APP>\`),然后 `svn commit`。

- **运行时读 DB 不读文件**——OpenDeploy 写完 DB 客户端刷新就能跑
- "未同步" 是 BOS Designer UI 的 VCS 标记,只影响团队协作
- **OpenDeploy v0.1 不自动化 SVN**——工具成功后提示用户"如果你们团队用 SVN,去 Designer 点同步"

---

## 缓存刷新(没找到 SP,v0.1 策略)

- BOS Designer 扩展列表有缓存,写完需用户**按 F5 刷新**
- 客户端已打开的表单也有缓存,**可能需要重登**
- 没找到 metadata-refresh 存过程(估计走 BOS 服务端点,需 DLL 反编译)
- **v0.1 策略**:工具成功消息里明示"请刷新 BOS / 重开客户端",不自动触发

---

## Backup 机制

OpenDeploy 每次 BOS 写入前快照受影响行到:

```
%USERPROFILE%/.opendeploy/projects/<pid>/bos-backups/<timestamp>_<op>_<ext_fid>.json
```

用户可调 `kingdee_restore_from_backup` 回滚。

---

## 删除扩展

`kingdee_delete_extension(extensionFId)` — 反向写 8 张表的 DELETE,同样事务包裹 + backup。

**前置校验**:
- 没有下级扩展继承它(查 `FINHERITPATH` 包含本扩展 FID 的其他行)

---

## 常见误解

| 误解 | 真相 |
|---|---|
| "扩展里要写完整 XML 才能生效" | 只写 delta,父对象的东西 BOS 自动合并 |
| "扩展会覆盖原厂升级" | 恰恰相反,扩展保护定制,升级原厂扩展自动适配 |
| "改扩展 = 改原单据" | 原单据 `T_META_OBJECTTYPE` 行**永远不动**,只动扩展行 |
| "XML 里字段是属性" | 子元素,见上 |
| "必须先登协同平台才能写" | 已实证作废,`FSUPPLIERNAME=NULL` 对 BOS Designer 透明 |
