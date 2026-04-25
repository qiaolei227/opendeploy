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

/**
 * 对齐 src/shared/erp-types.ts 的 `K3CloudConnectionConfig` 形状 ——
 * 顶层 key 是 `connection`(不是 `k3cloud`), 字段名是 `server`(不是 `host`)。
 * 所有字段在这里都声明为 optional 做防御式解析, 但产品正常写入的 settings.json
 * server/database/user/password 都有值; 默认只在理论上兜底。
 */
interface RawConnection {
  server?: string;
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
  connection?: RawConnection;
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
  const c = p.connection ?? {};
  return {
    server: c.server ?? 'localhost',
    port: c.port ?? 1433,
    database: c.database ?? '',
    user: c.user ?? '',
    password: c.password ?? '',
    options: {
      encrypt: c.encrypt ?? true,
      trustServerCertificate: c.trustServerCertificate ?? true
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
