import sql from 'mssql';

// The K/3 Cloud "central" DB — server installation typically creates one.
// Common names: K3CloudCenterDB, CenterDB, cosmic-center
for (const db of ['master', 'tempdb']) {
  const pool = await sql.connect({
    server: 'localhost',
    port: 1433,
    database: db,
    user: 'sa',
    password: '123',
    options: { encrypt: true, trustServerCertificate: true },
  });
  console.log(`\n=== Available DBs (probed via ${db}) ===`);
  const dbs = await pool.request().query(
    `SELECT name FROM sys.databases ORDER BY name`,
  );
  for (const r of dbs.recordset) console.log(' -', r.name);
  await pool.close();
  break; // only need to probe once
}
