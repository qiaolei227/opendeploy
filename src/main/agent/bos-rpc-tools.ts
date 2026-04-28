/**
 * Agent tools that drive K/3 Cloud BOS write operations through the same
 * HTTP RPC path BOS Designer uses (`*.common.kdsvc`). Replaces the SQL-direct
 * `bos-write-tools.ts` that was deleted in commit 029bacf — that route hit a
 * wall reverse-engineering BOS's internal SaveV9 XML generation
 * (BasePropertyField + base-data fields kept producing subtle bugs no matter
 * how many times we tried).
 *
 * Architecture:
 *   Tool input → BosSessionManager.getOrLogin(projectId)  // cached session
 *              → rpc/{save-for-ide,delete-extension}.ts   // typed RPC call
 *              → server returns IDEOperateResult / void   // typed result
 *              → tool formats user-friendly JSON
 *
 * No SQL writes — everything that used to be a transactional INSERT batch is
 * now a single `SaveForIDEV9` call. The server handles all the
 * T_META_* table mutations internally; our job is only to build the right
 * DCXML delta + paras envelope (rpc/dcxml.ts + rpc/save-for-ide.ts).
 */

import type { ToolHandler } from './tools';
import type { K3CloudConnector } from '../erp/k3cloud/connector';
import { getActiveConnector, getConnectionState } from '../erp/active';
import { createLogger } from '../logger';
import { bosSessionManager } from '../erp/k3cloud/rpc/session-manager';
import { deleteExtension as deleteExtensionRpc } from '../erp/k3cloud/rpc/delete-extension';
import { saveExtension as saveExtensionRpc } from '../erp/k3cloud/rpc/save-for-ide';
import { extractLayoutInfoOid } from '../erp/k3cloud/rpc/layout-discovery';
import { newCompactGuid } from '../erp/k3cloud/rpc/dcxml';
import { extractExistingExtensionElements } from '../erp/k3cloud/rpc/existing-elements';
import { parseAppearanceGeometry } from '../erp/k3cloud/fkernel-parsers';
import { saveEnumObject, type EnumItemInput } from '../erp/k3cloud/rpc/save-enum-object';
import {
  addEnumObjectToRecycle,
  updateMetaCacheByEnumTypeId,
} from '../erp/k3cloud/rpc/enum-objects';
import type {
  BosFieldAppearance,
  BosFieldElement,
  BosPluginElement,
  SaveExtensionRequest,
} from '../erp/k3cloud/rpc/types';
import { getProject } from '../projects/store';
import type { ObjectMeta, Project } from '@shared/erp-types';
import type { ExistingExtensionElements } from '../erp/k3cloud/rpc/existing-elements';

const log = createLogger('bos-rpc-tools');

/**
 * Build the BOS RPC tool set for the current active project. Empty when:
 *   - No project is connected — agent doesn't see write tools, so it won't
 *     promise writes that can't execute.
 *   - The active project has no `bos` field — same reason; user has to set
 *     up creds before agent can write. (We could surface a stub tool that
 *     errors at call time, but hiding is cleaner: the agent doesn't get
 *     to think writes are available when they're not.)
 *
 * `connector`, `projectId`, and `sessionMgr` injectable for tests.
 */
export async function buildBosRpcTools(
  connector?: K3CloudConnector,
  projectId?: string,
  sessionMgr = bosSessionManager,
): Promise<ToolHandler[]> {
  const c = connector ?? getActiveConnector();
  if (!c) return [];
  const pid = projectId ?? getConnectionState().projectId;
  if (!pid) return [];
  // Only expose write tools when the active project has BOS creds — keeps
  // the agent's tool list honest about what's actually available.
  const project = await getProject(pid).catch(() => null);
  if (!project?.bos) return [];

  return [
    createExtensionTool(c, pid, sessionMgr),
    addFieldsTool(c, pid, sessionMgr),
    registerPythonPluginsTool(c, pid, sessionMgr),
    deleteExtensionTool(pid, sessionMgr),
    createEnumTypeTool(c, pid, sessionMgr),
    deleteEnumTypeTool(c, pid, sessionMgr),
  ];
}

// ─── Individual tools ─────────────────────────────────────────────────

interface SessionMgrLike {
  getOrLogin(projectId: string): Promise<import('../erp/k3cloud/rpc/http-client').KdSession>;
  invalidate(projectId: string): void;
}

/**
 * Reject duplicate keys in a batch of items so a partial save never happens.
 * BOS would silently keep one copy on the server otherwise — confusing.
 */
function rejectDuplicates<T>(items: T[], keyOf: (t: T) => string, label: string): void {
  const seen = new Set<string>();
  for (const it of items) {
    const k = keyOf(it);
    if (seen.has(k)) {
      throw new Error(`${label} 中存在重复的 "${k}",请合并或区分。`);
    }
    seen.add(k);
  }
}

/**
 * Translate a class of friendly references on a batch of field args into
 * resolved server GUIDs. Shared by base_data/unit (lookup-class) and combo
 * (enum-type) translation — both have identical shape: filter by predicate,
 * extract the friendly name, resolve via cache, throw with index/key context
 * on miss, write resolved id back.
 */
async function translateFriendlyRefs(
  fields: AddFieldArgs[],
  match: (f: AddFieldArgs) => boolean,
  extractName: (f: AddFieldArgs) => string | undefined,
  resolve: (name: string) => Promise<{ id: string } | null>,
  apply: (f: AddFieldArgs, id: string) => void,
  errors: {
    missingName: (idx: number, fa: AddFieldArgs) => string;
    notFound: (idx: number, fa: AddFieldArgs, name: string) => string;
  },
): Promise<void> {
  for (let i = 0; i < fields.length; i++) {
    const fa = fields[i];
    if (!match(fa)) continue;
    const name = extractName(fa)?.trim();
    if (!name) throw new Error(errors.missingName(i, fa));
    const r = await resolve(name);
    if (!r) throw new Error(errors.notFound(i, fa, name));
    apply(fa, r.id);
  }
}

interface ExtensionForSave {
  ext: ObjectMeta;
  project: NonNullable<Project['bos']>;
  layoutInfoOid: string;
  existing: ExistingExtensionElements;
  /** Parent FKERNELXML — null when caller passed a layoutInfoOid override
   * (we skip the parent fetch in that case). Used by placement to find the
   * rightmost edge of original-vendor fields in a given container. */
  parentKernelXml: string | null;
  /** Extension's own FKERNELXML — null on first-save (no rows yet). Used by
   * placement to stack new fields below previously added extension fields. */
  extKernelXml: string | null;
}

/**
 * Shared prelude for both `kingdee_add_fields` and `kingdee_register_python_plugins`:
 * resolve the active project's BOS creds, validate the target extension, discover
 * the parent's layoutInfoOid, and read the extension's current FKERNELXML to
 * extract existing fields/appearances/plugins (the read-merge baseline-diff
 * requirement). Parent + extension XML reads run in parallel.
 *
 * `toolName` parameterizes the tool-specific Chinese error messages.
 */
