import sql from 'mssql';

const known = '69a531ee82525a';

for (const dbName of ['samom_core', 'samom_log']) {
  const pool = await sql.connect({
    server: 'localhost',
    port: 1433,
    database: dbName,
    user: 'sa',
    password: '123',
    options: { encrypt: true, trustServerCertificate: true },
  });

  console.log(`\n=== ${dbName} ===`);
  const tables = await pool.request().query(
    `SELECT name FROM sys.tables ORDER BY name`,
  );
  console.log('tables:', tables.recordset.length);

  for (const t of tables.recordset) {
    try {
      const cols = await pool.request().query(
        `SELECT name FROM sys.columns WHERE object_id = OBJECT_ID('${t.name}')`,
      );
      const colNames: string[] = cols.recordset.map((c: { name: string }) => c.name);
      const stringCols = colNames.filter((n) =>
        /id|center|name|database|number/i.test(n),
      );
      if (stringCols.length === 0) continue;
      const where = stringCols
        .map((c) => `CAST(${c} AS NVARCHAR(200)) = N'${known}'`)
        .join(' OR ');
      const r = await pool.request().query(
        `SELECT TOP 3 * FROM ${t.name} WHERE ${where}`,
      );
      if (r.recordset.length > 0) {
        console.log(`  🎯 in ${t.name}:`);
        console.log(JSON.stringify(r.recordset, null, 2));
      }
    } catch (err) {
      // ignore
    }
  }

  await pool.close();
}
