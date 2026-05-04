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
import { newCompactGuid, xmlEscape, defaultEntryServiceNames } from '../erp/k3cloud/rpc/dcxml';
import { BosResponseError } from '../erp/k3cloud/rpc/http-client';
import { extractExistingExtensionElements } from '../erp/k3cloud/rpc/existing-elements';
import {
  parseAppearanceGeometry,
  parseFormLayoutContainers,
} from '../erp/k3cloud/fkernel-parsers';
import { saveEnumObject, type EnumItemInput } from '../erp/k3cloud/rpc/save-enum-object';
import {
  addEnumObjectToRecycle,
  updateMetaCacheByEnumTypeId,
} from '../erp/k3cloud/rpc/enum-objects';
import type {
  BosFieldAppearance,
  BosFieldElement,
  BosPluginElement,
  BosEntryElement,
  BosEntryAppearance,
  BosTabControlAppearance,
  BosTabPageAppearance,
  BosFormOperationElement,
  BosDefValue,
  SaveExtensionRequest,
} from '../erp/k3cloud/rpc/types';
import { SEQUENCE_CATEGORY_CUST_ENTRY } from '../erp/k3cloud/rpc/sequence';
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
    // Plan 5.14 — entry / tab toolchain
    createTabControlTool(c, pid, sessionMgr),
    createTabPageTool(c, pid, sessionMgr),
    createEntryTool(c, pid, sessionMgr),
    deleteEntryTool(c, pid, sessionMgr),
    deleteTabPageTool(c, pid, sessionMgr),
    deleteTabControlTool(c, pid, sessionMgr),
    renameEntryTool(c, pid, sessionMgr),
    renameTabPageTool(c, pid, sessionMgr),
    renameTabControlTool(c, pid, sessionMgr),
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
 * Shared prelude for both `k3cloud_add_fields` and `k3cloud_register_python_plugins`:
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
    throw new Error(`扩展 ${extId} 不存在。先用 k3cloud_list_extensions 确认。`);
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
    : {
        fields: [],
        appearances: [],
        plugins: [],
        entries: [],
        entryAppearances: [],
        tabPages: [],
        tabControls: [],
        formOperations: [],
      };

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

/**
 * Collect all entry keys this extension can target — parent's original-vendor
 * entries (e.g. `FSaleOrderEntry`) plus the extension's own EntryEntities.
 *
 * Used by `k3cloud_add_fields` to detect when `container` names an entry
 * (single-level only — sub-entries excluded for v0.1) and route the field
 * through the entry-field branch.
 */
function collectEntryKeys(
  parentKernelXml: string | null,
  extKernelXml: string | null,
): Set<string> {
  const keys = new Set<string>();
  for (const xml of [parentKernelXml, extKernelXml]) {
    if (!xml) continue;
    const layout = parseFormLayoutContainers(xml);
    for (const e of layout.entries) {
      // v0.1: single-level only — skip sub-entries to keep wire format simple.
      if (e.kind === 'entry') keys.add(e.key);
    }
  }
  return keys;
}

/**
 * Find the maximum existing Tabindex among entry-fields belonging to a given
 * EntryEntity. Each entry maintains its own counter starting at 1; the next
 * Tabindex for new fields in that entry is `(this max) + 1`.
 *
 * Scans raw `*FieldAppearance` chunks (in `existingAppearancesRaw`) for those
 * whose `<EntityKey>` matches; max of their `<Tabindex>` (0 when none). Both
 * tags appear as flat direct children of the appearance element, so simple
 * substring match is safe.
 */
function maxTabindexForEntry(
  existingAppearancesRaw: string[],
  entryKey: string,
): number {
  const needle = `<EntityKey>${entryKey}</EntityKey>`;
  let max = 0;
  for (const raw of existingAppearancesRaw) {
    if (!raw.includes(needle)) continue;
    const m = raw.match(/<Tabindex>(\d+)<\/Tabindex>/);
    if (!m) continue;
    const v = Number(m[1]);
    if (v > max) max = v;
  }
  return max;
}

// ─── Constants for entry / tab toolchain ──────────────────────────────────

/** Default container for self-built TabControls (BOS entry-side panel). */
const ENTRY_PANEL_CONTAINER = 'FSPLITECONTAINER~Panel2';
/** Original-vendor entry-side TabControl, present on every K/3 form. */
const ORIGINAL_ENTRY_TAB_CONTROL = 'FTab1';
const DEFAULT_TAB_CONTROL_CAPTION = '页签控件';
const DEFAULT_TAB_PAGE_CAPTION = '页签';

/** 3-char lowercase alphanumeric suffix used by BOS Designer in tab/entry keys. */
function gen3CharLcSuffix(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 3; i++) {
    s += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return s;
}

/**
 * Compose a SaveExtensionRequest from the read-merge baseline + caller deltas.
 * Critical: all `existing*Raw` arrays from `ExistingExtensionElements` MUST flow
 * through — SaveForIDE is a baseline diff, anything missing gets dropped.
 */
