# BOS 写入已实证的坑

本文件沉淀 OpenDeploy 在真实金蝶云星空 V9 私有部署上**实证过**的写入陷阱。每条都标注**实证日期**和**对策**。和"BOS 客观能力"无关——纯是工程层踩坑沉淀,只要你写 BOS 元数据就要看。

---

## 1. FUSERID / FSUPPLIERNAME 机制作废(2026-04-23 实证)

### 旧规则(已废)

早期版本要求每次 BOS 写入必须:
- 反查当前用户的 `FUSERID` (开发商绑定)
- 写入 `FSUPPLIERNAME = '<开发商代码>'`
- 写入 `FMODIFIERID = <FUSERID>`
- 用户必须先登录"协同开发平台"完成开发商绑定

### 实证结论

**全部不需要**。直接写:
- `FSUPPLIERNAME = NULL`
- `FMODIFIERID = 0`

BOS Designer 把这种"无主"扩展视为**任何开发者都能编辑**,没有任何副作用。"同开发商才能编辑"的规则对 NULL 等价于共享。

### 影响范围

- ✂️ 不需要 `kingdee_probe_bos_environment` 返回 `ready=false` 阻塞写入
- ✂️ 不需要让用户提前登协同平台
- ✂️ 不需要在 SKILL.md 里加"先问用户 BOS 用户 ID"的澄清问

### 历史遗留代码

`bos-writer.ts` 已不再读 FUSERID;UI 上那些"BOS 环境未初始化"的提示已是冗余,可以拆。

---

## 2. T_META_TRACKERBILLTABLE.FTABLEID 必须 ≥ 900000(2026-04-23 实证)

### 症状

按"全局 `MAX(FTABLEID) + N` 自动分配"思路写入跟踪表,**会随机撞 PK 冲突**——SQL Server 报 `Violation of PRIMARY KEY constraint 'PK_T_META_TRACKERBILLTABLE'`。

### 根因

BOS Designer 内部分配器在 `[100000, 500000]` 区间**有自己的"占位"逻辑**(可能是预分配 / 留位 / 异步插入),`MAX + N` 会跟它的占位行撞键。

### 对策

扩展 tracker 的 `FTABLEID` 起点**强制挪到 900000+**。生成算法:

```
nextFTableId = max(globalMax + 1, 900000)
```

这样保证落到 BOS Designer 内部分配器永不触及的区间。

### 影响代码

`bos-writer.ts` 的 `allocateTrackerBillTableId()`(或对应函数)。新写工具时一定走同一套分配器,**不要每个工具自己拍 ID**。

---

## 3. 缓存刷新没找到 SP

### 症状

写完 `T_META_OBJECTTYPE` 等 8 张表,SQL 反查能看到新行,但:
- BOS Designer 扩展列表里看不到 → **F5 刷新** 后才出来
- 客户端打开的销售订单表单不触发新插件 → **重登客户端** 才生效

### 现状

没找到 metadata-refresh 的存储过程。估计走 BOS 服务端点(K/3 Cloud 内部 .NET DLL),需反编译 `Kingdee.BOS.dll` 才能定位。

### v0.1 策略

**不自动触发刷新**。每次 `kingdee_*` 写入工具成功后必须在返回消息里明示:

> "✅ 注册成功。请:
> 1. BOS Designer 按 F5 刷新看到扩展
> 2. 已打开的客户端表单需重新登录才能加载新插件"

不要省略提示——用户以为"工具成功就 OK"是常见误判。

---

## 4. SQL 写白名单(8 张表 + 仅 OpenDeploy 创建的 FID + backup 强制)

### 红线

任何 `UPDATE` / `DELETE` / `INSERT` 必须满足三条:

1. **表必须在白名单内**:
   - `T_META_OBJECTTYPE` / `_L` / `_E`
   - `T_META_OBJECTTYPENAMEEX` / `_L`
   - `T_META_OBJECTFUNCINTERFACE`
   - `T_META_OBJECTTYPEREF`
   - `T_META_TRACKERBILLTABLE`

