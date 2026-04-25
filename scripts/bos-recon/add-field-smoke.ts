/**
 * 一次性 smoke test — 绕过 UI / agent, 直接调 writer 层验证
 * `kingdee_add_field` 工具的底层 `addFieldToExtension` 能否端到端:
 *   ① 读扩展当前 FKERNELXML
 *   ② 插入 TextField + TextFieldAppearance 子树
 *   ③ UPDATE T_META_OBJECTTYPE
 *   ④ 用户 F5 刷新 BOS Designer → 能否看到字段
 *
 * 如果冲突 (扩展已有同 key 字段), 自动换成 F_DEMO_<ts 后缀>.
 *
 * 用完即删: 正式测完闭环后这个 script 没价值, 可 rm 掉。
 */

import sql from 'mssql';
import { loadSettings, resolveProjectConfig } from './config';
import { addFieldToExtension } from '../../src/main/erp/k3cloud/bos-writer';

const PROJECT_ID = 'p_mobmehj2_34p2xri7';
const EXT_ID = 'a4ad49d2-61c2-4000-9650-20e27c701675';
const BASE_KEY = 'F_DEMO';
const CAPTION = '演示字段';

async function main(): Promise<void> {
  const settings = await loadSettings();
  const cfg = resolveProjectConfig(settings, PROJECT_ID);
  const pool = new sql.ConnectionPool({
    server: cfg.server,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    options: cfg.options
  });
  await pool.connect();
  try {
    // 先看现有 XML, 避开重复 key
    const pre = await pool
      .request()
      .input('id', sql.VarChar(36), EXT_ID)
      .query<{ FKERNELXML: string | null }>(
        'SELECT FKERNELXML FROM T_META_OBJECTTYPE WHERE FID = @id'
      );
    const currentXml = pre.recordset[0]?.FKERNELXML ?? '';
    let key = BASE_KEY;
    if (currentXml.includes(`<Key>${BASE_KEY}</Key>`)) {
      key = `${BASE_KEY}_${Date.now().toString().slice(-6)}`;
      console.log(`[smoke] ${BASE_KEY} 已存在, 改用 ${key}`);
    }

    console.log(`[smoke] 调用 addFieldToExtension(ext=${EXT_ID}, key=${key}, caption=${CAPTION})`);
    const r = await addFieldToExtension(pool, PROJECT_ID, EXT_ID, 'text', {
      key,
      caption: CAPTION
    });
    console.log('[smoke] OK');
    console.log('  backupFile:', r.backupFile);
    console.log('  fieldKey:', key);
    console.log('  → 去 BOS Designer F5 刷新扩展, 应该能看到"' + CAPTION + '"');
  } finally {
    await pool.close();
  }
}

main().catch((err) => {
  console.error('[smoke] FAIL:', err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
