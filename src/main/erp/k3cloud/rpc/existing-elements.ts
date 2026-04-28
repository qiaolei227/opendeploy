/**
 * Extract existing extension elements (fields / appearances / plugins) as raw
 * XML chunks, so a subsequent SaveForIDEV9 can re-emit them alongside whatever
 * the agent is adding/removing this round.
 *
 * Why raw chunks (not typed AST):
 *
 * SaveForIDEV9's DCXML is NOT incremental — it's a baseline diff. The server
 * applies the entire `<Elements>` / `<Appearances>` / `<FormPlugins>` content
 * as the extension's complete set of mods on top of the parent. If a save
 * sends only the new field, prior fields silently disappear. So every save
 * must include every element the extension already owns.
 *
 * Extracting them as typed AST (FieldMeta / etc.) and re-rendering loses
 * server-set details (id assignments, action attributes, edge metadata).
 * Capturing the raw substring and re-emitting verbatim is the safest
 * round-trip — bytes in == bytes out for unchanged elements.
 *
 * Wire format reference: memory `bos_save_for_ide_v9_wire_format.md`
 * (the "DCXML 是 baseline diff(累积),不是 incremental" correction).
 */

import {
  iterateTagTokens,
  stripCdataSections,
  restoreCdataInChunk,
} from '../fkernel-parsers';

export interface ExistingExtensionElements {
  /** Raw `<TextField>...</TextField>` etc. chunks for re-emit. */
  fields: string[];
  /** Raw `<TextFieldAppearance>...</TextFieldAppearance>` etc. chunks. */
  appearances: string[];
  /** Raw `<PlugIn>...</PlugIn>` chunks (CDATA-preserved). */
  plugins: string[];
  // ─── Plan 5.14 — entry / tab-page / tab-control raw chunks ──────────
  // Same baseline-diff requirement: every Save must include all the
  // extension's existing entries / tabs verbatim or BOS treats them as
  // deleted. Captured here for the create / delete / rename tools to
  // pass through.
  /** Raw `<EntryEntity>...</EntryEntity>` chunks. SubEntryEntity NOT captured
   * — Plan 5.14 supports single-level only. */
  entries: string[];
  /** Raw `<EntryEntityAppearance>...</EntryEntityAppearance>` chunks. */
  entryAppearances: string[];
  /** Raw `<TabPageAppearance>...</TabPageAppearance>` chunks (any parent —
   * original-vendor TabControl like FTab1 *or* extension-built TabControl). */
  tabPages: string[];
  /** Raw `<TabControlAppearance>...</TabControlAppearance>` chunks. */
  tabControls: string[];
}

/**
 * Find the first `<openName>...</closeName>` block at any depth and return
 * the body substring (between `>` of open and `<` of close). Returns null
 * when no balanced match is found.
 */
function findFirstBlockBody(xml: string, openName: string, closeName: string): string | null {
  let openEnd = -1;
  let depth = 0;
  for (const tk of iterateTagTokens(xml)) {
    if (tk.isSelfClose) continue;
    if (!tk.isClose) {
      if (openEnd < 0) {
        if (tk.tag === openName) {
          openEnd = tk.end;
          depth = 1;
        }
        continue;
      }
      depth++;
    } else {
      if (openEnd < 0) continue;
      depth--;
      if (depth === 0) {
        if (tk.tag === closeName) {
          return xml.substring(openEnd, tk.start);
        }
        // Mismatched close at depth 0 — corrupt nesting; bail.
        return null;
      }
    }
  }
  return null;
}

/**
 * Yield each direct child of a body. A "direct child" is an element whose
 * open tag brings depth from 0 to 1, with a matching close that brings it
 * back to 0. Self-closing elements at depth 0 also yield (raw spans the
 * `<X .../>` token).
 */
