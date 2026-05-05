# Plan 5.12.3b — 业务规则 e2e demo

> 实证日期: 2026-05-05
> 父对象: SAL_SaleOrder（销售订单）
> 测试扩展 FID: `a57bd1698fdf4c288239908b74a8e333`
> Dev 环境: localhost K/3 Cloud V9.0.553.12

## 范围与目标

验证 Plan 5.12.3b 引入的 5 个 agent 工具 + 4 个 .NET bridge ops 在真账套上能完成"加规则 → 看规则 → BOS Designer 确认 → 删规则 → 复查"的完整闭环：

- `k3cloud_add_calculate_rule` — Calculate 字段级 UpdateAction（ActionId=2）
- `k3cloud_add_get_inv_stock_rule` — GetInvStock 实体级规则（ActionId=67）
- `k3cloud_list_business_rules` — 列出所有业务规则
- `k3cloud_delete_business_rule` — 删除指定规则
- `k3cloud_describe_service_meta` — 取参数 schema

## 前置准备

1. OpenDeploy app 已启动（`pnpm dev`），激活 dev K/3 项目
2. Dev 账套已清空 OpenDeploy 历史扩展（保证干净环境）
3. K/3 客户端已开启，准备演示 BOS Designer 验证

---

## 场景 0a — agent 创建 SAL_SaleOrder dev 扩展

**用户指令**: "请在 SAL_SaleOrder（销售订单）上创建一个新的扩展，中文名为'OpenDeploy 业务规则 demo'，开发标识用 OPENDEPLOY_DEMO。创建完成后告诉我新扩展的 FID。"

**Agent 行为**:
1. `k3cloud_list_extensions(parentFormId="SAL_SaleOrder")` → `{ count: 0, extensions: [] }` — 按 prompt 硬规则"候选 = 0 静默新建"，agent 没多问直接进下一步
2. `k3cloud_create_extension(parentFormId="SAL_SaleOrder", extName="OpenDeploy 业务规则 demo")` → `{ ok: true, extId: "a57bd1698fdf4c288239908b74a8e333", layoutInfoOid: "bc952920-057d-4790-9c27-1134091eb298" }`

**结果**: 扩展 FID = `a57bd1698fdf4c288239908b74a8e333`，一次成功。

**注**: agent reasoning 里说"`k3cloud_create_extension` 没有 developerCode 参数"——确实，工具是从项目配置自动取 dev code，所以用户指令里的 "OPENDEPLOY_DEMO" 没作为参数传，但实际开发标识来自项目设置。这是工具 schema 设计选择（见 `bos-rpc-tools.ts:505`），不是 bug。

**🐛 中途发现 bug + hotfix（2026-05-05）**: BOS Designer 截图显示扩展名为"销售订单"（父对象名），不是用户给的"OpenDeploy 业务规则 demo"。反编译 `Kingdee.BOS.App.Core.MetaDataService.DeserBusinessMetadata` 实证：服务端读 `metadata.Name` 时 paras.Name 反序列化到 `LocaleValue` 在新版 BOS 不工作（结果是空 `LocaleValue` indexer 取空字符串），fallback 到父对象 Name。**真权威是 DCXML `<Form><Name>{extName}</Name></Form>` 子元素**。修在 `src/main/erp/k3cloud/rpc/dcxml.ts:renderFormRoot`：emit `<Name>` 子元素，使用 `extension.name` 中 zh-CN（localeId=2052）的 value。重启 OpenDeploy 后场景 0b 重跑，FNAME 落库正确并保持。

---

## 场景 0b — agent 加 4 个测试字段

**用户指令**: "在刚才那个扩展上加 4 个 decimal 类型的测试字段：F_TestQty / F_TestPrice / F_TestAmount / F_TestStock，加到'基本信息'页签即可，加完反查确认 4 个字段都在。"

**Agent 行为**（OpenDeploy 重启后用新 dcxml.ts 重跑）:
1. `k3cloud_get_extension_fields(extId="a57bd16...")` → `count: 0`（前一次 0b 的 4 字段被 hotfix 调试 probe 用 minimal source XML 误冲，此为重跑起点）
2. `k3cloud_get_form_layout("SAL_SaleOrder")` → 拿父对象 tabs 列表（agent 按硬规则查容器 key）
3. `k3cloud_add_fields(extId, fields=[F_TestQty/F_TestPrice/F_TestAmount/F_TestStock, decimal, container=FTab_P0])` → `{ ok: true, addedCount: 4 }`
4. `k3cloud_get_extension_fields(extId)` 反查 → `count: 4`，4 字段就位

**结果**: 4 个 DecimalField 进 FKERNELXML（FieldScale=2 / FieldPrecision=23 默认），4 个 DecimalFieldAppearance 自动排版（Top=0/28/56/84，container=FTab_P0，ZOrder=99）。

