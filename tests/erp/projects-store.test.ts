import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createProject,
  deleteProject,
  getActiveProjectId,
  getProject,
  listProjects,
  setActiveProjectId,
  updateProject,
  type NewProjectInput
} from '../../src/main/projects/store';
import type { K3CloudConnectionConfig } from '@shared/erp-types';

const cfg: K3CloudConnectionConfig = {
  server: 'localhost',
  database: 'AIS001',
  user: 'sa',
  password: '123'
};

const basicInput: NewProjectInput = {
  name: '川沙诚信商贸',
  erpProvider: 'k3cloud',
  connection: cfg
};

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'opendeploy-projects-'));
  process.env.OPENDEPLOY_HOME = testDir;
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
  delete process.env.OPENDEPLOY_HOME;
});

describe('projects store', () => {
  it('listProjects returns empty when nothing persisted', async () => {
    expect(await listProjects()).toEqual([]);
  });

  it('createProject stamps id + createdAt + updatedAt', async () => {
    const p = await createProject(basicInput);
    expect(p.id).toMatch(/^p_/);
    expect(p.createdAt).toBe(p.updatedAt);
    expect(new Date(p.createdAt).toString()).not.toBe('Invalid Date');
  });

  it('createProject persists so listProjects can read it back', async () => {
    await createProject(basicInput);
    const all = await listProjects();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('川沙诚信商贸');
  });

  it('getProject returns the matching project or null', async () => {
    const p = await createProject(basicInput);
    expect(await getProject(p.id)).not.toBeNull();
    expect(await getProject('ghost')).toBeNull();
  });

  it('updateProject merges patch and bumps updatedAt', async () => {
    const p = await createProject(basicInput);
    await new Promise((r) => setTimeout(r, 5)); // ensure updatedAt differs
    const updated = await updateProject(p.id, { name: 'renamed' });
    expect(updated.name).toBe('renamed');
    expect(updated.id).toBe(p.id);
    expect(updated.createdAt).toBe(p.createdAt);
    expect(updated.updatedAt >= p.updatedAt).toBe(true);
  });

  it('updateProject throws when the id is unknown', async () => {
    await expect(updateProject('nope', { name: 'x' })).rejects.toThrow(/not found/);
  });

  it('deleteProject removes the project from the list', async () => {
    const a = await createProject(basicInput);
    const b = await createProject({ ...basicInput, name: 'other' });
    await deleteProject(a.id);
    const all = await listProjects();
    expect(all.map((p) => p.id)).toEqual([b.id]);
  });

  it('deleteProject clears activeProjectId when it was the active one', async () => {
    const p = await createProject(basicInput);
    await setActiveProjectId(p.id);
    expect(await getActiveProjectId()).toBe(p.id);
    await deleteProject(p.id);
    expect(await getActiveProjectId()).toBeNull();
  });

  it('setActiveProjectId validates existence', async () => {
    await expect(setActiveProjectId('ghost')).rejects.toThrow(/unknown/);
  });

  it('setActiveProjectId(null) clears the active pointer', async () => {
    const p = await createProject(basicInput);
    await setActiveProjectId(p.id);
    await setActiveProjectId(null);
    expect(await getActiveProjectId()).toBeNull();
  });
});