2. **FID 必须是本产品创建的**:写入前查 `T_META_OBJECTTYPE.FID`,确认是本次工具调用创建的扩展或其衍生行。**绝不**改原厂行(`FBASEOBJECTID = NULL` 的就是原厂)

3. **写前必须 backup**:快照受影响行到 `%USERPROFILE%/.opendeploy/projects/<pid>/bos-backups/<timestamp>_<op>_<ext_fid>.json`,可用 `kingdee_restore_from_backup` 回滚

### 不在白名单的表

- ❌ `T_META_OBJECTFIELD` / `_L`(字段元数据)— 扩展字段需求暂不工具化,见 `custom-fields.md`
- ❌ `T_META_FORM*`(表单布局)
- ❌ `T_META_LOCAL*`、`T_META_DBLINK*`
- ❌ 任何业务表 `T_SAL_*` / `T_BD_*` / `T_STK_*` / `T_AR_*` / `T_AP_*` / `T_GL_*`

写不在白名单的表 = **架构红线违规**,validator 会直接拒。

### 工具与 validator 的关系

- 工具实现层(`bos-writer.ts`)负责拼 SQL + 调 backup
- validator 层(`erp/validator.ts`)在 Plan 6 release gate 前**必须**真的拦截非白名单 SQL,目前是 no-op 放行

---

## 5. 事务包裹 + rollback

8 张表的写入**必须事务包裹**。任何一张失败:

1. 立刻 rollback 已写的部分
2. **删 backup 文件**(因为没真正写入,backup 不该残留诱导 restore)
3. 返回结构化错误,标明哪张表失败 + SQL Server 的原始错误码

OpenDeploy 的 `kingdee_create_extension_with_python_plugin` 已封装这套事务 + backup + rollback 协议,**不要绕过它直接拼 SQL**。

---

## 6. 多次注册同名插件的覆盖语义

### 症状

对同一扩展第二次调 `kingdee_register_python_plugin` 传同 `pluginName`:

- ✅ 当前实现:覆盖原 `<PlugIn>` 节点的 `<PyScript>`,不新增节点
- ⚠️ 用户预期可能是"再加一个" → 明确告知"同名覆盖,不同名追加"

### 对策

工具描述里写清"同名 = 覆盖 PyScript;要并存就改 pluginName"。

---

## 7. 删除扩展前必查继承链

`kingdee_delete_extension(extId)` 之前:

```sql
SELECT FID FROM T_META_OBJECTTYPE WHERE FINHERITPATH LIKE '%' + @extId + '%'
```

有结果 = 该扩展被其他扩展继承,**不能删**(删了下级会成孤儿)。返回 `error: has_dependents` + 列出依赖 FID 让用户先处理。

---

## 8. 中文 / 全角字符在 FKERNELXML 里

### 症状

`<PyScript>` 里的中文字符串经 SQL 写入往返后**可能编码错乱**。

### 对策

- 数据库连接全程 `nvarchar`(已默认)
- Python 源码字符串全部加 `u` 前缀:`u"客户必须填写"`(详见 `python-plugin-index/prompts/error-handling.md`)
- 测试时反查 `kingdee_list_form_plugins` 确认 `pyScript` 里中文字符**字节正确**(不是 `?` 也不是乱码)

---

## 索引

| 坑 | 状态 | 实证日期 |
|---|---|---|
| 1. FUSERID / FSUPPLIERNAME 机制作废 | 已实证 | 2026-04-23 |
| 2. FTABLEID ≥ 900000 | 已实证 | 2026-04-23 |
| 3. 缓存刷新无 SP | 已实证 | 2026-04-22 |
| 4. SQL 写白名单 | 设计约束 | 持续 |
| 5. 事务 + rollback + backup 删除 | 设计约束 | 持续 |
| 6. 同名覆盖语义 | 实现约定 | 2026-04-23 |
| 7. 删除前查继承链 | 设计约束 | 持续 |
| 8. 中文编码 | 经验沉淀 | 持续 |

新坑请按此格式追加,**必须有日期 + 实证 / 设计约束区分**。
