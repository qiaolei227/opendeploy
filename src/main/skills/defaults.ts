import type { KnowledgeSource } from '@shared/skill-types';

/**
 * Official skills sources shipped with the app. The manager iterates them in
 * order on update: first reachable one wins. Putting GitHub first matches
 * where the content actually lives; Gitee is a mirror for users behind the
 * Great Firewall.
 *
 * `location` is `owner/repo` format (no scheme, no `.git`). Adding an `@ref`
 * suffix would pin to a specific branch/tag; we leave it off so the app
 * always tracks the default branch.
 */
export const DEFAULT_KNOWLEDGE_SOURCES: KnowledgeSource[] = [
  {
    id: 'official-github',
    kind: 'github',
    location: 'qiaolei227/opendeploy-skills',
    label: 'OpenDeploy Skills (GitHub)'
  },
  {
    id: 'official-gitee',
    kind: 'gitee',
    location: 'qiaolei227/opendeploy-skills',
    label: 'OpenDeploy Skills (Gitee 镜像)'
  }
];
