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
import { bosSessionManager } from '../erp/k3cloud/rpc/session-manager';
import { deleteExtension as deleteExtensionRpc } from '../erp/k3cloud/rpc/delete-extension';
import { saveExtension as saveExtensionRpc } from '../erp/k3cloud/rpc/save-for-ide';
import { extractLayoutInfoOid } from '../erp/k3cloud/rpc/layout-discovery';
import { newCompactGuid } from '../erp/k3cloud/rpc/dcxml';
import type {
  BosFieldAppearance,
  BosFieldElement,
  SaveExtensionRequest,
} from '../erp/k3cloud/rpc/types';
import { getProject } from '../projects/store';

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
    addFieldTool(c, pid, sessionMgr),
    deleteExtensionTool(pid, sessionMgr),
  ];
}

// ─── Individual tools ─────────────────────────────────────────────────

interface SessionMgrLike {
  getOrLogin(projectId: string): Promise<import('../erp/k3cloud/rpc/http-client').KdSession>;
  invalidate(projectId: string): void;
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
        '- `kingdee_add_field` 添加扩展字段\n' +
        '- `kingdee_register_python_plugin` 挂 Python 表单插件\n' +
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
            '扩展已创建。后续添加字段 / 插件请把上面的 extId 传给 kingdee_add_field / kingdee_register_python_plugin。' +
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

// ─── kingdee_add_field ───────────────────────────────────────────────────
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
      if (!args.unitTypeKey) {
        throw new Error('unit 字段必须指定 unitTypeKey。');
      }
      if (!args.refBaseDataObjectKey) {
        throw new Error('unit 字段必须指定 refBaseDataObjectKey(单位组 BD_UnitGroup)。');
      }
      return {
        type: 'UnitField',
        key,
        caption,
        listTabIndex: lti,
        unitTypeKey: args.unitTypeKey,
        lookUpObjectId: args.refBaseDataObjectKey,
      };
  }
}

function buildAppearance(args: AddFieldArgs, elementType: BosFieldElement['type']): BosFieldAppearance {
  return {
    type: elementType,
    key: args.key,
    caption: args.caption,
    container: args.container ?? DEFAULT_CONTAINER,
    zOrderIndex: args.zOrderIndex ?? 99,
    tabindex: args.tabindex ?? args.listTabIndex ?? DEFAULT_LIST_TAB_INDEX_BASE,
    left: args.left ?? 10,
    top: args.top ?? 10,
    width: args.width,
    labelWidth: args.labelWidth,
  };
}

