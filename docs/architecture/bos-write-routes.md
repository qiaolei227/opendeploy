# BOS 写入路径决策矩阵

> **目的**:每次给 BOS 加新写入能力（字段、操作、按钮、转换规则、业务规则、扩展……）必须先读这份文档,选对路径再动手。Plan 5.12 反复踩坑大半源于"选错路径,实现到一半才发现"——本文档把"选哪条路"从隐性变成显性。

**最近一次更新**:2026-05-07(L3 followup — Route C 完全废止)
**对应仓库版本**:`feature/plan-5.12` @ HEAD(L3 followup migration:addToolbarButton/removeToolbarButton 也迁 Route B)

---

## §1 当前路径 — 只剩 2 条

| | Route A — Bridge | Route B — Envelope Rebuild | ~~Route C~~ |
|---|---|---|---|
| **核心位置** | `bos-bridge/` (.NET 4.8 sidecar) + `src/main/erp/k3cloud/bridge/{client,index}.ts` | `src/main/erp/k3cloud/rpc/{save-for-ide,dcxml,types,codec}.ts` | ~~已废止~~ |
| **形态** | DCXML deserialize → 强类型对象 mutate → DCXML serialize | 强类型 AST → 直接组 DCXML 字符串 → 全 envelope POST | — |
| **代码量** | ~1700 行 C# (Plan 6 followup 删 Operations.cs 1289 行 dead code 后) + ~300 行 TS | ~1500 行 TS(save-for-ide+dcxml+types,L3 followup 后扩了 BarButton 类型) | — |
| **当前生产用** | 转换规则(Plan 5.12.4 v2)、业务规则(Plan 5.12.3b) | `register_python_plugins` / `create_extension` / `add_custom_operation` / `removeOperation` / **`addToolbarButton` / `removeToolbarButton`**(L3 followup 完成 2026-05-07) | — |
| **可信度** | 🟢 已生产 | 🟢 已生产 | — |

**Route C 历史**:Plan 5.12.6 期间用过(`operation-overlay.ts` 字符串模板 splice 到既有 FKERNELXML),5.12.6 hotfix #4 把 addCustomOperation 切到 Route B,L3(2026-05-07)把 removeOperation 切到 Route B,L3 followup 同日把 addToolbarButton + removeToolbarButton 切到 Route B,Route C 至此完全死透。原 `operation-overlay.ts` 已重命名为 `appearance-locator.ts`(2026-05-08),只剩 2 个 appearance-locator 解析器(read-only,不构造 XML)。

---

## §2 决策树:加新写入能力时该走哪条?

```
新写入能力 X
│
├─ X 是「读」类(list / load / parse)?
│  └─ ✅ Route A bridge — list_* op,deserialize 后用强类型
│
├─ X 操作的元素属于「转换规则 / 业务规则」?
│  └─ ✅ Route A bridge — DcxmlSerializer 对这两类元素稳定,
│                          已有 5 个 convert / 4 个 business rule op
│
├─ X 操作 Form-level 结构(FormOperations / Plugins / Fields / Entries / Buttons)?
│  ├─ 是「新增 / 创建 / 全量替换」?
│  │  └─ ✅ Route B envelope rebuild — register_python_plugins 模式;
│  │                                     调 saveExtension(SaveExtensionRequest)
│  │                                     用 addXxx[] / addBarButtons[] 字段
│  └─ 是「按 key 删除」?
│     └─ ✅ Route B — filter existing.formOperations 重发 envelope,或
│                      用 removeBarButtons[] / removeFields[] 等显式 remove 字段
│
└─ X 操作 LayoutInfos / 控件外观 / 移动端布局?
   └─ ⚠️ 还没有任何路径覆盖,先 capture 实证再选路径(参考 §6)
```

---

## §3 各路径深度

### Route A — Bridge(`bos-bridge/`)

**何时用**:转换规则、业务规则、列表/读取类操作。

**怎么用**(TS 端调用模板):

```typescript
import { getBridge } from '@main/erp/k3cloud/bridge';

const bridge = await getBridge();
const xml = await this.getKernelXml(extId);                   // 1. TS 读 SQL
const { xml: newXml } = await bridge.send('add_convert_field_map', {
  xml,
  target_field_key: 'FFieldA',
  source_field_key: 'FSrc',
  mode: 'Auto',
});                                                            // 2. bridge mutate
await this.saveExtensionRaw(session, extId, newXml);          // 3. TS HTTP 发
```

**Bridge 不持 HTTP session、不与 K/3 server 通信** —— 纯函数 `string xml in → string xml out`。I/O 留 TS 端。

