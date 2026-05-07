/**
 * String-template overlays — Route C, frozen in sunset mode per
 * docs/architecture/bos-write-routes.md §3 Route C.
 *
 * **Lever 3 (2026-05-07) status**:
 * - `removeOperation` migrated to Route B (envelope rebuild, filter-existing).
 * - `buildAddCustomOperationOverlay` + `injectIntoForm` deleted as orphans
 *   (their last caller was `removeOperation` pre-lever-3; addCustomOperation
 *   itself moved to Route B in 5.12.6 hotfix #4).
 * - `buildAddToolbarButtonOverlay` / `buildRemoveToolbarButtonOverlay` /
 *   `buildRemoveOperationOverlay` REMAIN, used by toolbar-button flows that
 *   still need their own Route B migration. Migrating them requires extending
 *   `dcxml.ts` to emit BarButton deltas inside an existing-FormAppearance
 *   envelope — a non-trivial design + implementation cycle. Tracked as a
 *   followup task in `docs/architecture/bos-write-routes.md` §3 Route C.
 *
 * **Why these still exist after lever 3**: shipping toolbar-button migration
 * with delta-into-existing-appearance support takes a focused design pass
 * and capture-validation cycle; bundling it with lever 3 risked another
 * hotfix loop. The wire-replay snapshots (lever 2) lock the current shape
 * so a future migration PR can verify byte-identical behavior on the
 * Route B reimplementation before deleting these.
 *
 * **Do NOT add new functions here**. Per L1 doc anti-patterns, new BOS
 * write capabilities must use Route A or Route B.
 */

import { injectOverlay } from './business-rule-overlay';

export { injectOverlay };

/* ---------- Common ---------- */