async function loadExtensionForSave(
  connector: K3CloudConnector,
  projectId: string,
  extId: string,
  toolName: string,
  layoutInfoOidOverride?: string,
): Promise<ExtensionForSave> {
  const project = await getProject(projectId);
  if (!project?.bos) {
    throw new Error('当前项目未配置 BOS 写入凭据,请到项目设置中补全。');
  }

  const ext = await connector.getObject(extId);
  if (!ext) {
    throw new Error(`扩展 ${extId} 不存在。先用 kingdee_list_extensions 确认。`);
  }
  if (!ext.baseObjectId) {
    throw new Error(
      `${extId} 不是 BOS 扩展(FBASEOBJECTID 为空)。${toolName} 只能用于扩展,不能直接改原厂表单。`,
    );
  }
  if (ext.modelTypeId == null || ext.subsystemId == null) {
    throw new Error(
      `扩展 ${extId} 元数据不完整(modelTypeId=${ext.modelTypeId}, subsystemId=${ext.subsystemId})。`,
    );
  }

  // Parent and extension kernel XML are independent; fetch in parallel.
  const override = layoutInfoOidOverride?.trim();
  const [parentXml, extXml] = await Promise.all([
    override ? Promise.resolve(null) : connector.getKernelXml(ext.baseObjectId),
    connector.getKernelXml(extId),
  ]);

  let layoutInfoOid = override ?? '';
  if (!layoutInfoOid) {
    if (!parentXml) {
      throw new Error(`父单据 ${ext.baseObjectId} 无 FKERNELXML,无法自动发现 layoutInfoOid。`);
    }
    const oid = extractLayoutInfoOid(parentXml);
    if (!oid) {
      throw new Error(
        `父单据 ${ext.baseObjectId} FKERNELXML 中未找到 <LayoutInfo oid="...">,请手动指定 layoutInfoOid。`,
      );
    }
    layoutInfoOid = oid;
  }

  const existing = extXml
    ? extractExistingExtensionElements(extXml)
    : { fields: [], appearances: [], plugins: [] };

  return {
    ext,
    project: project.bos,
    layoutInfoOid,
    existing,
    parentKernelXml: parentXml,
    extKernelXml: extXml,
  };
}

// ─── Placement engine ──────────────────────────────────────────────────

const COLUMN_WIDTH = 280; // total cell incl. label + control + gap
const ROW_HEIGHT = 28; // typical BOS form row pitch
const GUTTER = 20; // gap between original layout and our column
const FALLBACK_LEFT = 1100; // for narrow base-data forms with no head fields

/**
 * Compute the starting (left, top) for a batch of new fields in a given
 * container. Strategy: place them as a single column just past the rightmost
 * edge of original-vendor *fields* in that container (region/tab/sub-head
 * appearances are excluded — they carry container-wide bounding boxes that
 * would inflate maxRight far past where actual fields paint).
 *
 *   left = (any field appearance found) ? maxRight + GUTTER : FALLBACK_LEFT
 *   top  = (any extension field exists) ? maxTop + ROW_HEIGHT : 0
 *
 * `parentKernelXml === null` means caller overrode layoutInfoOid; falls back
 * to FALLBACK_LEFT in that case.
 */
function isFieldAppearanceTag(tag: string): boolean {
  // *FieldAppearance suffix covers TextFieldAppearance / BaseDataFieldAppearance /
  // BillNoFieldAppearance / DateFieldAppearance / CheckBoxFieldAppearance / ...
  // Excludes SubHeadEntityAppearance / HeadEntityAppearance / TabControlAppearance /
  // TabPageAppearance / FormAppearance / WaterMarkAppearance / RegionAppearance.
  return /FieldAppearance$/.test(tag);
}

function computePlacementOrigin(
  container: string,
  parentKernelXml: string | null,
  extKernelXml: string | null,
): { left: number; top: number } {
  const containerLc = container.toLowerCase();

  let parentMaxRight = 0;
  if (parentKernelXml) {
    for (const g of parseAppearanceGeometry(parentKernelXml)) {
      if (g.container.toLowerCase() !== containerLc) continue;
      if (!isFieldAppearanceTag(g.tag)) continue;
      const right = g.left + g.width;
      if (right > parentMaxRight) parentMaxRight = right;
    }
  }

  let extMaxTop = -1; // -1 sentinel — distinguishes "no fields yet" from top=0
  if (extKernelXml) {
    for (const g of parseAppearanceGeometry(extKernelXml)) {
      if (g.container.toLowerCase() !== containerLc) continue;
      if (!isFieldAppearanceTag(g.tag)) continue;
      if (g.top > extMaxTop) extMaxTop = g.top;
    }
  }

  // If the parent has *any* field appearance in this container, hug its right
  // edge (so the column adapts to the form's actual width). Only use the
  // fallback when there's nothing to hug — typical for empty/skeleton
  // metadata or an extension targeting a container the parent doesn't paint
  // into.
  const left = parentMaxRight > 0 ? parentMaxRight + GUTTER : FALLBACK_LEFT;
  // First field starts at the very top of the container when nothing is
  // there yet. Stacking below previous extension fields keeps batches from
  // overlapping.
  const top = extMaxTop >= 0 ? extMaxTop + ROW_HEIGHT : 0;
  return { left, top };
}

