/**
 * 一次性 recon 脚本 — 拉取指定扩展的 FKERNELXML, 抽出业务规则相关节点
 * (EntityServiceRules / UpdateActions / FormBusinessService) 用于实证
 * `business-rules-corrected.md` 第 4 节推断的 XML 形态。
 *
 * Usage:
 *   pnpm dlx tsx scripts/extract-business-rule-xml.ts <extensionFid>
 *
 * 默认 extensionFid = '96d3fbdd-d383-4ea8-b119-4b9703b9567c' (dev SAL_SaleOrder 扩展)
 */

import sql from 'mssql';
import { loadSettings, resolveProjectConfig } from './bos-recon/config';

const DEFAULT_FID = '96d3fbdd-d383-4ea8-b119-4b9703b9567c';

async function main(): Promise<void> {
  const fid = process.argv[2] ?? DEFAULT_FID;

  const settings = await loadSettings();
  const projectId = settings.projects?.[0]?.id;
  if (!projectId) throw new Error('no project in settings.json');

  const cfg = resolveProjectConfig(settings, projectId);
  const pool = await sql.connect({
    server: cfg.server,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    options: cfg.options
  });

  const result = await pool.request()
    .input('fid', sql.NVarChar(36), fid)
    .query<{
      FID: string;
      FBASEOBJECTID: string;
      FKERNELXML_TEXT: string | null;
    }>(`
      SELECT FID, FBASEOBJECTID,
             CAST(FKERNELXML AS NVARCHAR(MAX)) AS FKERNELXML_TEXT
      FROM T_META_OBJECTTYPE
      WHERE FID = @fid
    `);

  await pool.close();

  if (result.recordset.length === 0) {
    console.error(`extension ${fid} not found in T_META_OBJECTTYPE`);
    process.exit(1);
  }

  const row = result.recordset[0];
  const xml = row.FKERNELXML_TEXT ?? '';

  console.log('=== 扩展元信息 ===');
  console.log(`FID: ${row.FID}`);
  console.log(`FBASEOBJECTID: ${row.FBASEOBJECTID}`);
  console.log(`FKERNELXML 总长度: ${xml.length} 字符`);
  console.log();

  // 抽出 EntityServiceRules 整段 (允许嵌套)
  const entitySrvMatches = xml.match(/<EntityServiceRules[\s\S]*?<\/EntityServiceRules>/g) ?? [];
  console.log(`=== <EntityServiceRules> 命中 ${entitySrvMatches.length} 段 ===`);
  entitySrvMatches.forEach((m, i) => {
    console.log(`\n--- 第 ${i + 1} 段 (${m.length} 字符) ---`);
    console.log(m);
  });
  console.log();

  // 抽出 UpdateActions 整段
  const updateActionsMatches = xml.match(/<UpdateActions[\s\S]*?<\/UpdateActions>/g) ?? [];
  console.log(`=== <UpdateActions> 命中 ${updateActionsMatches.length} 段 ===`);
  updateActionsMatches.forEach((m, i) => {
    console.log(`\n--- 第 ${i + 1} 段 (${m.length} 字符) ---`);
    console.log(m);
  });
  console.log();

  // 抽出 FormBusinessService 节点 (单独显示, 因为 ClassName / Parameters / RaiseEventType 是核心)
  const fbsMatches = xml.match(/<FormBusinessService[\s\S]*?<\/FormBusinessService>/g) ?? [];
  console.log(`=== <FormBusinessService> 命中 ${fbsMatches.length} 段 ===`);
  fbsMatches.forEach((m, i) => {
    console.log(`\n--- 第 ${i + 1} 段 ---`);
    console.log(m);
  });
  console.log();

  // 可能 BOS 用了别名 — 同时搜常见的可能变种
  const aliases = ['BusinessRules', 'BusinessRule', 'EntityServiceRule', 'BusinessService', 'ServiceRule', 'Rule '];
  console.log('=== 别名扫描 (可能的别名标签) ===');
  for (const alias of aliases) {
    const re = new RegExp(`<${alias}[^>]*>`, 'gi');
    const hits = xml.match(re);
    if (hits && hits.length > 0) {
      console.log(`<${alias}> — 命中 ${hits.length} 次`);
      // 显示前 3 个 + 周围少量 context
      for (let i = 0; i < Math.min(3, hits.length); i++) {
        const idx = xml.indexOf(hits[i]);
        console.log(`  [${i}] @${idx}: ${xml.slice(Math.max(0, idx - 20), idx + hits[i].length + 80)}`);
      }
    }
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
