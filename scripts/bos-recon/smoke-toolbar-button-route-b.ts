/**
 * Real-server smoke test for L3 followup migration (2026-05-07):
 *   addToolbarButton + removeToolbarButton + removeOperation now use
 *   Route B (envelope rebuild) instead of Route C (overlay).
 *
 * Validates the full toolbar-button lifecycle against a live K/3 Cloud
 * server — the layer mocked tests can't reach. Sacrificial extension
 * created/destroyed in one run; no customer data touched.
 *
 * Steps:
 *   1.  create sacrificial extension on SAL_SaleOrder
 *   2.  addCustomOperation(SmokeOp45) with inline Python plugin
 *   3.  list_operations  → assert SmokeOp45 visible
 *   4.  addToolbarButton(SmokeBtn → SmokeOp45)             ← NEW Route B
 *   5.  list_operations  → assert SmokeBtn visible + bound to SmokeOp45
 *   6.  removeToolbarButton(SmokeBtn)                       ← NEW Route B
 *   7.  list_operations  → assert SmokeBtn gone
 *   8.  removeOperation(SmokeOp45)                          ← lever 3 Route B
 *   9.  list_operations  → assert SmokeOp45 gone
 *   10. cleanup: delete sacrificial extension
 *
 * Each silent-drop or wire mismatch surfaces as a failed assertion at
 * the next list_operations check. This is the layer the mocked
 * connector-bar-button-flow.test.ts can't cover.
 *
 * Usage:
 *   pnpm tsx --tsconfig tsconfig.node.json scripts/bos-recon/smoke-toolbar-button-route-b.ts
 *
 * Env (defaults match settings.json on dev):
 *   K3_BASE_URL  — http://localhost/K3Cloud/
 *   K3_ACCT_ID   — 69a531ee82525a
 *   K3_USERNAME  — administrator
 *   K3_PASSWORD  — 1qaz@WSX
 *   K3_DEVCODE   — PAIJ
 */

import { randomUUID } from 'node:crypto';

import { login } from '../../src/main/erp/k3cloud/rpc/login';
import { saveExtension } from '../../src/main/erp/k3cloud/rpc/save-for-ide';
import { K3CloudConnector } from '../../src/main/erp/k3cloud/connector';
import { getBusinessObjectMetaData } from '../../src/main/erp/k3cloud/rpc/metadata';
import { extractKernelXml } from '../../src/main/erp/k3cloud/rpc/metadata-xml';
import { extractExistingExtensionElements } from '../../src/main/erp/k3cloud/rpc/existing-elements';

/**
 * Verification helper — bypass bridge.list_operations because of the
 * action="edit" baseline-drop bug discovered 2026-05-07 (see memory
 * `bos_form_metadata_deserialize_quirks.md` finding #1, and the new
 * `bos_bridge_list_operations_silent_drop` followup memory). Reads raw
 * FKERNELXML via getBusinessObjectMetaData and uses the
 * indexOf-based parser that doesn't go through DcxmlSerializer.
 */
async function rawSnapshot(session: Awaited<ReturnType<typeof login>>['session'], extId: string) {
  if (!session) throw new Error('no session');
  const md = await getBusinessObjectMetaData(session, extId);
  const xml = extractKernelXml(md.metaData) ?? '';
  const ex = extractExistingExtensionElements(xml);
  return {
    formOperationKeys: ex.formOperations
      .map((raw) => raw.match(/<Id>([^<]+)<\/Id>/)?.[1])
      .filter((k): k is string => !!k),
    // appearances includes FormAppearance overlays that wrap added BarButtons
    appearancesXml: ex.appearances,
    rawXmlLength: xml.length,
  };
}

const baseUrl = process.env.K3_BASE_URL ?? 'http://localhost/K3Cloud/';
const acctId = process.env.K3_ACCT_ID ?? '69a531ee82525a';
const username = process.env.K3_USERNAME ?? 'administrator';
const password = process.env.K3_PASSWORD ?? '1qaz@WSX';
const devCode = process.env.K3_DEVCODE ?? 'PAIJ';
const layoutInfoOid = 'bc952920-057d-4790-9c27-1134091eb298'; // SAL_SaleOrder live oid

const projectId = 'smoke-toolbar-' + Date.now();

const say = (who: string, msg: string) => console.log(`\n${who}: ${msg}`);
const tool = (name: string, args: Record<string, unknown>) => {
  const j = JSON.stringify(args);
  console.log(`🔧 ${name}(${j.slice(0, 160)}${j.length > 160 ? '…' : ''})`);
};
const ok = (msg: string) => console.log(`   ✓ ${msg}`);
const fail = (msg: string): never => {
  console.log(`   ✗ ${msg}`);
  process.exit(1);
};
const warn = (msg: string) => console.log(`   ⚠ ${msg}`);

