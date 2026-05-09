/**
 * Persistent on-disk state for convert-rule extensions created by OpenDeploy.
 *
 * When we create an extension via SaveRulesV9, we store the extension's XML
 * and server-filled metadata (InheritPath, Version) in a JSON file. Subsequent
 * patch operations (add field map, set group-by, …) load this file, mutate
 * the XML via the .NET bridge, and write the updated XML back — so each save
 * builds on the correct current state rather than resetting to the template.
 *
 *   $OPENDEPLOY_HOME/projects/<projectId>/convert-rule-ext/<extId>.json
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { openDeployHome } from '../../../paths';

export interface ConvertRuleExtState {
  extId: string;
  /** Rule id of the origin (e.g. "SaleOrder-OutStock") — needed for SaveRulesV9. */
  originRuleId: string;
  /** Current DCXML of the extension. Updated after every successful patch. */
  xml: string;
  /** Comma-wrapped lineage path set by the server at creation time. */
  inheritPath: string | null;
  version: string | null;
  mainVersion: string | null;
  createdAt: string;
  updatedAt: string;
}

export function convertRuleExtDir(projectId: string): string {
  return path.join(openDeployHome(), 'projects', projectId, 'convert-rule-ext');
}

export function convertRuleExtStatePath(projectId: string, extId: string): string {
  return path.join(convertRuleExtDir(projectId), `${extId}.json`);
}

export async function saveConvertRuleExtState(
  projectId: string,
  state: ConvertRuleExtState,
): Promise<void> {
  const p = convertRuleExtStatePath(projectId, state.extId);
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * Load the persisted state for an extension. Throws a user-readable error
 * when the state file is missing — the extension was either created outside
 * OpenDeploy, on another machine, or the project directory was wiped.
 */
/**
 * List all locally-tracked extensions for a given origin rule id. Used by
 * `extendConvertRule` to refuse creating a second sibling — single-layer-tree
 * guard for convert rules (mirroring the form-extension guard). Returns an
 * empty array when the project's ext-state directory is empty / missing.
 *
 * Note: this only sees extensions OpenDeploy itself created on this machine.
 * If the customer has extensions made via BOS Designer or another machine,
 * they won't show up here — that's an acceptable v0.1 limitation since the
 * single-layer-tree rule is OpenDeploy's own discipline, not BOS's.
 */
export async function listConvertRuleExtsByOrigin(
  projectId: string,
  originRuleId: string,
): Promise<ConvertRuleExtState[]> {
  const dir = convertRuleExtDir(projectId);
  if (!existsSync(dir)) return [];
  const files = await readdir(dir);
  const out: ConvertRuleExtState[] = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const raw = await readFile(path.join(dir, f), 'utf-8');
      const state = JSON.parse(raw) as ConvertRuleExtState;
      if (state.originRuleId === originRuleId) out.push(state);
    } catch {
      // skip corrupt files
    }
  }
  return out;
}

export async function loadConvertRuleExtState(
  projectId: string,
  extId: string,
): Promise<ConvertRuleExtState> {
  const p = convertRuleExtStatePath(projectId, extId);
  if (!existsSync(p)) {
    throw new Error(
      `转换规则扩展 ${extId} 未找到本地状态(${p})。` +
        `该扩展可能不是由 OpenDeploy 创建的，或者在另一台机器上创建。` +
        `请用 k3cloud_create_convert_rule_extension 创建新扩展，或告知扩展来源。`,
    );
  }
  const raw = await readFile(p, 'utf-8');
  return JSON.parse(raw) as ConvertRuleExtState;
}