function createExtensionTool(
  connector: K3CloudConnector,
  projectId: string,
  sessionMgr: SessionMgrLike,
): ToolHandler {
  return {
    definition: {
      name: 'kingdee_create_extension',
      description:
        '在 K/3 Cloud 上为指定父单据(原厂表单)新建一个 BOS 扩展。扩展是在父对象上挂字段 / 插件 / 业务规则等定制内容的容器,本身不带任何字段或插件。\n' +
        '\n创建后调用方拿到的 `extId` 用于后续:\n' +
        '- `kingdee_add_fields` 批量添加扩展字段(数组,一次保存)\n' +
        '- `kingdee_register_python_plugins` 批量挂 Python 表单插件(数组,一次保存)\n' +
        '- `kingdee_delete_extension` 不要时整个删掉\n' +
        '\n创建前**先调 `kingdee_list_extensions <parentFormId>`** 看是否已有可复用的扩展(同一父单据上多个扩展会变 BOS Designer 的负担)。' +
        '`layoutInfoOid` 通常会自动从父单据的元数据里查出来,只在自动发现失败时才手动传。',
      parameters: {
        type: 'object',
        properties: {
          parentFormId: {
            type: 'string',
            description: '原厂父单据 FormID,如 "SAL_SaleOrder"(销售订单)、"BD_MATERIAL"(物料)。',
          },
          extName: {
            type: 'string',
            description: '扩展中文名,描述业务意图,例如 "信用额度预警"。客户在 BOS Designer 中能看到。',
          },
          layoutInfoOid: {
            type: 'string',
            description:
              '(可选)父单据的主布局视图 OID(8-4-4-4-12 格式 GUID)。一般从父对象 FKERNELXML 自动发现,只在自动发现失败时才传。',
          },
        },
        required: ['parentFormId', 'extName'],
      },
    },
    async execute(args) {
      const parentFormId = String(args.parentFormId ?? '').trim();
      const extName = String(args.extName ?? '').trim();
      if (!parentFormId) throw new Error('kingdee_create_extension 需要 parentFormId 参数。');
      if (!extName) throw new Error('kingdee_create_extension 需要 extName 参数。');

      const project = await getProject(projectId);
      if (!project?.bos) {
        throw new Error('当前项目未配置 BOS 写入凭据,请到项目设置中补全。');
      }

      // Look up parent's modelTypeId / subsystemId — both required by
      // SaveForIDEV9 paras. Returns null when the form doesn't exist.
      const parent = await connector.getObject(parentFormId);
      if (!parent) {
        throw new Error(`父单据 ${parentFormId} 不存在。请先用 kingdee_search_metadata 确认 FormID 拼写。`);
      }
      if (parent.modelTypeId == null || parent.subsystemId == null) {
        throw new Error(
          `父单据 ${parentFormId} 元数据不完整(modelTypeId=${parent.modelTypeId}, subsystemId=${parent.subsystemId}),无法创建扩展。`,
        );
      }

      // Discover layoutInfoOid from parent FKERNELXML unless agent overrode.
      let layoutInfoOid = typeof args.layoutInfoOid === 'string' ? args.layoutInfoOid.trim() : '';
      if (!layoutInfoOid) {
        const xml = await connector.getKernelXml(parentFormId);
        if (!xml) {
          throw new Error(`父单据 ${parentFormId} 无 FKERNELXML,无法自动发现 layoutInfoOid。`);
        }
        const oid = extractLayoutInfoOid(xml);
        if (!oid) {
          throw new Error(
            `父单据 ${parentFormId} FKERNELXML 中未找到 <LayoutInfo oid="...">,请手动指定 layoutInfoOid 参数。`,
          );
        }
        layoutInfoOid = oid;
      }

      const formId = newCompactGuid();
      const req: SaveExtensionRequest = {
        extension: {
          formId,
          baseObjectId: parentFormId,
          modelTypeId: parent.modelTypeId,
          subSystemId: parent.subsystemId,
          name: [{ localeId: 2052, value: extName }],
          isv: { devCode: project.bos.devCode },
        },
        isNew: true,
        layoutInfoOid,
      };

      const session = await sessionMgr.getOrLogin(projectId);
      const result = await saveExtensionRpc(session, req);

      if (!result.isSuccess) {
        return JSON.stringify(
          {
            ok: false,
            parentFormId,
            extName,
            messageTitle: result.messageTitle,
            messageDetail: result.messageDetail,
            hint: '服务端拒绝了创建。看 messageDetail 里的具体原因。',
          },
          null,
          2,
        );
      }

      return JSON.stringify(
        {
          ok: true,
          extId: formId,
          parentFormId,
          extName,
          layoutInfoOid,
          reminder:
            '扩展已创建。后续添加字段 / 插件请把上面的 extId 传给 kingdee_add_fields / kingdee_register_python_plugins(都接数组,一次保存里把要加的全部传进来,不要拆多次)。' +
            'BOS Designer 中需点工具栏刷新按钮才能在扩展列表里看到新建的扩展。',
        },
        null,
        2,
      );
    },
  };
}

function deleteExtensionTool(projectId: string, sessionMgr: SessionMgrLike): ToolHandler {
  return {
    definition: {
      name: 'kingdee_delete_extension',
      description:
        '彻底删除一个 BOS 扩展 — 调用 K/3 Cloud 服务端的 Delete RPC,服务端会清掉 ' +
        'T_META_OBJECTTYPE + 名称扩展 + 引用克隆 + 跟踪表等所有相关行,以及该扩展上的字段 / 插件。\n' +
        '\n**用户想删扩展时永远走这个工具,不要让用户去 BOS Designer 手工删** — Designer ' +
        '里删会触发 SVN 同步检查,撞 "local modifications" 卡死(详见 memory ' +
        '`bos_designer_svn_kills_delete`)。本工具走原厂 RPC,绕开 SVN 路径。',
      parameters: {
        type: 'object',
        properties: {
          extId: {
            type: 'string',
            description: '要删除的扩展 FID(32 位 hex GUID,无连字符)。',
          },
        },
        required: ['extId'],
      },
    },
    async execute(args) {
      const extId = String(args.extId ?? '').trim();
      if (!extId) {
        throw new Error('kingdee_delete_extension 需要 extId 参数。');
      }
      const project = await getProject(projectId);
      if (!project?.bos) {
        throw new Error('当前项目未配置 BOS 写入凭据,请到项目设置中补全。');
      }
      const session = await sessionMgr.getOrLogin(projectId);
      const result = await deleteExtensionRpc(session, extId, { devCode: project.bos.devCode });

      if (!result.ok) {
        // Server-side failure — surface message verbatim so the user / agent
        // can see what went wrong (e.g. extension already deleted, FID
        // doesn't exist, permission denied).
        return JSON.stringify(
          {
            ok: false,
            extId,
            message: result.message,
            responseBody: result.responseBody,
          },
          null,
          2,
        );
      }

      return JSON.stringify(
        {
          ok: true,
          extId,
          reminder:
            '扩展已从服务端删除。客户端 BOS Designer 中的扩展列表需点工具栏刷新按钮才能更新;' +
            '已打开的客户端表单缓存可能需关闭客户端重登才能消失。',
        },
        null,
        2,
      );
    },
  };
}

// ─── kingdee_add_fields ──────────────────────────────────────────────────
//
// Batch + read-merge: the tool accepts an array of fields and writes them in
// ONE SaveForIDEV9 call. Before calling Save, it reads the extension's current
// FKERNELXML and re-includes every existing field/appearance/plugin in the
// DCXML, because BOS treats DCXML as a baseline diff (the extension's complete
// set of mods on top of parent) — anything missing from the diff gets rolled
// back. See memory `bos_save_for_ide_v9_wire_format.md`.
//
// Friendly type names → BOS RPC element types. The agent picks the friendly
// name; this map keeps the BOS internals out of the tool's parameter schema.

const FRIENDLY_TYPES = [
  'text',
  'int',
  'date',
  'decimal',
  'price',
  'amount',
  'qty',
  'checkbox',
  'combo',
  'base_data',
  'base_property',
  'unit',
] as const;
type FriendlyFieldType = (typeof FRIENDLY_TYPES)[number];

const DEFAULT_LIST_TAB_INDEX_BASE = 9000;
const DEFAULT_CONTAINER = 'FTAB_P0';