// Generated identities (kept in module scope so cleanup can reach them on error).
const extId = randomUUID().replace(/-/g, '');
const opKey = `SmokeOp${Date.now().toString().slice(-6)}`; // C-identifier
const btnKey = `SmokeBtn${Date.now().toString().slice(-6)}`;

console.log('═══════════════════════════════════════════════════════════');
console.log('  L3 followup smoke — toolbar button Route B end-to-end');
console.log('═══════════════════════════════════════════════════════════');

say('SYSTEM', `连 ${baseUrl} acct=${acctId} user=${username}`);
const loginResult = await login({ baseUrl, acctId, username, password });
if (!loginResult.isSuccess) fail(`login: ${loginResult.message}`);
const session = loginResult.session;
ok(`logged in as ${loginResult.userName}`);

const connector = new K3CloudConnector(
  { baseUrl, acctId, username, password, devCode },
  {},
  projectId,
);
await connector.connect();
ok('connector connected');

const baseExt = {
  formId: extId,
  baseObjectId: 'SAL_SaleOrder',
  modelTypeId: 100,
  subSystemId: '23',
  name: [{ localeId: 2052 as const, value: `L3 followup smoke ${Date.now()}` }],
  isv: { devCode },
};

let cleanupNeeded = false;

const cleanup = async () => {
  if (!cleanupNeeded) return;
  console.log('\n─── Cleanup: drop sacrificial extension ──────────────────');
  try {
    // Empty save = ship Form scaffolding only, every other element bucket
    // omitted = server treats omitted elements as removed (stateful
    // baseline diff). Extension row itself stays in DB but is empty.
    const r = await saveExtension(session, {
      extension: baseExt,
      isNew: false,
      layoutInfoOid,
    });
    if (r.isSuccess) ok(`扩展 ${extId} 内容清空`);
    else warn(`cleanup save returned: ${r.messageDetail ?? r.messageTitle}`);
  } catch (err) {
    warn(`cleanup err: ${err instanceof Error ? err.message : String(err)}`);
  }
};

process.on('SIGINT', () => { cleanup().finally(() => process.exit(2)); });
process.on('uncaughtException', (e) => {
  console.error('uncaught:', e);
  cleanup().finally(() => process.exit(3));
});

// ── 1. Create sacrificial extension ─────────────────────────────────────

console.log('\n─── 1. Create sacrificial extension ──────────────────────');
tool('create_extension', { parentFormId: 'SAL_SaleOrder', name: baseExt.name[0].value });
{
  const r = await saveExtension(session, {
    extension: baseExt,
    isNew: true,
    layoutInfoOid,
  });
  if (!r.isSuccess) fail(`create_extension: ${r.messageDetail ?? r.messageTitle}`);
  cleanupNeeded = true;
  ok(`extId = ${extId}`);
}

// ── 2. Add custom operation (target for the toolbar button) ─────────────

console.log('\n─── 2. addCustomOperation (Route B post hotfix #4) ──────');
tool('addCustomOperation', { extensionFid: extId, operationKey: opKey });
{
  const r = await connector.addCustomOperation({
    extensionFid: extId,
    operationKey: opKey,
    operationName: 'Smoke 测试操作',
    operationParameterId: randomUUID(),
    operationId: 45, // 自定义
    pluginClassName: 'smoke_test_plugin',
    pyBody: '#smoke test\nprint("hello from smoke")',
  });
  if (r.operationKey !== opKey) fail(`unexpected operationKey: ${r.operationKey}`);
  ok(`operation ${opKey} added`);
}

// ── 3. Verify operation visible (raw XML parser, bypasses bridge bug) ──

console.log('\n─── 3. raw FKERNELXML: verify operation persisted ───────');
{
  const snap = await rawSnapshot(session, extId);
  if (!snap.formOperationKeys.includes(opKey)) {
    fail(`WRITE SILENT DROP: addCustomOperation succeeded but ${opKey} not in DB FKERNELXML (formOpKeys=${snap.formOperationKeys.join(',')})`);
  }
  ok(`operation persisted to DB: keys=[${snap.formOperationKeys.join(', ')}]`);
}

// ── 4. Add toolbar button via NEW Route B path ──────────────────────────

