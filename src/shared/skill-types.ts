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
  | 'workflow'      // 流程方法论（需求澄清、交付节奏）
  | 'plugin-dev'    // 插件/二开技术骨架
  | 'sales'         // 销售域
  | 'purchase'      // 采购域
  | 'inventory'     // 库存域
  | 'finance'       // 财务域（AR/AP/GL）
  | 'basedata'      // 基础资料
  | 'metadata'      // 元数据查询 / 逆向
  | 'debugging';    // 调试诊断

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
  /** ERP provider this skill applies to (e.g. "kingdee-cosmic-v9"). Missing = generic. */
  erpProvider?: string;
}

/** A discovered skill on disk — frontmatter plus its filesystem location. Body is not loaded. */
export interface SkillMeta extends SkillFrontmatter {
  /** `"<namespace>/<directory>"`, e.g. `"common/requirements-clarification"`. */
  id: string;
  /** Absolute path to the skill directory (the one that contains SKILL.md). */
  path: string;
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
    /** SHA-256 hex digest of the skill's SKILL.md file. */
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
