import { loadSettings, saveSettings } from '../settings';
import { makeId } from '@shared/id';
import type { Project } from '@shared/erp-types';

export type NewProjectInput = Omit<Project, 'id' | 'createdAt' | 'updatedAt'>;

/**
 * Project persistence, backed by settings.json. Keeping projects on the
 * existing settings file keeps the on-disk layout simple (one source of
 * truth for "user state") and avoids a migration dance. The small write
 * amplification of saving the whole blob is acceptable at project-CRUD
 * frequency.
 */

/**
 * Projects loaded from settings.json. Pre-migration entries (alpha builds
 * before the BOS-only switch) carry a SQL `connection` field but no `bos`
 * — they're stale and would crash the renderer that now reads `p.bos.acctId`
 * unconditionally. Drop them on load with a console warning so the user
 * sees an empty list and re-creates with the new BOS-only flow.
 */
export async function listProjects(): Promise<Project[]> {
  const all = (await loadSettings()).projects ?? [];
  const valid: Project[] = [];
  for (const p of all) {
    if (p.bos && typeof p.bos.acctId === 'string' && typeof p.bos.baseUrl === 'string') {
      valid.push(p);
    } else {
      console.warn(
        `[projects] dropping project "${p.name}" (${p.id}) — missing BOS credentials. ` +
          'It was created in the SQL-direct era; please re-create with the new BOS-only form.'
      );
    }
  }
  return valid;
}

export async function getProject(id: string): Promise<Project | null> {
  const all = await listProjects();
  return all.find((p) => p.id === id) ?? null;
}

export async function createProject(input: NewProjectInput): Promise<Project> {
  const settings = await loadSettings();
  const now = new Date().toISOString();
  const project: Project = {
    ...input,
    id: makeId('p'),
    createdAt: now,
    updatedAt: now
  };
  await saveSettings({
    ...settings,
    projects: [...(settings.projects ?? []), project]
  });
  return project;
}

export async function updateProject(
  id: string,
  patch: Partial<Omit<Project, 'id' | 'createdAt'>>
): Promise<Project> {
  const settings = await loadSettings();
  const projects = settings.projects ?? [];
  const idx = projects.findIndex((p) => p.id === id);
  if (idx === -1) throw new Error(`project not found: ${id}`);
  const merged: Project = {
    ...projects[idx],
    ...patch,
    id: projects[idx].id,
    createdAt: projects[idx].createdAt,
    updatedAt: new Date().toISOString()
  };
  const next = [...projects];
  next[idx] = merged;
  await saveSettings({ ...settings, projects: next });
  return merged;
}

export async function deleteProject(id: string): Promise<void> {
  const settings = await loadSettings();
  const projects = (settings.projects ?? []).filter((p) => p.id !== id);
  // Clear active id if it pointed to the deleted project.
  const activeProjectId =
    settings.activeProjectId === id ? undefined : settings.activeProjectId;
  await saveSettings({ ...settings, projects, activeProjectId });
}

export async function getActiveProjectId(): Promise<string | null> {
  return (await loadSettings()).activeProjectId ?? null;
}

export async function setActiveProjectId(id: string | null): Promise<void> {
  const settings = await loadSettings();
  if (id !== null) {
    const exists = (settings.projects ?? []).some((p) => p.id === id);
    if (!exists) throw new Error(`cannot activate unknown project: ${id}`);
  }
  await saveSettings({ ...settings, activeProjectId: id ?? undefined });
}