interface AddFieldArgs {
  extId: string;
  type: FriendlyFieldType;
  key: string;
  caption: string;
  // Numeric-typed extras
  fieldScale?: number;
  fieldPrecision?: number;
  // QtyField extras
  controlFieldKey?: string;
  // BaseDataField extras
  refBaseDataObjectKey?: string;
  srcFindFieldName?: string;
  srcDisplayFieldName?: string;
  // BasePropertyField extras (sourceField = parent base data field key)
  sourceField?: string;
  // UnitField extras
  unitTypeKey?: string;
  // ComboField extras: agent passes friendly enum name; tool translates to GUID.
  enumTypeName?: string;
  // ComboField — final GUID after translation (don't accept from agent input).
  enumTypeId?: string;
  defaultCondition?: number;
  // Layout extras
  container?: string;
  top?: number;
  left?: number;
  width?: number;
  labelWidth?: number;
  zOrderIndex?: number;
  tabindex?: number;
  listTabIndex?: number;
  // Optional layout override (rare)
  layoutInfoOid?: string;
}

function buildFieldElement(args: AddFieldArgs): BosFieldElement {
  const { type, key, caption, listTabIndex } = args;
  const lti = listTabIndex ?? DEFAULT_LIST_TAB_INDEX_BASE;
  switch (type) {
    case 'text':
      return { type: 'TextField', key, caption, listTabIndex: lti };
    case 'int':
      return { type: 'IntegerField', key, caption, listTabIndex: lti };
    case 'date':
      return { type: 'DateField', key, caption, listTabIndex: lti };
    case 'decimal':
      return {
        type: 'DecimalField',
        key,
        caption,
        listTabIndex: lti,
        fieldScale: args.fieldScale ?? 2,
        fieldPrecision: args.fieldPrecision ?? 23,
      };
    case 'price':
      return {
        type: 'PriceField',
        key,
        caption,
        listTabIndex: lti,
        fieldScale: args.fieldScale ?? 4,
        fieldPrecision: args.fieldPrecision ?? 23,
      };
    case 'amount':
      return {
        type: 'AmountField',
        key,
        caption,
        listTabIndex: lti,
        fieldScale: args.fieldScale ?? 2,
        fieldPrecision: args.fieldPrecision ?? 23,
      };
    case 'qty':
      if (!args.controlFieldKey) {
        throw new Error('qty 字段必须指定 controlFieldKey(关联的 UnitField key)。');
      }
      return {
        type: 'QtyField',
        key,
        caption,
        listTabIndex: lti,
        fieldScale: args.fieldScale ?? 6,
        fieldPrecision: args.fieldPrecision ?? 23,
        controlFieldKey: args.controlFieldKey,
      };
    case 'checkbox':
      return { type: 'CheckBoxField', key, caption, listTabIndex: lti };
    case 'combo':
      // enumTypeId is the resolved GUID by this point (translated upstream
      // by addFieldsTool from args.enumTypeName via the connector cache).
      if (!args.enumTypeId) {
        throw new Error(
          'combo 字段缺少 enum-type GUID(translation step missing)。',
        );
      }
      return {
        type: 'ComboField',
        key,
        caption,
        listTabIndex: lti,
        enumTypeId: args.enumTypeId,
        defaultCondition: args.defaultCondition,
      };
    case 'base_data':
      if (!args.refBaseDataObjectKey) {
        throw new Error('base_data 字段必须指定 refBaseDataObjectKey(基础资料 FormID,如 BD_Customer)。');
      }
      return {
        type: 'BaseDataField',
        key,
        caption,
        listTabIndex: lti,
        lookUpObjectId: args.refBaseDataObjectKey,
        srcFindFieldName: args.srcFindFieldName,
        srcDisplayFieldName: args.srcDisplayFieldName,
      };
    case 'base_property':
      if (!args.sourceField) {
        throw new Error('base_property 字段必须指定 sourceField(同单据上的源 BaseDataField key)。');
      }
      return {
        type: 'BasePropertyField',
        key,
        caption,
        listTabIndex: lti,
        controlFieldKey: args.sourceField,
        srcDisplayFieldName: args.srcDisplayFieldName,
      };
    case 'unit':
      // refBaseDataObjectKey is the resolved GUID by this point (translated
      // upstream by addFieldsTool). unitTypeKey defaults to "1" matching
      // every captured BOS Designer UnitField in 2026-04-27 traces.
      if (!args.refBaseDataObjectKey) {
        throw new Error('unit 字段缺少 lookup-class GUID(translation step missing)。');
      }
      return {
        type: 'UnitField',
        key,
        caption,
        listTabIndex: lti,
        unitTypeKey: args.unitTypeKey ?? '1',
        lookUpObjectId: args.refBaseDataObjectKey,
      };
  }
}

function buildAppearance(args: AddFieldArgs, elementType: BosFieldElement['type']): BosFieldAppearance {
  // left/top are populated upstream by the placement engine in
  // addFieldsTool.execute (or by an explicit user override). They MUST be
  // set by the time we reach here — leaving them undefined would emit an
  // appearance node missing geometry, which BOS treats as 0/0 and renders
  // unusable. Coerce to 0 if absent so the bug is at least diagnosable.
  return {
    type: elementType,
    key: args.key,
    caption: args.caption,
    container: args.container ?? DEFAULT_CONTAINER,
    zOrderIndex: args.zOrderIndex ?? 99,
    tabindex: args.tabindex ?? args.listTabIndex ?? DEFAULT_LIST_TAB_INDEX_BASE,
    left: args.left ?? 0,
    top: args.top ?? 0,
    width: args.width,
    labelWidth: args.labelWidth,
  };
}

function coerceFieldArgs(raw: Record<string, unknown>, idx: number): AddFieldArgs {
  const type = String(raw.type ?? '') as FriendlyFieldType;
  const key = String(raw.key ?? '').trim();
  const caption = String(raw.caption ?? '').trim();
  if (!FRIENDLY_TYPES.includes(type)) {
    throw new Error(
      `fields[${idx}]: 不支持的字段类型 "${type}"。可选: ${FRIENDLY_TYPES.join(' / ')}。`,
    );
  }
  if (!key) throw new Error(`fields[${idx}]: 缺少 key 参数。`);
  if (!caption) throw new Error(`fields[${idx}]: 缺少 caption 参数。`);
  return {
    extId: '', // not used by buildFieldElement / buildAppearance
    type,
    key,
    caption,
    fieldScale: raw.fieldScale != null ? Number(raw.fieldScale) : undefined,
    fieldPrecision: raw.fieldPrecision != null ? Number(raw.fieldPrecision) : undefined,
    controlFieldKey: raw.controlFieldKey != null ? String(raw.controlFieldKey) : undefined,
    refBaseDataObjectKey:
      raw.refBaseDataObjectKey != null ? String(raw.refBaseDataObjectKey) : undefined,
    srcFindFieldName:
      raw.srcFindFieldName != null ? String(raw.srcFindFieldName) : undefined,
    srcDisplayFieldName:
      raw.srcDisplayFieldName != null ? String(raw.srcDisplayFieldName) : undefined,
    sourceField: raw.sourceField != null ? String(raw.sourceField) : undefined,
    unitTypeKey: raw.unitTypeKey != null ? String(raw.unitTypeKey) : undefined,
    enumTypeName: raw.enumTypeName != null ? String(raw.enumTypeName) : undefined,
    defaultCondition: raw.defaultCondition != null ? Number(raw.defaultCondition) : undefined,
    container: raw.container != null ? String(raw.container) : undefined,
    top: raw.top != null ? Number(raw.top) : undefined,
    left: raw.left != null ? Number(raw.left) : undefined,
    width: raw.width != null ? Number(raw.width) : undefined,
    labelWidth: raw.labelWidth != null ? Number(raw.labelWidth) : undefined,
    zOrderIndex: raw.zOrderIndex != null ? Number(raw.zOrderIndex) : undefined,
    tabindex: raw.tabindex != null ? Number(raw.tabindex) : undefined,
    listTabIndex: raw.listTabIndex != null ? Number(raw.listTabIndex) : undefined,
  };
}

