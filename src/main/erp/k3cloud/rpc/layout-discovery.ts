/**
 * Discover the parent form's main `<LayoutInfo oid="...">` from its
 * FKERNELXML. Every BOS extension save needs this OID — it's the layout
 * view the new appearances merge into. BOS Designer reads it from the
 * parent's metadata at save time; we do the same.
 *
 * Empirical (2026-04-27 captures, SAL_SaleOrder): the OID lives at the
 * root level of the form's FKERNELXML inside `<LayoutInfos><LayoutInfo
 * oid="GUID">`. There's typically one main layout per form; if multiple
 * exist (variant layouts, locked-down printable forms), we take the first
 * one — that's what BOS Designer uses for the default editor view.
 */

const LAYOUT_INFO_OID_RE = /<LayoutInfo\b[^>]*\boid\s*=\s*"([^"]+)"/i;

/**
 * Extract the first `<LayoutInfo oid="...">` from raw FKERNELXML. Returns
 * `null` when none is found — caller decides whether that's an error
 * (typical) or skip (rare write modes that don't touch layout).
 */
export function extractLayoutInfoOid(kernelXml: string): string | null {
  const m = kernelXml.match(LAYOUT_INFO_OID_RE);
  return m ? m[1] : null;
}