function* iterateDepth1Children(body: string): Generator<{ tag: string; raw: string }> {
  let depth = 0;
  let chunkStart = -1;
  let chunkTag = '';
  for (const tk of iterateTagTokens(body)) {
    if (tk.isSelfClose) {
      if (depth === 0) {
        yield { tag: tk.tag, raw: body.substring(tk.start, tk.end) };
      }
      continue;
    }
    if (!tk.isClose) {
      if (depth === 0) {
        chunkStart = tk.start;
        chunkTag = tk.tag;
      }
      depth++;
    } else {
      depth--;
      if (depth === 0 && tk.tag === chunkTag && chunkStart >= 0) {
        yield { tag: tk.tag, raw: body.substring(chunkStart, tk.end) };
        chunkStart = -1;
        chunkTag = '';
      }
    }
  }
}

/**
 * Walk an extension's current FKERNELXML and return raw chunks for every
 * field, appearance, and plugin the extension already owns. The returned
 * strings are ready to inject verbatim into a fresh DCXML envelope.
 *
 * Intentionally does NOT preserve `<Form>` / `<Elements>` wrappers — those
 * are scaffolding the emitter rebuilds each save. Only the diff-bearing
 * leaf chunks need to round-trip.
 *
 * Skips self-closing field markers like `<TextField action="remove" oid="X" />`
 * — those are commands, not state, and shouldn't be re-emitted.
 */
export function extractExistingExtensionElements(
  kernelXml: string,
): ExistingExtensionElements {
  const empty: ExistingExtensionElements = {
    fields: [],
    appearances: [],
    plugins: [],
    entries: [],
    entryAppearances: [],
    tabPages: [],
    tabControls: [],
  };
  if (!kernelXml) return empty;

  const { stripped, values } = stripCdataSections(kernelXml);

  const fields: string[] = [];
  const plugins: string[] = [];
  const appearances: string[] = [];
  const entries: string[] = [];
  const entryAppearances: string[] = [];
  const tabPages: string[] = [];
  const tabControls: string[] = [];

  // Fields + plugins + entries live under <Elements>.
  const elementsBody = findFirstBlockBody(stripped, 'Elements', 'Elements');
  if (elementsBody) {
    for (const child of iterateDepth1Children(elementsBody)) {
      if (child.tag === 'Form') {
        const formPluginsBody = findFirstBlockBody(child.raw, 'FormPlugins', 'FormPlugins');
        if (formPluginsBody) {
          for (const plug of iterateDepth1Children(formPluginsBody)) {
            if (plug.tag === 'PlugIn') {
              plugins.push(restoreCdataInChunk(plug.raw, values));
            }
          }
        }
        continue;
      }
      // EntryEntity — single-level only (SubEntryEntity skipped for v0.1).
      if (child.tag === 'EntryEntity') {
        if (child.raw.endsWith('/>')) continue;
        entries.push(child.raw);
        continue;
      }
      // Anything else ending in "Field" is a field element.
      if (/Field$/.test(child.tag)) {
        // Skip remove-action self-closers — those are deletion commands.
        if (child.raw.endsWith('/>')) continue;
        fields.push(child.raw);
      }
    }
  }

  // Appearances live under <Appearances> inside <LayoutInfo>. Mixed bag —
  // *FieldAppearance / TabPageAppearance / TabControlAppearance /
  // EntryEntityAppearance / WaterMark / ... — sorted into separate buckets
  // so each kind can be re-emitted in its proper section.
  const appearancesBody = findFirstBlockBody(stripped, 'Appearances', 'Appearances');
  if (appearancesBody) {
    for (const child of iterateDepth1Children(appearancesBody)) {
      if (child.raw.endsWith('/>')) continue;
      if (/FieldAppearance$/.test(child.tag)) {
        appearances.push(child.raw);
      } else if (child.tag === 'EntryEntityAppearance') {
        entryAppearances.push(child.raw);
      } else if (child.tag === 'TabPageAppearance') {
        tabPages.push(child.raw);
      } else if (child.tag === 'TabControlAppearance') {
        tabControls.push(child.raw);
      }
    }
  }

  return { fields, appearances, plugins, entries, entryAppearances, tabPages, tabControls };
}
