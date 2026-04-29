/**
 * End-to-end smoke for the Plan 5.14 entry/tab toolchain.
 *
 * Exercises the full lifecycle on an EXISTING extension:
 *   1. create_tab_page(parent=FTab1)            → tabPageKey
 *   2. create_entry(parentTabPageKey=...)        → entryKey + tableName + entryName + seq
 *   3. add_fields(container=entryKey, 3 fields)  → 3 entry-fields written
 *   4. get_form_layout(extId=...)                → verify entry + tab page + fields landed
 *   5. rename_entry                              → caption change visible
 *   6. delete_entry                              → cascades entry-fields
 *   7. delete_tab_page                           → empty after entry gone
 *
 * Drives the real RPC stack — needs a logged-in BOS session against a live
 * server. Doesn't go through the agent's tool registry; calls the same
 * underlying functions the tools wrap so we test the wire format, not the
 * tool plumbing.
 *
 * Usage:
 *   K3_USERNAME=demo K3_PASSWORD=1qaz@WSX K3_FID=<32-hex-extension-id> \
 *     pnpm tsx scripts/bos-recon/smoke-entry-lifecycle.ts
 *
 * Prerequisite: extension already exists. Run smoke-save.ts first to create
 * one, or pass an existing K3_FID. Designer must show the lifecycle visually
 * after each step (refresh between steps).
 */

import { login } from '../../src/main/erp/k3cloud/rpc/login';
import { getNextSequenceInt32, SEQUENCE_CATEGORY_CUST_ENTRY } from '../../src/main/erp/k3cloud/rpc/sequence';
import { saveExtension } from '../../src/main/erp/k3cloud/rpc/save-for-ide';
import { extractExistingExtensionElements } from '../../src/main/erp/k3cloud/rpc/existing-elements';
import { newCompactGuid } from '../../src/main/erp/k3cloud/rpc/dcxml';
import { getBusinessObjectMetaData } from '../../src/main/erp/k3cloud/rpc/metadata';
import { extractKernelXml } from '../../src/main/erp/k3cloud/rpc/metadata-xml';
import { parseFormLayoutContainers } from '../../src/main/erp/k3cloud/fkernel-parsers';
import type { SaveExtensionRequest } from '../../src/main/erp/k3cloud/rpc/types';

const baseUrl = process.env.K3_BASE_URL ?? 'http://localhost/k3cloud';
const acctId = process.env.K3_ACCT_ID ?? '69a531ee82525a';
const username = process.env.K3_USERNAME;
const password = process.env.K3_PASSWORD;
const devCode = process.env.K3_DEVCODE ?? 'PAIJ';
const extId = process.env.K3_FID;
const layoutInfoOid =
  process.env.K3_LAYOUT_OID ?? 'bc952920-057d-4790-9c27-1134091eb298';
const parentFormId = process.env.K3_PARENT ?? 'SAL_SaleOrder';

if (!username || !password) {
  console.error('K3_USERNAME and K3_PASSWORD env vars required');
  process.exit(1);
}
if (!extId) {
  console.error('K3_FID env var required (32-hex extension FID)');
  process.exit(1);
}

function gen3(): string {
  const a = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return a[Math.floor(Math.random() * a.length)] + a[Math.floor(Math.random() * a.length)] + a[Math.floor(Math.random() * a.length)];
}

async function readExtensionState() {
  const md = await getBusinessObjectMetaData(session, extId!);
  const xml = extractKernelXml(md.metaData);
  return {
    existing: xml ? extractExistingExtensionElements(xml) : {
      fields: [], appearances: [], plugins: [],
      entries: [], entryAppearances: [], tabPages: [], tabControls: [],
    },
    extKernelXml: xml,
  };
}

console.log('=== Login ===');
const loginResult = await login({ baseUrl, acctId, username, password });
if (!loginResult.isSuccess) {
  console.error('Login failed:', loginResult.message);
  process.exit(1);
}
console.log('logged in as', loginResult.userName);
console.log();

const session = loginResult.session;

const baseExt = {
  formId: extId!,
  baseObjectId: parentFormId,
  modelTypeId: 100,
  subSystemId: '23',
  name: [{ localeId: 2052 as const, value: 'Smoke Test Ext' }],
  isv: { devCode },
};

// Step 1 — create_tab_page (parent=FTab1)
console.log('=== Step 1: create_tab_page (parent=FTab1) ===');
{
  const { existing } = await readExtensionState();
  const tabPageKey = `FTab1_${devCode}_P_${gen3()}`;
  const req: SaveExtensionRequest = {
    extension: baseExt,
    isNew: false,
    layoutInfoOid,
    existingFieldsRaw: existing.fields,
    existingAppearancesRaw: existing.appearances,
    existingPluginsRaw: existing.plugins,
    existingEntriesRaw: existing.entries,
    existingEntryAppearancesRaw: existing.entryAppearances,
    existingTabPagesRaw: existing.tabPages,
    existingTabControlsRaw: existing.tabControls,
    addTabPages: [{ key: tabPageKey, caption: 'Smoke 页签', container: 'FTab1' }],
  };
  const r = await saveExtension(session, req);
  if (!r.isSuccess) {
    console.error('FAILED:', r.messageDetail);
    process.exit(1);
  }
  console.log('created tabPageKey:', tabPageKey);
  process.env.K3_SMOKE_TAB = tabPageKey;
}
console.log();

