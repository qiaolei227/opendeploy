/**
 * Clean up the two test extensions left by drive-real-agent-loop.ts.
 * Reads project creds from ~/.opendeploy/settings.json so it hits the
 * same K/3 Cloud server the agent test ran against.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

import { setActiveProject, setBundledConvertRuleBaselines, getActiveConnector } from '../../src/main/erp/active';
import { buildSaleOrderOutStockBaseline } from '../../src/main/erp/k3cloud/rpc/convert-rule-baselines';
import { saveExtension } from '../../src/main/erp/k3cloud/rpc/save-for-ide';
import { extractExistingExtensionElements } from '../../src/main/erp/k3cloud/rpc/existing-elements';
import { getBusinessObjectMetaData } from '../../src/main/erp/k3cloud/rpc/metadata';
import { extractKernelXml } from '../../src/main/erp/k3cloud/rpc/metadata-xml';
import type { Project } from '@shared/erp-types';

const FORM_EXT = 'eeaeee0c539549e3ac14e8a458940368';
const CONVERT_EXT = 'f835b061f962491283b18106ccea2e88';

const settings = JSON.parse(readFileSync(resolve(homedir(), '.opendeploy/settings.json'), 'utf-8'));
const project: Project = settings.projects?.[0];
if (!project?.bos) { console.error('no project'); process.exit(1); }

setBundledConvertRuleBaselines({
  'SaleOrder-OutStock': buildSaleOrderOutStockBaseline({
    originXml: readFileSync(resolve('src/main/erp/k3cloud/rpc/baselines/sale-order-outstock-origin.xml'), 'utf-8'),
    extensionTemplateXml: readFileSync(resolve('src/main/erp/k3cloud/rpc/baselines/sale-order-outstock-extension-template.xml'), 'utf-8'),
  }),
});
await setActiveProject(project);
const c = getActiveConnector()!;
const session = (c as unknown as { session: { cookies: string[] } }).session;
console.log('connected to', project.bos.baseUrl);

console.log('\n[1] delete convert-rule extension', CONVERT_EXT);
try {
  const r = await c.deleteConvertRuleExtension('SaleOrder-OutStock', CONVERT_EXT);
  console.log('   →', r.ok ? '✓ OK' : `✗ ${r.raw.slice(0, 200)}`);
} catch (e) {
  console.log('   threw:', e instanceof Error ? e.message.slice(0, 200) : e);
}

console.log('\n[2] tear down form extension', FORM_EXT);
try {
  // Read existing state, then delete all custom elements (entries + tab pages + fields)
  const md = await getBusinessObjectMetaData(session as never, FORM_EXT);
  const xml = extractKernelXml(md.metaData);
  const ex = xml ? extractExistingExtensionElements(xml) : null;
  if (!ex) { console.log('   no kernel xml — already gone?'); process.exit(0); }

  const r = await saveExtension(session as never, {
    extension: {
      formId: FORM_EXT,
      baseObjectId: 'SAL_SaleOrder',
      modelTypeId: 100,
      subSystemId: '23',
      name: [{ localeId: 2052, value: '端到端测试扩展' }],
      isv: { devCode: 'PAIJ' },
    },
    isNew: false,
    layoutInfoOid: 'bc952920-057d-4790-9c27-1134091eb298',
    existingFieldsRaw: ex.fields, existingAppearancesRaw: ex.appearances,
    existingPluginsRaw: ex.plugins, existingEntriesRaw: ex.entries,
    existingEntryAppearancesRaw: ex.entryAppearances,
    existingTabPagesRaw: ex.tabPages, existingTabControlsRaw: ex.tabControls,
    deleteFields: ex.fields.map((f) => f.key),
    deleteEntries: ex.entries.map((e) => e.key),
    deleteTabPages: ex.tabPages.map((t) => t.key),
  });
  console.log('   teardown →', r.isSuccess ? '✓ contents cleared' : `✗ ${r.messageDetail}`);
  console.log('   注意: extension 容器(T_META_OBJECTTYPE 那一行)还在 DB,不影响。');
  console.log('   要彻底删: BOS Designer 刷新扩展列表 → 右键删除');
} catch (e) {
  console.log('   threw:', e instanceof Error ? e.message.slice(0, 300) : e);
}

process.exit(0);
