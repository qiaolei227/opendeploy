/**
 * R2 step 3 — register a Python convert plugin that copies the PAIJ custom
 * entry rows from SO to OutStock. Standard convert-rule field mappings can't
 * handle this because the bridge requires a parent-rule DefaultConvertPolicy
 * for the target entry, which doesn't exist for custom entries.
 *
 * Plugin runs OnAfterCreateLink: for each target bill, copies source SO's
 * F_PAIJ_Entity_61b rows into target OutStock's F_PAIJ_Entity_jo3 collection,
 * carrying the 4 entry-level fields (Unit / Qty / Price / Amount).
 *
 * If push works → entry-level carrying via Python plugin path is verified.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { setActiveProject, setBundledConvertRuleBaselines, getActiveConnector } from '../../src/main/erp/active';
import { buildSaleOrderOutStockBaseline } from '../../src/main/erp/k3cloud/rpc/convert-rule-baselines';
import type { Project } from '@shared/erp-types';

const extId = process.argv[2];
if (!extId) { console.error('usage: <script> <extId>'); process.exit(1); }

const settings = JSON.parse(readFileSync(resolve(homedir(), '.opendeploy/settings.json'), 'utf-8'));
const project: Project = settings.projects?.[0];
setBundledConvertRuleBaselines({
  'SaleOrder-OutStock': buildSaleOrderOutStockBaseline({
    originXml: readFileSync(resolve('src/main/erp/k3cloud/rpc/baselines/sale-order-outstock-origin.xml'), 'utf-8'),
    extensionTemplateXml: readFileSync(resolve('src/main/erp/k3cloud/rpc/baselines/sale-order-outstock-extension-template.xml'), 'utf-8'),
  }),
});
await setActiveProject(project);
const c = getActiveConnector()!;

// Pattern based on real customer plugins:
//   - sarcah JSJXCloud2025/SAL_SaleOrderToSAL_OUTSTOCK.cs (AfterConvert idiom)
//   - 天宇药业产销协同/HTypePlugin/CreatePlanOrderPlan.cs (LoadSingle for source data)
// Use `BusinessDataServiceHelper.LoadSingle(ctx, sbillId, businessInfoType)` —
// never raw SQL — to fetch source bill DynamicObject; field access via
// Entity.EntryName.
const pyScript = `import clr
clr.AddReference("Kingdee.BOS")
clr.AddReference("Kingdee.BOS.Core")
clr.AddReference("Kingdee.BOS.DataEntity")
clr.AddReference("Kingdee.BOS.ServiceHelper")

from Kingdee.BOS.Orm.DataEntity import DynamicObject, DynamicObjectCollection
from Kingdee.BOS.ServiceHelper import BusinessDataServiceHelper

def AfterConvert(e):
    target_entity = e.TargetBusinessInfo.GetEntity("F_PAIJ_Entity_jo3")
    source_entity = e.SourceBusinessInfo.GetEntity("F_PAIJ_Entity_61b")
    if target_entity is None or source_entity is None:
        return
    tgt_prop = target_entity.EntryName  # PAIJ_Cust_Entry100018
    src_prop = source_entity.EntryName  # PAIJ_Cust_Entry100017
    src_type = e.SourceBusinessInfo.GetDynamicObjectType()

    src_bill_cache = {}

    for ex_data in e.Result.FindByEntityKey("FBillHead"):
        target_obj = ex_data.DataEntity
        std_entries = target_obj["SAL_OUTSTOCKENTRY"]
        if std_entries is None or std_entries.Count == 0:
            continue

        sbill_id = None
        for std_row in std_entries:
            links = std_row["FEntity_Link"]
            if links is None or links.Count == 0:
                continue
            sbill_id = links[0]["SBillId"]
            break
        if not sbill_id:
            continue

        cache_key = str(sbill_id)
        source_bill = src_bill_cache.get(cache_key)
        if source_bill is None:
            source_bill = BusinessDataServiceHelper.LoadSingle(e.Context, sbill_id, src_type)
            if source_bill is None:
                continue
            src_bill_cache[cache_key] = source_bill

        src_rows = source_bill[src_prop]
        if src_rows is None or src_rows.Count == 0:
            continue

        target_collection = target_obj[tgt_prop]
        for src_row in src_rows:
            new_row = DynamicObject(target_entity.DynamicObjectType)
            unit_obj = src_row["F_PAIJ_TestUnit"]
            if unit_obj is not None:
                new_row["F_PAIJ_TestUnit"] = unit_obj
            new_row["F_PAIJ_TestQty"] = src_row["F_PAIJ_TestQty"]
            new_row["F_PAIJ_TestPrice"] = src_row["F_PAIJ_TestPrice"]
            new_row["F_PAIJ_TestAmount"] = src_row["F_PAIJ_TestAmount"]
            target_collection.Add(new_row)
`;

// remove first (idempotent in addConvertPlugin would skip our updated script)
console.log(`removing any existing PAIJEntryCarrier on ${extId}…`);
const rm = await c.removeConvertPlugin(extId, 'PAIJEntryCarrier');
console.log(rm.ok ? '  ✓ cleared (or absent)' : `  ✗ ${rm.raw.slice(0, 200)}`);

console.log(`registering Python convert plugin on extension ${extId}…`);
const r = await c.addConvertPlugin(
  extId,
  'PAIJEntryCarrier',
  pyScript,
  '销售订单到出库单的 PAIJ 自定义单据体携带(Unit/Qty/Price/Amount)'
);
console.log(r.ok ? '✓ registered' : `✗ ${r.raw.slice(0, 300)}`);
process.exit(r.ok ? 0 : 1);