function buildSaveRequest(
  ext: ObjectMeta,
  project: NonNullable<Project['bos']>,
  layoutInfoOid: string,
  existing: ExistingExtensionElements,
  deltas: Pick<
    SaveExtensionRequest,
    | 'addFields'
    | 'addAppearances'
    | 'addPlugins'
    | 'addEntries'
    | 'addEntryAppearances'
    | 'addTabPages'
    | 'addTabControls'
    | 'addFormOperations'
  > = {},
): SaveExtensionRequest {
  return {
    extension: {
      formId: ext.id,
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
    existingEntriesRaw: existing.entries,
    existingEntryAppearancesRaw: existing.entryAppearances,
    existingTabPagesRaw: existing.tabPages,
    existingTabControlsRaw: existing.tabControls,
    existingFormOperationsRaw: existing.formOperations,
    ...deltas,
  };
}

/**
 * Read the first `<tag>...</tag>` body in `rawChunk`. Operates on the chunk
 * verbatim — caller's responsibility to ensure `tag` is a direct child only,
 * which holds for the flat appearance / entry chunks we filter on.
 */
function readChildText(rawChunk: string, tag: string): string | null {
  const m = rawChunk.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return m ? m[1] : null;
}

/**
 * Compute the next `{pageIndex, zOrderIndex}` for a new TabPage under
 * `parentTabControlKey`. Each is `max(siblings) + 1` independently —
 * historical edits can desync the two fields (SAL_SaleOrder's 收款执行明细
 * has pageIndex=10 but zOrderIndex=7), so a single max would put the new
 * tab visually before whichever field is lagging.
 *
 * Sources: parent form's native tabs (parsed from `parentKernelXml`) +
 * extension's own already-saved TabPages (`existingTabPagesRaw`). Filtered
 * by parent TabControl. Returns 0 for either field when no siblings exist.
 *
 * Without this, BOS defaults missing PageIndex/ZOrderIndex to 0 — every
 * new tab lands in front of every existing one (the user-reported bug).
 */
function nextTabIndices(
  parentKernelXml: string | null,
  existingTabPagesRaw: string[],
  parentTabControlKey: string,
): { pageIndex: number; zOrderIndex: number } {
  let maxPage = -1;
  let maxZ = -1;

  if (parentKernelXml) {
    const layout = parseFormLayoutContainers(parentKernelXml);
    for (const t of layout.tabs) {
      if (t.parentControl !== parentTabControlKey) continue;
      const p = t.pageIndex ?? 0;
      if (p > maxPage) maxPage = p;
      const z = t.zOrderIndex ?? 0;
      if (z > maxZ) maxZ = z;
    }
  }

  for (const raw of existingTabPagesRaw) {
    if (readChildText(raw, 'Container') !== parentTabControlKey) continue;
    const pRaw = readChildText(raw, 'PageIndex');
    const p = pRaw != null && pRaw !== '' ? Number(pRaw) : 0;
    if (Number.isFinite(p) && p > maxPage) maxPage = p;
    const zRaw = readChildText(raw, 'ZOrderIndex');
    const z = zRaw != null && zRaw !== '' ? Number(zRaw) : 0;
    if (Number.isFinite(z) && z > maxZ) maxZ = z;
  }

  return { pageIndex: maxPage + 1, zOrderIndex: maxZ + 1 };
}

/**
 * Replace the body of the first matched `<tag>...</tag>` in `rawChunk`.
 * Caller's responsibility to ensure `tag` is a direct child only — used for
 * single-level Name / Caption rewrites on appearance / entry chunks (no
 * nested same-name children in observed wire format).
 */
function replaceChildText(rawChunk: string, tag: string, newValue: string): string {
  const re = new RegExp(`(<${tag}>)[^<]*(</${tag}>)`);
  return rawChunk.replace(re, `$1${xmlEscape(newValue)}$2`);
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
      name: 'k3cloud_create_extension',
      description:
        '在 K/3 Cloud 上为指定父单据(原厂表单)新建一个 BOS 扩展。扩展是在父对象上挂字段 / 插件 / 业务规则等定制内容的容器,本身不带任何字段或插件。\n' +
        '\n创建后调用方拿到的 `extId` 用于后续:\n' +
        '- `k3cloud_add_fields` 批量添加扩展字段(数组,一次保存)\n' +
        '- `k3cloud_register_python_plugins` 批量挂 Python 表单插件(数组,一次保存)\n' +
        '- `k3cloud_delete_extension` 不要时整个删掉\n' +
        '\n创建前**先调 `k3cloud_list_extensions <parentFormId>`** 看是否已有可复用的扩展(同一父单据上多个扩展会变 BOS Designer 的负担)。' +
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
      if (!parentFormId) throw new Error('k3cloud_create_extension 需要 parentFormId 参数。');
      if (!extName) throw new Error('k3cloud_create_extension 需要 extName 参数。');

      const project = await getProject(projectId);
      if (!project?.bos) {
        throw new Error('当前项目未配置 BOS 写入凭据,请到项目设置中补全。');
      }

      // Look up parent's modelTypeId / subsystemId — both required by
      // SaveForIDEV9 paras. Returns null when the form doesn't exist.
      const parent = await connector.getObject(parentFormId);
      if (!parent) {
        throw new Error(`父单据 ${parentFormId} 不存在。请先用 k3cloud_search_metadata 确认 FormID 拼写。`);
      }
      if (parent.modelTypeId == null || parent.subsystemId == null) {
        throw new Error(
          `父单据 ${parentFormId} 元数据不完整(modelTypeId=${parent.modelTypeId}, subsystemId=${parent.subsystemId}),无法创建扩展。`,
        );
      }
      // Canonical FID lookup — K/3 父对象 FID 拼写不统一(SAL_SaleOrder 混合 / SAL_OUTSTOCK 全大写),
      // 服务端 RPC case-insensitive 能查到,但 BOS Designer 列扩展时严格按字符串匹配 FBASEOBJECTID
      // 列。直接用 raw 输入会让混合大小写的 FBASEOBJECTID 落库,Designer 看不到扩展(2026-04-30 实证)。
      const canonicalFormId = parent.id;

      // Discover layoutInfoOid from parent FKERNELXML unless agent overrode.
      let layoutInfoOid = typeof args.layoutInfoOid === 'string' ? args.layoutInfoOid.trim() : '';
      if (!layoutInfoOid) {
        const xml = await connector.getKernelXml(canonicalFormId);
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
          baseObjectId: canonicalFormId,
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

      const baseReminder =
        '扩展已创建。后续添加字段 / 插件请把上面的 extId 传给 k3cloud_add_fields / k3cloud_register_python_plugins(都接数组,一次保存里把要加的全部传进来,不要拆多次)。' +
        'BOS Designer 中需点工具栏刷新按钮才能在扩展列表里看到新建的扩展。';
      const caseHint =
        canonicalFormId !== parentFormId
          ? `提示:你输入的父单据 ID 拼写为 "${parentFormId}",规范拼写为 "${canonicalFormId}",已按规范写入。后续工具调用请使用规范拼写。`
          : '';

      return JSON.stringify(
        {
          ok: true,
          extId: formId,
          parentFormId: canonicalFormId,
          extName,
          layoutInfoOid,
          reminder: caseHint ? `${caseHint}\n${baseReminder}` : baseReminder,
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
      name: 'k3cloud_delete_extension',
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
        throw new Error('k3cloud_delete_extension 需要 extId 参数。');
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

// ─── k3cloud_add_fields ──────────────────────────────────────────────────
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
  /**
   * Plan 5.12.7 — multi-org enterprise edition only. Names the head-level
   * 使用组织 field that scopes this base_data lookup (e.g. `FSaleOrgId`).
   * Standard / single-org installs leave this undefined.
   */
  orgFieldKey?: string;
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
  /**
   * Set internally when `container` resolves to an EntryEntity key — routes
   * the field through the entry-field branch (emit EntityKey, skip
   * Container/Top/Left/ZOrderIndex, default Width=150). Never read from
   * agent input.
   */
  entityKey?: string;
  /** Plan 5.12.7 — 必录. */
  mustInput?: boolean;
  /**
   * Plan 5.12.7 — 缺省值. Friendly form (string / number / boolean) coerced
   * by `defaultValueForType` into the typed `BosDefValue` based on field type.
   * Pre-coercion shape is whatever JSON the agent passed.
   */
  defaultValueRaw?: unknown;
}

/**
 * Translate the agent's friendly `defaultValue` (string / number / boolean)
 * into the typed `BosDefValue` AST per field type, based on captures
 * req-77/req-103 (memory `bos_property_grid_inventory.md` §DefValue 多态 schema).
 *
 * - text / combo / checkbox: `kind: 'literal'` with stringified value (combo
 *   accepts the enum's literal value, checkbox normalizes truthy → "True"
 *   per BOS's capitalized boolean wire format)
 * - int / decimal / price / amount / qty: `kind: 'function'` GetNumeric(14)
 *   with stringified numeric value
 * - date: `kind: 'function'` GetDate(1) with Parameter "yyyy-MM-dd,<expr>".
 *   The expr is `@CurrentDate` for the keyword "today" / "now" / `@CurrentDate`
 *   itself; otherwise a literal date string the user passed (e.g.
 *   "2026-01-01"). Format-string portion fixed to "yyyy-MM-dd" — date-only
 *   semantics, no time component.
 * - base_data: `kind: 'function'` GetBaseData(15) with the FNumber lookup key
 *   in Value (NOT the GUID — server resolves at form-load time).
 * - base_property / unit: defaultValue is meaningless / unsupported by BOS;
 *   the tool throws.
 */
function defaultValueForType(
  type: FriendlyFieldType,
  raw: unknown,
  fieldKey: string,
): BosDefValue {
  const stringify = (v: unknown): string => (typeof v === 'string' ? v : String(v));
  switch (type) {
    case 'text':
    case 'combo':
      return { kind: 'literal', value: stringify(raw) };
    case 'checkbox': {
      const truthy =
        raw === true ||
        raw === 1 ||
        (typeof raw === 'string' && ['true', '1', 'yes'].includes(raw.trim().toLowerCase()));
      return { kind: 'literal', value: truthy ? 'True' : 'False' };
    }
    case 'int':
    case 'decimal':
    case 'price':
    case 'amount':
    case 'qty': {
      const num = Number(raw);
      if (!Number.isFinite(num)) {
        throw new Error(
          `字段 ${fieldKey}: defaultValue 必须能转成数字, 收到 "${stringify(raw)}"。`,
        );
      }
      return {
        kind: 'function',
        functionId: 14,
        functionName: 'GetNumeric',
        value: String(num),
      };
    }
    case 'date': {
      const s = stringify(raw).trim();
      const lower = s.toLowerCase();
      const expr =
        lower === 'today' || lower === 'now' || lower === '@currentdate' ? '@CurrentDate' : s;
      return {
        kind: 'function',
        functionId: 1,
        functionName: 'GetDate',
        parameter: `yyyy-MM-dd,${expr}`,
      };
    }
    case 'base_data':
      // FNumber lookup key (not GUID). Stringified so numeric-looking codes
      // like "01" survive intact.
      return {
        kind: 'function',
        functionId: 15,
        functionName: 'GetBaseData',
        value: stringify(raw),
      };
    case 'base_property':
    case 'unit':
      throw new Error(`字段 ${fieldKey}: ${type} 类型不支持 defaultValue。`);
  }
}

function buildFieldElement(args: AddFieldArgs): BosFieldElement {
  const { type, key, caption, listTabIndex, entityKey, mustInput } = args;
  const lti = listTabIndex ?? DEFAULT_LIST_TAB_INDEX_BASE;
  // Plan 5.12.7 — orgFieldKey only valid on base_data; tool layer rejected
  // earlier in coerceFieldArgs, but enforce here too as a defense in depth.
  if (args.orgFieldKey && type !== 'base_data') {
    throw new Error(`字段 ${key}: orgFieldKey 只对 base_data 字段有效。`);
  }
  // Translate friendly defaultValue → typed BosDefValue per field type.
  const defValue =
    args.defaultValueRaw !== undefined
      ? defaultValueForType(type, args.defaultValueRaw, key)
      : undefined;
  switch (type) {
    case 'text':
      return { type: 'TextField', key, caption, listTabIndex: lti, entityKey, mustInput, defValue };
    case 'int':
      return { type: 'IntegerField', key, caption, listTabIndex: lti, entityKey, mustInput, defValue };
    case 'date':
      return { type: 'DateField', key, caption, listTabIndex: lti, entityKey, mustInput, defValue };
    case 'decimal':
      return {
        type: 'DecimalField',
        key,
        caption,
        listTabIndex: lti,
        entityKey,
        mustInput,
        defValue,
        fieldScale: args.fieldScale ?? 2,
        fieldPrecision: args.fieldPrecision ?? 23,
      };
    case 'price':
      return {
        type: 'PriceField',
        key,
        caption,
        listTabIndex: lti,
        entityKey,
        mustInput,
        defValue,
        fieldScale: args.fieldScale ?? 4,
        fieldPrecision: args.fieldPrecision ?? 23,
      };
    case 'amount':
      return {
        type: 'AmountField',
        key,
        caption,
        listTabIndex: lti,
        entityKey,
        mustInput,
        defValue,
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
        entityKey,
        mustInput,
        defValue,
        fieldScale: args.fieldScale ?? 6,
        fieldPrecision: args.fieldPrecision ?? 23,
        controlFieldKey: args.controlFieldKey,
      };
    case 'checkbox':
      return { type: 'CheckBoxField', key, caption, listTabIndex: lti, entityKey, mustInput, defValue };
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
        entityKey,
        mustInput,
        defValue,
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
        entityKey,
        mustInput,
        defValue,
        lookUpObjectId: args.refBaseDataObjectKey,
        srcFindFieldName: args.srcFindFieldName,
        srcDisplayFieldName: args.srcDisplayFieldName,
        orgFieldKey: args.orgFieldKey,
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
        entityKey,
        mustInput,
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
        entityKey,
        mustInput,
        unitTypeKey: args.unitTypeKey ?? '1',
        lookUpObjectId: args.refBaseDataObjectKey,
      };
  }
}

function buildAppearance(args: AddFieldArgs, elementType: BosFieldElement['type']): BosFieldAppearance {
  // Entry-field appearance: positioned by the parent EntryEntityAppearance
  // grid, NOT by absolute (left, top). Skip Container/ZOrderIndex/Left/Top —
  // dcxml emitter omits them when entityKey is set.
  if (args.entityKey) {
    return {
      type: elementType,
      key: args.key,
      caption: args.caption,
      entityKey: args.entityKey,
      tabindex: args.tabindex ?? 1,
      width: args.width,
      labelWidth: args.labelWidth,
    };
  }
  // Head field: standard absolute geometry. left/top are populated upstream
  // by the placement engine in addFieldsTool.execute (or by an explicit user
  // override). They MUST be set by the time we reach here — leaving them
  // undefined would emit an appearance node missing geometry, which BOS
  // treats as 0/0 and renders unusable. Coerce to 0 if absent so the bug is
  // at least diagnosable.
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
  // Plan 5.12.7 — reject orgFieldKey on non-base_data so the agent gets a
  // clear error at coerce time rather than a confusing wire-level mismatch.
  if (raw.orgFieldKey != null && type !== 'base_data') {
    throw new Error(
      `fields[${idx}] (key=${key}): orgFieldKey 只对 base_data 字段有效(${type} 字段不接受 orgFieldKey)。`,
    );
  }
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
    orgFieldKey: raw.orgFieldKey != null ? String(raw.orgFieldKey) : undefined,
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
    mustInput: raw.mustInput === true ? true : undefined,
    defaultValueRaw: raw.defaultValue,
  };
}

function addFieldsTool(
  connector: K3CloudConnector,
  projectId: string,
  sessionMgr: SessionMgrLike,
): ToolHandler {
  return {
    definition: {
      name: 'k3cloud_add_fields',
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
        '\n- combo — 下拉(必带 enumTypeName,如 "审核状态" / "单据状态" / "是否启用" / 客户自建枚举名;**用前先调 k3cloud_list_enum_types** 找现成的枚举,工具内部翻成 GUID。要全新枚举请用 k3cloud_create_enum_type 先建好再来引用)' +
        '\n- base_data — 基础资料引用(必带 refBaseDataObjectKey,传 friendly FormID 即可如 "BD_Customer" / "BD_MATERIAL" / "BD_Department",工具自动翻成内部 GUID。可选 srcFindFieldName / srcDisplayFieldName)' +
        '\n- base_property — 基础资料属性带值(必带 sourceField 指向同单据已有的 BaseDataField key,如 "FCustId";可选 srcDisplayFieldName 选源字段名,如 "FName")。**用前先调 k3cloud_describe_basedata** 反查目标基础资料能 srcDisplay 哪些字段。' +
        '\n- unit — 计量单位(默认引用 `BD_UNIT` 标准单位表,99% 场景不用传任何额外参数。罕见需要换单位字典时可传 `refBaseDataObjectKey` 指向其他单位 lookup;高级:`unitTypeKey` 默认 "1" 一般不动)' +
        '\n\n**自动排版**:本工具会读父对象布局算出目标容器里原厂字段最右边界,把新字段竖向排列在那右侧一列,' +
        '多次调用会接着前次的字段往下顺排,无需手传坐标。窄基础资料表(无原厂头字段时)默认 left=1100 兜底,可能在窄表上偏右,需要时传 left/top 显式指定。' +
        '\n\n**写入后必反查闭环**:调 `k3cloud_get_extension_fields <extId>` 验证字段都已落库;' +
        '不要用 `k3cloud_get_fields`(那个只看父对象的原厂字段,扩展字段永远查不到)。' +
        '\n\n**关于容器选择**(重要):`container` 既可以传**头 tab key**(如 `FTAB_P0` 基本信息)也可以传**entry key**(如 `FSaleOrderEntry` 明细信息)。' +
        '工具会自动识别:命中 entry key → 走"明细行字段"分支(emit `<EntityKey>`,不需要也不接受 `top`/`left`/`zOrderIndex`,Tabindex 在该 entry 内独立计数);命中 tab key → 走头字段分支(自动排版到右侧一列)。' +
        '调用本工具前**必须先 `k3cloud_get_form_layout`** 看清父对象 / 扩展自身有哪些 tab、哪些 entry,把选项列给用户;不要默认 FTAB_P0 直接写。' +
        '挂在自建 entry 上时同样这样:`k3cloud_create_entry` 返回的 `entryKey` 直接传给本工具的 `container` 即可。',
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
                    '(combo 必填)下拉枚举的友好名,如 "审核状态" / "单据状态" / "是否启用"。工具自动翻成 GUID,大小写不敏感。**先调 k3cloud_list_enum_types 找有哪些可用**。',
                },
                defaultCondition: {
                  type: 'number',
                  description: '(combo 可选)枚举的默认值代码,默认 0。',
                },
                container: {
                  type: 'string',
                  description:
                    '(强烈推荐先调 k3cloud_get_form_layout 选)容器 key,如 "FTAB_P0"(基本信息)、"FTAB_P1"(其他头页签)、"FSaleOrderEntry"(明细单据体)。默认 "FTAB_P0"。',
                },
                top: { type: 'number', description: '(可选)Top 像素。留空则自动排版,顺排在前一字段下面一行。' },
                left: { type: 'number', description: '(可选)Left 像素。留空则自动排版,贴在原厂字段右侧。' },
                width: { type: 'number', description: '(可选)控件宽度像素,默认 300。' },
                labelWidth: { type: 'number', description: '(可选)标签宽度像素,默认 100。' },
                zOrderIndex: { type: 'number', description: '(可选)容器内排序,默认 99。' },
                tabindex: { type: 'number', description: '(可选)tab 顺序,默认 9000。' },
                listTabIndex: { type: 'number', description: '(可选)列表序号,默认 9000。' },
                mustInput: {
                  type: 'boolean',
                  description:
                    '(可选)字段是否必录。`true` 时 BOS 表单上该字段会强制要求填写,留空提交会被拦下。默认 false(不强制)。',
                },
                defaultValue: {
                  // Polymorphic: workflow accepts string | number | boolean.
                  // Most LLM tool-call schemas expect a single `type` string —
                  // declare "string" + clarify allowed forms in the description.
                  // Runtime coercion in `defaultValueForType` accepts unknown.
                  type: 'string',
                  description:
                    '(可选)字段缺省值。允许 string / number / boolean,工具按字段类型路由:' +
                    '\n- text/combo: 字符串字面值(combo 传枚举的 Value,如 "A")' +
                    '\n- checkbox: true/false(自动转 BOS 大写 "True"/"False")' +
                    '\n- int/decimal/price/amount/qty: 数字字面值(如 66.66)' +
                    '\n- date: "today" 关键字(取系统当前日期)或固定日期 "YYYY-MM-DD"(如 "2026-01-01")' +
                    '\n- base_data: 基础资料的 FNumber lookup key(如客户编码 "01",**不要传 GUID**;运行时由服务端按 FNumber 反查)' +
                    '\n- base_property/unit: **不支持** defaultValue,工具会报错。',
                },
                orgFieldKey: {
                  type: 'string',
                  description:
                    '(仅 base_data,**仅多组织企业版**)使用组织字段 key,如 "FSaleOrgId"。' +
                    '标准版/单组织环境**不传**。多组织时基础资料按组织过滤,常见值是单据头上的销售组织字段 key。',
                },
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
      if (!extId) throw new Error('k3cloud_add_fields 需要 extId 参数。');
      const rawFields = args.fields;
      if (!Array.isArray(rawFields) || rawFields.length === 0) {
        throw new Error('k3cloud_add_fields 需要 fields 参数(至少一个字段的数组)。');
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
          'k3cloud_add_fields',
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
            `fields[${idx}] (key=${fa.key}): 找不到名为 "${name}" 的基础资料。常用的有 BD_Customer / BD_MATERIAL / BD_Department / BD_UNIT。可以先调 k3cloud_describe_basedata 反查。`,
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
            `fields[${idx}] (key=${fa.key}): combo 字段必须指定 enumTypeName(下拉枚举的友好名,先调 k3cloud_list_enum_types 找)。`,
          notFound: (idx, fa, name) =>
            `fields[${idx}] (key=${fa.key}): 找不到名为 "${name}" 的枚举类型。先调 k3cloud_list_enum_types 看完整列表(常用的有 审核状态 / 单据状态 / 是否启用 / 优先级)。`,
        },
      );

      // Recognize entry containers — fields whose `container` matches a
      // parent or extension-built EntryEntity Key route through the
      // entry-field branch (emit EntityKey, skip absolute geometry, Tabindex
      // counted per-entry). Counter is seeded from existing max + max of any
      // explicit tabindexes the agent passed in this batch (so explicit and
      // auto-assigned values can't collide).
      const entryKeys = collectEntryKeys(parentKernelXml, extKernelXml);
      const tabindexCounterByEntry = new Map<string, number>();
      for (const fa of fieldArgsList) {
        const cont = fa.container;
        if (!cont || !entryKeys.has(cont)) continue;
        fa.entityKey = cont;
        fa.container = undefined;
        if (!tabindexCounterByEntry.has(cont)) {
          const existingMax = maxTabindexForEntry(existing.appearances, cont);
          const explicitMax = fieldArgsList
            .filter((f) => f.container === cont && typeof f.tabindex === 'number')
            .reduce((m, f) => Math.max(m, f.tabindex!), 0);
          tabindexCounterByEntry.set(cont, Math.max(existingMax, explicitMax) + 1);
        }
        // Only consume a counter slot when we actually auto-assign.
        if (fa.tabindex == null) {
          const next = tabindexCounterByEntry.get(cont)!;
          fa.tabindex = next;
          tabindexCounterByEntry.set(cont, next + 1);
        }
      }

      // Auto-place HEAD fields as a vertical column to the right of the
      // original-vendor layout, grouped by container. Within each container,
      // fields are stacked top-to-bottom one row apart, starting just past
      // the lowest existing extension field in that container so successive
      // batches don't overlap. Agent-supplied top/left always win. Entry-
      // fields skip placement entirely — their grid position is owned by
      // the parent EntryEntityAppearance.
      const originsByContainer = new Map<string, { left: number; top: number }>();
      const cursorTopByContainer = new Map<string, number>();
      for (const fa of fieldArgsList) {
        if (fa.entityKey) continue;
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

      const req = buildSaveRequest(ext, project, layoutInfoOid, existing, {
        addFields: newFields,
        addAppearances: newAppearances,
      });

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
            '验证全部字段已落库:调 k3cloud_get_extension_fields(不是 k3cloud_get_fields)。',
        },
        null,
        2,
      );
    },
  };
}

