<!-- 来源:help.open.kingdee.com 公开手册 + 金蝶云社区 / 第三方实战博客;实证状态:🟡 主流程;非客户环境实测 -->

# 业务规则 / 实体服务规则 / 字段值更新

BOS 的**字段公式联动引擎**——字段之间的自动计算和条件赋值,不用写插件。

> **关键澄清**:K/3 Cloud BOS **没有"业务规则"这个一级菜单名**,这套能力官方叫**实体服务规则**(单据头/单据体属性页里的"实体服务规则" tab)+ 字段属性里的**值更新事件**。"业务规则" 是实施圈的口语说法。本文继续沿用"业务规则"指代这一整套机制。

> **再一个关键事实**:BOS 表达式不是自创 DSL,是 **IronPython 表达式子集**(因为 BOS 运行时本来就嵌了 IronPython 解释表单插件)。所以函数名是 Python 风格(`len` 不是 `LEN`、`round` 不是 `ROUND`、没有 SQL 那套 `IIF`/`CONCAT`/`SUBSTR`/`DATEADD`)。

---

## 适用场景

`F金额 = F数量 * F单价`、`F折扣额 = F原价 * (1 - F折扣率)`、头字段汇总明细 `sum(map(lambda x: x.F金额, FEntity))`、条件赋值 `'VIP' if F年销售额 > 1000000 else '普通'`、校验阻断(勾了序列号管理的物料必须填序列号)。

---

## 配置路径

**字段值更新**(单字段联动):BOS Designer → 目标单据扩展 → 选中字段(如 `F金额`)→ 字段属性 → **值更新事件** → 填触发字段(`F数量, F单价` 任一变化)+ 赋值公式(`F数量 * F单价`)→ 保存 → 客户端 F5。

**实体服务规则**(多字段 / 复杂场景):BOS Designer → 单据头属性(或单据体属性)→ **实体服务规则** tab → 新增规则 → 输入描述 → 配 **执行条件**(留空 = 永真,如 `F金额 > 100000 and F客户.FCustTypeId.FNumber == 'VIP'`)→ 配 **条件成立 / 不成立时的服务** 列表(从上往下顺序执行)。常用服务:

- **计算公式值并填入指定列** —— 把公式结果写入字段
- **携带基础资料属性** —— 选中物料后自动填默认仓库
- **过滤指定字段的下拉数据** —— 跨字段限制 F8 范围
- **报错提示** —— 阻断保存
- **设置字段必录 / 锁定 / 显示**