function addFieldsTool(
  connector: K3CloudConnector,
  projectId: string,
  sessionMgr: SessionMgrLike,
): ToolHandler {
  return {
    definition: {
      name: 'kingdee_add_fields',
      description:
        '一次性给已有 BOS 扩展批量加字段。**所有这次要加的字段都放进 fields 数组里,一个工具调用搞定** — ' +
        'BOS 服务端把每次 Save 当成扩展的"完整差异"应用,所以拆成多次 add 后一次会覆盖前一次,只剩最后一个字段。' +
        '本工具内部会读现有字段并合入,所以**之后再加字段也用本工具,把新字段放进 fields 数组里就行**(只传 1 个也合法,但要尽量批量)。' +
        '\n\n字段类型(`type` 参数,每个 field 必填):' +
        '\n- text — 单行文本' +
        '\n- int — 整数' +
        '\n- decimal — 小数(可选 fieldScale / fieldPrecision)' +
        '\n- price — 单价' +
        '\n- amount — 金额' +
        '\n- qty — 数量(必带 controlFieldKey 指向同单据上的 UnitField)' +
        '\n- date — 日期 / 日期时间' +
        '\n- checkbox — 复选框' +
        '\n- combo — 下拉(必带 enumTypeName,如 "审核状态" / "单据状态" / "是否启用" / 客户自建枚举名;**用前先调 kingdee_list_enum_types** 找现成的枚举,工具内部翻成 GUID。要全新枚举请用 kingdee_create_enum_type 先建好再来引用)' +
        '\n- base_data — 基础资料引用(必带 refBaseDataObjectKey,传 friendly FormID 即可如 "BD_Customer" / "BD_MATERIAL" / "BD_Department",工具自动翻成内部 GUID。可选 srcFindFieldName / srcDisplayFieldName)' +
        '\n- base_property — 基础资料属性带值(必带 sourceField 指向同单据已有的 BaseDataField key,如 "FCustId";可选 srcDisplayFieldName 选源字段名,如 "FName")。**用前先调 kingdee_describe_basedata** 反查目标基础资料能 srcDisplay 哪些字段。' +
        '\n- unit — 计量单位(默认引用 `BD_UNIT` 标准单位表,99% 场景不用传任何额外参数。罕见需要换单位字典时可传 `refBaseDataObjectKey` 指向其他单位 lookup;高级:`unitTypeKey` 默认 "1" 一般不动)' +
        '\n\n**自动排版**:本工具会读父对象布局算出目标容器里原厂字段最右边界,把新字段竖向排列在那右侧一列,' +
        '多次调用会接着前次的字段往下顺排,无需手传坐标。窄基础资料表(无原厂头字段时)默认 left=1100 兜底,可能在窄表上偏右,需要时传 left/top 显式指定。' +
        '\n\n**写入后必反查闭环**:调 `kingdee_get_extension_fields <extId>` 验证字段都已落库;' +
        '不要用 `kingdee_get_fields`(那个只看父对象的原厂字段,扩展字段永远查不到)。' +
        '\n\n**关于容器选择**(重要):头页签 / 单据体多个时**调用本工具前必须先 `kingdee_get_form_layout`** 看清父对象有几个 tab、几个 entry,把选项列给用户,让用户选具体 container,然后传 `container` 参数(每个 field 单独传)。不要默认 FTAB_P0 直接写。',
      parameters: {
        type: 'object',
        properties: {
          extId: { type: 'string', description: '扩展 FID(32 位 hex GUID)。' },
          fields: {
            type: 'array',
            minItems: 1,
            description:
              '本次保存里要加的所有字段。原子提交:全成功或全失败。再要加更多字段就再调一次本工具(传新字段进 fields,旧字段会自动保留)。',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: [...FRIENDLY_TYPES], description: '字段类型。' },
                key: {
                  type: 'string',
                  description:
                    '字段 Key, 如 "F_PAIJ_CreditWarn"。BOS 约定 F_ 开头, 仅字母 / 数字 / 下划线。',
                },
                caption: {
                  type: 'string',
                  description: '中文显示标签, 如 "信用额度预警"。',
                },
                fieldScale: { type: 'number', description: '(decimal/price/amount/qty)小数位数。' },
                fieldPrecision: { type: 'number', description: '(decimal/price/amount/qty)总位数。' },
                controlFieldKey: { type: 'string', description: '(qty)关联的 UnitField key。' },
                refBaseDataObjectKey: {
                  type: 'string',
                  description:
                    '(base_data 必填 / unit 可选默认 BD_UNIT)关联基础资料 friendly FormID,如 "BD_Customer" / "BD_MATERIAL" / "BD_Department" / "BD_UNIT"。工具自动翻成内部 GUID,大小写不敏感。',
                },
                srcFindFieldName: {
                  type: 'string',
                  description: '(base_data 可选)源对象查找字段名,默认 "FNUMBER"。',
                },
                srcDisplayFieldName: {
                  type: 'string',
                  description: '(base_data 可选 / base_property 推荐)源字段显示名,默认 "FNAME"。',
                },
                sourceField: {
                  type: 'string',
                  description: '(base_property 必填)同单据已有的 BaseDataField key,如 "FCustId"。',
                },
                unitTypeKey: {
                  type: 'string',
                  description:
                    '(unit 可选,默认 "1")单位类型代码。99% 场景留空。',
                },
                enumTypeName: {
                  type: 'string',
                  description:
                    '(combo 必填)下拉枚举的友好名,如 "审核状态" / "单据状态" / "是否启用"。工具自动翻成 GUID,大小写不敏感。**先调 kingdee_list_enum_types 找有哪些可用**。',
                },
                defaultCondition: {
                  type: 'number',
                  description: '(combo 可选)枚举的默认值代码,默认 0。',
                },
                container: {
                  type: 'string',
                  description:
                    '(强烈推荐先调 kingdee_get_form_layout 选)容器 key,如 "FTAB_P0"(基本信息)、"FTAB_P1"(其他头页签)、"FSaleOrderEntry"(明细单据体)。默认 "FTAB_P0"。',
                },
                top: { type: 'number', description: '(可选)Top 像素。留空则自动排版,顺排在前一字段下面一行。' },
                left: { type: 'number', description: '(可选)Left 像素。留空则自动排版,贴在原厂字段右侧。' },
                width: { type: 'number', description: '(可选)控件宽度像素,默认 300。' },
                labelWidth: { type: 'number', description: '(可选)标签宽度像素,默认 100。' },
                zOrderIndex: { type: 'number', description: '(可选)容器内排序,默认 99。' },
                tabindex: { type: 'number', description: '(可选)tab 顺序,默认 9000。' },
                listTabIndex: { type: 'number', description: '(可选)列表序号,默认 9000。' },
              },
              required: ['type', 'key', 'caption'],
            },
          },
          layoutInfoOid: {
            type: 'string',
            description: '(高级)父单据布局 OID,通常自动发现,只在自动发现失败时手传。',
          },
        },
        required: ['extId', 'fields'],
      },
    },
    async execute(args) {
      const extId = String(args.extId ?? '').trim();
      if (!extId) throw new Error('kingdee_add_fields 需要 extId 参数。');
      const rawFields = args.fields;
      if (!Array.isArray(rawFields) || rawFields.length === 0) {
        throw new Error('kingdee_add_fields 需要 fields 参数(至少一个字段的数组)。');
      }
      // Validate each field upfront so a partial save never happens.
      const fieldArgsList: AddFieldArgs[] = rawFields.map((raw, i) =>
        coerceFieldArgs((raw ?? {}) as Record<string, unknown>, i),
      );
      rejectDuplicates(fieldArgsList, (fa) => fa.key, 'fields 的 key');

      const { ext, project, layoutInfoOid, existing, parentKernelXml, extKernelXml } =
        await loadExtensionForSave(
          connector,
          projectId,
          extId,
          'kingdee_add_fields',
          typeof args.layoutInfoOid === 'string' ? args.layoutInfoOid : undefined,
        );

      // Translate friendly basedata FormIds (BD_Customer / BD_UNIT) → lookup-
      // class GUIDs. BOS accepts the save with a friendly key but the runtime
      // form fails to render the lookup ("未正确配置指向的基础资料").
      await translateFriendlyRefs(
        fieldArgsList,
        (fa) => fa.type === 'base_data' || fa.type === 'unit',
        (fa) =>
          fa.refBaseDataObjectKey?.trim() || (fa.type === 'unit' ? 'BD_UNIT' : undefined),
        (name) => connector.resolveLookupClassGuid(name),
        (fa, id) => {
          fa.refBaseDataObjectKey = id;
        },
        {
          missingName: (idx, fa) =>
            `fields[${idx}] (key=${fa.key}): base_data 字段必须指定 refBaseDataObjectKey(基础资料 FormID,如 BD_Customer / BD_MATERIAL)。`,
          notFound: (idx, fa, name) =>
            `fields[${idx}] (key=${fa.key}): 找不到名为 "${name}" 的基础资料。常用的有 BD_Customer / BD_MATERIAL / BD_Department / BD_UNIT。可以先调 kingdee_describe_basedata 反查。`,
        },
      );

      // Translate combo enumTypeName → enumTypeId. BOS expects a T_META_FORMENUM
      // GUID in `<EnumType>`; the friendly name silently breaks at runtime.
      await translateFriendlyRefs(
        fieldArgsList,
        (fa) => fa.type === 'combo',
        (fa) => fa.enumTypeName,
        (name) => connector.resolveEnumTypeGuid(name),
        (fa, id) => {
          fa.enumTypeId = id;
        },
        {
          missingName: (idx, fa) =>
            `fields[${idx}] (key=${fa.key}): combo 字段必须指定 enumTypeName(下拉枚举的友好名,先调 kingdee_list_enum_types 找)。`,
          notFound: (idx, fa, name) =>
            `fields[${idx}] (key=${fa.key}): 找不到名为 "${name}" 的枚举类型。先调 kingdee_list_enum_types 看完整列表(常用的有 审核状态 / 单据状态 / 是否启用 / 优先级)。`,
        },
      );

      // Auto-place fields as a vertical column to the right of the
      // original-vendor layout, grouped by container. Within each container,
      // fields are stacked top-to-bottom one row apart, starting just past
      // the lowest existing extension field in that container so successive
      // batches don't overlap. Agent-supplied top/left always win.
      const originsByContainer = new Map<string, { left: number; top: number }>();
      const cursorTopByContainer = new Map<string, number>();
      for (const fa of fieldArgsList) {
        const cont = fa.container ?? DEFAULT_CONTAINER;
        if (!originsByContainer.has(cont)) {
          originsByContainer.set(
            cont,
            computePlacementOrigin(cont, parentKernelXml, extKernelXml),
          );
        }
        const origin = originsByContainer.get(cont)!;
        const cursorTop = cursorTopByContainer.get(cont) ?? origin.top;
        if (fa.left == null) fa.left = origin.left;
        if (fa.top == null) fa.top = cursorTop;
        cursorTopByContainer.set(cont, cursorTop + ROW_HEIGHT);
      }

      // Build typed AST nodes for the new fields + appearances.
      const newFields: BosFieldElement[] = [];
      const newAppearances: BosFieldAppearance[] = [];
      for (const fa of fieldArgsList) {
        const fel = buildFieldElement(fa);
        newFields.push(fel);
        newAppearances.push(buildAppearance(fa, fel.type));
      }

      const req: SaveExtensionRequest = {
        extension: {
          formId: extId,
          baseObjectId: ext.baseObjectId!,
          modelTypeId: ext.modelTypeId!,
          subSystemId: ext.subsystemId!,
          name: [{ localeId: 2052, value: ext.name }],
          isv: { devCode: project.devCode },
        },
        isNew: false,
        layoutInfoOid,
        existingFieldsRaw: existing.fields,
        existingAppearancesRaw: existing.appearances,
        existingPluginsRaw: existing.plugins,
        addFields: newFields,
        addAppearances: newAppearances,
      };

      const session = await sessionMgr.getOrLogin(projectId);
      const result = await saveExtensionRpc(session, req);

      if (!result.isSuccess) {
        return JSON.stringify(
          {
            ok: false,
            extId,
            attemptedFields: fieldArgsList.map((f) => f.key),
            messageTitle: result.messageTitle,
            messageDetail: result.messageDetail,
          },
          null,
          2,
        );
      }

      return JSON.stringify(
        {
          ok: true,
          extId,
          addedCount: newFields.length,
          fields: newFields.map((f) => ({
            key: f.key,
            type: f.type,
            caption: f.caption,
          })),
          reminder:
            '所有字段已一次性写入。BOS Designer 里需点扩展工具栏的刷新按钮才能看到;客户端表单缓存可能需要关闭客户端重登才会更新。' +
            '**字段已自动排版**:贴在原厂字段最右边界右侧一列,纵向顺排;之后再加字段会接着排到下方,无需拖动。如视觉位置不理想用户可在 BOS Designer 中手动微调。' +
            '验证全部字段已落库:调 kingdee_get_extension_fields(不是 kingdee_get_fields)。',
        },
        null,
        2,
      );
    },
  };
}

