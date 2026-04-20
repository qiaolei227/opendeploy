import { ipcMain } from 'electron';
import { loadSkillBody, scanSkills } from './skills/registry';
import { knowledgeDir } from './skills/paths';
import {
  checkUpdates,
  checkUpdatesFromDefaults,
  installFromDefaults,
  installFromSource,
  removeAll
} from './skills/manager';
import type { KnowledgeSource } from '@shared/skill-types';

export function registerSkillIpc(): void {
  ipcMain.handle('skills:list', async () => scanSkills(knowledgeDir()));

  ipcMain.handle('skills:load', async (_e, id: string) => {
    const all = await scanSkills(knowledgeDir());
    const meta = all.find((s) => s.id === id);
    if (!meta) throw new Error(`unknown skill: ${id}`);
    return loadSkillBody(meta);
  });

  ipcMain.handle('skills:install', async (_e, source: KnowledgeSource) =>
    installFromSource(source)
  );

  ipcMain.handle('skills:check-updates', async (_e, source: KnowledgeSource) =>
    checkUpdates(source)
  );

  ipcMain.handle('skills:remove-all', async () => removeAll());

  ipcMain.handle('skills:install-defaults', async () => {
    const r = await installFromDefaults();
    return { sourceId: r.source.id };
  });

  ipcMain.handle('skills:check-updates-defaults', async () => {
    const r = await checkUpdatesFromDefaults();
    return { sourceId: r.source.id, local: r.local, remote: r.remote };
  });
}