// ─── k3cloud_register_python_plugins ─────────────────────────────────────
//
// Wire format verified 2026-04-27 capture req-75 + smoke-plugin.ts smoke
// (extId=631a71d7f48249fca4e78daa74e0b925, IsSuccess=true). Plugin lives
// inside `<Form><FormPlugins><PlugIn>...` — see rpc/dcxml.ts emitter.
//
// Batch + read-merge: same baseline-diff issue as k3cloud_add_fields. Each
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
      name: 'k3cloud_register_python_plugins',
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
      if (!extId) throw new Error('k3cloud_register_python_plugins 需要 extId 参数。');
      const rawPlugins = args.plugins;
      if (!Array.isArray(rawPlugins) || rawPlugins.length === 0) {
        throw new Error('k3cloud_register_python_plugins 需要 plugins 参数(至少一个的数组)。');
      }
      const pluginArgsList: PluginArgs[] = rawPlugins.map((raw, i) =>
        coercePluginArgs((raw ?? {}) as Record<string, unknown>, i),
      );
      rejectDuplicates(pluginArgsList, (p) => p.className, 'plugins 的 className');

      const { ext, project, layoutInfoOid, existing } = await loadExtensionForSave(
        connector,
        projectId,
        extId,
        'k3cloud_register_python_plugins',
      );

      const newPlugins: BosPluginElement[] = pluginArgsList.map((p) => ({
        className: p.className,
        type: 'python',
        pyScript: p.pyBody,
      }));

      const req = buildSaveRequest(ext, project, layoutInfoOid, existing, {
        addPlugins: newPlugins,
      });

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

