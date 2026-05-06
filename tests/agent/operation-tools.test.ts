import { describe, expect, it, vi } from 'vitest';
import {
  listOperationsTool,
  addCustomOperationTool,
  deleteOperationTool,
  addToolbarButtonTool,
  deleteToolbarButtonTool
} from '../../src/main/agent/operation-tools';
import type { K3CloudConnector } from '../../src/main/erp/k3cloud/connector';
import type {
  ListOperationsResult,
  ParsedFormOperation,
  ParsedToolbarButton
} from '../../src/main/erp/k3cloud/rpc/operation-types';

/**
 * Tiny stand-in shaped to whatever the operation tools call. Cast to
 * K3CloudConnector at use-site since we only need a handful of methods.
 *
 * Mirrors `tests/agent/business-rule-tools.test.ts`'s factory.
 */
function makeFakeConnector(
  overrides: Partial<
    Pick<
      K3CloudConnector,
      | 'listOperations'
      | 'addCustomOperation'
      | 'removeOperation'
      | 'addToolbarButton'
      | 'removeToolbarButton'
    >
  > = {}
): K3CloudConnector {
  return {
    listOperations: vi.fn(
      async () =>
        ({ operations: [], toolbarButtons: [] }) as ListOperationsResult
    ),
    addCustomOperation: vi.fn(async () => ({ operationKey: 'unset' })),
    removeOperation: vi.fn(async () => undefined),
    addToolbarButton: vi.fn(async () => ({ buttonKey: 'unset' })),
    removeToolbarButton: vi.fn(async () => undefined),
    ...overrides
  } as unknown as K3CloudConnector;
}

const EXT_ID = '7cd9e5a1dbd54faba4be1b558877fbd2';

// ── listOperationsTool ──────────────────────────────────────────────────

describe('listOperationsTool', () => {
  it('registers as k3cloud_list_operations and is parallelSafe', () => {
    const tool = listOperationsTool(makeFakeConnector());
    expect(tool.definition.name).toBe('k3cloud_list_operations');
    expect(tool.parallelSafe).toBe(true);
  });

  it('forwards extensionFid and returns aggregated shape', async () => {
    const fake = makeFakeConnector({
      listOperations: vi.fn(
        async (): Promise<ListOperationsResult> => ({
          operations: [
            {
              operationKey: 'ApplyDiscount',
              operationId: 45,
              operationName: '应用折扣',
              servicePlugins: [
                { className: 'discount_handler', plugInType: 1, hasPyScript: true }
              ]
            }
          ],
          toolbarButtons: [
            {
              buttonKey: 'btnDiscount',
              buttonId: 'aabbccdd',
              caption: '折扣',
              seq: 1,
              parentEntityKey: null,
              boundOperationKey: 'ApplyDiscount',
              barItemLinkId: 'link-1',
              toolbarKey: 'tbMain'
            }
          ]
        })
      )
    });
    const tool = listOperationsTool(fake);
    const raw = await tool.execute({ extensionFid: EXT_ID });
    expect(fake.listOperations).toHaveBeenCalledWith(EXT_ID);
    const parsed = JSON.parse(raw);
    expect(parsed.operations).toHaveLength(1);
    expect(parsed.operations[0].servicePlugins[0].hasPyScript).toBe(true);
    expect(parsed.toolbarButtons[0].boundOperationKey).toBe('ApplyDiscount');
  });

  it('rejects when extensionFid is missing or empty', async () => {
    const tool = listOperationsTool(makeFakeConnector());
    await expect(tool.execute({})).rejects.toThrow(/extensionFid/);
    await expect(tool.execute({ extensionFid: '   ' })).rejects.toThrow(/extensionFid/);
  });
});

// ── addCustomOperationTool ──────────────────────────────────────────────

