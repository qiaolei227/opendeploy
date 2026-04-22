/**
 * Create a SAL_SaleOrder extension programmatically and register one Python
 * plugin into it, replicating what BOS Designer writes when a user clicks
 * "register Python script".
 *
 * Replicates the full footprint we reverse-engineered from the user's
 * existing `719dec90-…` extension. All writes go through one SQL transaction
 * so a partial failure leaves the database unchanged.
 *
 * Not yet written: T_META_OBJECTTYPEVIEW — those 2 rows in the reference
 * extension correspond to list-view edits the user made alongside creating
 * the extension, not to plugin registration. If BOS refuses to surface our
 * extension without them, we add them back.
 */
import sql from 'mssql';
import { randomUUID } from 'node:crypto';
import os from 'node:os';

const CONFIG: sql.config = {
  server: 'localhost',
  port: 1433,
  database: 'AIS20260302144343',
  user: 'sa',
  password: '123',
  options: { encrypt: true, trustServerCertificate: true },
  requestTimeout: 120_000,
  connectionTimeout: 15_000
};

const PARENT_FORM_ID = 'SAL_SaleOrder';
const EXT_NAME = `opendeploy_auto_ext_${Math.floor(Date.now() / 1000)}`;
const PLUGIN_NAME = 'opendeploy_auto_test_1';
const PY_BODY = `# auto-created by OpenDeploy at ${new Date().toISOString()}`;
const USER_ID = 100002; // seen in T_BAS_OPERATELOG.FUSERID
const SUBSYSTEM_ID = '23'; // SCM · inherited from SAL_SaleOrder