console.log('\n─── 4. addToolbarButton (NEW Route B — what L3 followup tests) ──');
const btnId = randomUUID().replace(/-/g, '');
const barDataManagerId = randomUUID();
const formBusinessServiceId = randomUUID();
const barItemLinkId = randomUUID();
tool('addToolbarButton', {
  extensionFid: extId,
  buttonKey: btnKey,
  boundOperationKey: opKey,
});
{
  const r = await connector.addToolbarButton({
    extensionFid: extId,
    target: { kind: 'form' },
    buttonKey: btnKey,
    buttonId: btnId,
    caption: 'Smoke 按钮',
    seq: 1,
    boundOperationKey: opKey,
    boundOperationName: 'Smoke 测试操作',
    toolbarKey: 'tbToolBar', // form-level top toolbar
    barDataManagerId,
    formBusinessServiceId,
    barItemLinkId,
  });
  if (r.buttonKey !== btnKey) fail(`unexpected buttonKey: ${r.buttonKey}`);
  ok(`button ${btnKey} added`);
}

// ── 5. Verify button visible + bound correctly (raw XML check) ──────────

console.log('\n─── 5. raw FKERNELXML: verify button persisted + wire shape ──');
{
  const snap = await rawSnapshot(session, extId);
  // Button lives inside FormAppearance overlay in `appearances` chunks.
  const fa = snap.appearancesXml.find((a) =>
    a.includes(`<Key>${btnKey}</Key>`) && a.includes('<BarButtonItem'),
  );
  if (!fa) {
    fail(
      `WRITE SILENT DROP: addToolbarButton succeeded but ${btnKey} not in DB FKERNELXML appearances ` +
      `(appearances.length=${snap.appearancesXml.length})`,
    );
  }
  // Sanity: bound operation key in ClickActions Parameters.
  if (!fa.includes(`["${opKey}"]`)) {
    fail(`button ${btnKey} not bound to ${opKey} (Parameters JSON missing)`);
  }
  ok(`button persisted to DB: ${btnKey} bound to ${opKey}, FormAppearance overlay present (chars=${fa.length})`);
}

// ── 6. Remove toolbar button via NEW Route B path ───────────────────────

console.log('\n─── 6. removeToolbarButton (NEW Route B) ────────────────');
tool('removeToolbarButton', { extensionFid: extId, buttonKey: btnKey });
{
  // Debug: dump the appearance XML around BarItemLinks so we can see the shape
  const snap = await rawSnapshot(session, extId);
  const fa = snap.appearancesXml.find((a) => a.includes(`<Key>${btnKey}</Key>`));
  if (fa) {
    console.log(`   [debug] full FormAppearance chunk(${fa.length} chars):\n${fa}`);
  }
  const list = await connector.listOperations(extId);
  const btn = list.toolbarButtons.find((b) => b.buttonKey === btnKey);
  console.log(`   [debug] parsed button: ${JSON.stringify(btn)}`);

  await connector.removeToolbarButton(extId, btnKey);
  ok('removeToolbarButton returned (no exception)');
}

// ── 7. Verify button gone (raw XML check) ──────────────────────────────

console.log('\n─── 7. raw FKERNELXML: verify button removed ─────────────');
{
  const snap = await rawSnapshot(session, extId);
  const stillThere = snap.appearancesXml.some((a) => a.includes(`<Key>${btnKey}</Key>`));
  if (stillThere) {
    fail(`SILENT NO-OP: removeToolbarButton returned ok but ${btnKey} still in DB FKERNELXML`);
  }
  ok(`button ${btnKey} removed from DB (appearances.length=${snap.appearancesXml.length})`);
}

// ── 8. Remove operation via lever 3 Route B path ────────────────────────

console.log('\n─── 8. removeOperation (lever 3 Route B) ────────────────');
tool('removeOperation', { extensionFid: extId, operationKey: opKey });
{
  await connector.removeOperation(extId, opKey);
  ok('removeOperation returned (no exception)');
}

// ── 9. Verify operation gone (raw XML check) ────────────────────────────

console.log('\n─── 9. raw FKERNELXML: verify operation removed ─────────');
{
  const snap = await rawSnapshot(session, extId);
  if (snap.formOperationKeys.includes(opKey)) {
    fail(`SILENT NO-OP: removeOperation returned ok but ${opKey} still in DB (keys=${snap.formOperationKeys.join(',')})`);
  }
  ok(`operation ${opKey} removed from DB (formOperationKeys=[${snap.formOperationKeys.join(', ')}])`);
}

// ── 10. Cleanup ─────────────────────────────────────────────────────────

await cleanup();
cleanupNeeded = false;

console.log('\n═══════════════════════════════════════════════════════════');
console.log('  ✅ L3 followup Route B end-to-end VERIFIED against real BOS server');
console.log('═══════════════════════════════════════════════════════════');
process.exit(0);
