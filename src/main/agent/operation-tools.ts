/**
 * Plan 5.12.6 Phase 4 — agent tools that drive the K/3 BOS extension's
 * FormOperation + toolbar BarButtonItem write paths via the .NET bridge.
 *
 * Five tools:
 *   - k3cloud_list_operations         (read)  — enumerate operations + buttons
 *   - k3cloud_add_custom_operation    (write) — append FormOperation, optional inline Python
 *   - k3cloud_delete_operation        (write) — remove FormOperation by key
 *   - k3cloud_add_toolbar_button      (write) — append BarButtonItem, bind to existing operation
 *   - k3cloud_delete_toolbar_button   (write) — remove BarButtonItem + paired BarItemLink
 *
 * Convention notes:
 *   - **No zod** — the project uses JSON Schema in `definition.parameters`
 *     plus runtime checks in `execute`. Same shape as
 *     `src/main/agent/business-rule-tools.ts` (5.12.3b template).
 *   - **GUIDs are tool-generated** for every node BOS expects an Id on:
 *     `operationParameterId` for `addCustomOperation`,
 *     `buttonId` (32-hex) + `barDataManagerId`/`formBusinessServiceId`/`barItemLinkId`
 *     (dashed UUIDs) for `addToolbarButton`. Agents must NOT supply ids — the
 *     tool surface is intentionally narrow so the LLM can't generate
 *     malformed/colliding ids.
 *   - **C-identifier validation** for keys (`operationKey` / `buttonKey` /
 *     `boundOperationKey` / `toolbarKey`). BOS tooling sometimes silently
 *     accepts whitespace / non-ASCII keys but they break the BOS Designer
 *     reload — reject up front.
 *   - **`addToolbarButton` looks up `boundOperationName` from the live
 *     `listOperations`** so the agent doesn't have to repeat the operation
 *     display name. Failing fast when the bound op doesn't exist gives a
 *     clearer error than letting the bridge surface a generic save error.
 *
 * Phase 2 deviation 8 carry-through: each operation may carry one or more
 * ServicePlugins entries; the bridge exposes `hasPyScript` per plugin (not
 * a single flag on the operation). Tool descriptions reflect this.
 */

import { randomUUID } from 'node:crypto';
import type { ToolHandler } from './tools';
import type { K3CloudConnector } from '../erp/k3cloud/connector';

// C identifier — letters / digits / underscore, must start with letter or _.
// Matches BOS Designer's silent contract for operation/button/toolbar keys.
const C_IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function requireString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== 'string' || v.trim() === '') {
    throw new Error(`${key} 必填，且不能为空字符串`);
  }
  return v.trim();
}

function requireIdentifier(args: Record<string, unknown>, key: string): string {
  const v = requireString(args, key);
  if (!C_IDENT_RE.test(v)) {
    throw new Error(
      `${key} 必须是 C 标识符（字母/数字/下划线，不能以数字开头）：收到 "${v}"`
    );
  }
  return v;
}

function compactGuid(): string {
  // 32-hex no dashes — matches BOS Designer convention for FID-style ids.
  return randomUUID().replace(/-/g, '');
}

/**
 * k3cloud_list_operations — read the FormOperation + BarButtonItem catalog
 * from an extension. Read path; safe to parallelize.
 */
