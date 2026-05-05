/**
 * Business-rule HeadEntity overlay templates for SaveForIDEV9.
 *
 * Path A (TS string-template overlay) — the v0.1 solution validated by
 * `.scratch/probes/spike-bizrule-writeback.ts` for Plan 5.12.3b Task 3.1.
 *
 * Why string templates instead of bridge-emitted DCXML:
 *   - A real BOS extension's FKERNELXML is a tiny stub `<Form action="edit"
 *     oid="BOS_BillModel">` (~361 chars), with empty BusinessInfo. The
 *     HeadEntity that owns EntityServiceRules / Field UpdateActions lives
 *     in the **parent** object (e.g. SAL_SaleOrder). Bridge ops that try
 *     to walk the extension's BusinessInfo throw "no HeadEntity found" on
 *     real-shape inputs — they're tuned for fixture XML.
 *   - The wire BOS Designer ships on Save is a minimal HeadEntity overlay
 *     keyed on the parent's HeadEntity oid plus an `action="edit"`
 *     attribute. Server merges this delta into the persisted FKERNELXML.
 *     Spike confirmed:
 *       * Server accepts the overlay
 *       * Round-trip read returns the rule with server-assigned defaults
 *       * `<EntityServiceRule action="remove" oid="..."/>` deletes by id
 *
 * Architecture debt: hard-coding BOS wire shape in TS means BOS major
 * upgrades that tighten format requirements will surface here first. v0.2
 * may revisit by porting the BOS DCXML emitter or by capturing baselines
 * per BOS version. Live with it for v0.1.
 *
 * Field-level UpdateAction overlay (`<Field action="edit" oid="...">
 * <UpdateActions>...`) is **not** in this module yet — Plan 5.12.3b
 * Task 3.5 owns spiking and adding it.
 */

/**
 * One business service inside an EntityServiceRule's
 * `<WhenTrueBusinessServices>` collection.
 *
 * `className` is the BOS internal element name — verified shapes:
 *   - `FormBusinessService`            (base class — entity-level Calculate, ActionId=2)
 *   - `GetInvStockBusinessServiceMeta` (subclass — GetInvStock, ActionId=67)
 *
 * `properties` is a flat name → value map serialized as `<Name>value</Name>`
 * children. Values are XML-escaped before emission. Subclass-specific
 * properties (e.g. `<StockQtyField>` for GetInvStock) go here.
 */
export interface EntityServiceRuleService {
  className: string;
  actionId: number;
  /** 32-hex-char service id (caller-generated GUID, lowercased without dashes). */
  id: string;
  description?: string;
  properties?: Record<string, unknown>;
}

export interface EntityServiceRuleArgs {
  /** Caller-generated rule GUID (dashed form recommended; both accepted). */
  ruleId: string;
  description: string;
  /** IronPython expression. `'True'` is the "always fire" sentinel. */
  preCondition: string;
  /** Optional human description; server fills with setnull when omitted. */
  preConditionDesc?: string;
  /**
   * Sequence index. Defaults to 1 when omitted — BOS Designer ships 1 for
   * a single-rule extension and re-numbers on save.
   */
  seq?: number;
  services: EntityServiceRuleService[];
}

/**
 * XML-escape a string value bound for an element body or attribute. Order
 * matters — `&` must be first or it would double-escape the entities we
 * emit on the next pass.
 */
