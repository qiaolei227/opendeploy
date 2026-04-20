/**
 * discover-k3cloud-schema.ts — Plan 4 Task 1.
 *
 * One-shot diagnostic: connects to a local MSSQL instance, picks the K/3
 * Cloud database, scans tables whose names hint at metadata, and dumps
 * columns + a handful of sample rows to a JSON file.
 *
 * Output feeds Task 12's typed-query design. Do not ship this in the app.
 *
 * Usage:
 *   node --experimental-strip-types scripts/discover-k3cloud-schema.ts
 *
 * Env overrides (defaults match the user's local SQL Express in memory
 * `project_plan_4_decisions`):
 *   MSSQL_SERVER     default "localhost"
 *   MSSQL_INSTANCE   default "SQLEXPRESS"
 *   MSSQL_USER       default "sa"
 *   MSSQL_PASSWORD   default "123"
 *   MSSQL_DATABASE   if unset, the script lists candidate DBs and exits
 *   MSSQL_PORT       only used when MSSQL_INSTANCE is empty
 */

import sql from 'mssql';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER = process.env.MSSQL_SERVER ?? 'localhost';
const INSTANCE = process.env.MSSQL_INSTANCE ?? 'SQLEXPRESS';
const USER = process.env.MSSQL_USER ?? 'sa';
const PASSWORD = process.env.MSSQL_PASSWORD ?? '123';
const DATABASE = process.env.MSSQL_DATABASE ?? '';
const PORT = process.env.MSSQL_PORT ? Number(process.env.MSSQL_PORT) : undefined;

const HINT_PATTERNS = ['meta', 'bos', 'form', 'entity', 'field', 'property', 'schema'];
const SAMPLE_ROWS = 5;

type TableRef = { schema: string; table: string };
type ColumnInfo = {
  name: string;
  dataType: string;
  maxLen: number | null;
  nullable: boolean;
  default: string | null;
};
type TableDump = {
  schema: string;
  table: string;
  rowCount: number;
  columns: ColumnInfo[];
  sample: Record<string, unknown>[];
};

async function main(): Promise<void> {
  const baseConfig: sql.config = {
    server: SERVER,
    user: USER,
    password: PASSWORD,
    options: {
      instanceName: INSTANCE || undefined,
      trustServerCertificate: true,
      encrypt: true
    },
    pool: { max: 2, min: 0, idleTimeoutMillis: 10_000 }
  };
  if (PORT) baseConfig.port = PORT;

  if (!DATABASE) {
    console.log('No MSSQL_DATABASE set. Listing candidate databases on the server:\n');
    const dbPool = await new sql.ConnectionPool({ ...baseConfig, database: 'master' }).connect();
    try {
      const r = await dbPool.request().query<{ name: string }>(
        `SELECT name FROM sys.databases
          WHERE name NOT IN ('master','model','msdb','tempdb')
          ORDER BY name`
      );
      for (const row of r.recordset) console.log(`  - ${row.name}`);
      console.log('\nRerun with: MSSQL_DATABASE=<name> node --experimental-strip-types scripts/discover-k3cloud-schema.ts');
    } finally {
      await dbPool.close();
    }
    return;
  }

  const pool = await new sql.ConnectionPool({ ...baseConfig, database: DATABASE }).connect();
  try {
    const tables = await listHintTables(pool);
    console.log(`found ${tables.length} metadata-hint tables in database "${DATABASE}"`);

    const dumps: TableDump[] = [];
    for (const t of tables) {
      try {
        dumps.push(await dumpTable(pool, t));
        process.stdout.write('.');
      } catch (err) {
        console.warn(`\nfailed on ${t.schema}.${t.table}: ${(err as Error).message}`);
      }
    }
    process.stdout.write('\n');

    const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');
    await fs.mkdir(outDir, { recursive: true });
    const outFile = path.join(
      outDir,
      `k3cloud-schema-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    );
    await fs.writeFile(
      outFile,
      JSON.stringify(
        {
          server: SERVER,
          instance: INSTANCE,
          database: DATABASE,
          capturedAt: new Date().toISOString(),
          hintPatterns: HINT_PATTERNS,
          tables: dumps
        },
        null,
        2
      ) + '\n',
      'utf8'
    );
    console.log(`wrote ${outFile}`);
    console.log('paste the JSON (or attach the file) back in chat so Task 12 SQL can be designed.');
  } finally {
    await pool.close();
  }
}

async function listHintTables(pool: sql.ConnectionPool): Promise<TableRef[]> {
  // Match by case-insensitive LIKE on table name.
  const clauses = HINT_PATTERNS.map((_, i) => `TABLE_NAME LIKE @p${i}`).join(' OR ');
  const req = pool.request();
  HINT_PATTERNS.forEach((p, i) => req.input(`p${i}`, sql.NVarChar(64), `%${p}%`));
  const r = await req.query<{ TABLE_SCHEMA: string; TABLE_NAME: string }>(
    `SELECT TABLE_SCHEMA, TABLE_NAME
       FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_TYPE = 'BASE TABLE' AND (${clauses})
      ORDER BY TABLE_SCHEMA, TABLE_NAME`
  );
  return r.recordset.map((row) => ({ schema: row.TABLE_SCHEMA, table: row.TABLE_NAME }));
}

async function dumpTable(pool: sql.ConnectionPool, t: TableRef): Promise<TableDump> {
  const qualified = `[${t.schema}].[${t.table}]`;

  const colsRes = await pool
    .request()
    .input('schema', sql.NVarChar(128), t.schema)
    .input('table', sql.NVarChar(256), t.table)
    .query<{
      COLUMN_NAME: string;
      DATA_TYPE: string;
      CHARACTER_MAXIMUM_LENGTH: number | null;
      IS_NULLABLE: string;
      COLUMN_DEFAULT: string | null;
    }>(
      `SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE, COLUMN_DEFAULT
         FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @table
        ORDER BY ORDINAL_POSITION`
    );

  const columns: ColumnInfo[] = colsRes.recordset.map((c) => ({
    name: c.COLUMN_NAME,
    dataType: c.DATA_TYPE,
    maxLen: c.CHARACTER_MAXIMUM_LENGTH,
    nullable: c.IS_NULLABLE === 'YES',
    default: c.COLUMN_DEFAULT
  }));

  const rowCountRes = await pool.request().query<{ n: number }>(
    `SELECT COUNT_BIG(*) AS n FROM ${qualified}`
  );
  const rowCount = Number(rowCountRes.recordset[0]?.n ?? 0);

  const sampleRes = await pool.request().query<Record<string, unknown>>(
    `SELECT TOP ${SAMPLE_ROWS} * FROM ${qualified}`
  );

  return {
    schema: t.schema,
    table: t.table,
    rowCount,
    columns,
    sample: sampleRes.recordset
  };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