export function listOperationsTool(c: K3CloudConnector): ToolHandler {
  return {
    parallelSafe: true,
    definition: {
      name: 'k3cloud_list_operations',
      description:
        '列出指定 BOS 扩展上的所有自定义操作（FormOperation）和工具栏按钮（BarButtonItem）。' +
        '\n\n概念区分：' +
        '\n- **操作（FormOperation）**：「按下后做什么」的逻辑实体，由 operationKey 标识。' +
        '\n- **按钮（BarButtonItem）**：在工具栏上显示的入口，通过 boundOperationKey 绑到某个操作。' +
        '\n\n返回 `{ operations: [...], toolbarButtons: [...] }`：' +
        '\n- `operations[i].servicePlugins[]` 列出该操作挂的服务插件；`servicePlugins[].hasPyScript=true` 表示该插件 inline 了 IronPython 源码（无法在 list 接口拿到原文，仅暴露存在性）。' +
        '\n- `toolbarButtons[i].parentEntityKey` 为 null 表示按钮挂在 FormAppearance（form 顶层工具栏），非 null 表示挂在指定 entry 的工具栏。' +
        '\n- `toolbarButtons[i].boundOperationKey` 为 null 表示孤儿按钮（绑的操作已被删）。' +
        '\n\n读路径，不改 DB；写完按钮 / 操作之后用本工具反查验证。',
      parameters: {
        type: 'object',
        properties: {
          extensionFid: {
            type: 'string',
            description: '扩展对象的 FID（GUID，32 位 hex 或带连字符）。'
          }
        },
        required: ['extensionFid']
      }
    },
    async execute(args) {
      const extensionFid = requireString(args, 'extensionFid');
      const result = await c.listOperations(extensionFid);
      return JSON.stringify(result, null, 2);
    }
  };
}

/**
 * k3cloud_add_custom_operation — append a FormOperation to an extension.
 * Optional `pyBody` + `pluginClassName` pair inlines an IronPython service
 * plugin (PlugInType=1) under that operation's ServicePlugins.
 *
 * `operationParameterId` is generated here (dashed UUID) — agents never
 * supply it. `operationId` defaults to 45 (DoNothing / 自定义).
 */
export function addCustomOperationTool(c: K3CloudConnector): ToolHandler {
  return {
    definition: {
      name: 'k3cloud_add_custom_operation',
      description:
        '在 BOS 扩展上加一个自定义操作（FormOperation）。' +
        '\n\n**Python 内联**：可选传 `pluginClassName` + `pyBody`，bridge 会在该操作的 ServicePlugins 里加一条 PlugInType=1（IronPython）的插件，按下绑此操作的按钮就跑这段脚本。' +
        '不传 pyBody → 操作壳子（也可后续走 `k3cloud_register_python_plugins` 走 FormPlugins / AfterDoOperation 路径）。' +
        '\n\n**两个 Python 挂载点选择**：' +
        '\n- 单按钮单一逻辑（点了打折 / 点了反审）→ ServicePlugins，**用本工具传 pyBody**' +
        '\n- 跨多按钮共享逻辑（任何按钮都先校验信用额度）→ FormPlugins，**用 `k3cloud_register_python_plugins`**' +
        '\n两个都挂会执行两次，按场景二选一。' +
        '\n\n**operationId**：默认 45 = DoNothing（自定义）。其他内置 ID（2=Copy 变体、21=审核 变体等）做内置操作变体时才显式传，并配合 `expressValue`。' +
        '\n\n**operationKey 唯一**：同一扩展内不能重复，重复时服务端会拒绝。' +
        '\n\n**写路径**：触发 SaveForIDEV9 持久化扩展。BOS Designer 工具栏点刷新即可看到新操作；客户端运行时通常需关闭客户端重登录才生效（缓存）。',
      parameters: {
        type: 'object',
        properties: {
          extensionFid: {
            type: 'string',
            description: '扩展对象的 FID（GUID）。'
          },
          operationKey: {
            type: 'string',
            description:
              'C 标识符，操作的唯一键，例如 "ApplyDiscount"。同扩展内不可重复。'
          },
          operationName: {
            type: 'string',
            description: '操作的显示名称（中文友好），如 "应用折扣"。'
          },
          operationId: {
            type: 'number',
            description:
              '可选，默认 45 = DoNothing 自定义。指定其他内置 ID 时本操作是该内置 ID 的变体，常配合 `expressValue` 使用。'
          },
          pluginClassName: {
            type: 'string',
            description:
              '可选，与 `pyBody` 配对使用。Python 服务插件的简短名（BOS Designer 服务插件列表里的标识），例如 "discount_handler"。指定 pyBody 时**必须**同时指定 pluginClassName。'
          },
          pyBody: {
            type: 'string',
            description:
              '可选，IronPython 2.7 源码，含必要 `import` + 类定义。inline 到该操作的 ServicePlugins。指定时必须同时指定 `pluginClassName`。'
          },
          operationObjectKey: {
            type: 'string',
            description:
              '可选，绑到某 entry（如 "FSaleOrderEntry"）。head 操作不传。'
          },
          expressValue: {
            type: 'string',
            description:
              '可选，OperationParameter.ExpressValue。仅做内置操作变体时填，自定义 OperationId=45 场景留空。'
          }
        },
        required: ['extensionFid', 'operationKey', 'operationName']
      }
    },
    async execute(args) {
      const extensionFid = requireString(args, 'extensionFid');
      const operationKey = requireIdentifier(args, 'operationKey');
      const operationName = requireString(args, 'operationName');

      const operationId =
        typeof args.operationId === 'number' && Number.isFinite(args.operationId)
          ? Math.trunc(args.operationId)
          : undefined;

      const pluginClassName =
        typeof args.pluginClassName === 'string' && args.pluginClassName.trim() !== ''
          ? args.pluginClassName.trim()
          : undefined;
      const pyBody =
        typeof args.pyBody === 'string' && args.pyBody !== '' ? args.pyBody : undefined;

      // pyBody/pluginClassName must be paired — bridge wires the inline
      // ServicePlugins entry only when both are present. Catch the missing
      // pluginClassName case here so the LLM gets an immediately actionable
      // error instead of a generic save failure.
      if (pyBody && !pluginClassName) {
        throw new Error('指定 pyBody 时必须同时指定 pluginClassName');
      }

      const operationObjectKey =
        typeof args.operationObjectKey === 'string' && args.operationObjectKey.trim() !== ''
          ? args.operationObjectKey.trim()
          : undefined;
      const expressValue =
        typeof args.expressValue === 'string' && args.expressValue !== ''
          ? args.expressValue
          : undefined;

      const operationParameterId = randomUUID(); // dashed UUID — connector forwards verbatim

      const result = await c.addCustomOperation({
        extensionFid,
        operationKey,
        operationName,
        operationParameterId,
        operationId,
        pluginClassName,
        pyBody,
        operationObjectKey,
        expressValue
      });

      return JSON.stringify(
        {
          ok: true,
          operationKey: result.operationKey,
          operationParameterId,
          message:
            `自定义操作 ${result.operationKey} 已添加。BOS Designer 工具栏点刷新即可看到；` +
            '客户端运行时通常需关闭客户端重登录才生效（缓存）。'
        },
        null,
        2
      );
    }
  };
}