// ─── k3cloud_create_enum_type ────────────────────────────────────────────
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
      name: 'k3cloud_create_enum_type',
      description:
        '在当前账套上**新建**一个下拉枚举类型(写 T_META_FORMENUM + items 表)。**只在 `k3cloud_list_enum_types` 找不到合适的现成枚举时才用** —— 同一账套不必要的重复枚举会让 BOS Designer 列表越来越乱。' +
        '\n\n传参:' +
        '\n- `name`:中文显示名,如 "信用等级" / "客户类型" / "退货原因"。同账套内不能与其他枚举重名(本工具不预校验,服务端会拒)。' +
        '\n- `items`:数组,每项 `{ value, caption }`:' +
        '\n  - `value`:存到数据库的代码,推荐短 ASCII 如 "1"/"2"/"A"/"B"/"YES"。**项内必须唯一**,不能空字符串。' +
        '\n  - `caption`:中文显示文字,如 "优秀"/"良好"。' +
        '\n  - 可选 `seq`:排序序号,默认按数组顺序 0/1/2/...' +
        '\n\n返回 `{ ok, enumTypeId, name, itemCount }`。**`enumTypeId` 后续传给 `k3cloud_add_fields` 的 combo 字段时可以用枚举名 + 名→GUID 翻译,也可以直接传 GUID(高级)。**',
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
      if (!name) throw new Error('k3cloud_create_enum_type 需要 name 参数。');
      const rawItems = args.items;
      if (!Array.isArray(rawItems) || rawItems.length === 0) {
        throw new Error('k3cloud_create_enum_type 需要 items 数组(至少 1 项)。');
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
            '枚举已建。后续 k3cloud_add_fields 的 combo 字段可以直接传 enumTypeName 引用本枚举(本工具会刷新缓存)。BOS Designer 里若已打开「枚举管理」面板需手动刷新一次才能看到新条目。',
        },
        null,
        2,
      );
    },
  };
}

