#!/usr/bin/env node
/**
 * Database script runner - uses the project's own Node.js + mssql driver, so no sqlcmd or SSMS is needed.
 *
 *   npm run db:check     test the connection and show what is in the database
 *   npm run db:init      run database/init.sql (creates the database, tables and seed data)
 *   npm run db:upgrade   run database/migration-v4-upgrade.sql on an existing database
 *   node database/run-sql.mjs <file.sql> [--db <name>]   run any GO-separated script
 *
 * Connection settings come from server/.env (copy .env.example): DB_SERVER, DB_PORT, DB_NAME,
 * DB_USER, DB_PASSWORD, DB_ENCRYPT, DB_TRUST_SERVER_CERTIFICATE, DB_TLS_MIN_VERSION.
 * Both scripts are safe to re-run: they only add what is missing and never delete data.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = { init: path.join(HERE, 'init.sql'), upgrade: path.join(HERE, 'migration-v4-upgrade.sql') };
const QUIET_INFO = new Set([5701, 5703]); // "Changed database context" / "Changed language setting"
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const VERSIONS = { 10: '2008', 11: '2012', 12: '2014', 13: '2016', 14: '2017', 15: '2019', 16: '2022', 17: '2025' };
const tty = process.stdout.isTTY;

const args = process.argv.slice(2);
const option = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const command = args[0] || 'help';

let sql, buildDbConfig;
try {
  ({ sql, buildDbConfig } = await import('../server/db.js'));
} catch (e) {
  if (e.code === 'ERR_MODULE_NOT_FOUND') fail('Server packages are not installed yet. Run: npm run install:all');
  throw e;
}
const base = buildDbConfig();
const targetDb = option('--db') || base.database;
const where = base.server.includes('\\') || base.server.includes(',') ? base.server : `${base.server}:${base.port}`;

// ---------------------------------------------------------------- helpers
function fail(message, extra) {
  status('');
  console.error(`\n✖ ${message}`);
  if (extra) console.error(`  ${extra}`);
  process.exit(1);
}
function status(text) { if (tty) process.stdout.write(`\r\x1b[K${text}`); }

function connectionHint(e) {
  const code = e.code || e.originalError?.code;
  const msg = String(e.message || '');
  if (code === 'ELOGIN' && /Cannot open database/i.test(msg)) return `Database ${targetDb} does not exist yet. Run: npm run db:init`;
  if (code === 'ELOGIN') return 'Check DB_USER / DB_PASSWORD in server/.env. It must be a SQL Server login (e.g. sa), and the server must allow "SQL Server and Windows Authentication mode" (SSMS > right-click the server > Properties > Security; restart the SQL Server service after changing it).';
  if (code === 'EINSTLOOKUP') return 'The named instance was not found. Start the "SQL Server Browser" service, or set DB_SERVER to just the host and DB_PORT to the instance\'s TCP port.';
  if (/unsupported protocol|wrong version number|EPROTO|SSL routines/i.test(msg)) return 'The server only offers an old TLS version (common on SQL Server 2012/2014 without updates). Install the latest service pack, or add DB_TLS_MIN_VERSION=TLSv1 to server/.env.';
  if (/self[- ]signed|certificate/i.test(msg)) return 'Set DB_TRUST_SERVER_CERTIFICATE=true in server/.env (local servers use a self-signed certificate).';
  const unreachable = ['ESOCKET', 'ETIMEOUT'].includes(code) || /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH/i.test(msg);
  if (unreachable && base.server.includes('\\')) {
    return `Cannot reach the named instance ${base.server}. Start the "SQL Server Browser" service (services.msc) and make sure TCP/IP is enabled for that instance (SQL Server Configuration Manager > SQL Server Network Configuration > Protocols > TCP/IP > Enabled, then restart the SQL Server service). Alternatively set DB_SERVER to just the host and DB_PORT to the instance's TCP port.`;
  }
  if (unreachable) {
    return 'Cannot reach SQL Server. Check that the SQL Server service is running and that TCP/IP is enabled (SQL Server Configuration Manager > SQL Server Network Configuration > Protocols > TCP/IP > Enabled, then restart the service). For a named instance such as localhost\\SQLEXPRESS also start the "SQL Server Browser" service; otherwise check DB_SERVER / DB_PORT.';
  }
  return '';
}

async function connect(database) {
  const pool = new sql.ConnectionPool(buildDbConfig({
    database,
    pool: { max: 1, min: 0, idleTimeoutMillis: 600000 }, // one connection, so every batch shares a session
    connectionTimeout: 20000,
    requestTimeout: 600000
  }));
  pool.on('error', () => {});
  try {
    await pool.connect();
  } catch (e) {
    fail(`Could not connect to SQL Server at ${where} (database ${database}): ${e.message}`, connectionHint(e));
  }
  return pool;
}

async function dbExists(pool, name) {
  const r = await pool.request().input('n', sql.NVarChar(128), name).query('SELECT DB_ID(@n) AS id');
  return r.recordset[0].id !== null;
}

/** Split a script into batches on GO lines, exactly like SSMS / sqlcmd; remembers each batch's first line. */
export function splitBatches(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const batches = [];
  let buf = [];
  let start = 1;
  const push = (repeat) => {
    const body = buf.join('\n');
    if (body.trim()) batches.push({ sql: body, line: start, repeat });
  };
  lines.forEach((line, i) => {
    const go = /^\s*GO(?:\s+(\d+))?\s*(?:--.*)?$/i.exec(line);
    if (!go) { buf.push(line); return; }
    push(go[1] ? parseInt(go[1], 10) : 1);
    buf = [];
    start = i + 2;
  });
  push(1);
  return batches;
}

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '').trim();