/**
 * k3cloud_delete_operation — remove a FormOperation by operationKey. Does
 * NOT auto-remove buttons that bind to it; the agent should call
 * `list_operations` first to check `boundOperationKey` references.
 */
export function deleteOperationTool(c: K3CloudConnector): ToolHandler {
  return {
    definition: {
      name: 'k3cloud_delete_operation',
      description:
        '按 operationKey 删除扩展上的一条自定义操作（FormOperation）。' +
        '\n\n**注意**：不会连带删除按钮 — 引用此操作的按钮会变成「孤儿」（boundOperationKey 指向不存在的操作），点击不响应。删除前先调 `k3cloud_list_operations` 检查 `toolbarButtons[].boundOperationKey`，有引用先调 `k3cloud_delete_toolbar_button` 删按钮。' +
        '\n\n**写路径**：触发 SaveForIDEV9。',
      parameters: {
        type: 'object',
        properties: {
          extensionFid: {
            type: 'string',
            description: '扩展 FID（GUID）。'
          },
          operationKey: {
            type: 'string',
            description: '要删除的操作 key（C 标识符）。'
          }
        },
        required: ['extensionFid', 'operationKey']
      }
    },
    async execute(args) {
      const extensionFid = requireString(args, 'extensionFid');
      const operationKey = requireIdentifier(args, 'operationKey');
      await c.removeOperation(extensionFid, operationKey);
      return JSON.stringify({ ok: true, operationKey }, null, 2);
    }
  };
}