// Step 2 — create_entry on that tab page
const tabPageKey = process.env.K3_SMOKE_TAB!;
let entryKey = '';
let entryTableName = '';
console.log('=== Step 2: create_entry ===');
{
  const allocatedInt = await getNextSequenceInt32(session, SEQUENCE_CATEGORY_CUST_ENTRY, 1);
  const { existing } = await readExtensionState();

  // Compute Seq from parent + ext.
  const parentMd = await getBusinessObjectMetaData(session, parentFormId);
  const parentXml = extractKernelXml(parentMd.metaData);
  let parentEntryCount = 0;
  if (parentXml) {
    for (const e of parseFormLayoutContainers(parentXml).entries) {
      if (e.kind === 'entry') parentEntryCount++;
    }
  }
  const seq = parentEntryCount + existing.entries.length + 1;
  entryKey = `F_${devCode}_Entity_${gen3()}`;
  entryTableName = `${devCode}_t_Cust_Entry${allocatedInt}`;
  const entryName = `${devCode}_Cust_Entry${allocatedInt}`;

  const req: SaveExtensionRequest = {
    extension: baseExt,
    isNew: false,
    layoutInfoOid,
    existingFieldsRaw: existing.fields,
    existingAppearancesRaw: existing.appearances,
    existingPluginsRaw: existing.plugins,
    existingEntriesRaw: existing.entries,
    existingEntryAppearancesRaw: existing.entryAppearances,
    existingTabPagesRaw: existing.tabPages,
    existingTabControlsRaw: existing.tabControls,
    addEntries: [{ key: entryKey, name: 'Smoke 测试体', entryName, tableName: entryTableName, seq }],
    addEntryAppearances: [{ key: entryKey, caption: 'Smoke 测试体', container: tabPageKey }],
  };
  const r = await saveExtension(session, req);
  if (!r.isSuccess) {
    console.error('FAILED:', r.messageDetail);
    process.exit(1);
  }
  console.log('created entryKey:', entryKey);
  console.log('             entryName:', entryName);
  console.log('             tableName:', entryTableName);
  console.log('             seq:', seq);
}
console.log();

// Step 3 — add 3 fields to the new entry
console.log('=== Step 3: add 3 entry-fields ===');
{
  const { existing } = await readExtensionState();
  const fieldKeys = [
    `F_${devCode}_Field_${gen3()}_a`,
    `F_${devCode}_Field_${gen3()}_b`,
    `F_${devCode}_Field_${gen3()}_c`,
  ];
  const req: SaveExtensionRequest = {
    extension: baseExt,
    isNew: false,
    layoutInfoOid,
    existingFieldsRaw: existing.fields,
    existingAppearancesRaw: existing.appearances,
    existingPluginsRaw: existing.plugins,
    existingEntriesRaw: existing.entries,
    existingEntryAppearancesRaw: existing.entryAppearances,
    existingTabPagesRaw: existing.tabPages,
    existingTabControlsRaw: existing.tabControls,
    addFields: [
      { type: 'TextField', key: fieldKeys[0], caption: '检验员', listTabIndex: 9001, entityKey: entryKey },
      { type: 'DateField', key: fieldKeys[1], caption: '检验日期', listTabIndex: 9002, entityKey: entryKey },
      { type: 'TextField', key: fieldKeys[2], caption: '备注', listTabIndex: 9003, entityKey: entryKey },
    ],
    addAppearances: [
      { type: 'TextField', key: fieldKeys[0], caption: '检验员', tabindex: 1, entityKey: entryKey },
      { type: 'DateField', key: fieldKeys[1], caption: '检验日期', tabindex: 2, entityKey: entryKey },
      { type: 'TextField', key: fieldKeys[2], caption: '备注', tabindex: 3, entityKey: entryKey },
    ],
  };
  const r = await saveExtension(session, req);
  if (!r.isSuccess) {
    console.error('FAILED:', r.messageDetail);
    process.exit(1);
  }
  console.log('added 3 entry-fields:', fieldKeys.join(', '));
}
console.log();

