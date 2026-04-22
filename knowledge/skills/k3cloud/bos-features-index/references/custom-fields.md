# 扩展字段

在 BOS 单据上加一个**自定义字段**,字段值独立存储,不碰原厂表。

---

## 基本形态

- 原厂单据 `SAL_SaleOrder` 有主表 `T_SAL_SALEORDER` 和明细表 `T_SAL_SALEORDERENTRY`
- 扩展字段**不加到原厂表**——加到扩展表 `T_SAL_SALEORDER_XXXX`(BOS 自动建)
- 单据打开时 BOS 按外键 join 扩展表,字段看起来和原厂字段无异

---

## 字段类型(常用)

| BOS 字段类型 | 数据库类型 | 典型用途 |
|---|---|---|
| 文本(Text) | nvarchar | 备注、编码 |
| 多行文本 | ntext | 长备注 |
| 整数 | int | 数量、计数 |
| 小数 | decimal | 金额、比率 |
| 日期 | datetime | 自定义时间字段 |
| 下拉(Combo) | int(对应枚举 FID) | 固定选项 |
| 复选框 | char(1) | 是否标记 |
| 基础资料 | bigint(FID) | 引用客户 / 物料 / 自定义基础资料 |
| 用户 | bigint(FID) | 引用员工 |

---

## 配置路径(BOS Designer 操作)

1. BOS Designer 登录协同平台
2. 找到目标单据(如 `销售订单`)
3. 右键 → **扩展**(或打开已有扩展)
4. 拖字段控件到布局,设置 `Key`(数据库列名,必须 `F_` 前缀)、`Name`(中文名)、`Type`
5. **保存** → BOS 自动:
   - 在扩展表(如 `T_SAL_SALEORDER_XXXX`)加列
   - 在 `FKERNELXML` 里加 `<Field>` 节点
6. **F5 刷新** → 新字段出现在单据上

---

## 字段 Key 命名规则

- **必须 `F_` 前缀**
- **建议加开发商前缀**:`F_PAIJ_CreditLimit`(开发商 `PAIJ` 的信用额度字段)
- 英文字母 + 数字 + 下划线,不要中文 / 空格
- 长度建议 ≤ 30 字符(数据库列名限制)

---

## 读写扩展字段

### Python 插件里读写

```python
# 读扩展字段(和标准字段一样)
val = self.Model.GetValue("F_PAIJ_CreditLimit")

# 写
self.Model.SetValue("F_PAIJ_CreditLimit", 10000)
```

BOS 在运行时已经把扩展字段当成标准字段处理,插件代码无感。

### SQL 查扩展字段

扩展字段在单独的扩展表,join 主表:

```sql
SELECT m.FBILLNO, e.F_PAIJ_CreditLimit
FROM T_SAL_SALEORDER m
LEFT JOIN T_SAL_SALEORDER_XXXX e ON m.FID = e.FID
WHERE m.FDATE > '2026-01-01'
```

具体扩展表名从 `FKERNELXML` 或 Designer 里看。

---

## OpenDeploy v0.1 当前不工具化

**❌ OpenDeploy v0.1 不提供 `kingdee_add_extension_field` 工具**。

原因:加字段要操作的表不只是 `T_META_OBJECTTYPE.FKERNELXML`,还要动态 ALTER TABLE 扩展表,涉及:
- 检查扩展表是否存在,不存在则 CREATE
- ALTER TABLE 加列(跨事务,MSSQL 的 DDL 不易回滚)
- 更新 `T_META_OBJECTTYPE.FKERNELXML` 加 `<Field>` 节点
- 更新 `T_META_OBJECTFIELD` / `T_META_OBJECTFIELD_L` 字段元数据表
- 处理字段类型映射(BasedataField 还要建 FK 关系)

风险 / 收益比不够,v0.1 **不做**,告知用户在 BOS Designer 手工配。

---

## 识别到"加字段"需求时的 agent 话术

```
用户:"帮我在销售订单上加一个'客户信用评级'字段"

Agent 回答:
"加扩展字段目前 OpenDeploy 工具还没自动化,需要你在 BOS Designer 手工加一次。
步骤:
1. 打开 BOS Designer,登录到 <客户环境名>
2. 在左侧树找到【销售订单】,右键 → 扩展(或打开已有扩展 <扩展名>)
3. 从左侧控件库拖一个【文本】(或【下拉】,看你想要什么类型)到布局里
4. 右侧属性里设:
   - Key: F_PAIJ_CustomerCreditLevel
   - Name: 客户信用评级
   - Type: 文本 / 下拉
5. 保存扩展 → F5 刷新
6. 如果是下拉,再配枚举值

加完告诉我字段 Key,我可以帮你写校验插件逻辑。"
```

---

## 扩展表发现(调试用)

给定一个扩展 FID,查它的扩展表名:

```sql
-- 扩展表会在 FKERNELXML 里列
SELECT FKERNELXML FROM T_META_OBJECTTYPE WHERE FID = '<扩展 FID>'
```

或查 `T_META_TABLE` 映射表(具体列待确认)。OpenDeploy 的 `kingdee_list_extension_tables` 工具**v0.1 未实现**。