// ─── k3cloud_delete_enum_type ────────────────────────────────────────────
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
      name: 'k3cloud_delete_enum_type',
      description:
        '把一个下拉枚举类型移到回收站(软删除,可恢复)。' +
        '\n\n何时用:' +
        '\n- `k3cloud_create_enum_type` 建错了想清掉' +
        '\n- 客户实施完拆除测试 / 中间过渡的枚举' +
        '\n\n**金蝶预置枚举(`isSysPreset === "1"`)删不了** —— 服务端会拒绝。先用 `k3cloud_list_enum_types` 看 isSysPreset 字段,值为 "1" 的别尝试删。\n\n传参:`enumTypeId`(GUID,从 `k3cloud_list_enum_types` 拿)。',
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
        throw new Error('k3cloud_delete_enum_type 需要 enumTypeId 参数。');
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

// ─── Plan 5.14 — Entry / Tab toolchain ─────────────────────────────────
// Wire format reference: memory `bos_entry_creation_wire_format.md`.

// ── k3cloud_create_tab_control ─────────────────────────────────────────

function createTabControlTool(
  connector: K3CloudConnector,
  projectId: string,
  sessionMgr: SessionMgrLike,
): ToolHandler {
  return {
    definition: {
      name: 'k3cloud_create_tab_control',
      description:
        '在已有 BOS 扩展的单据体侧(`FSPLITECONTAINER~Panel2`)新建一个 TabControl 页签控件,默认带 N 个空 TabPage 作为子页签。' +
        '\n\n何时用:用户想"在单据体上加一组 tab"或要"新单据体放在新 tab 下"。' +
        '\n\n返回 `{ ok, tabControlKey, tabPageKeys: [{ key, index }] }` —— 后续:' +
        '\n- 创建单据体 entry → `k3cloud_create_entry(parentTabPageKey=tabPageKeys[i].key)`' +
        '\n- 加字段到 TabPage 之下需要先加 entry,字段不能直接落 TabPage' +
        '\n\n参数:' +
        '\n- `extId`(必)扩展 FID' +
        '\n- `caption`(可选,默认 "页签控件")TabControl 显示文字' +
        '\n- `tabPageCount`(可选,默认 3,范围 1-10)子 TabPage 数量',
      parameters: {
        type: 'object',
        properties: {
          extId: { type: 'string', description: '扩展 FID(32 位 hex GUID)。' },
          caption: { type: 'string', description: 'TabControl 显示文字,默认 "页签控件"。' },
          tabPageCount: {
            type: 'number',
            description: '子 TabPage 数量,默认 3,范围 1-10。',
          },
        },
        required: ['extId'],
      },
    },
    async execute(args) {
      const extId = String(args.extId ?? '').trim();
      if (!extId) throw new Error('k3cloud_create_tab_control 需要 extId 参数。');
      const caption =
        String(args.caption ?? DEFAULT_TAB_CONTROL_CAPTION).trim() || DEFAULT_TAB_CONTROL_CAPTION;
      const tabPageCount =
        args.tabPageCount != null ? Number(args.tabPageCount) : 3;
      if (!Number.isInteger(tabPageCount) || tabPageCount < 1 || tabPageCount > 10) {
        throw new Error('k3cloud_create_tab_control 的 tabPageCount 必须为 1-10 的整数。');
      }

      const { ext, project, layoutInfoOid, existing } = await loadExtensionForSave(
        connector,
        projectId,
        extId,
        'k3cloud_create_tab_control',
      );

      const suffix = gen3CharLcSuffix();
      const tabControlKey = `F_${project.devCode}_Tab_${suffix}`;
      const addTabControls: BosTabControlAppearance[] = [
        {
          key: tabControlKey,
          caption,
          container: ENTRY_PANEL_CONTAINER,
        },
      ];
      const addTabPages: BosTabPageAppearance[] = [];
      const tabPageKeys: Array<{ key: string; index: number }> = [];
      for (let i = 0; i < tabPageCount; i++) {
        // BOS Designer reuses the parent TabControl's 3-char suffix on its
        // children's key (verified in capture #1334+).
        const pageKey = `${tabControlKey}_P${i}_${suffix}`;
        addTabPages.push({
          key: pageKey,
          caption: DEFAULT_TAB_PAGE_CAPTION,
          container: tabControlKey,
          // Self-built TabControl has no pre-existing siblings — children
          // index from 0 in creation order. pageIndex == zOrderIndex so the
          // user-facing "页签序号" matches the actual order.
          pageIndex: i,
          zOrderIndex: i,
        });
        tabPageKeys.push({ key: pageKey, index: i });
      }

      const req = buildSaveRequest(ext, project, layoutInfoOid, existing, {
        addTabControls,
        addTabPages,
      });

      const session = await sessionMgr.getOrLogin(projectId);
      const result = await saveExtensionRpc(session, req);

      if (!result.isSuccess) {
        return JSON.stringify(
          {
            ok: false,
            extId,
            tabControlKey,
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
          tabControlKey,
          tabPageKeys,
          reminder:
            'TabControl 已创建并自带 ' +
            tabPageCount +
            ' 个空页签。在某个 TabPage 上加单据体:`k3cloud_create_entry(parentTabPageKey=tabPageKeys[i].key)`。BOS Designer 中需点工具栏刷新按钮才能看到。',
        },
        null,
        2,
      );
    },
  };
}

// ── k3cloud_create_tab_page ────────────────────────────────────────────

function createTabPageTool(
  connector: K3CloudConnector,
  projectId: string,
  sessionMgr: SessionMgrLike,
): ToolHandler {
  return {
    definition: {
      name: 'k3cloud_create_tab_page',
      description:
        '在指定 TabControl 下新建一个 TabPage(单页签)。' +
        '\n\n默认 `parentTabControlKey="FTab1"`(原厂单据体侧 TabControl,所有 K/3 单据都有)。' +
        '想挂到自建 TabControl 时传 `k3cloud_create_tab_control` 返回的 `tabControlKey`。' +
        '\n\n**位置**:默认追加到该 TabControl 下所有现有页签的最右侧(自动算 max ZOrderIndex+1)。' +
        '想插到指定位置时显式传 `zOrderIndex`(0 = 最左,序号越大越靠右)。' +
        '\n\n返回 `{ ok, tabPageKey, zOrderIndex }`。后续:' +
        '\n- 在该 TabPage 上挂 entry → `k3cloud_create_entry(parentTabPageKey=tabPageKey)`',
      parameters: {
        type: 'object',
        properties: {
          extId: { type: 'string', description: '扩展 FID。' },
          parentTabControlKey: {
            type: 'string',
            description:
              '父 TabControl 的 Key。默认 "FTab1"(原厂单据体侧)。自建则传 k3cloud_create_tab_control 返回的 tabControlKey。',
          },
          caption: { type: 'string', description: 'TabPage 显示文字,默认 "页签"。' },
          zOrderIndex: {
            type: 'number',
            description:
              '页签序号(BOS 单据上的"页签序号"属性)。0=最左、序号越大越靠右。' +
              '不传默认取 max(同 parent 下现有页签序号)+1,即追加到最右侧。',
          },
        },
        required: ['extId'],
      },
    },
    async execute(args) {
      const extId = String(args.extId ?? '').trim();
      if (!extId) throw new Error('k3cloud_create_tab_page 需要 extId 参数。');
      const parentKey =
        String(args.parentTabControlKey ?? ORIGINAL_ENTRY_TAB_CONTROL).trim() ||
        ORIGINAL_ENTRY_TAB_CONTROL;
      const caption =
        String(args.caption ?? DEFAULT_TAB_PAGE_CAPTION).trim() || DEFAULT_TAB_PAGE_CAPTION;
      const explicitZ =
        args.zOrderIndex != null ? Number(args.zOrderIndex) : null;
      if (explicitZ != null && (!Number.isInteger(explicitZ) || explicitZ < 0)) {
        throw new Error('k3cloud_create_tab_page 的 zOrderIndex 必须为非负整数。');
      }

      const { ext, project, layoutInfoOid, existing, parentKernelXml } =
        await loadExtensionForSave(
          connector,
          projectId,
          extId,
          'k3cloud_create_tab_page',
        );

      let pageKey: string;
      if (parentKey === ORIGINAL_ENTRY_TAB_CONTROL) {
        // Original-vendor tab control — independent random suffix per page.
        pageKey = `FTab1_${project.devCode}_P_${gen3CharLcSuffix()}`;
      } else {
        // Self-built TabControl — keep the parent's suffix on children.
        // Compute next P-index: scan existing tab pages whose Container matches
        // parentKey and find max P<idx> + 1.
        let maxIdx = -1;
        const idxRe = /_P(\d+)_/;
        for (const raw of existing.tabPages) {
          if (readChildText(raw, 'Container') !== parentKey) continue;
          const k = readChildText(raw, 'Key') ?? '';
          const m = k.match(idxRe);
          if (m) {
            const n = Number(m[1]);
            if (n > maxIdx) maxIdx = n;
          }
        }
        const nextIdx = maxIdx + 1;
        // Reuse parent's 3-char suffix (last 3 chars after final '_' in the
        // common case `F_<DevCode>_Tab_<3char>`).
        const tail = parentKey.slice(-3);
        pageKey = `${parentKey}_P${nextIdx}_${tail}`;
      }

      const auto = nextTabIndices(parentKernelXml, existing.tabPages, parentKey);
      const pageIndex = explicitZ ?? auto.pageIndex;
      const zOrderIndex = explicitZ ?? auto.zOrderIndex;
      const addTabPages: BosTabPageAppearance[] = [
        { key: pageKey, caption, container: parentKey, pageIndex, zOrderIndex },
      ];
      const req = buildSaveRequest(ext, project, layoutInfoOid, existing, { addTabPages });
      const session = await sessionMgr.getOrLogin(projectId);
      const result = await saveExtensionRpc(session, req);

      if (!result.isSuccess) {
        return JSON.stringify(
          {
            ok: false,
            extId,
            tabPageKey: pageKey,
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
          tabPageKey: pageKey,
          parentTabControlKey: parentKey,
          pageIndex,
          zOrderIndex,
          reminder:
            'TabPage 已建(页签序号 ' +
            pageIndex +
            ',Z 序 ' +
            zOrderIndex +
            ',追加在末尾)。挂 entry 上去:`k3cloud_create_entry(parentTabPageKey="' +
            pageKey +
            '")`。',
        },
        null,
        2,
      );
    },
  };
}

// ── k3cloud_create_entry ───────────────────────────────────────────────

function createEntryTool(
  connector: K3CloudConnector,
  projectId: string,
  sessionMgr: SessionMgrLike,
): ToolHandler {
  return {
    definition: {
      name: 'k3cloud_create_entry',
      description:
        '在已有 BOS 扩展上新建一个单据体(EntryEntity / 明细行)。' +
        '\n\n用户说"加一个明细 / 加一个表体 / 在订单上加一行子表"时用本工具。' +
        '工具内部会调服务端的 GetSequenceInt32 拿一个全局唯一 int,自动按 BOS 内部约定生成 EntryName / TableName / Key。' +
        '\n\n**前置**:必须先有一个 TabPage 收纳 entry —— 调 `k3cloud_create_tab_page`(默认挂到原厂 FTab1 下)拿到 `tabPageKey`,把它传给本工具的 `parentTabPageKey`。' +
        '\n\n返回 `{ ok, entryKey, tableName, entryName, seq, parentTabPageKey }`。后续:' +
        '\n- 给 entry 加字段 → `k3cloud_add_fields(container=entryKey)`(工具自动识别 entry 路径,emit EntityKey,Tabindex 每 entry 独立)',
      parameters: {
        type: 'object',
        properties: {
          extId: { type: 'string', description: '扩展 FID。' },
          name: { type: 'string', description: '单据体的中文显示名,例 "质检明细"。' },
          parentTabPageKey: {
            type: 'string',
            description:
              '父 TabPage 的 Key。先调 k3cloud_create_tab_page(可挂到 FTab1)或 k3cloud_get_form_layout 找现有 TabPage。',
          },
          mustInput: {
            type: 'boolean',
            description:
              '(可选)单据体必录(至少一行)。`true` 时单据保存前 BOS 会校验该 entry 至少有一行数据,空提交被拦下。默认 false。',
          },
          isShowSeq: {
            type: 'boolean',
            description:
              '(可选)是否显示行序号列,**默认 true**(BOS Designer 新建 entry 的默认行为)。极少需要传 false。',
          },
        },
        required: ['extId', 'name', 'parentTabPageKey'],
      },
    },
    async execute(args) {
      const extId = String(args.extId ?? '').trim();
      if (!extId) throw new Error('k3cloud_create_entry 需要 extId 参数。');
      const name = String(args.name ?? '').trim();
      if (!name) throw new Error('k3cloud_create_entry 需要 name 参数。');
      const parentTabPageKey = String(args.parentTabPageKey ?? '').trim();
      if (!parentTabPageKey) {
        throw new Error('k3cloud_create_entry 需要 parentTabPageKey 参数。');
      }
      // Plan 5.12.7 — entity-level required + show-seq (default true).
      const mustInput = args.mustInput === true ? true : undefined;
      const isShowSeq = args.isShowSeq === false ? false : true;

      const { ext, project, layoutInfoOid, existing, parentKernelXml } =
        await loadExtensionForSave(connector, projectId, extId, 'k3cloud_create_entry');

      let allocatedInt: number;
      try {
        allocatedInt = await connector.getNextSequenceInt32(SEQUENCE_CATEGORY_CUST_ENTRY, 1);
      } catch (err) {
        if (err instanceof BosResponseError) {
          return JSON.stringify(
            {
              ok: false,
              extId,
              stage: 'GetSequenceInt32',
              messageDetail: err.responseBody,
              hint: '服务端拒绝分配 entry 内码。常见原因:登录会话过期(关闭客户端重登,或重连项目)/ 账套数据库异常 / 用户无 BOS 写权限。',
            },
            null,
            2,
          );
        }
        throw err;
      }
      const devCode = project.devCode;
      const entryName = `${devCode}_Cust_Entry${allocatedInt}`;
      const tableName = `${devCode}_t_Cust_Entry${allocatedInt}`;
      const entryKey = `F_${devCode}_Entity_${gen3CharLcSuffix()}`;

      // Seq = parent.entries + ext.existingEntries + 1
      let parentEntryCount = 0;
      if (parentKernelXml) {
        for (const e of parseFormLayoutContainers(parentKernelXml).entries) {
          if (e.kind === 'entry') parentEntryCount++;
        }
      }
      const extEntryCount = existing.entries.length;
      const seq = parentEntryCount + extEntryCount + 1;

      const addEntries: BosEntryElement[] = [
        { key: entryKey, name, entryName, tableName, seq, mustInput },
      ];
      const addEntryAppearances: BosEntryAppearance[] = [
        { key: entryKey, caption: name, container: parentTabPageKey, isShowSeq },
      ];
      // The default toolbar BarButtons (新增行 / 删除行) reference service
      // names that must be registered as FormOperations on the Form root —
      // without these the buttons render but clicks don't fire any row
      // operation. OperationId 19 = 新增记录 / 4 = 删除记录 (BOS built-in
      // row ops). 2026-05-04 实证: BOS Designer adds these alongside the
      // BarItems whenever you add an entry-level button.
      const svc = defaultEntryServiceNames(entryKey);
      const addFormOperations: BosFormOperationElement[] = [
        { service: svc.insert, operationId: 19, operationName: '新增记录', entryKey },
        { service: svc.delete, operationId: 4, operationName: '删除记录', entryKey },
      ];
      const req = buildSaveRequest(ext, project, layoutInfoOid, existing, {
        addEntries,
        addEntryAppearances,
        addFormOperations,
      });

      const session = await sessionMgr.getOrLogin(projectId);
      let result;
      try {
        result = await saveExtensionRpc(session, req);
      } catch (err) {
        if (err instanceof BosResponseError) {
          return JSON.stringify(
            {
              ok: false,
              extId,
              entryKey,
              stage: 'SaveForIDEV9',
              messageDetail: err.responseBody,
            },
            null,
            2,
          );
        }
        throw err;
      }

      if (!result.isSuccess) {
        return JSON.stringify(
          {
            ok: false,
            extId,
            entryKey,
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
          entryKey,
          tableName,
          entryName,
          seq,
          parentTabPageKey,
          reminder:
            '单据体已建。加字段到该 entry:`k3cloud_add_fields(extId, fields=[{...container="' +
            entryKey +
            '"}])`,工具会自动走 entry-field 路径。BOS Designer 中需点工具栏刷新按钮才能看到;客户端缓存可能需要关闭重登。',
        },
        null,
        2,
      );
    },
  };
}

// ── delete tools ───────────────────────────────────────────────────────

function deleteEntryTool(
  connector: K3CloudConnector,
  projectId: string,
  sessionMgr: SessionMgrLike,
): ToolHandler {
  return {
    definition: {
      name: 'k3cloud_delete_entry',
      description:
        '从 BOS 扩展上删除一个**扩展自建**的单据体(EntryEntity)。' +
        '\n\n会级联清掉该 entry 下挂的所有扩展字段(EntityKey 命中的)和对应的 EntryEntityAppearance。' +
        '\n\n**只能删扩展自建的 entry**(以 `F_<DevCode>_Entity_` 开头);原厂自带的 entry(如 `FSaleOrderEntry`)不能删,工具会拒。',
      parameters: {
        type: 'object',
        properties: {
          extId: { type: 'string', description: '扩展 FID。' },
          entryKey: { type: 'string', description: '要删除的 entry key,如 F_PAIJ_Entity_xxx。' },
        },
        required: ['extId', 'entryKey'],
      },
    },
    async execute(args) {
      const extId = String(args.extId ?? '').trim();
      const entryKey = String(args.entryKey ?? '').trim();
      if (!extId) throw new Error('k3cloud_delete_entry 需要 extId 参数。');
      if (!entryKey) throw new Error('k3cloud_delete_entry 需要 entryKey 参数。');

      const { ext, project, layoutInfoOid, existing } = await loadExtensionForSave(
        connector,
        projectId,
        extId,
        'k3cloud_delete_entry',
      );

      const filtered: ExistingExtensionElements = {
        ...existing,
        entries: existing.entries.filter((raw) => readChildText(raw, 'Key') !== entryKey),
        entryAppearances: existing.entryAppearances.filter(
          (raw) => readChildText(raw, 'Key') !== entryKey,
        ),
        // Cascade: drop any field element / appearance whose EntityKey equals
        // the entry being deleted.
        fields: existing.fields.filter(
          (raw) => readChildText(raw, 'EntityKey') !== entryKey,
        ),
        appearances: existing.appearances.filter(
          (raw) => readChildText(raw, 'EntityKey') !== entryKey,
        ),
        // Cascade: drop FormOperations registered for this entry's row buttons.
        formOperations: existing.formOperations.filter(
          (raw) => readChildText(raw, 'OperationObjectKey') !== entryKey,
        ),
      };

      const req = buildSaveRequest(ext, project, layoutInfoOid, filtered);
      const session = await sessionMgr.getOrLogin(projectId);
      const result = await saveExtensionRpc(session, req);

      if (!result.isSuccess) {
        return JSON.stringify(
          {
            ok: false,
            extId,
            entryKey,
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
          entryKey,
          reminder:
            '单据体已删除(连带级联清理了该 entry 下的扩展字段)。BOS Designer 中需点工具栏刷新按钮;客户端缓存可能需关闭重登。',
        },
        null,
        2,
      );
    },
  };
}

function deleteTabPageTool(
  connector: K3CloudConnector,
  projectId: string,
  sessionMgr: SessionMgrLike,
): ToolHandler {
  return {
    definition: {
      name: 'k3cloud_delete_tab_page',
      description:
        '从 BOS 扩展上删除一个 TabPage。**会先检查是否有 entry 挂在这个 page 上**,有则拒绝并返回挂着的 entry 列表 —— 用户须先用 `k3cloud_delete_entry` 清掉那些 entry。',
      parameters: {
        type: 'object',
        properties: {
          extId: { type: 'string', description: '扩展 FID。' },
          tabPageKey: { type: 'string', description: '要删除的 TabPage Key。' },
        },
        required: ['extId', 'tabPageKey'],
      },
    },
    async execute(args) {
      const extId = String(args.extId ?? '').trim();
      const tabPageKey = String(args.tabPageKey ?? '').trim();
      if (!extId) throw new Error('k3cloud_delete_tab_page 需要 extId 参数。');
      if (!tabPageKey) throw new Error('k3cloud_delete_tab_page 需要 tabPageKey 参数。');

      const { ext, project, layoutInfoOid, existing } = await loadExtensionForSave(
        connector,
        projectId,
        extId,
        'k3cloud_delete_tab_page',
      );

      // Refuse if any entry is attached to this page.
      const attached: string[] = [];
      for (const raw of existing.entryAppearances) {
        if (readChildText(raw, 'Container') === tabPageKey) {
          const k = readChildText(raw, 'Key');
          if (k) attached.push(k);
        }
      }
      if (attached.length > 0) {
        return JSON.stringify(
          {
            ok: false,
            extId,
            tabPageKey,
            attachedEntries: attached,
            messageDetail:
              'TabPage 上还挂着 entry,先用 k3cloud_delete_entry 清掉这些 entry 再删 page。',
          },
          null,
          2,
        );
      }

      const filtered: ExistingExtensionElements = {
        ...existing,
        tabPages: existing.tabPages.filter(
          (raw) => readChildText(raw, 'Key') !== tabPageKey,
        ),
      };
      const req = buildSaveRequest(ext, project, layoutInfoOid, filtered);
      const session = await sessionMgr.getOrLogin(projectId);
      const result = await saveExtensionRpc(session, req);

      if (!result.isSuccess) {
        return JSON.stringify(
          {
            ok: false,
            extId,
            tabPageKey,
            messageTitle: result.messageTitle,
            messageDetail: result.messageDetail,
          },
          null,
          2,
        );
      }
      return JSON.stringify(
        { ok: true, extId, tabPageKey, reminder: 'TabPage 已删除。BOS Designer 刷新工具栏。' },
        null,
        2,
      );
    },
  };
}

function deleteTabControlTool(
  connector: K3CloudConnector,
  projectId: string,
  sessionMgr: SessionMgrLike,
): ToolHandler {
  return {
    definition: {
      name: 'k3cloud_delete_tab_control',
      description:
        '从 BOS 扩展上删除一个 TabControl(级联删除其下所有 TabPage)。**先检查所有子 page 上无 entry 挂着**,有则拒绝并列出挂着的 entry —— 用户须先 `k3cloud_delete_entry` 清掉。',
      parameters: {
        type: 'object',
        properties: {
          extId: { type: 'string', description: '扩展 FID。' },
          tabControlKey: { type: 'string', description: '要删除的 TabControl Key。' },
        },
        required: ['extId', 'tabControlKey'],
      },
    },
    async execute(args) {
      const extId = String(args.extId ?? '').trim();
      const tabControlKey = String(args.tabControlKey ?? '').trim();
      if (!extId) throw new Error('k3cloud_delete_tab_control 需要 extId 参数。');
      if (!tabControlKey) throw new Error('k3cloud_delete_tab_control 需要 tabControlKey 参数。');

      const { ext, project, layoutInfoOid, existing } = await loadExtensionForSave(
        connector,
        projectId,
        extId,
        'k3cloud_delete_tab_control',
      );

      // Single-pass split: drop child TabPages, keep the rest, while
      // collecting the dropped Keys so the entry-attachment check runs
      // against the right set.
      const childPageKeys = new Set<string>();
      const tabPagesKept: string[] = [];
      for (const raw of existing.tabPages) {
        if (readChildText(raw, 'Container') === tabControlKey) {
          const k = readChildText(raw, 'Key');
          if (k) childPageKeys.add(k);
          continue;
        }
        tabPagesKept.push(raw);
      }

      // Refuse if any entry is attached to any of those pages.
      const attached: string[] = [];
      for (const raw of existing.entryAppearances) {
        const cont = readChildText(raw, 'Container');
        if (cont && childPageKeys.has(cont)) {
          const k = readChildText(raw, 'Key');
          if (k) attached.push(k);
        }
      }
      if (attached.length > 0) {
        return JSON.stringify(
          {
            ok: false,
            extId,
            tabControlKey,
            attachedEntries: attached,
            messageDetail:
              'TabControl 下的 TabPage 上还挂着 entry,先用 k3cloud_delete_entry 清掉这些 entry 再删 TabControl。',
          },
          null,
          2,
        );
      }

      const filtered: ExistingExtensionElements = {
        ...existing,
        tabControls: existing.tabControls.filter(
          (raw) => readChildText(raw, 'Key') !== tabControlKey,
        ),
        tabPages: tabPagesKept,
      };
      const req = buildSaveRequest(ext, project, layoutInfoOid, filtered);
      const session = await sessionMgr.getOrLogin(projectId);
      const result = await saveExtensionRpc(session, req);

      if (!result.isSuccess) {
        return JSON.stringify(
          {
            ok: false,
            extId,
            tabControlKey,
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
          tabControlKey,
          cascadedTabPageCount: childPageKeys.size,
          reminder: 'TabControl 及其 ' + childPageKeys.size + ' 个子 TabPage 已删除。BOS Designer 刷新工具栏。',
        },
        null,
        2,
      );
    },
  };
}

// ── rename tools ───────────────────────────────────────────────────────

interface RenameToolSpec {
  toolName: string;
  description: string;
  /** Argument name carrying the target Key (entryKey / tabPageKey / tabControlKey). */
  keyArgName: string;
  /** Argument name carrying the new value (newName for entry, newCaption for tabs). */
  valueArgName: string;
  /**
   * For each `existing.<bucket>` chunk whose `<Key>` matches, replace `<tag>` text.
   * Listed in order of mutation: entry rename hits BOTH entries (Name) and
   * entryAppearances (Caption); tab tools hit one bucket each.
   */
  mutations: Array<{
    bucket: keyof Pick<
      ExistingExtensionElements,
      'entries' | 'entryAppearances' | 'tabPages' | 'tabControls'
    >;
    tag: 'Name' | 'Caption';
  }>;
}

function makeRenameTool(
  connector: K3CloudConnector,
  projectId: string,
  sessionMgr: SessionMgrLike,
  spec: RenameToolSpec,
): ToolHandler {
  return {
    definition: {
      name: spec.toolName,
      description: spec.description,
      parameters: {
        type: 'object',
        properties: {
          extId: { type: 'string' },
          [spec.keyArgName]: { type: 'string' },
          [spec.valueArgName]: { type: 'string' },
        },
        required: ['extId', spec.keyArgName, spec.valueArgName],
      },
    },
    async execute(args) {
      const extId = String(args.extId ?? '').trim();
      const targetKey = String(args[spec.keyArgName] ?? '').trim();
      const newValue = String(args[spec.valueArgName] ?? '').trim();
      if (!extId) throw new Error(`${spec.toolName} 需要 extId 参数。`);
      if (!targetKey) throw new Error(`${spec.toolName} 需要 ${spec.keyArgName} 参数。`);
      if (!newValue) throw new Error(`${spec.toolName} 需要 ${spec.valueArgName} 参数。`);

      const { ext, project, layoutInfoOid, existing } = await loadExtensionForSave(
        connector,
        projectId,
        extId,
        spec.toolName,
      );

      const updated: ExistingExtensionElements = { ...existing };
      for (const m of spec.mutations) {
        updated[m.bucket] = existing[m.bucket].map((raw) =>
          readChildText(raw, 'Key') === targetKey
            ? replaceChildText(raw, m.tag, newValue)
            : raw,
        );
      }
      const req = buildSaveRequest(ext, project, layoutInfoOid, updated);
      const session = await sessionMgr.getOrLogin(projectId);
      const result = await saveExtensionRpc(session, req);
      if (!result.isSuccess) {
        return JSON.stringify(
          {
            ok: false,
            extId,
            [spec.keyArgName]: targetKey,
            messageTitle: result.messageTitle,
            messageDetail: result.messageDetail,
          },
          null,
          2,
        );
      }
      return JSON.stringify(
        { ok: true, extId, [spec.keyArgName]: targetKey, [spec.valueArgName]: newValue },
        null,
        2,
      );
    },
  };
}

function renameEntryTool(c: K3CloudConnector, p: string, s: SessionMgrLike): ToolHandler {
  return makeRenameTool(c, p, s, {
    toolName: 'k3cloud_rename_entry',
    description:
      '改单据体(EntryEntity)的中文名。**同时改 EntryEntity 的 `<Name>` 和 EntryEntityAppearance 的 `<Caption>`,保持一致** —— BOS Designer 自身重命名只改 Name,我们工具显式同步两边。',
    keyArgName: 'entryKey',
    valueArgName: 'newName',
    mutations: [
      { bucket: 'entries', tag: 'Name' },
      { bucket: 'entryAppearances', tag: 'Caption' },
    ],
  });
}

function renameTabPageTool(c: K3CloudConnector, p: string, s: SessionMgrLike): ToolHandler {
  return makeRenameTool(c, p, s, {
    toolName: 'k3cloud_rename_tab_page',
    description: '改 TabPage 的标题(Caption)。',
    keyArgName: 'tabPageKey',
    valueArgName: 'newCaption',
    mutations: [{ bucket: 'tabPages', tag: 'Caption' }],
  });
}

function renameTabControlTool(c: K3CloudConnector, p: string, s: SessionMgrLike): ToolHandler {
  return makeRenameTool(c, p, s, {
    toolName: 'k3cloud_rename_tab_control',
    description: '改 TabControl 的标题(Caption)。',
    keyArgName: 'tabControlKey',
    valueArgName: 'newCaption',
    mutations: [{ bucket: 'tabControls', tag: 'Caption' }],
  });
}
