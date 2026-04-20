/**
 * Shared types for the Skills subsystem — see docs/plans/2026-04-20-plan-3-skills-infrastructure.md.
 *
 * Knowledge format mirrors Anthropic Claude Code's Skills: a directory containing a single
 * `SKILL.md` whose YAML frontmatter describes when to use the skill, and whose body is the
 * instruction markdown the agent loads on demand.
 */

/** YAML frontmatter contract for every SKILL.md file. */
export interface SkillFrontmatter {
  /** Human-facing display name. Matches the enclosing directory name by convention. */
  name: string;
  /** One paragraph explaining when the agent should load this skill. Used for discovery. */
  description: string;
  /** Semver string (e.g. "1.0.0" or "0.2.0-beta.1"). */
  version: string;
  /** Free-form labels (e.g. ["common", "requirements"]) surfaced in UI filters. */
  tags?: string[];
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
