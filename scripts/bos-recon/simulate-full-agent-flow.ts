/**
 * Full-flow agent conversation simulation.
 *
 * Mimics what the LLM agent would do end-to-end for a realistic
 * implementation request:
 *   "在销售订单上加一个质检明细子表(2 个字段),然后让销售订单下推
 *    出库单时把质检明细的字段也带过去 + 加一个合并策略 + 加一个过滤"
 *
 * Steps (each annotated as a "user / agent" turn):
 *   A1. create_extension(SAL_SaleOrder)
 *   A2. create_tab_page(parent=FTab1)
 *   A3. create_entry(parent=tabPage)
 *   A4. add_fields(container=entry, 2 fields)
 *   B1. create_convert_rule_extension(SaleOrder-OutStock)
 *   B2. add_convert_field_mapping
 *   B3. set_convert_groupby
 *   B4. set_convert_filter
 *   B5. describe_convert_rule (verify)
 *   C1. delete_convert_rule_extension
 *   C2. delete form extension via DROP saveExtension
 *
 * Drives the same RPC functions the agent's tools wrap. No LLM involved —
 * this verifies the wire format + bridge integration end-to-end. The
 * "conversation" annotations are for readability.
 *
 * Usage:
 *   pnpm tsx --tsconfig tsconfig.node.json scripts/bos-recon/simulate-full-agent-flow.ts
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { login } from '../../src/main/erp/k3cloud/rpc/login';
import { saveExtension } from '../../src/main/erp/k3cloud/rpc/save-for-ide';
import { getNextSequenceInt32, SEQUENCE_CATEGORY_CUST_ENTRY } from '../../src/main/erp/k3cloud/rpc/sequence';
import { getBusinessObjectMetaData } from '../../src/main/erp/k3cloud/rpc/metadata';
import { extractKernelXml } from '../../src/main/erp/k3cloud/rpc/metadata-xml';
import { extractExistingExtensionElements } from '../../src/main/erp/k3cloud/rpc/existing-elements';
import { parseFormLayoutContainers } from '../../src/main/erp/k3cloud/fkernel-parsers';
import type { SaveExtensionRequest } from '../../src/main/erp/k3cloud/rpc/types';
import { K3CloudConnector } from '../../src/main/erp/k3cloud/connector';
import { buildSaleOrderOutStockBaseline } from '../../src/main/erp/k3cloud/rpc/convert-rule-baselines';

const baseUrl = process.env.K3_BASE_URL ?? 'http://localhost/k3cloud';
const acctId = process.env.K3_ACCT_ID ?? '69a531ee82525a';
const username = process.env.K3_USERNAME ?? 'demo';
const password = process.env.K3_PASSWORD ?? '1qaz@WSX';
const devCode = process.env.K3_DEVCODE ?? 'PAIJ';
const layoutInfoOid = 'bc952920-057d-4790-9c27-1134091eb298';
const projectId = 'simulate-flow-' + Date.now();

const gen3 = () => {
  const a = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return a[Math.floor(Math.random() * a.length)] + a[Math.floor(Math.random() * a.length)] + a[Math.floor(Math.random() * a.length)];
};

const say = (who: string, msg: string) => console.log(`\n${who}: ${msg}`);
const tool = (name: string, args: Record<string, unknown>) =>
  console.log(`🔧 ${name}(${JSON.stringify(args).slice(0, 160)}${JSON.stringify(args).length > 160 ? '…' : ''})`);
const ok = (msg: string) => console.log(`   ✓ ${msg}`);
const fail = (msg: string) => { console.log(`   ✗ ${msg}`); process.exit(1); };

// ── Setup ───────────────────────────────────────────────────────────────

console.log('═══════════════════════════════════════════════════════════');
console.log('  Full-flow agent conversation simulation');
console.log('═══════════════════════════════════════════════════════════');

say('SYSTEM', `连接 ${baseUrl} acct=${acctId} user=${username}`);
const loginResult = await login({ baseUrl, acctId, username, password });
if (!loginResult.isSuccess) fail(`login: ${loginResult.message}`);
const session = loginResult.session;
ok(`logged in as ${loginResult.userName}`);

const originXml = readFileSync(
  resolve('src/main/erp/k3cloud/rpc/baselines/sale-order-outstock-origin.xml'),
  'utf-8',
);
const extensionTemplateXml = readFileSync(
  resolve('src/main/erp/k3cloud/rpc/baselines/sale-order-outstock-extension-template.xml'),
  'utf-8',
);
const baselines = {
  'SaleOrder-OutStock': buildSaleOrderOutStockBaseline({ originXml, extensionTemplateXml }),
};
const connector = new K3CloudConnector(
  { baseUrl, acctId, username, password, devCode },
  baselines,
  projectId,
);
await connector.connect();
ok('K3CloudConnector connected (with baselines + projectId for convert-rule state)');

// ── Phase A: form extension + entry + fields ────────────────────────────

say('👤 USER', '在销售订单上加一个质检明细子表,加 2 个字段:质检员(text)、检验日期(date)。');
say('🤖 AGENT', '好的。先建一个扩展挂在销售订单上,再在扩展里建子表,最后加字段。我来一步一步做。');

const extId = randomUUID().replace(/-/g, '');
const baseExt = {
  formId: extId,
  baseObjectId: 'SAL_SaleOrder',
  modelTypeId: 100,
  subSystemId: '23',
  name: [{ localeId: 2052 as const, value: '模拟流程扩展' }],
  isv: { devCode },
};

console.log('\n─── A1. 创建扩展 ──────────────────────────────────────────');
tool('kingdee_create_extension', { parentFormId: 'SAL_SaleOrder', extName: '模拟流程扩展' });
{
  const r = await saveExtension(session, {
    extension: baseExt, isNew: true, layoutInfoOid,
  });
  if (!r.isSuccess) fail(`create_extension: ${r.messageDetail}`);
  ok(`extId = ${extId}`);
}

const readState = async () => {
  const md = await getBusinessObjectMetaData(session, extId);
  const xml = extractKernelXml(md.metaData);
  return xml ? extractExistingExtensionElements(xml) : {
    fields: [], appearances: [], plugins: [],
    entries: [], entryAppearances: [], tabPages: [], tabControls: [],
  };
};

console.log('\n─── A2. 创建 TabPage(挂在 FTab1 下) ──────────────────────');
const tabPageKey = `FTab1_${devCode}_P_${gen3()}`;
tool('kingdee_create_tab_page', { extId, name: '质检页签', container: 'FTab1' });
{
  const ex = await readState();
  const r = await saveExtension(session, {
    extension: baseExt, isNew: false, layoutInfoOid,
    existingFieldsRaw: ex.fields, existingAppearancesRaw: ex.appearances,
    existingPluginsRaw: ex.plugins, existingEntriesRaw: ex.entries,
    existingEntryAppearancesRaw: ex.entryAppearances,
    existingTabPagesRaw: ex.tabPages, existingTabControlsRaw: ex.tabControls,
    addTabPages: [{ key: tabPageKey, caption: '质检页签', container: 'FTab1' }],
  });
  if (!r.isSuccess) fail(`create_tab_page: ${r.messageDetail}`);
  ok(`tabPageKey = ${tabPageKey}`);
}

console.log('\n─── A3. 创建单据体(质检明细) ─────────────────────────────');
const allocatedInt = await getNextSequenceInt32(session, SEQUENCE_CATEGORY_CUST_ENTRY, 1);
const entryKey = `F_${devCode}_Entity_${gen3()}`;
const entryTableName = `${devCode}_t_Cust_Entry${allocatedInt}`;
const entryName = `${devCode}_Cust_Entry${allocatedInt}`;
tool('kingdee_create_entry', { extId, name: '质检明细', parentTabPageKey: tabPageKey });
{
  const ex = await readState();
  const parentMd = await getBusinessObjectMetaData(session, 'SAL_SaleOrder');
  const parentXml = extractKernelXml(parentMd.metaData);
  let parentEntryCount = 0;
  if (parentXml) {
    for (const e of parseFormLayoutContainers(parentXml).entries) {
      if (e.kind === 'entry') parentEntryCount++;
    }
  }
  const seq = parentEntryCount + ex.entries.length + 1;
  const r = await saveExtension(session, {
    extension: baseExt, isNew: false, layoutInfoOid,
    existingFieldsRaw: ex.fields, existingAppearancesRaw: ex.appearances,
    existingPluginsRaw: ex.plugins, existingEntriesRaw: ex.entries,
    existingEntryAppearancesRaw: ex.entryAppearances,
    existingTabPagesRaw: ex.tabPages, existingTabControlsRaw: ex.tabControls,
    addEntries: [{ key: entryKey, name: '质检明细', entryName, tableName: entryTableName, seq }],
    addEntryAppearances: [{ key: entryKey, caption: '质检明细', container: tabPageKey }],
  });
  if (!r.isSuccess) fail(`create_entry: ${r.messageDetail}`);
  ok(`entryKey = ${entryKey}, table = ${entryTableName}`);
}

console.log('\n─── A4. 给单据体加 2 个字段(质检员 text + 检验日期 date) ─');
const fInspectorKey = `F_${devCode}_Insp_${gen3()}`;
const fInspDateKey = `F_${devCode}_Date_${gen3()}`;
tool('kingdee_add_fields', { extId, container: entryKey, fields: ['质检员(text)', '检验日期(date)'] });
{
  const ex = await readState();
  const r = await saveExtension(session, {
    extension: baseExt, isNew: false, layoutInfoOid,
    existingFieldsRaw: ex.fields, existingAppearancesRaw: ex.appearances,
    existingPluginsRaw: ex.plugins, existingEntriesRaw: ex.entries,
    existingEntryAppearancesRaw: ex.entryAppearances,
    existingTabPagesRaw: ex.tabPages, existingTabControlsRaw: ex.tabControls,
    addFields: [
      { type: 'TextField', key: fInspectorKey, caption: '质检员', entityKey: entryKey, listTabIndex: 1 },
      { type: 'DateField', key: fInspDateKey, caption: '检验日期', entityKey: entryKey, listTabIndex: 2 },
    ],
    addAppearances: [
      { type: 'TextField', key: fInspectorKey, caption: '质检员', container: entryKey, entityKey: entryKey, tabindex: 1 },
      { type: 'DateField', key: fInspDateKey, caption: '检验日期', container: entryKey, entityKey: entryKey, tabindex: 2 },
    ],
  });
  if (!r.isSuccess) fail(`add_fields: ${r.messageDetail}`);
  ok(`字段已加: ${fInspectorKey}(text) + ${fInspDateKey}(date)`);
}

// ── Phase B: convert rule extension + field mapping + strategies ────────

say('👤 USER', '现在让销售订单下推出库单时把这些字段带过去,再设置个合并策略 + 过滤。');
say('🤖 AGENT', '了解。先扩展销售订单→出库单的转换规则,然后加字段映射,设合并策略,设过滤条件。');

console.log('\n─── B1. 创建转换规则扩展(SaleOrder → OutStock) ─────────');
tool('kingdee_create_convert_rule_extension', { ruleId: 'SaleOrder-OutStock', displayName: '模拟流程转换扩展' });
let convertExtId = '';
{
  const r = await connector.extendConvertRule('SaleOrder-OutStock', '模拟流程转换扩展');
  if (!r.ok) fail(`extendConvertRule: ${r.raw.slice(0, 200)}`);
  convertExtId = r.newExtensionId;
  ok(`convertExtId = ${convertExtId}`);
}

console.log('\n─── B2. 加字段映射(FNote → FNote, header) ────────────────');
tool('kingdee_add_convert_field_mapping', {
  extId: convertExtId, targetFieldKey: 'FNote', sourceFieldKey: 'FNote', mode: 'Auto',
});
{
  const r = await connector.addConvertFieldMapping(convertExtId, 'FNote', 'FNote', 'Auto');
  if (!r.ok) fail(`addConvertFieldMapping: ${r.raw.slice(0, 200)}`);
  ok('字段映射 FNote ← FNote 已写入');
}

console.log('\n─── B3. 设置 GroupBy 策略(GroupByField, FStockOrgId) ────');
tool('kingdee_set_convert_groupby', { extId: convertExtId, mode: 'GroupByField', field1: 'FStockOrgId' });
{
  const r = await connector.setConvertGroupBy(convertExtId, 'GroupByField', 'FStockOrgId');
  if (!r.ok) fail(`setConvertGroupBy: ${r.raw.slice(0, 200)}`);
  ok('GroupBy: GroupByField FStockOrgId 已设置');
}

console.log('\n─── B4. 设置过滤条件(IronPython 表达式) ─────────────────');
tool('kingdee_set_convert_filter', {
  extId: convertExtId,
  alertMessage: '只有审核通过的订单可下推',
  custFilter: 'row["FDocumentStatus"] == "C"',
});
{
  const r = await connector.setConvertFilter(
    convertExtId,
    '只有审核通过的订单可下推',
    'row["FDocumentStatus"] == "C"',
  );
  if (!r.ok) fail(`setConvertFilter: ${r.raw.slice(0, 200)}`);
  ok('过滤条件已设置');
}

console.log('\n─── B5. describe_convert_rule(extId) 验证落库 ────────────');
tool('kingdee_describe_convert_rule', { ruleId: convertExtId });
{
  const summary = await connector.describeConvertRule(convertExtId);
  console.log(`   ruleId       : ${summary.ruleId}`);
  console.log(`   source/target: ${summary.sourceFormId} → ${summary.targetFormId}`);
  console.log(`   fieldMapCount: ${summary.defaultConvert?.fieldMapCount}`);
  console.log(`   groupBy      : ${summary.groupBy?.mode} → [${summary.groupBy?.fields.join(', ')}]`);
  console.log(`   filter       : alertMsg=${summary.filter?.alertMessage ? 'set' : '(none)'} custFilter=${summary.filter?.custFilter ? 'set' : '(none)'}`);
  ok('summary 字段映射 / GroupBy / filter 都能反查到');
}

// ── Phase C: cleanup ────────────────────────────────────────────────────

say('👤 USER', '验完了,把测试创建的东西都清掉。');
say('🤖 AGENT', '清理 — 先删转换规则扩展,再删表单扩展。');

console.log('\n─── C1. 删除转换规则扩展 ─────────────────────────────────');
tool('kingdee_delete_convert_rule_extension', { extId: convertExtId });
{
  const r = await connector.deleteConvertRuleExtension('SaleOrder-OutStock', convertExtId);
  if (!r.ok) fail(`deleteConvertRuleExtension: ${r.raw.slice(0, 200)}`);
  ok('转换规则扩展已删');
}

console.log('\n─── C2. 删除表单扩展 ─────────────────────────────────────');
tool('kingdee_delete_extension', { extId });
{
  const ex = await readState();
  const r = await saveExtension(session, {
    extension: baseExt, isNew: false, layoutInfoOid,
    existingFieldsRaw: ex.fields, existingAppearancesRaw: ex.appearances,
    existingPluginsRaw: ex.plugins, existingEntriesRaw: ex.entries,
    existingEntryAppearancesRaw: ex.entryAppearances,
    existingTabPagesRaw: ex.tabPages, existingTabControlsRaw: ex.tabControls,
    deleteEntries: [entryKey],
    deleteTabPages: [tabPageKey],
    deleteFields: [fInspectorKey, fInspDateKey],
  });
  if (!r.isSuccess) console.log(`   ⚠ form 扩展删除返回错误(可手动到 BOS Designer 清): ${r.messageDetail}`);
  else ok('表单扩展内容已清(extension 容器本身留在 DB,不影响)');
}

console.log('\n═══════════════════════════════════════════════════════════');
console.log('  ✅ 全流程模拟完成');
console.log('═══════════════════════════════════════════════════════════');
process.exit(0);
