import { describe, expect, it, vi } from 'vitest';
import sql from 'mssql';
import { buildBosWriteTools } from '../../src/main/agent/bos-write-tools';
import type { K3CloudConnector } from '../../src/main/erp/k3cloud/connector';
import {
  buildExtensionKernelXml,
  insertTextFieldIntoKernelXml
} from '../../src/main/erp/k3cloud/bos-xml';

const EXT_ID = '719dec90-f2d9-4c13-b26e-08b88642c3eb';

/**
 * Fake connector that lets each test hand a fixed FKERNELXML row back via
 * `pool.request().query()`. Mirrors the makeFakePool pattern in
 * tests/erp/bos-writer.test.ts but wrapped in a connector facade so we can
 * inject through `buildBosWriteTools(connector, projectId)`.
 */
function makeConnectorWithKernelXml(xml: string | null): K3CloudConnector {
  const fakePool = {
    request: () => {
      const inputs: Record<string, unknown> = {};
      const req = {
        input: (name: string, _type?: unknown, val?: unknown) => {
          inputs[name] = val;
          return req;
        },
        query: vi.fn(async () => ({ recordset: xml === null ? [] : [{ xml }] }))
      };
      return req;
    }
  } as unknown as sql.ConnectionPool;

  return {
    config: { server: 'localhost', database: 'AIS001', user: 'sa', password: 'x' },
    getPool: vi.fn(async () => fakePool)
  } as unknown as K3CloudConnector;
}

describe('kingdee_get_extension_fields tool', () => {
  it('is registered with parallelSafe=true when project is active', () => {
    const conn = makeConnectorWithKernelXml(null);
    const tools = buildBosWriteTools(conn, 'p_test');
    const t = tools.find((x) => x.definition.name === 'kingdee_get_extension_fields');
    expect(t).toBeDefined();
    expect(t!.parallelSafe).toBe(true);
  });

  it('returns count + fields JSON for an extension with one text field', async () => {
    const xml = insertTextFieldIntoKernelXml(
      buildExtensionKernelXml(EXT_ID, []),
      { spec: { key: 'F_DEMO', caption: '演示字段' } }
    );
    const conn = makeConnectorWithKernelXml(xml);
    const tools = buildBosWriteTools(conn, 'p_test');
    const t = tools.find((x) => x.definition.name === 'kingdee_get_extension_fields')!;

    const out = await t.execute({ extId: EXT_ID });
    const parsed = JSON.parse(out);
    expect(parsed.count).toBe(1);
    expect(parsed.fields[0].key).toBe('F_DEMO');
    expect(parsed.fields[0].caption).toBe('演示字段');
    expect(parsed.fields[0].type).toBe('text');
  });

  it('returns count=0 when extension xml is null (extension missing)', async () => {
    const conn = makeConnectorWithKernelXml(null);
    const tools = buildBosWriteTools(conn, 'p_test');
    const t = tools.find((x) => x.definition.name === 'kingdee_get_extension_fields')!;

    const parsed = JSON.parse(await t.execute({ extId: EXT_ID }));
    expect(parsed.count).toBe(0);
    expect(parsed.fields).toEqual([]);
  });
});