const C_IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function xmlEscape(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function assertCIdent(name: string, label: string): void {
  if (!C_IDENT_RE.test(name)) {
    throw new Error(`${label}: must be a C-identifier (got "${name}")`);
  }
}

/* ---------- remove_operation ---------- */

/**
 * Build a `<Form action="edit">` overlay that removes one FormOperation
 * by key. BOS server's deserializer accepts `action="remove" oid=`
 * declarative removal on collection elements (5.12.3b business-rule
 * remove path uses identical pattern).
 */
export function buildRemoveOperationOverlay(operationKey: string): string {
  assertCIdent(operationKey, 'buildRemoveOperationOverlay: operationKey');
  return (
    `<FormOperations>` +
      `<FormOperation action="remove" oid="${xmlEscape(operationKey)}" />` +
    `</FormOperations>`
  );
}

/* ---------- add_toolbar_button ---------- */

export interface AddToolbarButtonArgs {
  extensionFormId: string;
  /** form-level FormAppearance oid (parent appearance container), or
   *  entry-level EntryEntityAppearance oid (resolved by entityKey). */
  appearanceOid: string;
  /** "FormAppearance" | "EntryEntityAppearance" — wire tag. */
  appearanceKind: 'FormAppearance' | 'EntryEntityAppearance';
  /** ElementType="100" for form-level, "35" for entry-level. */
  appearanceElementType: number;
  buttonKey: string;
  buttonId: string;
  caption: string;
  seq?: number;
  boundOperationKey: string;
  boundOperationName: string;
  toolbarKey: string;
  barDataManagerId: string;
  formBusinessServiceId: string;
  barItemLinkId: string;
}

export function buildAddToolbarButtonOverlay(args: AddToolbarButtonArgs): string {
  assertCIdent(args.buttonKey, 'buildAddToolbarButtonOverlay: buttonKey');
  assertCIdent(args.boundOperationKey, 'buildAddToolbarButtonOverlay: boundOperationKey');
  assertCIdent(args.toolbarKey, 'buildAddToolbarButtonOverlay: toolbarKey');
  if (!args.appearanceOid) throw new Error('appearanceOid required');
  const seq = args.seq ?? 1;
  // Build ClickActions JSON-array Parameters string.
  const paramsJson = JSON.stringify([args.boundOperationKey]);

  return (
    `<${args.appearanceKind} action="edit" oid="${xmlEscape(args.appearanceOid)}" ElementType="${args.appearanceElementType}" ElementStyle="1">` +
      `<Menu>` +
        `<BarDataManager>` +
          `<Id>${xmlEscape(args.barDataManagerId)}</Id>` +
          `<BarItems>` +
            `<BarButtonItem ElementType="2005" ElementStyle="1">` +
              `<Shortcut />` +
              `<Seq>${seq}</Seq>` +
              `<Description>按钮</Description>` +
              `<IsShowTitle>True</IsShowTitle>` +
              `<ClickActions>` +
                `<FormBusinessService>` +
                  `<ConfirmInfo />` +
                  `<Parameters>${xmlEscape(paramsJson)}</Parameters>` +
                  `<ActionId>23</ActionId>` +
                  `<Description>${xmlEscape('调用表单操作--' + args.boundOperationName)}</Description>` +
                  `<Id>${xmlEscape(args.formBusinessServiceId)}</Id>` +
                `</FormBusinessService>` +
              `</ClickActions>` +
              `<Caption>${xmlEscape(args.caption)}</Caption>` +
              `<Id>${xmlEscape(args.buttonId)}</Id>` +
              `<Key>${xmlEscape(args.buttonKey)}</Key>` +
            `</BarButtonItem>` +
          `</BarItems>` +
          `<BarItemLinks>` +
            `<BarItemLink>` +
              `<Id>${xmlEscape(args.barItemLinkId)}</Id>` +
              `<BarItemKey>${xmlEscape(args.buttonKey)}</BarItemKey>` +
              `<ParentKey>${xmlEscape(args.toolbarKey)}</ParentKey>` +
            `</BarItemLink>` +
          `</BarItemLinks>` +
        `</BarDataManager>` +
      `</Menu>` +
    `</${args.appearanceKind}>`
  );
}

/* ---------- remove_toolbar_button ---------- */

export function buildRemoveToolbarButtonOverlay(
  appearanceKind: 'FormAppearance' | 'EntryEntityAppearance',
  appearanceOid: string,
  appearanceElementType: number,
  buttonId: string,
  barItemLinkId: string,
): string {
  if (!appearanceOid) throw new Error('appearanceOid required');
  if (!buttonId) throw new Error('buttonId required');
  if (!barItemLinkId) throw new Error('barItemLinkId required');
  return (
    `<${appearanceKind} action="edit" oid="${xmlEscape(appearanceOid)}" ElementType="${appearanceElementType}" ElementStyle="1">` +
      `<Menu>` +
        `<BarDataManager>` +
          `<BarItems>` +
            `<BarButtonItem action="remove" oid="${xmlEscape(buttonId)}" />` +
          `</BarItems>` +
          `<BarItemLinks>` +
            `<BarItemLink action="remove" oid="${xmlEscape(barItemLinkId)}" />` +
          `</BarItemLinks>` +
        `</BarDataManager>` +
      `</Menu>` +
    `</${appearanceKind}>`
  );
}

/**
 * Find a `<FormAppearance ... oid=...>` or `<EntryEntityAppearance ... oid=...>`
 * in a parent-form FKERNELXML, returning {oid, elementType} or null. For
 * entry-level the caller passes an entityKey to disambiguate; the matched
 * appearance's `<Key>` child must equal `entityKey`.
 */
export function extractFormAppearanceLocation(parentKernelXml: string): {
  oid: string;
  elementType: number;
} | null {
  // FormAppearance is the form-level main toolbar container; oid attr is on
  // the appearance node itself, element type is 100 per req-96.
  const m = parentKernelXml.match(/<FormAppearance\b[^>]*\boid="([^"]+)"[^>]*\bElementType="(\d+)"/);
  if (!m) return null;
  return { oid: m[1], elementType: Number(m[2]) };
}

export function extractEntryEntityAppearanceLocation(
  parentKernelXml: string,
  entityKey: string,
): { oid: string; elementType: number } | null {
  // Walk EntryEntityAppearance blocks; match one whose <Key>X</Key> = entityKey.
  const re = /<EntryEntityAppearance\b[^>]*\boid="([^"]+)"[^>]*\bElementType="(\d+)"[\s\S]*?<\/EntryEntityAppearance>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(parentKernelXml)) !== null) {
    if (m[0].includes(`<Key>${entityKey}</Key>`)) {
      return { oid: m[1], elementType: Number(m[2]) };
    }
  }
  return null;
}
