import sql from 'mssql';

// K3DBConfiger* is the K/3 Cloud central management DB.
const pool = await sql.connect({
  server: 'localhost',
  port: 1433,
  database: 'K3DBConfiger2026321425507',
  user: 'sa',
  password: '123',
  options: { encrypt: true, trustServerCertificate: true },
});

console.log('\n=== Tables in K3DBConfiger ===');
const tables = await pool.request().query(
  `SELECT name FROM sys.tables ORDER BY name`,
);
for (const r of tables.recordset) console.log(' -', r.name);

// Look for any table with our known acctId
const known = '69a531ee82525a';
console.log(`\n=== Searching for ${known} ===`);
for (const t of tables.recordset) {
  try {
    const cols = await pool.request().query(
      `SELECT name FROM sys.columns WHERE object_id = OBJECT_ID('${t.name}')`,
    );
    const colNames: string[] = cols.recordset.map((c: { name: string }) => c.name);
    // Build a SELECT that scans all string-y columns for the value
    const stringCols = colNames.filter((n) =>
      /id|number|name|database|center|key|guid/i.test(n),
    );
    if (stringCols.length === 0) continue;
    const where = stringCols
      .map((c) => `CAST(${c} AS NVARCHAR(200)) = N'${known}'`)
      .join(' OR ');
    const r = await pool.request().query(
      `SELECT TOP 5 * FROM ${t.name} WHERE ${where}`,
    );
    if (r.recordset.length > 0) {
      console.log(`  🎯 in table ${t.name}:`);
      console.log(JSON.stringify(r.recordset, null, 2));
    }
  } catch (err) {
    // ignore
  }
}

await pool.close();