**关键回归证据**: hotfix 后，add_fields 跑完 `T_META_OBJECTTYPE_L.FNAME` 仍保持 "OpenDeploy 业务规则 demo" 不被重置——证明所有 update 路径同样走 `<Form><Name>` 子元素 emit。

---

## 场景 1 — Calculate 字段级 UpdateAction

**用户指令**: "在这个扩展上加一条计算规则：当 F_TestQty 或 F_TestPrice 变化时，自动算出 F_TestAmount = F_TestQty * F_TestPrice。"

**Agent 行为**（修了 inline 路径之后第三次重试成功）:
1. `k3cloud_list_business_rules(extensionFid)` → `{ entityRules: [], fieldUpdateActions: [] }`（干净起点，前一次 entity-level rule 已被用户删）
2. `k3cloud_add_calculate_rule({ mountPoint: { kind: 'field', fieldKey: 'F_TestQty' }, actions: ['F_TestAmount = F_TestQty * F_TestPrice'] })` → `{ ok: true, serviceId: 'ba26fec8-17f3-42a3-bcb3-629082687f7a' }`
3. `k3cloud_add_calculate_rule({ mountPoint: { kind: 'field', fieldKey: 'F_TestPrice' }, actions: ['F_TestAmount = F_TestQty * F_TestPrice'] })` → `{ ok: true, serviceId: '1eecf87d-6913-4ec2-ae9c-c07b57964af5' }`

**结果**: 2 条字段级 Calculate UpdateAction 成功落库。任一字段（数量 / 单价）变化时实时触发金额重算。

**🐛 中途遇到两个 bug + hotfix（2026-05-05）**：

1. **第一轮** `connector.addFieldUpdateAction` 只在父对象 FKERNELXML 找字段 oid，扩展字段被拒（错误："字段 F_TestQty 在父对象 SAL_SaleOrder 上未找到"）。修：fallback 到扩展自身 FKERNELXML（`connector.ts:972`）。
2. **第二轮** 找到 oid 但走 overlay 路径（`<DecimalField action="edit" oid=...>` 追加到扩展 XML），BOS 服务端反序列化报"未能找到 DecimalField 对应的数据类型"。**根因**：扩展字段在 base metadata 里不存在，overlay 的 oid 找不到合并目标。修：参考 capture `req-120` IntegerField 实证，扩展字段必须 **inline 修改字段块**（加 `<FireUpdateEvent>1</FireUpdateEvent>` + inline `<UpdateActions>`），实现 `inlineFieldUpdateActionInExt`（`business-rule-overlay.ts`）+ `addFieldUpdateAction` 路由分发：父对象字段 overlay / 扩展字段 inline。

**DB 实证**：FKERNELXML 含 2 个 `<FireUpdateEvent>1</FireUpdateEvent>` + 2 个 `<UpdateActions>` 块（F_TestQty + F_TestPrice 各一），全部 inline 嵌入字段定义内。memory 沉淀：`bos_extension_field_inline_updateactions.md`。

---

## 场景 2 — list 验证 Calculate 规则在

**用户指令**: 场景 1 已含"加完反查确认"，agent 在 add_calculate_rule 完成后顺手反查。

**Agent 行为**:
1. `k3cloud_list_business_rules(extensionFid)` → `{ entityRules: [], fieldUpdateActions: [{ fieldKey: 'F_TestQty', actionId: 2, serviceId: 'ba26fec8-...', parameters: '["F_TestAmount = F_TestQty * F_TestPrice"]' }, { fieldKey: 'F_TestPrice', actionId: 2, serviceId: '1eecf87d-...', parameters: '["F_TestAmount = F_TestQty * F_TestPrice"]' }] }`

**结果**: 2 条 fieldUpdateActions 都被列出，fieldKey / actionId / parameters 与场景 1 写入一致。**`list_business_rules` 工具同时支持 inline 形态的 UpdateActions 解析**——之前没动过该工具，免费回归。

---

## 场景 3 — GetInvStock 实体级规则

**用户指令**: "加一条 GetInvStock 实体级业务规则：preCondition `FBillTypeID.FNumber == '01.01'`，stockQtyField `F_TestStock`。加完反查确认这条规则在。"

**Agent 行为**（修 PascalCase + TS list parser 之后第三次重试成功）:
1. `k3cloud_describe_service_meta(actionId=67)` → 返回 `properties.stockQtyField` 等 19+ camelCase schema
2. `k3cloud_add_get_inv_stock_rule(extensionFid, description, preCondition="FBillTypeID.FNumber == '01.01'", stockQtyField="F_TestStock")` → `{ ok: true, ruleId: '9803482e-c165-429d-964f-78178b399077', serviceId: 'd2c818b559aa470b9b994f5a7fece527' }`