// ─── kingdee_register_python_plugins ─────────────────────────────────────
//
// Wire format verified 2026-04-27 capture req-75 + smoke-plugin.ts smoke
// (extId=631a71d7f48249fca4e78daa74e0b925, IsSuccess=true). Plugin lives
// inside `<Form><FormPlugins><PlugIn>...` — see rpc/dcxml.ts emitter.
//
// Batch + read-merge: same baseline-diff issue as kingdee_add_fields. Each
// save's DCXML is the extension's complete state, so we read the extension's
// current FKERNELXML and re-include existing fields / appearances / plugins.

interface PluginArgs {
  className: string;
  pyBody: string;
}

function coercePluginArgs(raw: Record<string, unknown>, idx: number): PluginArgs {
  const className = String(raw.className ?? '').trim();
  const pyBody = String(raw.pyBody ?? '');
  if (!className) throw new Error(`plugins[${idx}]: 缺少 className。`);
  if (!/^[a-z0-9_]+$/i.test(className)) {
    throw new Error(
      `plugins[${idx}]: className "${className}" 不合法 — 仅允许字母 / 数字 / 下划线。`,
    );
  }
  if (!pyBody.trim()) throw new Error(`plugins[${idx}]: 缺少非空的 pyBody。`);
  return { className, pyBody };
}

