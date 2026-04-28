import sql from 'mssql';

const pool = await sql.connect({
  server: 'localhost',
  port: 1433,
  database: 'AIS20260302144343',
  user: 'sa',
  password: '123',
  options: { encrypt: true, trustServerCertificate: true },
});

const r = await pool.request().query(
  `SELECT FDATACENTERID, FNUMBER, FDATABASENAME FROM T_BAS_DataCenter`
);
console.log(JSON.stringify(r.recordset, null, 2));

await pool.close();
