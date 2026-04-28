/**
 * Probe: where does the 14-hex acctId (`69a531ee82525a`) live in the DB?
 * Try a few likely tables in both master and the account-set DB itself.
 */

import sql from 'mssql';

async function probeIn(database: string, label: string) {
  const pool = await sql.connect({
    server: 'localhost',
    port: 1433,
    database,
    user: 'sa',
    password: '123',
    options: { encrypt: true, trustServerCertificate: true },
  });

  console.log(`\n=== Probing ${label} (${database}) ===`);

  // 1. Look for any table with a column whose value matches our known acctId.
  const known = '69a531ee82525a';
  const TABLES_TO_TRY = [
    'T_BAS_DataCenter',
    'T_BAS_DataCenter_L',
    'T_BAS_AcctCtl',
    'T_BAS_DBLink',
    'T_PM_DataCenter',
    'K3DataCenter',
  ];
  for (const t of TABLES_TO_TRY) {
    try {
      const r = await pool.request().query(
        `SELECT TOP 1 name FROM sys.tables WHERE name = '${t}'`,
      );
      if (r.recordset.length > 0) {
        console.log(`  table exists: ${t}`);
        // describe columns
        const cols = await pool.request().query(
          `SELECT name, system_type_id FROM sys.columns WHERE object_id = OBJECT_ID('${t}')`,
        );
        const colList = cols.recordset.map((c: { name: string }) => c.name).join(', ');
        console.log(`    columns: ${colList}`);
        // try to find rows mentioning known acctId
        const rows = await pool.request().query(
          `SELECT TOP 5 * FROM ${t}`,
        );
        for (const row of rows.recordset) {
          const json = JSON.stringify(row);
          if (json.includes(known)) {
            console.log(`    🎯 row contains ${known}:`, json.substring(0, 500));
          }
        }
      }
    } catch (err) {
      // ignore
    }
  }

  await pool.close();
}

await probeIn('master', 'master');
await probeIn('AIS20260302144343', 'account-set');