function registerPythonPluginsTool(
  connector: K3CloudConnector,
  projectId: string,
  sessionMgr: SessionMgrLike,
): ToolHandler {
  return {
    definition: {
      name: 'kingdee_register_python_plugins',
      description:
        '一次性给已有 BOS 扩展批量挂 Python 表单插件(写到扩展 `<Form>` 节点下的 `<FormPlugins>`)。' +
        '**所有这次要挂的插件都放进 plugins 数组里,一个工具调用搞定** — BOS 服务端把每次 Save 当成扩展的"完整差异",拆多次调用会让前面挂的插件消失。' +
        '本工具内部读现有插件并合入,所以**之后再挂插件也用本工具,把新插件放进 plugins 数组就行**(只传 1 个也合法)。' +
        '\n\n何时用:' +
        '\n- 客户需求要在表单生命周期事件里加自定义校验 / 联动 / 反写(典型:`AfterButtonClick` / `BeforeF7Select` / `DataChanged`)' +
        '\n- 同一个扩展可挂多个插件(放数组里一次性提交即可)' +
        '\n\n每个 plugin 的字段:' +
        '\n- `className`:插件标识,小写蛇形(`[a-z0-9_]+`),例 `credit_warn` / `material_validator`。BOS Designer 表单插件列表里显示这个。' +
        '\n- `pyBody`:**完整** IronPython 2.7 源码,含 `from Kingdee.BOS... import AbstractDynamicFormPlugIn` + 至少一个继承自它的类。脚本里随便用 `<` / `>` / `&` / 引号 — 工具用 CDATA 包裹,无需手动转义。' +
        '\n\n**写入后**:用户需在 BOS Designer 中刷新扩展(工具栏刷新按钮),且**关闭客户端重登**才能让客户端缓存到新插件(详见 memory `bos_client_cache_relogin`)。',
      parameters: {
        type: 'object',
        properties: {
          extId: {
            type: 'string',
            description: '扩展 FID(32 位 hex GUID,无连字符)。',
          },
          plugins: {
            type: 'array',
            minItems: 1,
            description:
              '本次保存里要挂的所有 Python 插件。原子提交。再要挂更多就再调一次本工具(传新的进 plugins,旧的会自动保留)。',
            items: {
              type: 'object',
              properties: {
                className: {
                  type: 'string',
                  description: '插件类名 / 标识,推荐小写蛇形,例 "credit_warn"。',
                },
                pyBody: {
                  type: 'string',
                  description:
                    'IronPython 2.7 完整源码,含 import + 继承 AbstractDynamicFormPlugIn 的类定义。',
                },
              },
              required: ['className', 'pyBody'],
            },
          },
        },
        required: ['extId', 'plugins'],
      },
    },
    async execute(args) {
      const extId = String(args.extId ?? '').trim();
      if (!extId) throw new Error('kingdee_register_python_plugins 需要 extId 参数。');
      const rawPlugins = args.plugins;
      if (!Array.isArray(rawPlugins) || rawPlugins.length === 0) {
        throw new Error('kingdee_register_python_plugins 需要 plugins 参数(至少一个的数组)。');
      }
      const pluginArgsList: PluginArgs[] = rawPlugins.map((raw, i) =>
        coercePluginArgs((raw ?? {}) as Record<string, unknown>, i),
      );
      rejectDuplicates(pluginArgsList, (p) => p.className, 'plugins 的 className');

      const { ext, project, layoutInfoOid, existing } = await loadExtensionForSave(
        connector,
        projectId,
        extId,
        'kingdee_register_python_plugins',
      );

      const newPlugins: BosPluginElement[] = pluginArgsList.map((p) => ({
        className: p.className,
        type: 'python',
        pyScript: p.pyBody,
      }));

      const req: SaveExtensionRequest = {
        extension: {
          formId: extId,
          baseObjectId: ext.baseObjectId!,
          modelTypeId: ext.modelTypeId!,
          subSystemId: ext.subsystemId!,
          name: [{ localeId: 2052, value: ext.name }],
          isv: { devCode: project.devCode },
        },
        isNew: false,
        layoutInfoOid,
        existingFieldsRaw: existing.fields,
        existingAppearancesRaw: existing.appearances,
        existingPluginsRaw: existing.plugins,
        addPlugins: newPlugins,
      };

      const session = await sessionMgr.getOrLogin(projectId);
      const result = await saveExtensionRpc(session, req);

      if (!result.isSuccess) {
        return JSON.stringify(
          {
            ok: false,
            extId,
            attemptedClassNames: pluginArgsList.map((p) => p.className),
            messageTitle: result.messageTitle,
            messageDetail: result.messageDetail,
          },
          null,
          2,
        );
      }

      return JSON.stringify(
        {
          ok: true,
          extId,
          addedCount: newPlugins.length,
          plugins: pluginArgsList.map((p) => ({
            className: p.className,
            scriptLength: p.pyBody.length,
          })),
          reminder:
            '所有插件已一次性挂到扩展。BOS Designer 中需点扩展工具栏刷新按钮才能在「表单插件」节点看到;' +
            '**客户端的运行时缓存里没有新插件 — 用户必须关闭 K/3 Cloud 客户端重登,新单据上才会执行新脚本**(只 F5 刷新表单不够,详见 memory `bos_client_cache_relogin`)。',
        },
        null,
        2,
      );
    },
  };
}

// ─── kingdee_create_enum_type ────────────────────────────────────────────
//
// Wire format verified 2026-04-28 capture req-583 (BOS Designer create-enum):
//   POST BusinessDataService.SaveV9 with ap0 = base64+zlib JSON containing
//   the EnumObject schema header + data values. Schema portion is constant
//   (saved as enum-save-schema.json) — we just slot in name + items.
//   After-save: UpdateMetaCacheByEnumTypeId so subsequent reads see it.