/** init.sql creates and USEs one database; point those statements at DB_NAME when it differs. */
function retargetDatabase(text, name) {
  const m = /CREATE\s+DATABASE\s+\[?([A-Za-z0-9_]+)\]?/i.exec(text);
  if (!m || m[1] === name) return text;
  const from = m[1];
  console.log(`• Using database name "${name}" from DB_NAME (the script says "${from}")`);
  return text
    .replace(new RegExp(`N'${from}'`, 'g'), `N'${name}'`)
    .replace(new RegExp(`CREATE\\s+DATABASE\\s+\\[?${from}\\]?`, 'gi'), `CREATE DATABASE [${name}]`)
    .replace(new RegExp(`^(\\s*)USE\\s+\\[?${from}\\]?`, 'gim'), `$1USE [${name}]`);
}

async function runScript(file, startDb, { retarget } = {}) {
  let text = fs.readFileSync(file, 'utf8');
  if (retarget) text = retargetDatabase(text, retarget);
  const lines = text.split(/\r?\n/);
  const batches = splitBatches(text);
  const label = path.relative(process.cwd(), file) || file;
  console.log(`• Running ${label} (${batches.length} batches) on ${where}`);
  const t0 = Date.now();
  let db = startDb;
  let pool = await connect(db);
  try {
    for (let i = 0; i < batches.length; i++) {
      const b = batches[i];
      const use = /^USE\s+\[?([A-Za-z0-9_]+)\]?\s*;?$/i.exec(stripComments(b.sql));
      if (use) { // switch database by reconnecting, so the context can never silently fall back to master
        await pool.close();
        db = use[1];
        pool = await connect(db);
        continue;
      }
      status(`  batch ${i + 1}/${batches.length} (line ${b.line})`);
      for (let r = 0; r < b.repeat; r++) {
        const req = pool.request();
        req.on('info', (m) => { if (!QUIET_INFO.has(m.number)) { status(''); console.log(`  ${m.message}`); } });
        try {
          await req.batch(b.sql);
        } catch (e) {
          status('');
          console.error(`\n✖ Failed in batch ${i + 1} of ${batches.length} (${label}, starting at line ${b.line})`);
          for (const err of [...(e.precedingErrors || []), e]) {
            const fileLine = err.lineNumber ? b.line + err.lineNumber - 1 : null;
            console.error(`  SQL error ${err.number ?? err.code ?? ''}${fileLine ? ` at line ${fileLine}` : ''}: ${err.message}`);
            if (fileLine && lines[fileLine - 1]) console.error(`  > ${lines[fileLine - 1].trim().slice(0, 160)}`);
          }
          console.error('\n  Nothing after this batch was run. Fix the problem and run the same command again (the scripts are safe to re-run).');
          process.exit(1);
        }
      }
    }
  } finally {
    await pool.close().catch(() => {});
  }
  status('');
  console.log(`✔ ${batches.length} batches finished in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return db;
}

async function describe(db) {
  const pool = await connect(db);
  const tables = (await pool.request().query(
    `SELECT t.name AS tbl, SUM(p.rows) AS cnt FROM sys.tables t
     JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0, 1)
     WHERE t.is_ms_shipped = 0 GROUP BY t.name ORDER BY t.name`)).recordset;
  if (!tables.length) { console.log(`  Database ${db} has no tables yet.`); await pool.close(); return { tables }; }
  console.log(`\n  ${db}: ${tables.length} tables`);
  const cells = tables.map((t) => `${t.tbl} ${t.cnt}`);
  const width = Math.max(...cells.map((c) => c.length)) + 3;
  const perRow = Math.max(1, Math.floor(96 / width));
  for (let i = 0; i < cells.length; i += perRow) console.log('  ' + cells.slice(i, i + perRow).map((c) => c.padEnd(width)).join(''));
  const names = new Set(tables.map((t) => t.tbl));
  if (names.has('Users') && names.has('Roles')) {
    const users = (await pool.request().query(
      'SELECT u.Username, r.RoleName FROM Users u LEFT JOIN Roles r ON r.RoleId = u.RoleId WHERE u.IsActive = 1 ORDER BY u.UserId')).recordset;
    if (users.length) console.log(`\n  Logins: ${users.map((u) => `${u.Username} (${u.RoleName || 'no role'})`).join(', ')}`);
  }
  await pool.close();
  return { tables, names };
}

// ---------------------------------------------------------------- commands
if (['help', '-h', '--help'].includes(command)) {
  console.log(`Usage:
  npm run db:check     test the connection and show what is in the database
  npm run db:init      create the database, tables and seed data (database/init.sql)
  npm run db:upgrade   upgrade an existing database (database/migration-v4-upgrade.sql)
  node database/run-sql.mjs <file.sql> [--db <name>]

Settings are read from server/.env - copy .env.example and fill in DB_SERVER, DB_USER and DB_PASSWORD.`);
  process.exit(0);
}

if (!process.env.DB_PASSWORD) {
  fail('DB_PASSWORD is empty, so there is nothing to connect with.',
    'Copy .env.example to server/.env and set DB_SERVER, DB_USER and DB_PASSWORD (a SQL Server login such as sa).');
}
if (!NAME_RE.test(targetDb)) fail(`"${targetDb}" is not a valid database name (letters, digits and _ only).`);

if (command === 'check') {
  const pool = await connect('master');
  const v = (await pool.request().query(
    "SELECT CAST(SERVERPROPERTY('ProductVersion') AS NVARCHAR(50)) AS ver, CAST(SERVERPROPERTY('ProductLevel') AS NVARCHAR(50)) AS lvl, CAST(SERVERPROPERTY('Edition') AS NVARCHAR(100)) AS ed")).recordset[0];
  const major = parseInt(v.ver, 10);
  console.log(`✔ Connected to ${where}: SQL Server ${VERSIONS[major] || v.ver} ${v.lvl} (${v.ed}, ${v.ver})`);
  if (major < 11) console.log('  ⚠ These scripts need SQL Server 2012 or newer.');
  const exists = await dbExists(pool, targetDb);
  await pool.close();
  if (!exists) { console.log(`• Database ${targetDb} does not exist yet. Next: npm run db:init`); process.exit(0); }
  const { names } = await describe(targetDb);
  if (!names) console.log('\n• Empty database. Next: npm run db:init');
  else if (!names.has('ItemMaster') || !names.has('UserLocations') || !names.has('AppSettings')) console.log('\n• This is an older version of the schema. Next: npm run db:upgrade');
  else console.log('\n• Schema is up to date (v4).');
  process.exit(0);
}

if (command === 'init') {
  const master = await connect('master');
  const exists = await dbExists(master, targetDb);
  await master.close();
  if (exists) console.log(`• Database ${targetDb} already exists. init.sql only adds what is missing; existing tables and data are kept.`);
  const db = await runScript(SCRIPTS.init, 'master', { retarget: targetDb });
  await describe(db);
  console.log('\nDone. Demo passwords are listed in README.md - change them before going live.');
  process.exit(0);
}

if (command === 'upgrade') {
  const master = await connect('master');
  const exists = await dbExists(master, targetDb);
  await master.close();
  if (!exists) fail(`Database ${targetDb} was not found on ${where}.`, 'For a new installation run: npm run db:init');
  await runScript(SCRIPTS.upgrade, targetDb);
  await describe(targetDb);
  console.log('\nDone. The upgrade is safe to run again at any time.');
  process.exit(0);
}

const file = path.resolve(command);
if (!command.toLowerCase().endsWith('.sql') || !fs.existsSync(file)) {
  fail(`Unknown command or file: ${command}`, 'Use check, init, upgrade or a path to a .sql file. Run with --help for usage.');
}
await runScript(file, option('--db') || 'master');
process.exit(0);
