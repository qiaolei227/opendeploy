/**
 * TypeScript DTOs for the FormOperations + toolbar button summary that
 * `connector.listOperations` returns. The shape mirrored the bridge's old
 * `list_operations` JSON response (originally in
 * `bos-bridge/BosContext.Operations.cs`) — that file was deleted in the
 * Plan 6 followup (2026-05-08) once `connector.listOperations` was switched
 * to the TS-side `operation-parser.ts`. Field names stayed in camelCase to
 * match what the bridge would have delivered, so existing tests + agent
 * tools didn't have to change.
 *
 * Keep this file purely declarative (no runtime). Connector wrappers and the
 * Phase 4 agent tools both consume these shapes; centralizing the typedefs
 * here mirrors how `business-rule-parser.ts` exposes its `ListBusinessRulesResult`.
 */

/**
 * One ServicePlugins entry on a FormOperation. PlugInType=0 → DLL, =1 →
 * IronPython. `hasPyScript` mirrors the bridge's flag (Phase 2 deviation 8 —
 * the bridge can't safely return the inline ScriptString in a list response,
 * so it just exposes whether one exists; agents must call the Python plugin
 * tools to read the body).
 */
export interface ParsedServicePlugin {
  className: string;
  plugInType: number;
  hasPyScript: boolean;
}

/**
 * One FormOperation node. `operationId` is the BOS operation discriminator
 * (45 = 自定义/DoNothing, 2 = 复制 variant, 21 = 审核, etc.). `operationName`
 * may be empty when a developer left the human caption blank.
 */
export interface ParsedFormOperation {
  operationKey: string;
  operationId: number;
  operationName?: string;
  expressValue?: string;
  operEleIds?: string;
  servicePlugins: ParsedServicePlugin[];
}

/**
 * One BarButtonItem + its BarItemLink, summarized. `parentEntityKey === null`
 * means the button lives on a FormAppearance (form-level toolbar);
 * non-null = entry-level toolbar bound to the named EntryEntityAppearance.
 *
 * `boundOperationKey === null` flags the orphan-shell case (BOS Designer
 * stripped ClickActions when the bound op was deleted — see recon §4.5).
 *
 * `toolbarKey` is the BarItemLink.ParentKey, i.e. which toolbar the button
 * attaches to. `null` happens when the link couldn't be resolved (shouldn't
 * happen for v0.1 add_toolbar_button output, but possible for legacy data).
 */
export interface ParsedToolbarButton {
  buttonKey: string;
  buttonId?: string;
  caption?: string;
  description?: string;
  seq: number;
  parentEntityKey?: string | null;
  boundOperationKey?: string | null;
  barItemLinkId?: string | null;
  toolbarKey?: string | null;
}

export interface ListOperationsResult {
  operations: ParsedFormOperation[];
  toolbarButtons: ParsedToolbarButton[];
}