function addFieldTool(
  connector: K3CloudConnector,
  projectId: string,
  sessionMgr: SessionMgrLike,
): ToolHandler {
  return {
    definition: {
      name: 'kingdee_add_field',
      description:
        '给已有 BOS 扩展添加一个业务字段(写 FKERNELXML + 同步落库)。' +
        '\n\n字段类型(`type` 参数):' +
        '\n- text — 单行文本' +
        '\n- int — 整数' +
        '\n- decimal — 小数(可选 fieldScale / fieldPrecision)' +
        '\n- price — 单价' +
        '\n- amount — 金额' +
        '\n- qty — 数量(必带 controlFieldKey 指向同单据上的 UnitField)' +
        '\n- date — 日期 / 日期时间' +
        '\n- checkbox — 复选框' +
        '\n- base_data — 基础资料引用(必带 refBaseDataObjectKey,如 "BD_Customer" / "BD_MATERIAL"。可选 srcFindFieldName / srcDisplayFieldName)' +
        '\n- base_property — 基础资料属性带值(必带 sourceField 指向同单据已有的 BaseDataField key,如 "FCustId";可选 srcDisplayFieldName 选源字段名,如 "FName")。**用前先调 kingdee_describe_basedata** 反查目标基础资料能 srcDisplay 哪些字段。' +
        '\n- unit — 计量单位(必带 unitTypeKey + refBaseDataObjectKey)' +
        '\n\n**默认坐标 left=10 top=10(左上角)** — 会和原厂字段视觉重叠,用户必须在 BOS Designer 里拖到合适位置。' +
        '只在你确实知道目标坐标时才传 top / left 参数。' +
        '\n\n**写入后必反查闭环**:调 `kingdee_get_extension_fields <extId>` 验证字段已落库;' +
        '不要用 `kingdee_get_fields`(那个只看父对象的原厂字段,扩展字段永远查不到)。',
      parameters: {
        type: 'object',
        properties: {
          extId: { type: 'string', description: '扩展 FID(32 位 hex GUID)。' },
          type: {
            type: 'string',
            enum: [...FRIENDLY_TYPES],
            description: '字段类型。',
          },
          key: {
            type: 'string',
            description:
              '字段 Key, 如 "F_PAIJ_CreditWarn"。BOS 约定 F_ 开头, 仅字母 / 数字 / 下划线。这是表单绑定和 BOS Designer 显示的唯一标识。',
          },
          caption: {
            type: 'string',
            description: '中文显示标签, 如 "信用额度预警"。用户在表单上看到的就是这个。',
          },
          // numeric extras
          fieldScale: { type: 'number', description: '(decimal/price/amount/qty)小数位数。' },
          fieldPrecision: { type: 'number', description: '(decimal/price/amount/qty)总位数。' },
          // qty
          controlFieldKey: { type: 'string', description: '(qty)关联的 UnitField key。' },
          // base_data / unit
          refBaseDataObjectKey: {
            type: 'string',
            description:
              '(base_data 必填 / unit 必填)关联基础资料 FormID,如 "BD_Customer" / "BD_MATERIAL" / "BD_Department" / "BD_UnitGroup"。',
          },
          srcFindFieldName: { type: 'string', description: '(base_data 可选)源对象查找字段名,默认 "FNUMBER"。' },
          srcDisplayFieldName: { type: 'string', description: '(base_data 可选 / base_property 推荐)源字段显示名,默认 "FNAME"。' },
          // base_property
          sourceField: {
            type: 'string',
            description: '(base_property 必填)同单据已有的 BaseDataField key,如 "FCustId"。',
          },
          // unit
          unitTypeKey: { type: 'string', description: '(unit 必填)单位类型 key。' },
          // appearance
          container: { type: 'string', description: '(可选)容器 key,默认 "FTAB_P0"(主页签)。' },
          top: { type: 'number', description: '(可选)Top 像素,默认 10。' },
          left: { type: 'number', description: '(可选)Left 像素,默认 10。' },
          width: { type: 'number', description: '(可选)控件宽度像素,默认 300。' },
          labelWidth: { type: 'number', description: '(可选)标签宽度像素,默认 100。' },
          zOrderIndex: { type: 'number', description: '(可选)容器内排序,默认 99。' },
          tabindex: { type: 'number', description: '(可选)tab 顺序,默认 9000。' },
          listTabIndex: { type: 'number', description: '(可选)列表序号,默认 9000。' },
          layoutInfoOid: {
            type: 'string',
            description: '(高级)父单据布局 OID,通常自动发现,只在自动发现失败时手传。',
          },
        },
        required: ['extId', 'type', 'key', 'caption'],
      },
    },
    async execute(args) {
      const extId = String(args.extId ?? '').trim();
      const type = String(args.type ?? '') as FriendlyFieldType;
      const key = String(args.key ?? '').trim();
      const caption = String(args.caption ?? '').trim();
      if (!extId) throw new Error('kingdee_add_field 需要 extId 参数。');
      if (!FRIENDLY_TYPES.includes(type)) {
        throw new Error(`不支持的字段类型 "${type}"。可选: ${FRIENDLY_TYPES.join(' / ')}。`);
      }
      if (!key) throw new Error('kingdee_add_field 需要 key 参数。');
      if (!caption) throw new Error('kingdee_add_field 需要 caption 参数。');

      const project = await getProject(projectId);
      if (!project?.bos) {
        throw new Error('当前项目未配置 BOS 写入凭据,请到项目设置中补全。');
      }

      // Look up the extension to discover its parent FormID.
      const ext = await connector.getObject(extId);
      if (!ext) {
        throw new Error(`扩展 ${extId} 不存在。先用 kingdee_list_extensions 确认。`);
      }
      if (!ext.baseObjectId) {
        throw new Error(
          `${extId} 不是 BOS 扩展(FBASEOBJECTID 为空)。kingdee_add_field 只能用于扩展,不能直接改原厂表单。`,
        );
      }
      if (ext.modelTypeId == null || ext.subsystemId == null) {
        throw new Error(`扩展 ${extId} 元数据不完整(modelTypeId=${ext.modelTypeId}, subsystemId=${ext.subsystemId})。`);
      }

      // Resolve layoutInfoOid — agent override → parent FKERNELXML discovery.
      let layoutInfoOid =
        typeof args.layoutInfoOid === 'string' ? args.layoutInfoOid.trim() : '';
      if (!layoutInfoOid) {
        const xml = await connector.getKernelXml(ext.baseObjectId);
        if (!xml) {
          throw new Error(`父单据 ${ext.baseObjectId} 无 FKERNELXML,无法自动发现 layoutInfoOid。`);
        }
        const oid = extractLayoutInfoOid(xml);
        if (!oid) {
          throw new Error(
            `父单据 ${ext.baseObjectId} FKERNELXML 中未找到 <LayoutInfo oid="...">,请手动指定 layoutInfoOid。`,
          );
        }
        layoutInfoOid = oid;
      }

      // Build the typed AST node.
      const fieldArgs: AddFieldArgs = {
        extId,
        type,
        key,
        caption,
        fieldScale: args.fieldScale != null ? Number(args.fieldScale) : undefined,
        fieldPrecision: args.fieldPrecision != null ? Number(args.fieldPrecision) : undefined,
        controlFieldKey:
          args.controlFieldKey != null ? String(args.controlFieldKey) : undefined,
        refBaseDataObjectKey:
          args.refBaseDataObjectKey != null ? String(args.refBaseDataObjectKey) : undefined,
        srcFindFieldName:
          args.srcFindFieldName != null ? String(args.srcFindFieldName) : undefined,
        srcDisplayFieldName:
          args.srcDisplayFieldName != null ? String(args.srcDisplayFieldName) : undefined,
        sourceField: args.sourceField != null ? String(args.sourceField) : undefined,
        unitTypeKey: args.unitTypeKey != null ? String(args.unitTypeKey) : undefined,
        container: args.container != null ? String(args.container) : undefined,
        top: args.top != null ? Number(args.top) : undefined,
        left: args.left != null ? Number(args.left) : undefined,
        width: args.width != null ? Number(args.width) : undefined,
        labelWidth: args.labelWidth != null ? Number(args.labelWidth) : undefined,
        zOrderIndex: args.zOrderIndex != null ? Number(args.zOrderIndex) : undefined,
        tabindex: args.tabindex != null ? Number(args.tabindex) : undefined,
        listTabIndex: args.listTabIndex != null ? Number(args.listTabIndex) : undefined,
      };

      const fieldEl = buildFieldElement(fieldArgs);
      const appearance = buildAppearance(fieldArgs, fieldEl.type);

      const req: SaveExtensionRequest = {
        extension: {
          formId: extId,
          baseObjectId: ext.baseObjectId,
          modelTypeId: ext.modelTypeId,
          subSystemId: ext.subsystemId,
          name: [{ localeId: 2052, value: ext.name }],
          isv: { devCode: project.bos.devCode },
        },
        isNew: false,
        layoutInfoOid,
        addFields: [fieldEl],
        addAppearances: [appearance],
      };

      const session = await sessionMgr.getOrLogin(projectId);
      const result = await saveExtensionRpc(session, req);

      if (!result.isSuccess) {
        return JSON.stringify(
          {
            ok: false,
            extId,
            fieldKey: key,
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
          fieldKey: key,
          fieldType: fieldEl.type,
          caption,
          reminder:
            '字段已写入。BOS Designer 里需点扩展工具栏的刷新按钮才能看到;客户端表单缓存可能需要关闭客户端重登才会更新。' +
            '**字段默认落在容器左上角(left=10 top=10)会和原厂字段视觉重叠 — 这是预期的,客户在 BOS Designer 中手动拖到合适位置。**' +
            '验证字段已落库:调 kingdee_get_extension_fields(不是 kingdee_get_fields)。',
        },
        null,
        2,
      );
    },
  };
}
