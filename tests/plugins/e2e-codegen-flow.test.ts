import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { runAgentLoop } from '../../src/main/agent/loop';
import { ToolRegistry } from '../../src/main/agent/tools';
import { buildK3CloudTools } from '../../src/main/agent/k3cloud-tools';
import { buildPluginTools } from '../../src/main/agent/plugin-tools';
import { _reset, setActiveProject } from '../../src/main/erp/active';
import { projectPluginsDir } from '../../src/main/plugins/paths';
import type { LlmClient } from '../../src/main/llm/types';
import type { StreamEvent } from '../../src/shared/llm-types';
import type { K3CloudConnector } from '../../src/main/erp/k3cloud/connector';
import type { FieldMeta, ObjectMeta, Project } from '@shared/erp-types';

/**
 * End-to-end exercise of the codegen path: a scripted agent queries
 * metadata via kingdee_get_fields, then writes a Python plugin file via
 * write_plugin, then confirms to the user. Verifies that:
 *   - the write_plugin tool actually lands bytes on disk at the expected
 *     per-project plugin path
 *   - the tool_result payload carries the fields the artifacts panel
 *     reads (filename, path, lines, projectId, created)
 *
 * No real LLM / MSSQL is involved. The fake K3CloudConnector is injected
 * into buildK3CloudTools; the plugin tools read active-project state from
 * erp/active.
 */

const project: Project = {
  id: 'p_credit_demo',
  name: '信用额度 demo 客户',
  erpProvider: 'k3cloud',
  connection: {
    server: 'localhost',
    database: 'AIS001',
    user: 'sa',
    password: 'x',
    edition: 'standard',
    version: '9'
  },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

function fakeConnector(): K3CloudConnector {
  const head: FieldMeta[] = [
    { key: 'FBillNo', name: 'FBillNo', type: 'TextField', isEntryField: false },
    {
      key: 'FCustomerId',
      name: 'FCustomerId',
      type: 'BasedataField',
      isEntryField: false
    },
    { key: 'FSaleAmount', name: 'FSaleAmount', type: 'DecimalField', isEntryField: false }
  ];
  const saleOrder: ObjectMeta = {
    id: 'SAL_SaleOrder',
    name: '销售订单',
    modelTypeId: 100,
    subsystemId: 'SAL',
    isTemplate: false,
    modifyDate: null
  };
  return {
    config: project.connection,
    connect: async () => {},
    disconnect: async () => {},
    testConnection: async () => ({ ok: true }),
    listObjects: async () => [saleOrder],
    getObject: async (id: string) => (id === 'SAL_SaleOrder' ? saleOrder : null),
    getFields: async () => head,
    listSubsystems: async () => [{ id: 'SAL', number: 'SAL', name: '销售' }],
    searchMetadata: async () => [saleOrder]
  } as unknown as K3CloudConnector;
}

function scriptedClient(scripts: StreamEvent[][]): LlmClient {
  let call = 0;
  return {
    async *stream() {
      const script = scripts[call++];
      if (!script) throw new Error('fake client ran out of scripts');
      for (const e of script) yield e;
    }
  };
}

let testDir: string;

beforeEach(async () => {
  testDir = mkdtempSync(path.join(tmpdir(), 'opendeploy-codegen-e2e-'));
  process.env.OPENDEPLOY_HOME = testDir;
  _reset();
  // Establishes projectId on the active-state module so buildPluginTools
  // can read it. The internal connect() will throw (no real DB), but the
  // module still records status=error with the projectId populated, which
  // is enough for the plugin tools — they only need the id.
  await setActiveProject(project);
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
  delete process.env.OPENDEPLOY_HOME;
  _reset();
});

const PLUGIN_BODY = [
  '# -*- coding: utf-8 -*-',
  '# Credit-limit guard on SAL_SaleOrder BeforeSave',
  'import clr',
  "clr.AddReference('Kingdee.BOS')",
  'from Kingdee.BOS.Core.Bill.PlugIn import AbstractBillPlugIn',
  '',
  'class CreditLimitGuard(AbstractBillPlugIn):',
  '    def BeforeSave(self, e):',
  "        cust = self.View.Model.GetValue('FCustomerId')",
  '        if cust is None: return',
  '        # ... credit check logic here ...',
  ''
].join('\n');

describe('plugins codegen e2e', () => {
  it('agent uses kingdee_get_fields + write_plugin to produce a .py on disk', async () => {
    const registry = new ToolRegistry();
    for (const t of buildK3CloudTools(fakeConnector())) registry.register(t);
    for (const t of buildPluginTools()) registry.register(t);

    const client = scriptedClient([
      [
        {
          type: 'tool_call',
          toolCall: {
            id: 'tc1',
            name: 'kingdee_get_fields',
            arguments: { formId: 'SAL_SaleOrder' }
          }
        },
        { type: 'done', finishReason: 'tool_calls' }
      ],
      [
        {
          type: 'tool_call',
          toolCall: {
            id: 'tc2',
            name: 'write_plugin',
            arguments: {
              filename: 'credit_limit_guard.py',
              content: PLUGIN_BODY
            }
          }
        },
        { type: 'done', finishReason: 'tool_calls' }
      ],
      [
        {
          type: 'delta',
          content:
            '已保存到 plugins/credit_limit_guard.py，请在 K/3 Cloud 客户端注册。'
        },
        { type: 'done', finishReason: 'stop' }
      ]
    ]);

    const final = await runAgentLoop({
      client,
      tools: registry,
      initialMessages: [
        {
          id: 'u1',
          role: 'user',
          content: '客户想要销售订单审核前挡信用额度超限',
          createdAt: ''
        }
      ],
      providerId: 'test',
      apiKey: 'k'
    });

    // On-disk landing — the actual file.
    const abs = path.join(
      projectPluginsDir(project.id),
      'credit_limit_guard.py'
    );
    const onDisk = await fs.readFile(abs, 'utf8');
    expect(onDisk).toContain('CreditLimitGuard');
    expect(onDisk).toContain('BeforeSave');

    // Tool result in the message stream carries the fields artifacts-store
    // reads. Grab the LAST tool message — the write_plugin result, not the
    // earlier kingdee_get_fields one.
    const toolMessages = final.filter((m) => m.role === 'tool');
    const writeResult = toolMessages[toolMessages.length - 1];
    expect(writeResult).toBeDefined();
    const parsed = JSON.parse(writeResult!.content);
    expect(parsed.filename).toBe('credit_limit_guard.py');
    expect(parsed.created).toBe(true);
    expect(parsed.lines).toBeGreaterThan(5);
    expect(parsed.path).toContain('credit_limit_guard.py');
    expect(parsed.projectId).toBe('p_credit_demo');

    // Final assistant message is the user-facing reply.
    const last = final[final.length - 1];
    expect(last.role).toBe('assistant');
    expect(last.content).toContain('credit_limit_guard.py');
  });
});
