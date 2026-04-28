import sql from 'mssql';

const known = '69a531ee82525a';

const pool = await sql.connect({
  server: 'localhost',
  port: 1433,
  database: 'AIS20260302144343',
  user: 'sa',
  password: '123',
  options: { encrypt: true, trustServerCertificate: true },
});

console.log('Searching ALL string columns in AIS20260302144343 for', known);
console.log('(this takes a minute...)');

const tables = await pool.request().query(
  `SELECT name FROM sys.tables ORDER BY name`,
);
console.log(`scanning ${tables.recordset.length} tables`);

let hits = 0;
for (const t of tables.recordset) {
  try {
    const cols = await pool.request().query(
      `SELECT c.name, ty.name as type FROM sys.columns c
       JOIN sys.types ty ON c.system_type_id = ty.system_type_id
       WHERE c.object_id = OBJECT_ID('${t.name}')`,
    );
    const stringCols: string[] = cols.recordset
      .filter((c: { type: string }) => /char|varchar|nvarchar|text/i.test(c.type))
      .map((c: { name: string }) => c.name);
    if (stringCols.length === 0) continue;
    const where = stringCols
      .map((c) => `CAST(${c} AS NVARCHAR(200)) = N'${known}'`)
      .join(' OR ');
    const r = await pool.request().query(
      `SELECT TOP 1 * FROM ${t.name} WHERE ${where}`,
    );
    if (r.recordset.length > 0) {
      console.log(`  🎯 in ${t.name}:`);
      const row = r.recordset[0];
      // Find which column matches
      for (const k of Object.keys(row)) {
        if (String(row[k]) === known) {
          console.log(`     ${k} = ${row[k]}`);
        }
      }
      hits++;
    }
  } catch (err) {
    // ignore
  }
}

console.log(`\nFinished. ${hits} tables had a hit.`);
await pool.close();
