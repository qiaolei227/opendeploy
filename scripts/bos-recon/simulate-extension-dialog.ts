/**
 * 模拟 agent 对话：完整跑一遍「顾问要求扩展销售订单->销售出库单转换规则」的路径，
 * 不依赖真实 BOS server。用 fetch mock 拦截 RPC，直接执行 connector + tool 层，
 * 打印每一步 agent 看到的内容。
 *
 * 跑：pnpm tsx scripts/bos-recon/simulate-extension-dialog.ts
 */
import { K3CloudConnector } from '../../src/main/erp/k3cloud/connector';
import { setBundledConvertRuleBaselines } from '../../src/main/erp/active';
import { buildK3CloudTools } from '../../src/main/agent/k3cloud-tools';
import {
  buildSaleOrderOutStockBaseline,
  type ConvertRuleBaseline,
} from '../../src/main/erp/k3cloud/rpc/convert-rule-baselines';
import { encodeAppLayer } from '../../src/main/erp/k3cloud/rpc/codec';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ─── Mock fetch — 只关心 4 个端点 ─────────────────────────────────
type Handler = (init?: RequestInit) => Promise<Response> | Response;
const handlers: Array<{ matchUrl: RegExp; handler: Handler }> = [];

globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
  for (const h of handlers) {
    if (h.matchUrl.test(u)) return h.handler(init);
  }
  throw new Error('no mock matched: ' + u);
}) as typeof fetch;

function mockUrl(matchUrl: RegExp, handler: Handler): void {
  handlers.push({ matchUrl, handler });
}

// ─── 装 mock：Login / GetCurrentISV / SaveRulesV9 / Describe ────────
const ORIGIN_XML = readFileSync(
  resolve('src/main/erp/k3cloud/rpc/baselines/sale-order-outstock-origin.xml'),
  'utf-8',
);
const EXT_TEMPLATE_XML = readFileSync(
  resolve('src/main/erp/k3cloud/rpc/baselines/sale-order-outstock-extension-template.xml'),
  'utf-8',
);
const baselines: Record<string, ConvertRuleBaseline> = {
  'SaleOrder-OutStock': buildSaleOrderOutStockBaseline({
    originXml: ORIGIN_XML,
    extensionTemplateXml: EXT_TEMPLATE_XML,
  }),
};
setBundledConvertRuleBaselines(baselines);

let saveRulesCalls = 0;
let getIsvCalls = 0;

mockUrl(/GetPublicKeyInfo/, () => {
  // Empty key → cipherPasswordForLogin uses obfuscation fallback
  return new Response(encodeAppLayer('""'));
});

mockUrl(/ValidateLoginInfo|LoginValidate|ValidateUser/, () => {
  return new Response(
    encodeAppLayer(
      JSON.stringify({
        LoginResultType: 1,
        Message: 'mock login ok',
        Context: { UserName: 'demo' },
      }),
    ),
  );
});

mockUrl(/GetCurrentISV/, () => {
  getIsvCalls++;
  return new Response(
    encodeAppLayer(
      JSON.stringify({
        Id: 'IBHC-LMFG-QIMZ-LHQA-VFBK',
        Name: 'UNW',
        ISVSignal: 'Kingdee',
        PackageSignal: '',
        DevCode: 'UNW',
      }),
    ),
  );
});

mockUrl(/SaveRulesV9/, async (init) => {
  saveRulesCalls++;
  // 解析进来的 ap0,确认 wire 格式 OK
  const body = String(init?.body ?? '');
  const params = new URLSearchParams(body);
  const ap0 = params.get('ap0') ?? '';
  console.log(`    [mock] SaveRulesV9 received (ap0 b64+zlib len=${ap0.length})`);
  return new Response(encodeAppLayer(''));
});

mockUrl(/GetConvertRule\.common/, () => {
  // 返回个最小 ConvertRuleMetaData,够 summarizer 跑就行
  return new Response(
    encodeAppLayer(
      JSON.stringify({
        Id: 'SaleOrder-OutStock',
        ModelTypeId: 790,
        Name: [{ Key: 2052, Value: '销售订单->销售出库单' }],
        SourceFormId: 'SAL_SaleOrder',
        HasExtends: false,
        InheritPath: '',
        InheritPathDescription: [],
        ISV: { Id: null, Name: 'Kingdee', ISVSignal: 'Kingdee', PackageSignal: '', DevCode: null },
        Rule: {
          ___InstClassType__: 'Kingdee.BOS.Core.Bill.PlugIn.ConvertRule.ConvertRuleElement',
          SourceFormId: 'SAL_SaleOrder',
          TargetFormId: 'SAL_OUTSTOCK',
          Status: true,
          IsDefault: true,
          Invisible: false,
          IsRandom: false,
          FreePush: false,
          CheckLinkSet: false,
          Formula: null,
          PushRunCondition: null,
          PushRunConditionExt: null,
          ConvertType: 0,
          Policies: [],
        },
      }),
    ),
  );
});