> **来源**:[实体服务配置与应用 · dokuwiki](https://help.open.kingdee.com/dokuwiki/doku.php?id=%E5%AE%9E%E4%BD%93%E6%9C%8D%E5%8A%A1%E9%85%8D%E7%BD%AE%E4%B8%8E%E5%BA%94%E7%94%A8) · fetched 2026-04-23

---

## 公式语法概览

BOS 表达式 = **IronPython 表达式子集**,**不是 SQL,不是完整 Python**:

| 类别 | 写法 |
|---|---|
| 四则运算 | `F1 + F2 * F3 / F4` |
| 比较 | `==`(条件判等)、`<>` 或 `!=`(不等)、`<` `<=` `>` `>=` |
| 赋值(仅赋值公式里) | `=` |
| 逻辑 | `and`、`or`、`not`(全小写) |
| 条件表达式 | `'值A' if 条件 else '值B'`(三目,可嵌套) |
| 范围判断 | `F1 in ['A', 'B', 'C']` |
| 空值判等 | `F1 == null`(注意:文本字段要三段式判空) |

**SQL 不支持的事**(实体服务规则 / 字段值更新里 ❌):
- `like '%xxx%'` —— 表达式引擎不接 SQL,模糊匹配用 `'xxx' in F1` 或 `F1.find('xxx') >= 0`
- `IIF(...)` —— 没有,用 `值A if 条件 else 值B`
- `CONCAT(...)` —— 没有,用 `+` 拼接或 `format()`
- `DATEADD(F1, 7, 'd')` —— 没有,用 `F1.AddDays(7)`(.NET DateTime 方法)

> **来源**:[BOS 语句基础应用 · rsrx.net](https://www.rsrx.net/kingdee/3221.html) · fetched 2026-04-23

---

## 完整函数库

> 下面所有函数 / 方法在**实体服务规则的执行条件 / 赋值公式 / 字段值更新事件**里能用。**过滤语句**(F7 选单条件)是另一套——那里支持原生 SQL,可以写 `like '%xxx%'`。

### 数学

| 函数 | 签名 | 示例 | 说明 |
|---|---|---|---|
| `round` | `round(数值, 精度)` | `round(F金额 * F税率, 2)` | 四舍五入;算金额 / 税额必配,避免浮点尾数 |
| `int` | `int(x)` | `int(F数量)` | 转整数(向下截断,不是四舍五入) |
| `float` | `float(x)` | `float(F文本字段)` | 转小数 |

<!-- 数学函数:abs / pow / sqrt / mod 在手册和实战博客里都没明确列出,IronPython 标准库里有但 BOS 表达式沙箱是否放行待实证;签名待实证 -->

**来源**:[BOS 语句基础应用 · rsrx.net](https://www.rsrx.net/kingdee/3221.html) · [BOS 设计器语法汇总 · 博客园](https://www.cnblogs.com/lanrenka/p/17669244.html) · fetched 2026-04-23

### 逻辑 / 条件

| 结构 | 签名 | 示例 | 说明 |
|---|---|---|---|
| **三目** | `真值 if 条件 else 假值` | `F金额 * 0.95 if F金额 > 100000 else F金额` | 替代 SQL `IIF`;可嵌套 `'A' if … else ('B' if … else 'C')` |
| **and / or / not** | `cond1 and cond2` | `F金额 > 100000 and F客户.FCustTypeId.FNumber == 'VIP'` | **全小写**,不是 `AND` / `OR` |
| **in** | `F1 in ['A', 'B']` | `F单据状态 in ['B', 'C']` | 范围判断 |

### 字符串

> 字符串方法都是 **.NET String 实例方法**,不是独立函数。

| 方法 | 签名 | 示例 | 说明 |
|---|---|---|---|
| `.find` | `字符串.find('子串')` | `F备注.find('紧急') >= 0` | 子串查找,`>= 0` 表示存在;**替代 SQL `like '%xxx%'`** |
| `.strip` | `字符串.strip()` | `len(F文本.strip()) > 0` | 去首尾空格;三段式判空必备 |
| `.ToString` | `对象.ToString('格式')` | `F日期.ToString('yyyy-MM-dd')` | 对象转字符串,常用于日期格式化 |
| `len` | `len(x)` | `len(F备注) > 50`、`len(FEntity) > 0` | 字符串长度 / 集合元素数 |
| `format` | `format(x, '0.00')` | `format(F金额, '0.00')` | 格式化输出 |
| `+` 拼接 | `s1 + s2` | `F单号 + '-' + F分录号.ToString()` | **BOS 没有 `CONCAT`** |

<!-- BOS 表达式没有 SUBSTR / LEFT / RIGHT / UPPER / LOWER / REPLACE / TRIM 这些 SQL 风格函数;.NET 字符串实例方法 .Substring() / .ToUpper() / .ToLower() / .Replace() 推测可用,但官方手册和主流实战博客都没明确给示例;签名待实证 -->

### 日期时间

> 日期字段都是 **.NET DateTime**,所有方法都是实例方法。**BOS 没有 SQL `DATEADD` / `DATEDIFF` / `YEAR` / `MONTH` / `DAY` / `NOW` / `TODAY`**——全用 .NET 风格。

| 方法 / 变量 | 签名 | 示例 | 说明 |
|---|---|---|---|
| `.AddDays` / `.AddMonths` / `.AddYears` | `日期.AddDays(天数)`(可负) | `F下单日期.AddDays(7)` | 加减日期 |
| `.Date` | `日期时间.Date` | `F创建时间.Date == @currentshortdate` | 截日期部分(去时分秒) |
| `.Date.Year` / `.Month` / `.Day` | `日期.Date.Year` | `F到货日.Date.Year == 2026` | 取年月日数字 |
| `@currentshortdate` | 系统变量,无括号 | `F到货日 < @currentshortdate` | 当前日期 |
| `@currentlongdate` | 系统变量 | — | 当前日期时间 |

<!-- DATEDIFF 类函数:实战博客没列;.NET 风格 (日期1 - 日期2).TotalDays 推测可用;签名待实证 -->

### 集合 / 聚合(头字段引明细)

> 头字段按整个单据体汇总时用,**lambda 表达式**遍历明细行。**只有单据头能用,单据体的实体服务规则不能 lambda 遍历**。

| 模式 | 签名 | 示例 | 说明 |
|---|---|---|---|
| **求和** | `sum(map(lambda x: x.字段, FEntity))` | `sum(map(lambda x: x.F金额, FEntity))` | 头字段 `F总金额` 汇总明细 |
| **条件求和** | `sum(map(lambda x: x.字段 if 条件 else 0, FEntity))` | `sum(map(lambda x: x.F金额 if x.F税率 > 0 else 0, FEntity))` | 只汇总有税的行 |
| **计数** | `len(filter(lambda x: 条件, FEntity))` | `len(filter(lambda x: x.F物料.FIsKFPeriod == True, FEntity)) > 0` | 是否有启用保质期的明细 |
| **去重拼接** | `'分隔符'.join(o for o in set(map(lambda x: format(x.字段), FEntity)))` | `'\\n'.join(o for o in set(map(lambda x: format(x.F物料.FNumber), FEntity)))` | 头备注列出所有物料编码换行 |

<!-- avg / max / min:Python 内置函数 max() / min() 推测可用,实战博客提了 sum/len 但 max/min 没明确给示例;签名待实证 -->

### 业务函数(BOS 内置)

| 函数 / 变量 | 签名 | 示例 | 说明 |
|---|---|---|---|
| `GetValue` | `GetValue(字段标识)` | 过滤 `FUseOrgId = 'GetValue(F_XHWT_OrgId)'` | 主要用在**过滤语句**里跨界面取值 |
| `ISDRAW` | `ISDRAW()` | `ISDRAW() == True` / `ISDRAW() == False` | 当前单据**是否有源单**(被下推来的);**必须带括号**,布尔常量只接 `True / true / 1`,大写 `TRUE` 报错 |
| `ISPUSH` | `ISPUSH()` | `ISPUSH() == True` | 当前单据**是否已下推**;已下推的不允许反审核 / 删除 |
| `@userid` | 系统变量 | `F制单人 == @userid` | 当前用户 ID |
| `@currentorgid` | 系统变量 | `F组织 == @currentorgid` | 当前组织 ID |

**来源**:[BOS 语句基础应用 · rsrx.net](https://www.rsrx.net/kingdee/3221.html) · [BOS 设计器基础资料过滤 · 博客园](https://www.cnblogs.com/lanrenka/p/17817941.html) · fetched 2026-04-23

### 基础资料字段下钻

不是函数,是**对象属性访问** —— 基础资料字段拿出来是个对象,`.` 取属性。签名 `F基础资料.F属性`,可链式。

- `F客户.FNumber` / `F客户.FName` —— 客户编码 / 名称
- `F客户.FCustTypeId.FNumber` —— 客户类型编码(再下钻一层)
- `F物料.FIsKFPeriod` —— 物料是否启用保质期(布尔字段)

**典型场景**:执行条件里跨实体判断,如 `F客户.FCustTypeId.FNumber == 'VIP'`。

---

## 触发机制深入

| 机制 | 触发时机 | 范围 | 限制 |
|---|---|---|---|
| **字段值更新事件** | 触发字段失焦后立即 | 单字段 | 不支持 lambda 遍历单据体 |
| **实体服务规则**(头) | 任一条件字段变化后 | 单据头多字段联动 | 支持 lambda 遍历单据体 |
| **实体服务规则**(体) | 单据体行字段变化后 | 当前行 | **不支持 lambda 遍历** |
| **保存前校验** | 保存按钮点下后 | 服务端再跑一遍全部规则 | 客户端拦不住的兜底 |

**触发顺序**:同字段触发多个值更新事件 → 按 Designer 配置顺序;再触发实体服务规则 → 按规则列表顺序;最后保存前服务端再走一遍。

**关键陷阱**:**单据转换(下推)时不触发字段值更新和实体服务规则**——下推字段值直接搬,转换时要算东西必须挂**表单服务策略**(配在转换规则上)。

> **来源**:[单据转换规则 · dokuwiki](https://help.open.kingdee.com/dokuwiki/doku.php?id=%E5%8D%95%E6%8D%AE%E8%BD%AC%E6%8D%A2%E8%A7%84%E5%88%99) · fetched 2026-04-23

---

## 联动陷阱

1. **循环依赖**:`F1 → F2 → F1` 会报"检测到循环"或保存时跑死。依赖只能单向,反向用插件。
2. **聚合性能**:明细 100 行以上 + 头字段 `sum(map(...))` 实时算可能卡;改成"保存前 Python 插件计算一次"。
3. **精度丢失**:必须 `round(..., 2)` 显式指定,**否则浮点尾数让金额变 100.00000001**,不同 BOS 版本精度行为不一致。
4. **触发时机错位**:值更新是**失焦后**算,不是输入中;要"实时显示"得用前端插件。
5. **下推不触发**:**单据转换时所有字段值更新 / 实体服务规则全静默**,靠"表单服务策略"补。
6. **文本字段判空必须三段式**:`F文本 <> null and F文本 <> '' and len(F文本.strip()) > 0`,光写 `<> null` 漏空串 / 全空格。
7. **大小写敏感**:`ISDRAW()` 不能写 `isdraw()` / `IsDraw()`;布尔常量只接受 `True / true / 1`,`TRUE` 报错。
8. **单据体实体服务规则不能遍历**:配在单据体上的只看**当前行**,跨行汇总只能配在单据头上。
9. **改完必须重启客户端**:实施圈反复踩——客户端要**完全退出重登**才生效,F5 不一定够。

---

## 业务规则 vs 数据校验规则 vs 插件

BOS 这三套都能"约束字段值",别混:

| 维度 | 业务规则(实体服务规则 / 值更新) | 数据校验规则 | Python 插件 |
|---|---|---|---|
| **配置位置** | 字段属性 / 单据头属性 | 单据头属性 → 校验规则 tab | 扩展对象 → FormPlugins |
| **触发时机** | 字段失焦 / 保存前 | 仅保存前(也可挂"提交"操作) | 任意事件(字段变 / 保存前 / 审核前 / 关闭前) |
| **典型用途** | 算金额、联动赋值、过滤下拉、轻量阻断 | "纯校验"——值不合规直接报错阻断 | 复杂校验 + 跨单据 / 跨基础资料读 + 调外部接口 |
| **能做的复杂度** | 一行表达式 + lambda + 内置服务 | 一行表达式 + 报错信息 | 任意 IronPython,可调 ServiceHelper / SQL / 外部 API |
| **维护门槛** | 实施顾问 | 实施顾问 | 程序员 |

**判断标准**:
- 一行表达式能写完 → **值更新事件**
- 多字段联动 + 多个动作(算公式 + 锁字段 + 报错)→ **实体服务规则**
- 只想报错阻断,没有其他动作 → **数据校验规则**
- 三段以上 if-else 嵌套 / 跨单据查 / 调外部接口 → **Python 插件**

---

**升级信号**:写业务规则写到嵌套三目超过 2 层,或发现需要跨单据查 / 调外部接口,就该升 Python 插件。审核 / 反审核 / 下推 / 删除拦截走**操作插件**(不是表单插件)——见 `plugin-types.md`。

---

## 实战示例

### 1. 头明细金额汇总
```
# 头字段 F总金额 的"值更新公式"
sum(map(lambda x: x.F金额, FEntity))
```

### 2. 阶梯折扣
```
# 字段 F实际金额 的"值更新公式"
F原金额 * 0.9 if F原金额 > 100000 else (F原金额 * 0.95 if F原金额 > 50000 else F原金额)
```

### 3. 头字段拼明细物料编码
```
# 头字段 F物料清单(文本) 的"值更新公式"
'\\n'.join(o for o in set(map(lambda x: format(x.F物料.FNumber), FEntity)))
```

### 4. 实体服务规则:VIP 客户金额超 10 万自动审核
- **执行条件**:`F客户.FCustTypeId.FNumber == 'VIP' and F金额 > 100000`
- **条件成立时的服务**:计算公式值并填入指定列 → `F自动审核标记 = 1`

### 5. 校验:启用序列号的物料明细必须填序列号
- **执行条件**:`len(filter(lambda x: x.F物料.FIsKFPeriod == True and (x.F序列号 == null or x.F序列号 == ''), FEntity)) > 0`
- **条件成立时的服务**:报错提示 → "存在启用序列号管理但未填序列号的明细行"

> **来源**:[金蝶云星空表单服务规则设置 · CSDN · qq_33881408](https://blog.csdn.net/qq_33881408/article/details/134878374) · fetched 2026-04-23

---

## OpenDeploy v0.1 不工具化

业务规则 / 实体服务规则 / 数据校验规则全部手工 BOS Designer 配置;agent 只负责:(1) 判断需求适合哪种(按上面判断标准);(2) 给出表达式(用本文函数库);(3) 给步骤告知属性页位置 + 提醒"配完客户端要重登"。

**不要用 SQL 直接改 `T_META_OBJECTTYPE.FKERNELXML` 里的 `<EntityServices>` 节点**——误改会让整个单据加载报错。