/** .NET DateTime.Ticks = 100-ns intervals since 0001-01-01 00:00:00 UTC. */
function dotnetTicks(): string {
  const EPOCH_OFFSET_TICKS = 621355968000000000n; // ticks between 0001-01-01 and 1970-01-01
  return String(BigInt(Date.now()) * 10000n + EPOCH_OFFSET_TICKS);
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function extensionDeltaXml(extId: string, pluginName: string, pyBody: string): string {
  return (
    '<FormMetadata><BusinessInfo><BusinessInfo><Elements>' +
    `<Form action="edit" oid="BOS_BillModel" ElementType="100" ElementStyle="0">` +
    `<Id>${extId}</Id>` +
    '<FormPlugins>' +
    '<PlugIn ElementType="0" ElementStyle="0">' +
    `<ClassName>${xmlEscape(pluginName)}</ClassName>` +
    '<PlugInType>1</PlugInType>' +
    `<PyScript>${xmlEscape(pyBody)}</PyScript>` +
    '</PlugIn>' +
    '</FormPlugins>' +
    '</Form>' +
    '</Elements></BusinessInfo></BusinessInfo></FormMetadata>'
  );
}

async function main(): Promise<void> {
  const extId = randomUUID(); // GUID for the new extension
  const version = dotnetTicks();
  const hostname = os.hostname();
  const ip = Object.values(os.networkInterfaces())
    .flat()
    .filter((i): i is os.NetworkInterfaceInfo => !!i && !i.internal && i.family === 'IPv4')[0]?.address ?? '127.0.0.1';
  const computerInfo = `${ip};${hostname}`;
  const kernelXml = extensionDeltaXml(extId, PLUGIN_NAME, PY_BODY);

  const pool = await new sql.ConnectionPool(CONFIG).connect();
  try {
    // 0. Resolve the developer mark dynamically from this user's most recent
    // metadata write — BOS doesn't store the "current developer" in any
    // registry table; it's stamped onto every FSUPPLIERNAME the user saves.
    // Mirroring that read here keeps the extensions we create editable by
    // the same user in BOS Designer.
    const devProbe = await pool
      .request()
      .input('uid', sql.Int, USER_ID)
      .query<{ s: string | null }>(`
        SELECT TOP 1 FSUPPLIERNAME AS s
          FROM T_META_OBJECTTYPE
         WHERE FMODIFIERID = @uid AND FSUPPLIERNAME IS NOT NULL
         ORDER BY FMODIFYDATE DESC
      `);
    const developerId = devProbe.recordset[0]?.s ?? 'OPENDEPLOY';

    console.log('=== Extension creation plan ===');
    console.log(`  new extension FID   = ${extId}`);
    console.log(`  parent form         = ${PARENT_FORM_ID}`);
    console.log(`  extension name      = ${EXT_NAME}`);
    console.log(`  plugin name         = ${PLUGIN_NAME}`);
    console.log(`  version (ticks)     = ${version}`);
    console.log(`  developer mark      = ${developerId} ${devProbe.recordset[0]?.s ? '(from user history)' : '(fallback)'}`);
    console.log(`  computer info       = ${computerInfo}`);
    console.log();

    // 1. Read the parent form's inheritable fields so the extension picks
    // them up faithfully — model type, subsystem, inheritance path.
    const parent = await pool
      .request()
      .input('id', sql.VarChar(64), PARENT_FORM_ID)
      .query<{
        FMODELTYPEID: number | null;
        FSUBSYSID: string | null;
        FMODELTYPESUBID: number | null;
        FINHERITPATH: string;
      }>(`SELECT FMODELTYPEID, FSUBSYSID, FMODELTYPESUBID, FINHERITPATH
            FROM T_META_OBJECTTYPE WHERE FID = @id`);
    if (parent.recordset.length === 0) throw new Error(`parent form ${PARENT_FORM_ID} not found`);
    const p = parent.recordset[0];
    const modelTypeId = p.FMODELTYPEID ?? 100;
    const subsystemId = p.FSUBSYSID ?? SUBSYSTEM_ID;
    const modelTypeSubId = p.FMODELTYPESUBID ?? 100;
    // Extension's inherit path = ",<parentId>," + parent's own path.
    // Parent's path already starts with ',FOO,BAR,…', so prepend parent id.
    const inheritPath = `,${PARENT_FORM_ID}${p.FINHERITPATH}`;

    console.log('=== Parent inheritance ===');
    console.log(`  model type id        = ${modelTypeId}`);
    console.log(`  subsystem id         = ${subsystemId}`);
    console.log(`  model type sub id    = ${modelTypeSubId}`);
    console.log(`  inherit path         = ${inheritPath}`);
    console.log();

    // 2. Count what we're about to replicate from the parent.
    const refRows = await pool
      .request()
      .input('id', sql.VarChar(64), PARENT_FORM_ID)
      .query<{ n: number }>(`SELECT COUNT(*) AS n FROM T_META_OBJECTTYPEREF WHERE FOBJECTTYPEID = @id`);
    const trackerRows = await pool
      .request()
      .input('id', sql.VarChar(64), PARENT_FORM_ID)
      .query<{ n: number }>(`SELECT COUNT(*) AS n FROM T_META_TRACKERBILLTABLE WHERE FOBJECTTYPEID = @id`);

    console.log('=== Rows to clone from parent ===');
    console.log(`  T_META_OBJECTTYPEREF          = ${refRows.recordset[0].n}`);
    console.log(`  T_META_TRACKERBILLTABLE       = ${trackerRows.recordset[0].n}`);
    console.log();

    // 3. Wrap everything in a transaction.
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      // 3a. Core row in T_META_OBJECTTYPE.
      await new sql.Request(tx)
        .input('fid', sql.VarChar(36), extId)
        .input('mtype', sql.Int, modelTypeId)
        .input('sub', sql.VarChar(36), subsystemId)
        .input('msub', sql.Int, modelTypeSubId)
        .input('version', sql.VarChar(100), version)
        .input('xml', sql.NVarChar(sql.MAX), kernelXml)
        .input('base', sql.VarChar(36), PARENT_FORM_ID)
        .input('devtype', sql.SmallInt, 2)
        .input('dev', sql.VarChar(100), developerId)
        .input('inherit', sql.NVarChar(510), inheritPath)
        .input('user', sql.Int, USER_ID)
        .input('computer', sql.VarChar(255), computerInfo)
        .query(`
          INSERT INTO T_META_OBJECTTYPE
            (FID, FMODELTYPEID, FSUBSYSID, FMODELTYPESUBID, FVERSION, FISTEMPLATE,
             FKERNELXML, FBASEOBJECTID, FDEVTYPE, FSUPPLIERNAME, FINHERITPATH,
             FMODIFIERID, FMODIFYDATE, FCOMPUTERINFO, FMAINVERSION)
          VALUES
            (@fid, @mtype, @sub, @msub, @version, 0,
             @xml, @base, @devtype, @dev, @inherit,
             @user, GETDATE(), @computer, @version)
        `);
      console.log('  ✓ T_META_OBJECTTYPE');

      // 3b. Localized name.
      await new sql.Request(tx)
        .input('pkid', sql.VarChar(36), randomUUID().toUpperCase())
        .input('fid', sql.VarChar(36), extId)
        .input('name', sql.NVarChar(510), EXT_NAME)
        .query(`
          INSERT INTO T_META_OBJECTTYPE_L (FPKID, FID, FLOCALEID, FNAME, FKERNELXMLLANG)
          VALUES (@pkid, @fid, 2052, @name, '')
        `);
      console.log('  ✓ T_META_OBJECTTYPE_L');

      // 3c. Extension marker.
      await new sql.Request(tx)
        .input('fid', sql.VarChar(36), extId)
        .query(`INSERT INTO T_META_OBJECTTYPE_E (FID, FSEQ) VALUES (@fid, 0)`);
      console.log('  ✓ T_META_OBJECTTYPE_E');

      // 3d. NAMEEX self-reference.
      await new sql.Request(tx)
        .input('fid', sql.VarChar(36), extId)
        .query(`INSERT INTO T_META_OBJECTTYPENAMEEX (FENTRYID, FID) VALUES (@fid, @fid)`);
      console.log('  ✓ T_META_OBJECTTYPENAMEEX');

      // 3e. Localized NAMEEX.
      await new sql.Request(tx)
        .input('pkid', sql.VarChar(36), randomUUID())
        .input('fid', sql.VarChar(36), extId)
        .input('name', sql.NVarChar(510), EXT_NAME)
        .query(`
          INSERT INTO T_META_OBJECTTYPENAMEEX_L (FPKID, FENTRYID, FLOCALEID, FNAMEEX)
          VALUES (@pkid, @fid, 2052, @name)
        `);
      console.log('  ✓ T_META_OBJECTTYPENAMEEX_L');

      // 3f. Function interface row. FENTRYID in the reference extension is
      // a distinct UUID that's the same across rows in the same batch —
      // looks like a BOS-internal "batch id". A fresh random UUID works.
      await new sql.Request(tx)
        .input('entry', sql.VarChar(36), randomUUID())
        .input('fid', sql.VarChar(36), extId)
        .query(`
          INSERT INTO T_META_OBJECTFUNCINTERFACE (FENTRYID, FID, FFUNCID)
          VALUES (@entry, @fid, 2)
        `);
      console.log('  ✓ T_META_OBJECTFUNCINTERFACE');

      // 3g. Clone all foreign-key refs from parent.
      const cloneRef = await new sql.Request(tx)
        .input('ext', sql.VarChar(36), extId)
        .input('parent', sql.VarChar(64), PARENT_FORM_ID)
        .query(`
          INSERT INTO T_META_OBJECTTYPEREF (FOBJECTTYPEID, FREFOBJECTTYPEID, FTABLENAME, FFIELDNAME)
          SELECT @ext, FREFOBJECTTYPEID, FTABLENAME, FFIELDNAME
            FROM T_META_OBJECTTYPEREF
           WHERE FOBJECTTYPEID = @parent
        `);
      console.log(`  ✓ T_META_OBJECTTYPEREF (${cloneRef.rowsAffected[0]} rows cloned)`);

      // 3h. Clone tracker bill tables from parent. FTABLEID is a global-
      // unique int across every tracker row; cloning the parent's values
      // collides with itself. BOS's behavior is MAX(FTABLEID)+N so we do
      // the same — ROW_NUMBER across the parent rows gives a stable offset.
      const cloneTracker = await new sql.Request(tx)
        .input('ext', sql.VarChar(36), extId)
        .input('parent', sql.VarChar(64), PARENT_FORM_ID)
        .query(`
          DECLARE @maxId INT = (SELECT ISNULL(MAX(FTABLEID), 0) FROM T_META_TRACKERBILLTABLE);
          INSERT INTO T_META_TRACKERBILLTABLE (FTABLEID, FTABLENAME, FPKFIELDNAME, FOBJECTTYPEID)
          SELECT @maxId + ROW_NUMBER() OVER (ORDER BY FTABLEID),
                 FTABLENAME, FPKFIELDNAME, @ext
            FROM T_META_TRACKERBILLTABLE
           WHERE FOBJECTTYPEID = @parent
        `);
      console.log(`  ✓ T_META_TRACKERBILLTABLE (${cloneTracker.rowsAffected[0]} rows cloned)`);

      await tx.commit();
      console.log();
      console.log('Transaction committed.');
    } catch (err) {
      await tx.rollback();
      throw err;
    }

    // 4. Verify we can read back what we just wrote.
    const verify = await pool
      .request()
      .input('id', sql.VarChar(36), extId)
      .query<{
        FID: string;
        FBASEOBJECTID: string;
        FSUPPLIERNAME: string;
        xml: string;
      }>(`
        SELECT FID, FBASEOBJECTID, FSUPPLIERNAME,
               CAST(FKERNELXML AS nvarchar(max)) AS xml
          FROM T_META_OBJECTTYPE WHERE FID = @id
      `);
    console.log();
    console.log('=== Verification ===');
    console.log(JSON.stringify(verify.recordset[0], null, 2));

    console.log();
    console.log('=== Next step ===');
    console.log('Now open BOS Designer on SAL_SaleOrder and check:');
    console.log(`  1. "扩展" 列表里能看到 \`${EXT_NAME}\` 吗?`);
    console.log(`  2. 打开它,"插件配置信息" 里看到 \`${PLUGIN_NAME}\` 了吗?`);
    console.log(`  3. 客户端打开一张新建销售订单,能不能触发该 Python(BeforeSave 之类,但当前脚本是个空注释不会做事,只验证不报错加载即可)`);
  } finally {
    await pool.close().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