function createEnumTypeTool(
  connector: K3CloudConnector,
  projectId: string,
  sessionMgr: SessionMgrLike,
): ToolHandler {
  return {
    definition: {
      name: 'kingdee_create_enum_type',
      description:
        '在当前账套上**新建**一个下拉枚举类型(写 T_META_FORMENUM + items 表)。**只在 `kingdee_list_enum_types` 找不到合适的现成枚举时才用** —— 同一账套不必要的重复枚举会让 BOS Designer 列表越来越乱。' +
        '\n\n传参:' +
        '\n- `name`:中文显示名,如 "信用等级" / "客户类型" / "退货原因"。同账套内不能与其他枚举重名(本工具不预校验,服务端会拒)。' +
        '\n- `items`:数组,每项 `{ value, caption }`:' +
        '\n  - `value`:存到数据库的代码,推荐短 ASCII 如 "1"/"2"/"A"/"B"/"YES"。**项内必须唯一**,不能空字符串。' +
        '\n  - `caption`:中文显示文字,如 "优秀"/"良好"。' +
        '\n  - 可选 `seq`:排序序号,默认按数组顺序 0/1/2/...' +
        '\n\n返回 `{ ok, enumTypeId, name, itemCount }`。**`enumTypeId` 后续传给 `kingdee_add_fields` 的 combo 字段时可以用枚举名 + 名→GUID 翻译,也可以直接传 GUID(高级)。**',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '枚举的中文显示名,例 "信用等级"。' },
          items: {
            type: 'array',
            minItems: 1,
            description: '下拉项数组,至少 1 项。',
            items: {
              type: 'object',
              properties: {
                value: { type: 'string', description: '代码值,存数据库,例 "1"/"A"/"YES"。' },
                caption: { type: 'string', description: '显示文字,例 "优秀"/"是"。' },
                seq: { type: 'number', description: '(可选)排序序号,默认按数组顺序。' },
              },
              required: ['value', 'caption'],
            },
          },
        },
        required: ['name', 'items'],
      },
    },
    async execute(args) {
      const name = String(args.name ?? '').trim();
      if (!name) throw new Error('kingdee_create_enum_type 需要 name 参数。');
      const rawItems = args.items;
      if (!Array.isArray(rawItems) || rawItems.length === 0) {
        throw new Error('kingdee_create_enum_type 需要 items 数组(至少 1 项)。');
      }
      const items: EnumItemInput[] = rawItems.map((raw, i) => {
        const r = (raw ?? {}) as Record<string, unknown>;
        const value = String(r.value ?? '').trim();
        const caption = String(r.caption ?? '').trim();
        if (!value) throw new Error(`items[${i}]: 缺少 value(代码值)。`);
        if (!caption) throw new Error(`items[${i}]: 缺少 caption(显示文字)。`);
        return {
          value,
          caption,
          seq: r.seq != null ? Number(r.seq) : undefined,
        };
      });
      rejectDuplicates(items, (it) => it.value, '下拉项的代码 value');

      const project = await getProject(projectId);
      if (!project?.bos) {
        throw new Error('当前项目未配置 BOS 写入凭据,请到项目设置中补全。');
      }

      const session = await sessionMgr.getOrLogin(projectId);
      const result = await saveEnumObject(session, { name, items });

      if (!result.ok) {
        return JSON.stringify(
          {
            ok: false,
            name,
            messageDetail: result.responseBody.slice(0, 500),
          },
          null,
          2,
        );
      }

      // Bust server-side metadata cache so subsequent enum reads pick this up.
      // Non-fatal — server-side cache will refresh on its own eventually; log
      // so a recurring failure is diagnosable rather than invisible.
      try {
        await updateMetaCacheByEnumTypeId(session, result.enumTypeId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        void log.warn(
          `updateMetaCacheByEnumTypeId failed after create enumTypeId=${result.enumTypeId}: ${msg}`,
        );
      }
      // And bust our connector-side cache so the next combo-field translation
      // resolves the new enum.
      connector.invalidateEnumCache();

      return JSON.stringify(
        {
          ok: true,
          enumTypeId: result.enumTypeId,
          name,
          itemCount: items.length,
          reminder:
            '枚举已建。后续 kingdee_add_fields 的 combo 字段可以直接传 enumTypeName 引用本枚举(本工具会刷新缓存)。BOS Designer 里若已打开「枚举管理」面板需手动刷新一次才能看到新条目。',
        },
        null,
        2,
      );
    },
  };
}

// ─── kingdee_delete_enum_type ────────────────────────────────────────────
//
// Soft-delete via MetadataService.AddEnumObjectToRecycle(enumTypeId).
// Server moves the row to a recycle-bin equivalent — recoverable via
// RecoverEnumObject (not yet exposed). Hard delete isn't surfaced.

function deleteEnumTypeTool(
  connector: K3CloudConnector,
  projectId: string,
  sessionMgr: SessionMgrLike,
): ToolHandler {
  return {
    definition: {
      name: 'kingdee_delete_enum_type',
      description:
        '把一个下拉枚举类型移到回收站(软删除,可恢复)。' +
        '\n\n何时用:' +
        '\n- `kingdee_create_enum_type` 建错了想清掉' +
        '\n- 客户实施完拆除测试 / 中间过渡的枚举' +
        '\n\n**金蝶预置枚举(`isSysPreset === "1"`)删不了** —— 服务端会拒绝。先用 `kingdee_list_enum_types` 看 isSysPreset 字段,值为 "1" 的别尝试删。\n\n传参:`enumTypeId`(GUID,从 `kingdee_list_enum_types` 拿)。',
      parameters: {
        type: 'object',
        properties: {
          enumTypeId: {
            type: 'string',
            description: '要删除的枚举 GUID(8-4-4-4-12 格式)。',
          },
        },
        required: ['enumTypeId'],
      },
    },
    async execute(args) {
      const enumTypeId = String(args.enumTypeId ?? '').trim();
      if (!enumTypeId) {
        throw new Error('kingdee_delete_enum_type 需要 enumTypeId 参数。');
      }

      const project = await getProject(projectId);
      if (!project?.bos) {
        throw new Error('当前项目未配置 BOS 写入凭据,请到项目设置中补全。');
      }

      const session = await sessionMgr.getOrLogin(projectId);
      const ok = await addEnumObjectToRecycle(session, enumTypeId);
      if (!ok) {
        return JSON.stringify(
          {
            ok: false,
            enumTypeId,
            messageDetail:
              '服务端拒绝删除。可能原因:GUID 不存在 / 是金蝶预置枚举(isSysPreset="1") / 还有 ComboField 在引用。',
          },
          null,
          2,
        );
      }

      // Cache bust both sides. Non-fatal if server-side fails.
      try {
        await updateMetaCacheByEnumTypeId(session, enumTypeId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        void log.warn(
          `updateMetaCacheByEnumTypeId failed after delete enumTypeId=${enumTypeId}: ${msg}`,
        );
      }
      connector.invalidateEnumCache();

      return JSON.stringify(
        {
          ok: true,
          enumTypeId,
          reminder:
            '已移到回收站。BOS Designer 里若已打开「枚举管理」面板需手动刷新才看不到这条。',
        },
        null,
        2,
      );
    },
  };
}
