/**
 * 从 OpenDeploy 产品的 settings.json 里按 projectId 解析出 mssql 连接配置,
 * 给 recon scripts 复用 —— 避免把密码放到 CLI 参数里。
 *
 * 目前只支持 k3cloud provider;其他 ERP 将来加 recon 支持时在这里分派。
 */

import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type sql from 'mssql';

export interface ReconMssqlConfig {
  server: string;
  port: number;
  database: string;
  user: string;
  password: string;
  options?: sql.config['options'];
}

interface RawK3CloudConnection {
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  encrypt?: boolean;
  trustServerCertificate?: boolean;
}

interface RawProject {
  id: string;
  erpProvider?: string;
  k3cloud?: RawK3CloudConnection;
}

interface RawSettings {
  projects?: RawProject[];
}

export function resolveProjectConfig(
  settings: RawSettings,
  projectId: string
): ReconMssqlConfig {
  const p = (settings.projects ?? []).find((x) => x.id === projectId);
  if (!p) throw new Error(`project "${projectId}" not found in settings`);
  if (p.erpProvider !== 'k3cloud') {
    throw new Error(`erpProvider "${p.erpProvider}" not supported by bos-recon`);
  }
  const k = p.k3cloud ?? {};
  return {
    server: k.host ?? 'localhost',
    port: k.port ?? 1433,
    database: k.database ?? '',
    user: k.user ?? '',
    password: k.password ?? '',
    options: {
      encrypt: k.encrypt ?? true,
      trustServerCertificate: k.trustServerCertificate ?? true
    }
  };
}

export function opendeploySettingsPath(): string {
  return path.join(os.homedir(), '.opendeploy', 'settings.json');
}

export async function loadSettings(): Promise<RawSettings> {
  const raw = await readFile(opendeploySettingsPath(), 'utf-8');
  return JSON.parse(raw) as RawSettings;
}