function xmlEscape(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * BOS XML element names are restricted to the C-identifier shape (the
 * .NET DCXML serializer reflects against type/property names). LLM-fed
 * `properties` keys are interpolated as element tags (`<Foo>val</Foo>`),
 * so we validate at the boundary — escaping doesn't help on tag names.
 */
const ELEMENT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
function assertElementName(name: string, context: string): void {
  if (!ELEMENT_NAME_PATTERN.test(name)) {
    throw new Error(
      `${context}: '${name}' is not a valid BOS element name (expected C-identifier shape /^[A-Za-z_][A-Za-z0-9_]*$/)`,
    );
  }
}

/**
 * Build the `<HeadEntity action="edit" oid="...">` overlay that adds one
 * EntityServiceRule (with N services in `<WhenTrueBusinessServices>`).
 *
 * Caller injects the result into the extension's FKERNELXML before
 * `</Elements>` via `injectOverlay`.
 */
export function buildAddEntityRuleOverlay(
  parentHeadOid: string,
  rule: EntityServiceRuleArgs,
): string {
  if (!parentHeadOid) throw new Error('buildAddEntityRuleOverlay: parentHeadOid is empty');
  if (!rule.ruleId) throw new Error('buildAddEntityRuleOverlay: rule.ruleId is empty');

  const seq = rule.seq ?? 1;
  const preConditionDescElement = rule.preConditionDesc
    ? `<PreConditionDesc>${xmlEscape(rule.preConditionDesc)}</PreConditionDesc>`
    : '';

  const servicesXml = rule.services
    .map((svc) => {
      assertElementName(svc.className, 'buildAddEntityRuleOverlay: service className');
      const descElement = svc.description
        ? `<Description>${xmlEscape(svc.description)}</Description>`
        : '';
      const propsXml = svc.properties
        ? Object.entries(svc.properties)
            .map(([k, v]) => {
              assertElementName(k, 'buildAddEntityRuleOverlay: service property name');
              return `<${k}>${xmlEscape(v)}</${k}>`;
            })
            .join('')
        : '';
      return (
        `<${svc.className}>` +
        `<ActionId>${svc.actionId}</ActionId>` +
        descElement +
        `<Id>${xmlEscape(svc.id)}</Id>` +
        propsXml +
        `</${svc.className}>`
      );
    })
    .join('');

  return (
    `<HeadEntity action="edit" oid="${xmlEscape(parentHeadOid)}" ElementType="34" ElementStyle="0">` +
    `<EntityServiceRules>` +
    `<EntityServiceRule>` +
    `<Id>${xmlEscape(rule.ruleId)}</Id>` +
    `<Description>${xmlEscape(rule.description)}</Description>` +
    `<PreCondition>${xmlEscape(rule.preCondition)}</PreCondition>` +
    preConditionDescElement +
    `<Seq>${seq}</Seq>` +
    `<WhenTrueBusinessServices>` +
    servicesXml +
    `</WhenTrueBusinessServices>` +
    `</EntityServiceRule>` +
    `</EntityServiceRules>` +
    `</HeadEntity>`
  );
}

/**
 * Build the remove overlay for an entity-level rule. Server resolves the
 * EntityServiceRule by its oid and detaches it; we don't have to know
 * which HeadEntity it came from beyond the parent oid we're scoping to.
 */
export function buildRemoveEntityRuleOverlay(
  parentHeadOid: string,
  ruleId: string,
): string {
  if (!parentHeadOid) throw new Error('buildRemoveEntityRuleOverlay: parentHeadOid is empty');
  if (!ruleId) throw new Error('buildRemoveEntityRuleOverlay: ruleId is empty');
  return (
    `<HeadEntity action="edit" oid="${xmlEscape(parentHeadOid)}" ElementType="34" ElementStyle="0">` +
    `<EntityServiceRules>` +
    `<EntityServiceRule action="remove" oid="${xmlEscape(ruleId)}" />` +
    `</EntityServiceRules>` +
    `</HeadEntity>`
  );
}

/**
 * Splice an overlay XML fragment into the extension's FKERNELXML, just
 * before the closing `</Elements>` tag. Throws when the marker is absent —
 * a malformed extension XML or a BOS format change that drops `<Elements>`
 * would otherwise silently produce a no-op save.
 */
export function injectOverlay(extKernelXml: string, overlayXml: string): string {
  const marker = '</Elements>';
  if (!extKernelXml.includes(marker)) {
    throw new Error(`injectOverlay: extension XML has no </Elements> marker — cannot inject overlay`);
  }
  return extKernelXml.replace(marker, overlayXml + marker);
}

/**
 * Pull the `oid` attribute from the (single) `<HeadEntity ...>` tag in a
 * parent object's FKERNELXML. Returns null when the parent's XML doesn't
 * declare a HeadEntity (rare — most BillModels do).
 *
 * Caller is expected to feed the **parent** (e.g. SAL_SaleOrder) FKERNELXML
 * here, not the extension's stub. The oid we read is the value the
 * `action="edit"` overlay needs to target.
 */
export function extractHeadEntityOid(parentKernelXml: string): string | null {
  const match = parentKernelXml.match(/<HeadEntity[^>]*\boid="([^"]+)"/);
  return match?.[1] ?? null;
}
