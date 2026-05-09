/**
 * Minimal repro for the silent-drop BasePropertyField bug observed in
 * "信用额度管控" 2026-05-08:
 *
 * Steps:
 *   1. Pick a clean parent (BD_MATERIAL — usually no project extension).
 *   2. Create a fresh extension on it.
 *   3. add_fields with 6 head fields (combo/amount/date/checkbox/base_data/base_property).
 *   4. Read DB FKERNELXML, count *FieldAppearance.
 *   5. add_fields a 7th field (envelope rebuild) — checks if rebuild loses
 *      the appearance bucket.
 *   6. Re-read DB, recount.
 *
 * Cleanup is via SQL (since we just produced a possibly-broken extension).
 * Print the extId so the user can DELETE it manually if cleanup is denied.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

import { K3CloudConnector } from '../../src/main/erp/k3cloud/connector';
import type { Project } from '@shared/erp-types';

const settings = JSON.parse(readFileSync(resolve(homedir(), '.opendeploy/settings.json'), 'utf-8'));
const project: Project = settings.projects?.[0];
if (!project?.bos) { console.error('no project'); process.exit(1); }

const PARENT = process.env.PARENT ?? 'BD_MATERIAL';

const c = new K3CloudConnector(project.bos);
await c.connect();
console.log('✓ connected', project.bos.baseUrl);

// If there's already a project extension here, reuse it (we just need to
// trigger Step 3 envelope rebuild on something that already has 6 fields).
const existing = await c.listExtensions(PARENT);
const projectExt = existing.find((e) => e.developerCode == null || e.developerCode === project.bos!.devCode);
let extIdReuse: string | null = null;
if (projectExt) {
  console.log(`Reusing existing ext ${projectExt.extId} (${projectExt.name})`);
  extIdReuse = projectExt.extId;
}

// 1. Create extension
console.log(`\nStep 1 — create_extension on ${PARENT}…`);
// Use the agent's tool path so we go through buildSaveExtensionRequest correctly.
// connector doesn't expose createExtension as one call — emulate via internal flow:
// We need to use the bos-rpc-tools-equivalent. Instead, dynamic-construct via a single-shot
// add_fields-style flow.
// Simplest: call internal saveExtension with isNew + 6 fields together, no separate "create then add".
const parentObj = await c.getObject(PARENT);
if (!parentObj) { console.error('parent not found'); process.exit(1); }

const { saveExtension } = await import('../../src/main/erp/k3cloud/rpc/save-for-ide');
const { extractLayoutInfoOid } = await import('../../src/main/erp/k3cloud/rpc/layout-discovery');
const { newCompactGuid } = await import('../../src/main/erp/k3cloud/rpc/dcxml');
const parentXml = (await c.getKernelXml(PARENT))!;
const layoutInfoOid = extractLayoutInfoOid(parentXml)!;

const extId = extIdReuse ?? newCompactGuid();
console.log(`  using extId=${extId}${extIdReuse ? ' (reused)' : ' (new)'}`);

// Use connector's internal session.
const session = (c as any).requireSession();

// Step 2 — single-shot save: create + add 6 fields + 6 appearances.
const fields: any[] = [
  { type: 'TextField', key: 'F_DBG_Note', caption: '备注', listTabIndex: 9000, id: newCompactGuid() },
  { type: 'AmountField', key: 'F_DBG_Amt', caption: '金额', listTabIndex: 9001, fieldScale: 2, fieldPrecision: 18, id: newCompactGuid() },
  { type: 'DateField', key: 'F_DBG_Date', caption: '日期', listTabIndex: 9002, id: newCompactGuid() },
  { type: 'CheckBoxField', key: 'F_DBG_Enable', caption: '启用', listTabIndex: 9003, id: newCompactGuid() },
  { type: 'BaseDataField', key: 'F_DBG_Cust', caption: '客户', listTabIndex: 9004, lookUpObjectId: '42d9a9bf-a383-47dc-8d37-3a1bb135bc01', srcFindFieldName: 'FNUMBER', srcDisplayFieldName: 'FNAME', id: newCompactGuid() },
  { type: 'BasePropertyField', key: 'F_DBG_CustName', caption: '客户名称', listTabIndex: 9005, controlFieldKey: 'F_DBG_Cust', srcDisplayFieldName: 'FName', defaultCondition: 67, id: newCompactGuid() },
];
const apps: any[] = fields.map((f, i) => ({
  type: f.type, key: f.key, caption: f.caption,
  container: 'FTAB_P0', zOrderIndex: 99, tabindex: 9000 + i,
  left: 600 + i * 280, top: 30,
}));

if (!extIdReuse) {
  const result = await saveExtension(session, {
    extension: {
      formId: extId, baseObjectId: PARENT,
      modelTypeId: parentObj.modelTypeId!, subSystemId: parentObj.subsystemId!,
      name: [{ localeId: 2052, value: 'addfield-debug' }],
      isv: { devCode: project.bos.devCode },
    },
    isNew: true,
    layoutInfoOid,
    addFields: fields,
    addAppearances: apps,
  });
  if (!result.isSuccess) {
    console.error('save failed:', result.messageDetail);
    process.exit(1);
  }
  console.log(`  ✓ saved (${fields.length} fields + ${apps.length} appearances)`);
} else {
  console.log(`  (skipping create — reusing existing extension)`);
}

// Pause to be readable in DB.
console.log(`\nStep 2 — try reading via getBusinessObjectMetaData (RPC)`);
try {
  const xml = await c.getKernelXml(extId);
  if (xml) {
    const matches = xml.match(/<\w+FieldAppearance\b/g) ?? [];
    console.log(`  ✓ getKernelXml succeeded (${xml.length} chars), *FieldAppearance count: ${matches.length}`);
    console.log(`    tags: ${[...new Set(matches)].join(', ')}`);
  } else {
    console.log(`  ⚠ getKernelXml returned null`);
  }
} catch (e) {
  console.log(`  ❌ getKernelXml threw: ${(e as Error).message.slice(0, 200)}`);
}

// Step 3 — second envelope-rebuild save: add a 7th field. This emulates
// what register_python_plugins / add_fields(entry) / etc would do — it
// reads existing.appearances and re-emits the envelope. If anything is
// dropped, the 6 *FieldAppearance count goes down.
console.log(`\nStep 3 — second envelope-rebuild save (add 1 more field)…`);
const { extractExistingExtensionElements } = await import('../../src/main/erp/k3cloud/rpc/existing-elements');
const extXml1 = (await c.getKernelXml(extId))!;
const existing1 = extractExistingExtensionElements(extXml1);
console.log(`  read-back appearances bucket: ${existing1.appearances.length}, fields bucket: ${existing1.fields.length}`);

const newField = {
  type: 'TextField', key: 'F_DBG_Note2', caption: '备注 2',
  listTabIndex: 9006, id: newCompactGuid(),
};
const newApp = {
  type: 'TextField', key: 'F_DBG_Note2', caption: '备注 2',
  container: 'FTAB_P0', zOrderIndex: 99, tabindex: 9006, left: 600 + 6 * 280, top: 30,
};

const result2 = await saveExtension(session, {
  extension: {
    formId: extId, baseObjectId: PARENT,
    modelTypeId: parentObj.modelTypeId!, subSystemId: parentObj.subsystemId!,
    name: [{ localeId: 2052, value: 'addfield-debug' }],
    isv: { devCode: project.bos.devCode },
  },
  isNew: false,
  layoutInfoOid,
  existingFieldsRaw: existing1.fields,
  existingAppearancesRaw: existing1.appearances,
  existingPluginsRaw: existing1.plugins,
  existingEntriesRaw: existing1.entries,
  existingEntryAppearancesRaw: existing1.entryAppearances,
  existingTabPagesRaw: existing1.tabPages,
  existingTabControlsRaw: existing1.tabControls,
  existingFormOperationsRaw: existing1.formOperations,
  existingHeadEntityRaw: existing1.headEntity,
  addFields: [newField as any],
  addAppearances: [newApp as any],
});
console.log(`  saveExtension result: isSuccess=${result2.isSuccess}`);
if (!result2.isSuccess) console.log(`  detail: ${result2.messageDetail}`);

// Step 4 — re-read.
const xml2 = await c.getKernelXml(extId);
if (xml2) {
  const matches2 = xml2.match(/<\w+FieldAppearance\b/g) ?? [];
  console.log(`\n  ${matches2.length} *FieldAppearance in DB after envelope rebuild`);
  console.log(`  tags: ${[...new Set(matches2)].join(', ')}`);
  if (matches2.length === 7) {
    console.log(`\n✅ All 7 appearances survived envelope rebuild — wire path is sound`);
  } else {
    console.log(`\n❌ DROP — expected 7, got ${matches2.length}`);
  }
}

console.log(`\nResult extId=${extId} — clean up later via SQL.`);
await c.disconnect();