**已实现 18 个 op**(`bos-bridge/Program.cs` 派发表):
- 系统:`ping`, `normalize_convert_rule`, `roundtrip`, `schema-probe`
- 转换规则:`add_convert_field_map`, `set_convert_group_by`, `set_convert_filter`, `add_convert_plugin`, `remove_convert_plugin`, `add_convert_bill_type_map`
- 业务规则:`list_business_rules`, `add_entity_service_rule`, `add_field_update_action`, `remove_business_rule`
- **操作/按钮**(已实现但 5.12.6 实测**不可靠** — 见 §4 spike #1/#2):`list_operations`, `add_custom_operation`, `remove_operation`, `add_toolbar_button`, `remove_toolbar_button`

**Fail mode**(Route A 不能解的):
- **A-FAIL-1 byte-exact PK 不匹配**:DcxmlSerializer 输出 `action="edit" oid=...` 时要求扩展和父对象 baseline 的 PK byte-exact 一致;5.12.6 spike #1 实测对操作类元素这个匹配过严,产 silent-drop。详见 `docs/recon/2026-05-06-operations-spike.md` 和 `connector.ts:1094-1099`
- **A-FAIL-2 父元素被擦风险**:Bridge 强类型 mutate 模型对"加一个子节点"和"重写整个 Form"边界容易模糊;5.12.6 spike #2 撞到了

### Route B — Envelope Rebuild(`rpc/save-for-ide.ts` + `rpc/dcxml.ts`)

**何时用**:Form-level 结构变更(字段、操作、按钮、entry、Python 插件)。

**怎么用**(TS 端调用模板,见 `connector.addCustomOperation` line 1135-1163):

```typescript
const ext = await this.getObject(extId);                       // 1. 读扩展元数据
const extXml = await this.getKernelXml(extId);                 // 2. 读现有 FKERNELXML
const parentXml = await this.getKernelXml(ext.baseObjectId);   // 3. 读父对象 FKERNELXML
const layoutInfoOid = extractLayoutInfoOid(parentXml);         // 4. 抽 layout oid
const existing = extractExistingExtensionElements(extXml);     // 5. 抽现有 elements

const req: SaveExtensionRequest = {
  extension: { formId: ext.id, baseObjectId: ext.baseObjectId, ... },
  isNew: false,
  layoutInfoOid,
  existingFieldsRaw: existing.fields,
  existingPluginsRaw: existing.plugins,
  /* … 一定要把所有 existingXxxRaw 都传齐,否则该类元素全被服务端抹掉 */
  addFormOperations: [newOp],                                  // 6. 增量
};
const result = await saveExtension(session, req);              // 7. POST
```

**Fail mode**:
- **B-FAIL-1 envelope 漏字段 → 元素被抹**:caller 必须 supply 所有 `existingXxxRaw`,任何一类漏掉,服务端就把那一整类元素从扩展里抹掉。5.12.6 hotfix #4 就是这个 bug
- **B-FAIL-2 wire format 严格**:`SaveExtensionRequest` 的 12 字段 + 12 appearance 类型的 dcxml.ts emit 必须正确;捕获错了 → 服务端 silent drop 或 NRE
- **B-FAIL-3 fresh extension 的 LayoutInfos 缺失**:create_extension 后立即写,FKERNELXML 没 `<LayoutInfos>` —— 必须从父对象 extract layoutInfoOid 注入

### ~~Route C — Overlay~~ (已死,2026-05-07)

**全部清空**。所有 5 大 fail mode (C-FAIL-1 ~ C-FAIL-5) 因为这条路根本不在了已无意义,留作历史记录:
- C-FAIL-1 duplicate `<Form>` sibling silent drop
- C-FAIL-2 missing `<LayoutInfos>` silent drop
- C-FAIL-3 wire 没有 `action="add"` 概念,Route C 加东西本就不该走 overlay
- C-FAIL-4 手动 XML 转义易漏
- C-FAIL-5 0 类型保护

`src/main/erp/k3cloud/rpc/appearance-locator.ts`(原 `operation-overlay.ts`,2026-05-08 改名)只剩 `extractFormAppearanceLocation` / `extractEntryEntityAppearanceLocation` 两个**只读**解析器,不构造任何 XML;用 regex literal 匹配元素名,不触发 L4 ESLint guard,因此**不在白名单**。

---

## §4 已知失败模式速查表

| 编号 | 失败模式 | 证据 | 哪条路径会撞 | 现行解法 |
|---|---|---|---|---|
| **F1** | bridge byte-exact PK match 失败 → silent drop | docs/recon/2026-05-06-operations-spike.md spike #1 | A | 改 B(全 envelope 重建) |
| **F2** | bridge 父元素 wipe 风险 | spike #2 | A | 改 B |
| **F4** | fresh extension 缺 `<LayoutInfos>` → silent drop add | 5.12.6 hotfix #4 注释(connector.ts:1100-1103) | B(忘 layoutInfoOid) | extract from parent 注入 |
| **F5** | envelope 漏 existingXxxRaw → 该类元素全抹 | 5.12.6 hotfix #4 | B | 必须传齐 8 个 existing*Raw 字段 |
| ~~F3~~ | ~~duplicate `<Form>` sibling silent drop~~ | ~~Route C 专属,已废止~~ | — | — |

---

## §5 加新 BOS 写入能力的 Checklist

```
□ Step 1 — 决策树查路径(本文 §2),选 A 或 B
□ Step 2 — 在 BOS Designer 里手动跑一次目标场景,capture wire
   (`pnpm bos:capture` 后操作 BOS Designer + `pnpm tsx scripts/bos-recon/decode-capture.ts <log> <reqId>`)
□ Step 3 — 看 capture 决定 element 形态
   ├─ Route A 路径:看 element 在 BOS Core schema 里有没有(用 bridge schema-probe);有 → bridge 加 op
   └─ Route B 路径:看 capture 的 ap0 JSON 里 __source__ 是怎么 emit 的,types.ts + dcxml.ts 加 case
□ Step 4 — 加 capture replay 测试(L2 框架,见 docs/architecture/bos-capture-replay.md)
□ Step 5 — 实现 + agent tool wrapper + integration test 跑 round-trip
□ Step 6 — 第一次 e2e 走 BOS Designer 重登 + 看 element 真出现(memory `bos_client_cache_relogin`)
□ Step 7 — 失败时,优先看 .scratch/captures/decoded/<reqId>/ 而不是猜
```

**禁止**:跳过 Step 2(直接编 wire)、跳过 Step 4(不留 fixture 等下次回归)、跳过 Step 6(只看 list_* 工具自己说"成功")。

---

## §6 反模式

❌ **不要在 TS 里手写 BOS XML 字符串拼接**(L4 ESLint 规则会禁)。例外:`bos-bridge/`(它就是干这个的)、`rpc/dcxml.ts`(类型驱动的 emitter,不是手写)、`rpc/business-rule-overlay.ts`(5.12.3b 业务规则 overlay 字符串构造,L3 跟进时一并清)。`rpc/appearance-locator.ts`(原 operation-overlay.ts)只用 regex literal 不触发 guard,不在白名单。

❌ **不要为了"省事"在 connector.ts 里再开第 4 条路径**。3 条已经很多。新场景必须落到 A 或 B 的现有 channel。

❌ **不要假设 bridge `add_X` op 存在 = 它能用**。5 个操作/按钮 op 都在 bridge 里,但全部因 F1/F2 不可靠 —— 实际 connector 用 B。新场景验证 bridge 路径前必须先实测。

❌ **不要 hot-patch overlay**。Route C 是 dying;有 bug 就改成 B,不要再加 hotfix。

---

## §7 常用引用

**代码**:
- Route A bridge dispatcher:`bos-bridge/Program.cs`
- Route A bridge ops 实现:`bos-bridge/BosContext.{cs,BusinessRules.cs,Operations.cs,Reflection.cs}`
- Route A TS client:`src/main/erp/k3cloud/bridge/{client,index}.ts`
- Route B envelope build:`src/main/erp/k3cloud/rpc/{save-for-ide,dcxml,types,codec}.ts` + `rpc/README.md`
- Route C(已绝迹):原 `src/main/erp/k3cloud/rpc/operation-overlay.ts`,2026-05-08 改名 `appearance-locator.ts` — 只剩 read-only 解析器
- Connector 三路调用:`src/main/erp/k3cloud/connector.ts:1034-1300`

**Capture 工具**:
- 抓包:`scripts/bos-recon/capture-proxy.ts` (`pnpm bos:capture`)
- 解码:`scripts/bos-recon/decode-capture.ts`
- 跨包对比:`scripts/bos-recon/analyze-saves.ts`

**已 commit 的 spike / 实证文档**:
- `docs/recon/2026-05-06-operations-spike.md` — 5.12.6 spike,4 份 capture,DCXML stateful baseline diff 模型
- `docs/recon/2026-05-04-business-rules-tier-b.md` — 5.12.3b 业务规则
- `connector.ts:1094-1104` — 5.12.6 三路演变注释
- `appearance-locator.ts:1-18`(原 `operation-overlay.ts`)— Route C 历史 + 现职责 file 头注释

**Memory 速查**:
- `bos_save_path_is_rpc.md` — 总路线(RPC,不是 SQL 直写)
- `bos_save_for_ide_v9_wire_format.md` — wire 协议细节(ap0 JSON / DCXML stateful baseline diff)
- `bos_dcxml_element_schema.md` — element schema 表
- `followup_operation_overlay_to_bridge.md` — 5.12.6 路径 5 条已知债 + 5 条触发条件
- `plan_5_12_6_e2e_status.md` — 5.12.6 当前 4-hotfix 状态
- `bos_client_cache_relogin.md` — 改完字段必须重登才看得到
- `bos_metadata_cache_invalidation.md` — 服务端 cache 失效套路

---

## §8 维护

- 这份文档**不许过期**。每次新加 BOS 写入能力(成功 OR 失败)必须更新 §3 / §4。
- 路径数量 = 复杂度。**永远朝路径减少的方向走**(L3 把 C 干掉,目标剩 A + B 两条;长期看 A 也可能仅用于 read,write 全归 B)。
- 任何"加新路径"的提议必须先在本文 §2 决策树证明现有 A/B/C 都不够,才能开新路径。
