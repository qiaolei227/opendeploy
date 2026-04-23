/**
 * Shared types for the Skills subsystem — see docs/plans/2026-04-20-plan-3-skills-infrastructure.md.
 *
 * Knowledge format mirrors Anthropic Claude Code's Skills: a directory containing a single
 * `SKILL.md` whose YAML frontmatter describes when to use the skill, and whose body is the
 * instruction markdown the agent loads on demand.
 */

/**
 * Primary category buckets used by the Skills page nav. Keeping this closed
 * enum-ish (vs free-form string) so the UI can show a stable filter row and
 * agents get consistent hints. Add values here deliberately — rebuilding the
 * seed manifest is cheap but UI copy is not.
 */
export type SkillCategory =
  | 'workflow'          // 流程方法论（需求澄清、交付节奏、决策骨架）
  | 'plugin-dev'        // 插件/二开技术骨架（事件、API、模板）
  | 'product-features'  // ERP 标准产品功能速查（SAL / PUR / STK / FIN / BD …）
  | 'bos-features'      // BOS 平台可定制能力速查（扩展字段 / 业务规则 / 插件类型 …）
  | 'integration'       // 外部系统对接(WebAPI / iPaaS / 事件订阅)
  | 'troubleshooting'   // 客户日常报错诊断索引(Plan 5.8 起新增)
  | 'sales'             // 销售域
  | 'purchase'          // 采购域
  | 'inventory'         // 库存域
  | 'finance'           // 财务域（AR/AP/GL）
  | 'basedata'          // 基础资料
  | 'metadata'          // 元数据查询 / 逆向
  | 'debugging';        // 调试诊断

/** YAML frontmatter contract for every SKILL.md file. */
export interface SkillFrontmatter {
  /** Stable machine identifier. Matches the enclosing directory name by convention. */
  name: string;
  /**
   * Human-readable display title shown on the Skills page card as the primary
   * label. When absent, the UI falls back to `name`. Authors are encouraged to
   * write this in the consultant's working language (usually 中文 here).
   */
  title?: string;
  /** One paragraph explaining when the agent should load this skill. Used for discovery. */
  description: string;
  /** Semver string (e.g. "1.0.0" or "0.2.0-beta.1"). */
  version: string;
  /** Primary category — used by the Skills page nav. Required for bundled skills. */
  category?: SkillCategory;
  /**
   * @deprecated Since v0.1 the skill's ERP affinity is derived from its
   * top-level namespace (`system/*` / `common/*` / `<erp>/*` e.g. `k3cloud/*`).
   * Legacy skills with this field are still parsed so third-party bundles
   * don't break, but new skills should leave it out — the namespace is
   * authoritative for filtering and display.
   */
  erpProvider?: string;
}

/**
 * Kind of supporting file that can live inside a skill directory alongside
 * `SKILL.md`. Two folders, semantic split mirrors Anthropic's convention:
 *
 * - `prompts/*.md` — procedural guidance the agent should *follow* when
 *   loaded (e.g. "when X happens, do Y"). Instructional.
 * - `references/*.md` — declarative material the agent can *look up* (e.g.
 *   event tables, API signatures, code templates). Reference data.
 *
 * Both are lazy-loaded via the `load_skill_file` tool so SKILL.md stays
 * small (it only lists what's available). This lets a skill carry many KB
 * of supporting content without bloating the system-prompt catalog.
 */
export type SkillResourceKind = 'prompts' | 'references';

export interface SkillResource {
  kind: SkillResourceKind;
  /** File base-name without `.md` suffix, e.g. `"events-reference"`. */
  name: string;
}

/** A discovered skill on disk — frontmatter plus its filesystem location. Body is not loaded. */
export interface SkillMeta extends SkillFrontmatter {
  /** `"<namespace>/<directory>"`, e.g. `"common/requirements-clarification"`. */
  id: string;
  /** Absolute path to the skill directory (the one that contains SKILL.md). */
  path: string;
  /**
   * Resources under `prompts/` and `references/` subfolders. Empty array
   * when the skill has no supporting files — a single SKILL.md is the
   * minimum viable skill.
   */
  resources: SkillResource[];
}

/** A skill with its body loaded — returned by `load_skill` and similar APIs. */
export interface LoadedSkill extends SkillMeta {
  /** Markdown body, frontmatter stripped. */
  body: string;
}

/** `manifest.json` at the knowledge-cache root — bundle-level version + per-skill integrity. */
export interface KnowledgeManifest {
  /** Manifest schema version; bump when the shape below changes. */
  schema: '1';
  /** Content version (semver) for the whole bundle. */
  version: string;
  /** Source ref the bundle was built from (git sha or tag). Optional for dev bundles. */
  sourceRef?: string;
  /** Per-skill integrity records. Order is not significant. */
  skills: Array<{
    /** Matches SkillMeta.id. */
    id: string;
    version: string;
    /**
     * SHA-256 hex digest of the skill's *entire directory* (SKILL.md plus
     * any `prompts/*.md` / `references/*.md`). Computed by hashing each
     * file, concatenating `<relative-path>:<file-sha256>\n` sorted by
     * path, then hashing the concatenation — deterministic and catches
     * any supporting-file edit, not just SKILL.md edits.
     */
    sha256: string;
  }>;
}

/** User-configured knowledge source used by the manager to install/update bundles. */
export interface KnowledgeSource {
  /** User-chosen stable id; used to distinguish multiple configured sources. */
  id: string;
  kind: 'github' | 'gitee' | 'local';
  /**
   * For `github` / `gitee`: `"owner/repo"` or `"owner/repo@ref"` (ref defaults to `main`).
   * For `local`: absolute path to a bundle directory (must contain `manifest.json`).
   */
  location: string;
  /** Optional display label shown in UI lists. */
  label?: string;
}