// Step 4 — verify: extension should now show entry + 3 fields
console.log('=== Step 4: verify state after creation ===');
{
  const { existing } = await readExtensionState();
  console.log('  ext.entries.count        =', existing.entries.length, '(expected 1)');
  console.log('  ext.entryAppearances     =', existing.entryAppearances.length, '(expected 1)');
  console.log('  ext.tabPages             =', existing.tabPages.length, '(expected 1)');
  console.log('  ext.fields(entry-fields) =', existing.appearances.filter(s => s.includes(entryKey)).length, '(expected 3)');
}
console.log();

// Step 5 — rename entry
console.log('=== Step 5: rename_entry ===');
{
  const { existing } = await readExtensionState();
  const newName = 'Smoke 改名了';
  const xmlEscape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const renamed = {
    ...existing,
    entries: existing.entries.map(raw =>
      raw.includes(`<Key>${entryKey}</Key>`)
        ? raw.replace(/(<Name>)[^<]*(<\/Name>)/, `$1${xmlEscape(newName)}$2`)
        : raw,
    ),
    entryAppearances: existing.entryAppearances.map(raw =>
      raw.includes(`<Key>${entryKey}</Key>`)
        ? raw.replace(/(<Caption>)[^<]*(<\/Caption>)/, `$1${xmlEscape(newName)}$2`)
        : raw,
    ),
  };
  const req: SaveExtensionRequest = {
    extension: baseExt,
    isNew: false,
    layoutInfoOid,
    existingFieldsRaw: renamed.fields,
    existingAppearancesRaw: renamed.appearances,
    existingPluginsRaw: renamed.plugins,
    existingEntriesRaw: renamed.entries,
    existingEntryAppearancesRaw: renamed.entryAppearances,
    existingTabPagesRaw: renamed.tabPages,
    existingTabControlsRaw: renamed.tabControls,
  };
  const r = await saveExtension(session, req);
  if (!r.isSuccess) {
    console.error('FAILED:', r.messageDetail);
    process.exit(1);
  }
  console.log('renamed entry to:', newName);
}
console.log();

// Step 6 — delete entry (cascades fields)
console.log('=== Step 6: delete_entry (cascades fields) ===');
{
  const { existing } = await readExtensionState();
  const readChild = (raw: string, tag: string) => {
    const m = raw.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
    return m ? m[1] : null;
  };
  const filtered = {
    ...existing,
    entries: existing.entries.filter(raw => readChild(raw, 'Key') !== entryKey),
    entryAppearances: existing.entryAppearances.filter(raw => readChild(raw, 'Key') !== entryKey),
    fields: existing.fields.filter(raw => readChild(raw, 'EntityKey') !== entryKey),
    appearances: existing.appearances.filter(raw => readChild(raw, 'EntityKey') !== entryKey),
  };
  const req: SaveExtensionRequest = {
    extension: baseExt,
    isNew: false,
    layoutInfoOid,
    existingFieldsRaw: filtered.fields,
    existingAppearancesRaw: filtered.appearances,
    existingPluginsRaw: filtered.plugins,
    existingEntriesRaw: filtered.entries,
    existingEntryAppearancesRaw: filtered.entryAppearances,
    existingTabPagesRaw: filtered.tabPages,
    existingTabControlsRaw: filtered.tabControls,
  };
  const r = await saveExtension(session, req);
  if (!r.isSuccess) {
    console.error('FAILED:', r.messageDetail);
    process.exit(1);
  }
  console.log('deleted entry + cascaded entry-fields');
}
console.log();

// Step 7 — delete tab page (now empty)
console.log('=== Step 7: delete_tab_page ===');
{
  const { existing } = await readExtensionState();
  const readChild = (raw: string, tag: string) => {
    const m = raw.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
    return m ? m[1] : null;
  };
  const filtered = {
    ...existing,
    tabPages: existing.tabPages.filter(raw => readChild(raw, 'Key') !== tabPageKey),
  };
  const req: SaveExtensionRequest = {
    extension: baseExt,
    isNew: false,
    layoutInfoOid,
    existingFieldsRaw: filtered.fields,
    existingAppearancesRaw: filtered.appearances,
    existingPluginsRaw: filtered.plugins,
    existingEntriesRaw: filtered.entries,
    existingEntryAppearancesRaw: filtered.entryAppearances,
    existingTabPagesRaw: filtered.tabPages,
    existingTabControlsRaw: filtered.tabControls,
  };
  const r = await saveExtension(session, req);
  if (!r.isSuccess) {
    console.error('FAILED:', r.messageDetail);
    process.exit(1);
  }
  console.log('deleted tabPage:', tabPageKey);
}
console.log();

// Step 8 — final state should be back to original
console.log('=== Step 8: final state ===');
{
  const { existing } = await readExtensionState();
  console.log('  ext.entries.count        =', existing.entries.length, '(expected 0)');
  console.log('  ext.entryAppearances     =', existing.entryAppearances.length, '(expected 0)');
  console.log('  ext.tabPages             =', existing.tabPages.length, '(expected 0)');
}

console.log();
console.log('=== Smoke OK ===');
