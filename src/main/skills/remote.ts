import type { KnowledgeSource } from '@shared/skill-types';

/**
 * Translates a `KnowledgeSource` into concrete HTTPS URLs. Kept separate from
 * the manager so that adding a new hosting service (e.g. Codeberg) is a matter
 * of implementing one more adapter and wiring it into `adapterFor` — the
 * manager stays identical.
 */
export interface RemoteSourceAdapter {
  /** URL for the repo tarball at the configured ref. */
  tarballUrl(source: KnowledgeSource): string;
  /** URL for a single raw file at the configured ref. */
  rawUrl(source: KnowledgeSource, filePath: string): string;
}

const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

function parseLocation(loc: string): { repo: string; ref: string } {
  const [repo, ref = 'main'] = loc.split('@');
  if (!REPO_RE.test(repo)) {
    throw new Error(`invalid repo: "${loc}" (expected "owner/repo" or "owner/repo@ref")`);
  }
  return { repo, ref };
}

const GITHUB: RemoteSourceAdapter = {
  tarballUrl(source) {
    const { repo, ref } = parseLocation(source.location);
    return `https://codeload.github.com/${repo}/tar.gz/refs/heads/${ref}`;
  },
  rawUrl(source, filePath) {
    const { repo, ref } = parseLocation(source.location);
    return `https://raw.githubusercontent.com/${repo}/${ref}/${filePath}`;
  }
};

const GITEE: RemoteSourceAdapter = {
  tarballUrl(source) {
    const { repo, ref } = parseLocation(source.location);
    return `https://gitee.com/${repo}/repository/archive/${ref}.tar.gz`;
  },
  rawUrl(source, filePath) {
    const { repo, ref } = parseLocation(source.location);
    return `https://gitee.com/${repo}/raw/${ref}/${filePath}`;
  }
};

export function adapterFor(source: KnowledgeSource): RemoteSourceAdapter {
  switch (source.kind) {
    case 'github':
      return GITHUB;
    case 'gitee':
      return GITEE;
    case 'local':
      throw new Error('local sources do not use a RemoteSourceAdapter; use the manager directly');
  }
}