**结果**: 1 条 GetInvStock entity-level rule，含 `<StockQtyField>F_TestStock</StockQtyField>`。

**🐛 中途遇到 3 个 bug + hotfix（2026-05-05）**：

1. **`buildAddEntityRuleOverlay` properties emit 用 camelCase**（agent 传 `stockQtyField`），BOS 服务端反射要 PascalCase（`<StockQtyField>`）→ 默默丢弃。修：`business-rule-overlay.ts` emit 时 `k.charAt(0).toUpperCase() + k.slice(1)`。**第一轮没修前**写出的旧规则 `3f126961...` 没有 `<StockQtyField>` 子元素，孤魂规则。
2. **bridge.ListBusinessRules 反射读不到 HeadEntity overlay**（DCXML `action="edit"` 是 delta marker，无 baseline 时 BOS deserializer 静默 drop）→ list 永远返回 `entityRules: []`。修：`business-rule-parser.ts` 改纯 TS string-walk parser；`connector.listBusinessRules` 不再走 bridge。
3. **`delete_business_rule` 依赖 list 找 ruleId 决定 entity vs field**——list 返空 → delete entity rule 永远报"未找到"。修因 (2) 自动解决。

**memory 沉淀**: `bos_extension_field_inline_updateactions.md`（场景 1 inline）+ 本场景的 PascalCase + TS parser 经验沉淀到 `bos_client_cache_relogin.md` 更新（用户当前登录方式无运行时缓存）。

---

## 场景 4 — BOS Designer 验证两条规则

**用户操作**: 用户截图 BOS Designer 实体服务规则面板（无需重登；用户当前登录方式无客户端缓存问题）。

**预期 + 实际**:
- 实体级规则区有 2 条 GetInvStock 规则——一条是 hotfix 前的孤魂规则（无 StockQtyField），一条是 hotfix 后的正确规则（含 StockQtyField=F_TestStock）。截图证实**写入路径已通**。
- 字段更新动作区有 2 条 Calculate 动作（targetField F_TestAmount，分别 mount 在 F_TestQty 和 F_TestPrice）——已在场景 2 反查证实。

**注**: 同名 entity rule 双开是 hotfix 调试副作用，非设计意图；场景 5 顺手清掉孤魂规则。

---

## 场景 5 — agent 删 GetInvStock 规则（删孤魂规则）

**用户指令**: "list_business_rules 看下扩展上现在所有规则。然后帮我把那条旧的、不完整的 GetInvStock 规则删掉。"

**Agent 行为**:
1. `k3cloud_list_business_rules(extensionFid)` → 返回 **2 条 entityRules**（TS parser 修复证据：之前一直返空）
   - `r1: ruleId=3f126961-..., services[0].serviceId=9bcc...` （**孤魂**：无 StockQtyField）
   - `r2: ruleId=9803482e-..., services[0].serviceId=d2c8...` （**正确**：含 StockQtyField=F_TestStock）
2. agent 按"哪条服务参数缺失"识别旧规则；用户提示 ruleId 后调 `k3cloud_delete_business_rule(extensionFid, ruleId='3f126961-fd13-4488-8d09-6bf95337736f')` → `{ location: 'entity' }`

**结果**: 旧孤魂规则被删；正确规则保留。

---

## 场景 6 — list 确认 delete 生效

**用户指令**: 含在场景 5 序列内（agent 自动反查）。

**Agent 行为**: `k3cloud_list_business_rules(extensionFid)` → 反查（待用户后续触发或 agent 自动反查）

**DB 实证**（直接 SQL）:
```sql
SELECT ... FROM T_META_OBJECTTYPE WHERE FID = 'a57bd1698fdf4c288239908b74a8e333';
-- EntityServiceRule blocks: 1（仅保留 9803482e 含 StockQtyField）
-- UpdateActions: 2（场景 1 的 F_TestQty / F_TestPrice Calculate）
-- FireUpdateEvent: 2（同上）
```

---

## 场景 6.5 — service Description 空行 cosmetic fix（hotfix + 回归验证）

**用户报告**（截图）: BOS Designer 双击 GetInvStock 规则 → "当规则条件成立时，执行以下服务" 列表第一行**显示为空白**，再次双击进入编辑窗口字段值都在。

**根因**: BOS Designer 的服务列表用每个 service 的 `<Description>` 文本当行标签。recon req-120 实证 BOS Designer 自身 wire 会主动塞默认值 —— GetInvStock 默认 "获取即时库存信息" / Calculate 默认 "计算定义公式的值并填写到指定列"。我们 `addGetInvStockRuleTool` / `addCalculateRuleTool` entity 分支都没填，wire 里 service 节点缺 Description，BOS Designer 渲染空行；编辑窗口走详情控件，所以双击进去看得见数据。