// ─── 起 connector,装 baselines ────────────────────────────────────
const connector = new K3CloudConnector(
  {
    baseUrl: 'http://localhost/k3cloud',
    acctId: 'mock',
    username: 'demo',
    password: 'x',
  },
  baselines,
);
await connector.connect();

const tools = buildK3CloudTools(connector);
const tool = (name: string) =>
  tools.find((t) => t.definition.name === name) ??
  (() => {
    throw new Error('tool not found: ' + name);
  })();

// ─── 模拟对话 ──────────────────────────────────────────────────────
function userTurn(s: string): void {
  console.log(`\n顾问: ${s}`);
}
function agentTurn(s: string): void {
  console.log(`agent: ${s}`);
}
async function call(toolName: string, args: Record<string, unknown>): Promise<string> {
  console.log(`  → ${toolName}(${JSON.stringify(args)})`);
  const t = tool(toolName);
  const out = await t.execute(args);
  // 折叠输出,只显示前 200 字
  console.log(`  ← ${out.slice(0, 200)}${out.length > 200 ? '...' : ''}`);
  return out;
}

console.log('━'.repeat(72));
console.log('对话 1:happy path — 扩展 SaleOrder-OutStock');
console.log('━'.repeat(72));
userTurn('帮我在销售订单到销售出库单的转换规则上建一个扩展,叫"加客户分组"');
agentTurn('好,我先看下当前规则状态。');
await call('kingdee_describe_convert_rule', { ruleId: 'SaleOrder-OutStock' });
agentTurn('当前没扩展,我来建一个。');
const r1 = await call('kingdee_create_convert_rule_extension', {
  originRuleId: 'SaleOrder-OutStock',
  displayName: '加客户分组',
});
const r1p = JSON.parse(r1);
agentTurn(
  `扩展已建好,新扩展 ID = ${r1p.newExtensionId}。请在 BOS Designer 里 F5 刷新,或关闭客户端重登再打开就能看到。`,
);

console.log('\n' + '━'.repeat(72));
console.log('对话 2:unsupported rule — 应给清楚的引导');
console.log('━'.repeat(72));
userTurn('采购订单到收料单的规则也帮我扩展一下');
agentTurn('调用 kingdee_create_convert_rule_extension。');
const r2 = await call('kingdee_create_convert_rule_extension', {
  originRuleId: 'PUR_PurchaseOrder-PUR_Receive',
  displayName: 'pur ext',
});
const r2p = JSON.parse(r2);
agentTurn(`这条规则现在还不支持(${r2p.message}),需要先在 BOS Designer 里手工扩展。`);

console.log('\n' + '━'.repeat(72));
console.log('对话 3:删除刚建的扩展');
console.log('━'.repeat(72));
userTurn('哦发现客户不需要这个扩展了,删掉吧');
agentTurn(`好,我把 ${r1p.newExtensionId} 删掉。`);
const r3 = await call('kingdee_delete_convert_rule_extension', {
  originRuleId: 'SaleOrder-OutStock',
  extId: r1p.newExtensionId,
});
const r3p = JSON.parse(r3);
agentTurn(r3p.message);

console.log('\n' + '━'.repeat(72));
console.log('对话 4:参数验证 — 空字符串应被工具自己拒绝');
console.log('━'.repeat(72));
userTurn('(模拟 agent 拼错参数)');
try {
  await call('kingdee_create_convert_rule_extension', { originRuleId: '   ' });
} catch (err) {
  console.log(`  ✗ throws: ${err instanceof Error ? err.message : err}`);
}
try {
  await call('kingdee_delete_convert_rule_extension', { originRuleId: 'X', extId: '' });
} catch (err) {
  console.log(`  ✗ throws: ${err instanceof Error ? err.message : err}`);
}

console.log('\n' + '━'.repeat(72));
console.log('对话 5:连续两次写,验证 ISV 缓存(只该有 1 次 GetCurrentISV)');
console.log('━'.repeat(72));
const isvBefore = getIsvCalls;
await call('kingdee_create_convert_rule_extension', {
  originRuleId: 'SaleOrder-OutStock',
});
await call('kingdee_create_convert_rule_extension', {
  originRuleId: 'SaleOrder-OutStock',
});
const isvAfter = getIsvCalls;
console.log(
  `  GetCurrentISV 调用次数:之前 ${isvBefore} → 之后 ${isvAfter}(增量 ${isvAfter - isvBefore},应为 0,因为 connector 缓存)`,
);

console.log('\n' + '━'.repeat(72));
console.log('总计:');
console.log('  SaveRulesV9 调用次数:', saveRulesCalls);
console.log('  GetCurrentISV 调用次数:', getIsvCalls);
console.log('━'.repeat(72));