/**
 * k3cloud_add_toolbar_button — append a BarButtonItem (+ BarItemLink) to
 * a form-level or entry-level toolbar, bound to an existing FormOperation.
 *
 * Internally calls `listOperations` first to:
 *   1. fail fast when `boundOperationKey` doesn't exist (clearer than a
 *      bridge save error)
 *   2. pick up `boundOperationName` so the agent doesn't have to repeat
 *      the display name (BOS uses it in ClickActions Description)
 */
export function addToolbarButtonTool(c: K3CloudConnector): ToolHandler {
  return {
    definition: {
      name: 'k3cloud_add_toolbar_button',
      description:
        '在 BOS 扩展某个位置的工具栏加一个按钮（BarButtonItem），绑已存在的 FormOperation。' +
        '\n\n**位置选择 `target`**：' +
        '\n- `target.kind="form"` → 加到 form **顶层主工具栏**（FormAppearance.Menu，BOS Designer 属性面板"菜单集合"）。' +
        '\n- `target.kind="list"` → 加到单据的 **列表菜单**（FormAppearance.ListMenu，BOS Designer 属性面板"列表菜单"）。客户在销售订单查询列表上看到的工具栏按钮就在这里。' +
        '\n- `target.kind="entry"` → 加到指定 entry 的工具栏，必须传 `target.entityKey`（如 "FSaleOrderEntry"）。' +
        '\n\n**`toolbarKey`**：父级 ToolBar 的 Key。先调 `k3cloud_list_operations` 看现有 toolbar 借用即可；如果该 entry 还没初始化工具栏，list 拿不到 — 提示用户在 BOS Designer 手工加临时按钮初始化后再删（或当 v0.1 限制说明）。' +
        '\n\n**`boundOperationKey`**：必须先用 `k3cloud_add_custom_operation` 创建对应操作。本工具会内部 list 验证 — 不存在直接报错，不发送写请求。' +
        '\n\n**buttonKey 唯一**：同扩展内不可重复。' +
        '\n\n**写路径**：触发 SaveForIDEV9。BOS Designer 工具栏点刷新即可看到；客户端运行时通常需关闭客户端重登录（缓存）。',
      parameters: {
        type: 'object',
        properties: {
          extensionFid: {
            type: 'string',
            description: '扩展 FID（GUID）。'
          },
          target: {
            type: 'object',
            description:
              "按钮挂哪。kind='form' → form 顶层工具栏(菜单集合);kind='list' → 列表菜单;kind='entry' → 指定 entry 的工具栏(必传 entityKey)。",
            properties: {
              kind: {
                type: 'string',
                description: "'form' / 'list' / 'entry'"
              },
              entityKey: {
                type: 'string',
                description: "kind='entry' 时必填，如 'FSaleOrderEntry'。"
              }
            },
            required: ['kind']
          },
          buttonKey: {
            type: 'string',
            description: 'C 标识符，按钮唯一键。'
          },
          caption: {
            type: 'string',
            description: '按钮显示文字（中文友好）。'
          },
          seq: {
            type: 'number',
            description: '按钮在工具栏中的顺序，整数 ≥ 1，默认 1。'
          },
          boundOperationKey: {
            type: 'string',
            description:
              '要绑定的 FormOperation key（必须先用 k3cloud_add_custom_operation 创建）。'
          },
          toolbarKey: {
            type: 'string',
            description:
              '父级 ToolBar Key（C 标识符）。从 list_operations 取现有 toolbar 借用。'
          }
        },
        required: ['extensionFid', 'target', 'buttonKey', 'caption', 'boundOperationKey', 'toolbarKey']
      }
    },
    async execute(args) {
      const extensionFid = requireString(args, 'extensionFid');
      const buttonKey = requireIdentifier(args, 'buttonKey');
      const caption = requireString(args, 'caption');
      const boundOperationKey = requireIdentifier(args, 'boundOperationKey');
      const toolbarKey = requireIdentifier(args, 'toolbarKey');

      // seq — int ≥ 1, default 1.
      let seq = 1;
      if (args.seq !== undefined && args.seq !== null) {
        if (typeof args.seq !== 'number' || !Number.isFinite(args.seq)) {
          throw new Error('seq 必须是数字');
        }
        const truncated = Math.trunc(args.seq);
        if (truncated < 1) {
          throw new Error('seq 必须 ≥ 1');
        }
        seq = truncated;
      }

      // target — manual discriminated-union check (no zod in this codebase).
      const targetRaw = args.target;
      if (!targetRaw || typeof targetRaw !== 'object') {
        throw new Error('target 必填，且必须是对象');
      }
      const t = targetRaw as Record<string, unknown>;
      const kind = t.kind;
      if (kind !== 'form' && kind !== 'list' && kind !== 'entry') {
        throw new Error("target.kind 必填，且必须是 'form' / 'list' / 'entry'");
      }
      let target: { kind: 'form' } | { kind: 'list' } | { kind: 'entry'; entityKey: string };
      if (kind === 'form') {
        target = { kind: 'form' };
      } else if (kind === 'list') {
        target = { kind: 'list' };
      } else {
        const entityKey = t.entityKey;
        if (typeof entityKey !== 'string' || entityKey.trim() === '') {
          throw new Error("target.kind='entry' 时 target.entityKey 必填非空");
        }
        target = { kind: 'entry', entityKey: entityKey.trim() };
      }

      // Pre-flight: verify boundOperationKey exists, pick up its name.
      // Failing here avoids shipping a save that the bridge will reject and
      // gives the agent a clear actionable error.
      const list = await c.listOperations(extensionFid);
      const op = list.operations.find((o) => o.operationKey === boundOperationKey);
      if (!op) {
        throw new Error(
          `boundOperationKey "${boundOperationKey}" 在扩展 ${extensionFid} 上不存在；先用 k3cloud_add_custom_operation 创建该操作`
        );
      }

      const buttonId = compactGuid(); // 32-hex
      const barDataManagerId = randomUUID(); // dashed
      const formBusinessServiceId = randomUUID(); // dashed
      const barItemLinkId = randomUUID(); // dashed

      const result = await c.addToolbarButton({
        extensionFid,
        target,
        buttonKey,
        buttonId,
        caption,
        seq,
        boundOperationKey,
        boundOperationName: op.operationName ?? boundOperationKey,
        toolbarKey,
        barDataManagerId,
        formBusinessServiceId,
        barItemLinkId
      });

      return JSON.stringify(
        {
          ok: true,
          buttonKey: result.buttonKey,
          buttonId,
          barDataManagerId,
          formBusinessServiceId,
          barItemLinkId,
          message:
            `按钮 ${result.buttonKey} 已添加，绑到操作 ${boundOperationKey}。` +
            'BOS Designer 工具栏点刷新即可看到；客户端运行时通常需关闭客户端重登录（缓存）。'
        },
        null,
        2
      );
    }
  };
}