**Hotfix**: `business-rule-overlay.ts` 加 `DEFAULT_SERVICE_DESCRIPTION_BY_CLASSNAME` 表，`buildAddEntityRuleOverlay` 在 `svc.description` 缺失时按 className 兜底；显式 description 仍优先生效。

**回归验证**:
1. 用户重启 OpenDeploy
2. agent: `k3cloud_delete_business_rule(ruleId='9803482e-...')` 删旧规则 → `k3cloud_add_get_inv_stock_rule(...)` 重加
3. BOS Designer 工具栏点刷新 → 双击新规则 → "执行以下服务" 那行显示 "获取即时库存信息" 标签 ✓

**单测**: 2 个新单测 `tests/erp/business-rule-overlay.test.ts`：默认兜底场景 + 显式覆盖场景。

---

## 场景 7 — 清理: agent 删扩展

**用户指令**: "把扩展 a57bd1698fdf4c288239908b74a8e333 删掉，清理 demo 痕迹。"

**Agent 行为**:
1. `k3cloud_delete_extension(extensionFid='a57bd1698fdf4c288239908b74a8e333')` → ok

**SQL 实证**（直接 sqlcmd 验证）:
```sql
SELECT 'T_META_OBJECTTYPE' tbl, COUNT(*) cnt FROM T_META_OBJECTTYPE WHERE FID = 'a57bd1698fdf4c288239908b74a8e333'
UNION ALL SELECT 'T_META_OBJECTTYPE_L', COUNT(*) FROM T_META_OBJECTTYPE_L WHERE FID = 'a57bd1698fdf4c288239908b74a8e333'
UNION ALL SELECT 'T_META_OBJECTTYPE_E', COUNT(*) FROM T_META_OBJECTTYPE_E WHERE FID = 'a57bd1698fdf4c288239908b74a8e333';
-- 三表全部 0 行
```

**结果**: demo 扩展从 DB 完全删除，账套回到干净状态。

---

## Hotfix 总结（2026-05-05 demo 实证沉淀）

跑完整个 demo 共触发 6 个 hotfix（按发现顺序）：

| # | 症状 | 修哪 | commit / 状态 |
|---|---|---|---|
| 1 | 扩展名落库为父对象名（"销售订单"） | `dcxml.ts` emit `<Form><Name>` 子元素 | 待 commit |
| 2 | 扩展字段被 `addFieldUpdateAction` 拒（仅查父对象 oid） | `connector.ts` fallback 到扩展 FKERNELXML | 待 commit |
| 3 | 扩展字段 overlay 被 BOS 反序列化拒（"未能找到 DecimalField 对应的数据类型"） | 新 `inlineFieldUpdateActionInExt`，路由分发 | 待 commit |
| 4 | GetInvStock 规则 `<StockQtyField>` 不落 DB（camelCase 被 BOS 反射丢弃） | `business-rule-overlay.ts` k.charAt(0).toUpperCase() | 待 commit |
| 5 | `list_business_rules` 永远返 `entityRules: []`（bridge 反射 drop delta marker） | 新纯 TS `business-rule-parser.ts`，不再走 bridge | 待 commit |
| 6 | BOS Designer 服务列表渲染空行（service 缺 `<Description>`） | `business-rule-overlay.ts` className → 默认描述兜底 | 待 commit |

**Skill / prompt / 工具消息更新**:
- 移除 5 处 "请关闭客户端整个重登" 提醒（用户当前登录方式无客户端缓存问题），改为条件触发文案
- 修 3 个回归单测（断言 `/重登/` → `/BOS Designer/`）
- 新增单测 13 个（business-rule-parser 8 + inline-overlay 4 + dcxml 3 + Description-fallback 2）

**memory 沉淀**:
- `bos_extension_field_inline_updateactions.md`（场景 1 inline 路径全实证）
- `feedback_check_applog_on_error.md` 更新（demo / verify scenarios 也要先看日志再问用户）
- `bos_client_cache_relogin.md` 更新（用户当前登录方式细节）

---

## 已知 limitation

- **Calculate AST validator 当前只查函数白名单 + 字段引用 + Python 3 语法 + SQL-style 禁止模式**。未实现完整 Python AST 解析（递归表达式 / lambda / .NET 方法链等）。复杂场景可能漏检，BOS 服务端最终会 reject。
- **GetInvStock 工具暴露 ~19 typed param**。客户实战如发现 v0.2 补充字段，回头扩 SERVICE_META_SCHEMAS。
- **schema-driven 工具静默丢弃未知 key**（follow-up：`warnings: string[]` 反馈机制 — memory `followup_tool_feedback_warnings_on_dropped_inputs.md`）。
- **v0.1 不支持 ActionId**: 3 (MulUnitConvert) / 23 (CallBillFunction) / 42 (GetPrice) / 70 (InvMinusCheck) — 留 v0.2。