describe('addCustomOperationTool', () => {
  it('registers as k3cloud_add_custom_operation and is NOT parallelSafe (writer)', () => {
    const tool = addCustomOperationTool(makeFakeConnector());
    expect(tool.definition.name).toBe('k3cloud_add_custom_operation');
    expect(tool.parallelSafe).toBeUndefined();
  });

  it('happy path: forwards args + auto-generated operationParameterId (dashed UUID)', async () => {
    const addCustomOperation = vi.fn(async () => ({ operationKey: 'PyOp' }));
    const fake = makeFakeConnector({ addCustomOperation });
    const tool = addCustomOperationTool(fake);

    const raw = await tool.execute({
      extensionFid: EXT_ID,
      operationKey: 'PyOp',
      operationName: 'Py 测试',
      pluginClassName: 'my_handler',
      pyBody: '# test\nclass X: pass'
    });
    const parsed = JSON.parse(raw);

    expect(parsed.ok).toBe(true);
    expect(parsed.operationKey).toBe('PyOp');
    // operationParameterId returned in tool result is dashed UUID 36-char.
    expect(parsed.operationParameterId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(parsed.message).toMatch(/BOS Designer/);

    expect(addCustomOperation).toHaveBeenCalledTimes(1);
    const call = addCustomOperation.mock.calls[0][0];
    expect(call).toMatchObject({
      extensionFid: EXT_ID,
      operationKey: 'PyOp',
      operationName: 'Py 测试',
      pluginClassName: 'my_handler',
      pyBody: '# test\nclass X: pass'
    });
    // operationParameterId on the connector call must also be dashed UUID.
    expect(call.operationParameterId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it('forwards optional operationId / operationObjectKey / expressValue when given', async () => {
    const addCustomOperation = vi.fn(async () => ({ operationKey: 'CopyVariant' }));
    const fake = makeFakeConnector({ addCustomOperation });
    const tool = addCustomOperationTool(fake);

    await tool.execute({
      extensionFid: EXT_ID,
      operationKey: 'CopyVariant',
      operationName: '复制变体',
      operationId: 2,
      operationObjectKey: 'FSaleOrderEntry',
      expressValue: 'someParam'
    });

    const call = addCustomOperation.mock.calls[0][0];
    expect(call.operationId).toBe(2);
    expect(call.operationObjectKey).toBe('FSaleOrderEntry');
    expect(call.expressValue).toBe('someParam');
    expect(call.pyBody).toBeUndefined();
    expect(call.pluginClassName).toBeUndefined();
  });

  it('rejects pyBody without pluginClassName (does not call connector)', async () => {
    const addCustomOperation = vi.fn(async () => ({ operationKey: 'X' }));
    const fake = makeFakeConnector({ addCustomOperation });
    const tool = addCustomOperationTool(fake);

    await expect(
      tool.execute({
        extensionFid: EXT_ID,
        operationKey: 'PyOpNoCls',
        operationName: 'x',
        pyBody: '# code only — no class name'
      })
    ).rejects.toThrow(/pluginClassName/);

    expect(addCustomOperation).not.toHaveBeenCalled();
  });

  it('rejects invalid operationKey (not a C identifier)', async () => {
    const tool = addCustomOperationTool(makeFakeConnector());
    await expect(
      tool.execute({
        extensionFid: EXT_ID,
        operationKey: '1Bad',
        operationName: 'x'
      })
    ).rejects.toThrow(/operationKey/);

    await expect(
      tool.execute({
        extensionFid: EXT_ID,
        operationKey: 'has space',
        operationName: 'x'
      })
    ).rejects.toThrow(/operationKey/);
  });

  it('rejects missing extensionFid / operationKey / operationName', async () => {
    const tool = addCustomOperationTool(makeFakeConnector());
    await expect(
      tool.execute({ operationKey: 'OK', operationName: 'x' })
    ).rejects.toThrow(/extensionFid/);
    await expect(
      tool.execute({ extensionFid: EXT_ID, operationName: 'x' })
    ).rejects.toThrow(/operationKey/);
    await expect(
      tool.execute({ extensionFid: EXT_ID, operationKey: 'OK' })
    ).rejects.toThrow(/operationName/);
  });
});

// ── deleteOperationTool ─────────────────────────────────────────────────

describe('deleteOperationTool', () => {
  it('registers as k3cloud_delete_operation and is NOT parallelSafe', () => {
    const tool = deleteOperationTool(makeFakeConnector());
    expect(tool.definition.name).toBe('k3cloud_delete_operation');
    expect(tool.parallelSafe).toBeUndefined();
  });

  it('forwards extensionFid + operationKey, returns ok payload', async () => {
    const removeOperation = vi.fn(async () => undefined);
    const fake = makeFakeConnector({ removeOperation });
    const tool = deleteOperationTool(fake);

    const raw = await tool.execute({
      extensionFid: EXT_ID,
      operationKey: 'ApplyDiscount'
    });

    expect(removeOperation).toHaveBeenCalledWith(EXT_ID, 'ApplyDiscount');
    expect(JSON.parse(raw)).toEqual({ ok: true, operationKey: 'ApplyDiscount' });
  });

  it('rejects invalid operationKey', async () => {
    const tool = deleteOperationTool(makeFakeConnector());
    await expect(
      tool.execute({ extensionFid: EXT_ID, operationKey: '1Bad' })
    ).rejects.toThrow(/operationKey/);
  });

  it('rejects missing args', async () => {
    const tool = deleteOperationTool(makeFakeConnector());
    await expect(tool.execute({})).rejects.toThrow(/extensionFid/);
    await expect(tool.execute({ extensionFid: EXT_ID })).rejects.toThrow(/operationKey/);
  });
});

// ── addToolbarButtonTool ────────────────────────────────────────────────

describe('addToolbarButtonTool', () => {
  function existingOp(): ParsedFormOperation {
    return {
      operationKey: 'ApplyDiscount',
      operationId: 45,
      operationName: '应用折扣',
      servicePlugins: []
    };
  }

  function makeConnectorWithOp(
    addToolbarButton = vi.fn(async () => ({ buttonKey: 'btnDiscount' }))
  ): K3CloudConnector {
    return makeFakeConnector({
      listOperations: vi.fn(
        async (): Promise<ListOperationsResult> => ({
          operations: [existingOp()],
          toolbarButtons: [] as ParsedToolbarButton[]
        })
      ),
      addToolbarButton
    });
  }

  it('registers as k3cloud_add_toolbar_button and is NOT parallelSafe', () => {
    const tool = addToolbarButtonTool(makeFakeConnector());
    expect(tool.definition.name).toBe('k3cloud_add_toolbar_button');
    expect(tool.parallelSafe).toBeUndefined();
  });

  it('happy path form-level: looks up boundOperationName + auto-generates all 4 ids', async () => {
    const addToolbarButton = vi.fn(async () => ({ buttonKey: 'btnDiscount' }));
    const fake = makeConnectorWithOp(addToolbarButton);
    const tool = addToolbarButtonTool(fake);

    const raw = await tool.execute({
      extensionFid: EXT_ID,
      target: { kind: 'form' },
      buttonKey: 'btnDiscount',
      caption: '折扣',
      boundOperationKey: 'ApplyDiscount',
      toolbarKey: 'tbMain'
    });
    const parsed = JSON.parse(raw);

    expect(parsed.ok).toBe(true);
    expect(parsed.buttonKey).toBe('btnDiscount');
    // buttonId — 32-hex, no dashes
    expect(parsed.buttonId).toMatch(/^[0-9a-f]{32}$/);
    // 3 dashed UUIDs
    const dashedRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    expect(parsed.barDataManagerId).toMatch(dashedRe);
    expect(parsed.formBusinessServiceId).toMatch(dashedRe);
    expect(parsed.barItemLinkId).toMatch(dashedRe);

    // listOperations was called for pre-flight + name lookup.
    expect(fake.listOperations).toHaveBeenCalledWith(EXT_ID);

    // Connector got all the generated ids + boundOperationName from the live op.
    expect(addToolbarButton).toHaveBeenCalledTimes(1);
    const call = addToolbarButton.mock.calls[0][0];
    expect(call.target).toEqual({ kind: 'form' });
    expect(call.buttonKey).toBe('btnDiscount');
    expect(call.caption).toBe('折扣');
    expect(call.seq).toBe(1); // default
    expect(call.boundOperationKey).toBe('ApplyDiscount');
    expect(call.boundOperationName).toBe('应用折扣');
    expect(call.toolbarKey).toBe('tbMain');
    expect(call.buttonId).toMatch(/^[0-9a-f]{32}$/);
    expect(call.barDataManagerId).toMatch(dashedRe);
    expect(call.formBusinessServiceId).toMatch(dashedRe);
    expect(call.barItemLinkId).toMatch(dashedRe);
  });

  it('happy path entry-level: forwards target.entityKey through', async () => {
    const addToolbarButton = vi.fn(async () => ({ buttonKey: 'btnRowMark' }));
    const fake = makeConnectorWithOp(addToolbarButton);
    const tool = addToolbarButtonTool(fake);

    await tool.execute({
      extensionFid: EXT_ID,
      target: { kind: 'entry', entityKey: 'FSaleOrderEntry' },
      buttonKey: 'btnRowMark',
      caption: '标记行',
      boundOperationKey: 'ApplyDiscount',
      toolbarKey: 'tbEntry',
      seq: 3
    });

    const call = addToolbarButton.mock.calls[0][0];
    expect(call.target).toEqual({ kind: 'entry', entityKey: 'FSaleOrderEntry' });
    expect(call.seq).toBe(3);
  });

  it('rejects when boundOperationKey does not exist (does not call addToolbarButton)', async () => {
    const addToolbarButton = vi.fn(async () => ({ buttonKey: 'btn' }));
    const listOperations = vi.fn(
      async (): Promise<ListOperationsResult> => ({
        operations: [], // no op with that key
        toolbarButtons: []
      })
    );
    const fake = makeFakeConnector({ listOperations, addToolbarButton });
    const tool = addToolbarButtonTool(fake);

    await expect(
      tool.execute({
        extensionFid: EXT_ID,
        target: { kind: 'form' },
        buttonKey: 'btnGhost',
        caption: 'x',
        boundOperationKey: 'GhostOp',
        toolbarKey: 'tbMain'
      })
    ).rejects.toThrow(/GhostOp.*不存在|不存在.*GhostOp/);

    // list was called (pre-flight), but write was not.
    expect(listOperations).toHaveBeenCalledWith(EXT_ID);
    expect(addToolbarButton).not.toHaveBeenCalled();
  });

  it("target.kind='entry' without entityKey rejected", async () => {
    const tool = addToolbarButtonTool(makeConnectorWithOp());
    await expect(
      tool.execute({
        extensionFid: EXT_ID,
        target: { kind: 'entry' }, // missing entityKey
        buttonKey: 'btnX',
        caption: 'x',
        boundOperationKey: 'ApplyDiscount',
        toolbarKey: 'tbMain'
      })
    ).rejects.toThrow(/entityKey/);
  });

  it("target.kind invalid → rejects", async () => {
    const tool = addToolbarButtonTool(makeConnectorWithOp());
    await expect(
      tool.execute({
        extensionFid: EXT_ID,
        target: { kind: 'something' },
        buttonKey: 'btnX',
        caption: 'x',
        boundOperationKey: 'ApplyDiscount',
        toolbarKey: 'tbMain'
      })
    ).rejects.toThrow(/kind/);

    await expect(
      tool.execute({
        extensionFid: EXT_ID,
        target: 'not-an-object',
        buttonKey: 'btnX',
        caption: 'x',
        boundOperationKey: 'ApplyDiscount',
        toolbarKey: 'tbMain'
      })
    ).rejects.toThrow(/target/);
  });

  it('invalid buttonKey / boundOperationKey / toolbarKey (non-C-ident) rejected', async () => {
    const tool = addToolbarButtonTool(makeConnectorWithOp());
    const base = {
      extensionFid: EXT_ID,
      target: { kind: 'form' },
      buttonKey: 'btnOK',
      caption: 'x',
      boundOperationKey: 'ApplyDiscount',
      toolbarKey: 'tbMain'
    };

    await expect(tool.execute({ ...base, buttonKey: '1Bad' })).rejects.toThrow(/buttonKey/);
    await expect(tool.execute({ ...base, boundOperationKey: 'has space' })).rejects.toThrow(
      /boundOperationKey/
    );
    await expect(tool.execute({ ...base, toolbarKey: 'tb-Bad' })).rejects.toThrow(/toolbarKey/);
  });

  it('seq < 1 or non-integer rejected', async () => {
    const tool = addToolbarButtonTool(makeConnectorWithOp());
    const base = {
      extensionFid: EXT_ID,
      target: { kind: 'form' },
      buttonKey: 'btnX',
      caption: 'x',
      boundOperationKey: 'ApplyDiscount',
      toolbarKey: 'tbMain'
    };
    await expect(tool.execute({ ...base, seq: 0 })).rejects.toThrow(/seq/);
    await expect(tool.execute({ ...base, seq: -1 })).rejects.toThrow(/seq/);
    await expect(tool.execute({ ...base, seq: 'abc' })).rejects.toThrow(/seq/);
  });
});

// ── deleteToolbarButtonTool ─────────────────────────────────────────────

describe('deleteToolbarButtonTool', () => {
  it('registers as k3cloud_delete_toolbar_button and is NOT parallelSafe', () => {
    const tool = deleteToolbarButtonTool(makeFakeConnector());
    expect(tool.definition.name).toBe('k3cloud_delete_toolbar_button');
    expect(tool.parallelSafe).toBeUndefined();
  });

  it('forwards extensionFid + buttonKey, returns ok payload', async () => {
    const removeToolbarButton = vi.fn(async () => undefined);
    const fake = makeFakeConnector({ removeToolbarButton });
    const tool = deleteToolbarButtonTool(fake);

    const raw = await tool.execute({
      extensionFid: EXT_ID,
      buttonKey: 'btnDiscount'
    });

    expect(removeToolbarButton).toHaveBeenCalledWith(EXT_ID, 'btnDiscount');
    expect(JSON.parse(raw)).toEqual({ ok: true, buttonKey: 'btnDiscount' });
  });

  it('rejects invalid buttonKey', async () => {
    const tool = deleteToolbarButtonTool(makeFakeConnector());
    await expect(
      tool.execute({ extensionFid: EXT_ID, buttonKey: '1Bad' })
    ).rejects.toThrow(/buttonKey/);
  });

  it('rejects missing args', async () => {
    const tool = deleteToolbarButtonTool(makeFakeConnector());
    await expect(tool.execute({})).rejects.toThrow(/extensionFid/);
    await expect(tool.execute({ extensionFid: EXT_ID })).rejects.toThrow(/buttonKey/);
  });
});