/**
 * k3cloud_delete_toolbar_button — remove a BarButtonItem + paired BarItemLink
 * by buttonKey. Bridge walks every appearance's Menu/BarDataManager so the
 * caller doesn't have to know whether the button lived on form-level vs
 * entry-level toolbar.
 */
export function deleteToolbarButtonTool(c: K3CloudConnector): ToolHandler {
  return {
    definition: {
      name: 'k3cloud_delete_toolbar_button',
      description:
        '按 buttonKey 删除扩展上的一个工具栏按钮（连带删除其 BarItemLink）。' +
        '\n\nbridge 会遍历所有 Appearance（form 顶层 + 每个 entry）找到该按钮，调用方不必知道按钮原本挂在 form 还是 entry。' +
        '\n\n**写路径**：触发 SaveForIDEV9。',
      parameters: {
        type: 'object',
        properties: {
          extensionFid: {
            type: 'string',
            description: '扩展 FID（GUID）。'
          },
          buttonKey: {
            type: 'string',
            description: '要删除的按钮 key（C 标识符）。'
          }
        },
        required: ['extensionFid', 'buttonKey']
      }
    },
    async execute(args) {
      const extensionFid = requireString(args, 'extensionFid');
      const buttonKey = requireIdentifier(args, 'buttonKey');
      await c.removeToolbarButton(extensionFid, buttonKey);
      return JSON.stringify({ ok: true, buttonKey }, null, 2);
    }
  };
}
