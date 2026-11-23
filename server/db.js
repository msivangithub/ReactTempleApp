import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sql from 'mssql';
import dotenv from 'dotenv';

// Settings come from server/.env (copy .env.example there). A project-root .env is read as a fallback.
// Variables that are already set in the environment always win, so a host can inject them directly.
const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(here, '.env') });
dotenv.config({ path: path.join(here, '..', '.env') });

const flag = (value, fallback) => (value === undefined || value === '' ? fallback : /^(1|true|yes|on)$/i.test(value));

/**
 * One place that turns DB_* variables into an mssql config, shared by the API and database/run-sql.mjs.
 * DB_SERVER may be a host (localhost), host,port or a named instance (localhost\SQLEXPRESS); for a named
 * instance the port is looked up through the SQL Server Browser service and DB_PORT is ignored.
 */
export function buildDbConfig(overrides = {}) {
  const tlsMin = process.env.DB_TLS_MIN_VERSION; // e.g. TLSv1 for an old, unpatched SQL Server 2012/2014
  return {
    server: process.env.DB_SERVER || 'localhost',
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME || 'TempleApp',
    user: process.env.DB_USER || 'sa',
    password: process.env.DB_PASSWORD || '',
    options: {
      encrypt: flag(process.env.DB_ENCRYPT, false),
      trustServerCertificate: flag(process.env.DB_TRUST_SERVER_CERTIFICATE, true),
      enableArithAbort: true,
      useUTC: false, // DATETIME columns hold the server's local time (GETDATE()), same as SSMS shows
      ...(tlsMin ? { cryptoCredentialsDetails: { minVersion: tlsMin, ...(/^TLSv1(\.1)?$/.test(tlsMin) ? { ciphers: 'DEFAULT@SECLEVEL=0' } : {}) } } : {})
    },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
    ...overrides
  };
}

export const dbConfigured = () => Boolean(process.env.DB_PASSWORD);

const httpError = (status, message) => Object.assign(new Error(message), { status, expose: true });

let pool = null;
let connecting = null;
let lastError = null;

/** Shared connection pool. Connects lazily and reconnects after the database comes back. */
export async function getPool() {
  if (pool?.connected) return pool;
  if (!dbConfigured()) throw httpError(503, 'The database is not configured. Copy .env.example to server/.env, set DB_SERVER, DB_USER and DB_PASSWORD, then run npm run db:init.');
  if (!connecting) {
    const next = new sql.ConnectionPool(buildDbConfig());
    next.on('error', (e) => { lastError = e; });
    connecting = next.connect()
      .then((p) => { pool = p; lastError = null; return p; })
      .catch((e) => { lastError = e; throw httpError(503, `Database unavailable: ${e.message}`); })
      .finally(() => { connecting = null; });
  }
  return connecting;
}
export const dbStatus = () => ({ configured: dbConfigured(), connected: Boolean(pool?.connected), error: lastError?.message || null });

// Parameters are always bound (never concatenated). Types are inferred from the JS value.
function bind(request, params = {}) {
  for (const [name, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (value === null) request.input(name, sql.NVarChar(4000), null);
    else if (typeof value === 'boolean') request.input(name, sql.Bit, value);
    else if (typeof value === 'number') request.input(name, Number.isInteger(value) && Math.abs(value) <= 2147483647 ? sql.Int : sql.Decimal(18, 2), value);
    else if (value instanceof Date) request.input(name, sql.DateTime, value);
    else { const s = String(value); request.input(name, s.length > 4000 ? sql.NVarChar(sql.MAX) : sql.NVarChar(4000), s); }
  }
  return request;
}

async function run(text, params, runner) {
  const target = runner || (await getPool());
  return bind(target.request(), params).query(text);
}
/** rows of the first result set */
export const q = async (text, params, runner) => (await run(text, params, runner)).recordset || [];
/** first row or null */
export const one = async (text, params, runner) => (await q(text, params, runner))[0] || null;
/** all result sets of a multi-statement batch */
export const sets = async (text, params, runner) => (await run(text, params, runner)).recordsets || [];
/** number of affected rows */
export const exec = async (text, params, runner) => { const r = await run(text, params, runner); return (r.rowsAffected || []).reduce((s, n) => s + n, 0); };

export const db = { q, one, sets, exec };

/** Runs work(db) in one transaction: everything is committed together or rolled back together. */
export async function tx(work) {
  const t = new sql.Transaction(await getPool());
  await t.begin();
  const tdb = { q: (s, a) => q(s, a, t), one: (s, a) => one(s, a, t), sets: (s, a) => sets(s, a, t), exec: (s, a) => exec(s, a, t) };
  try {
    const out = await work(tdb);
    await t.commit();
    return out;
  } catch (e) {
    try { await t.rollback(); } catch { /* already rolled back by SQL Server */ }
    throw e;
  }
}

// App settings (AppSettings table) - cached for a few seconds, refreshed after edits
let settingsCache = null;
let settingsAt = 0;
export async function getSettings(force = false) {
  if (force || !settingsCache || Date.now() - settingsAt > 10000) {
    const rows = await q('SELECT SettingKey, SettingValue FROM dbo.AppSettings');
    settingsCache = Object.fromEntries(rows.map((r) => [r.SettingKey, r.SettingValue ?? '']));
    settingsAt = Date.now();
  }
  return settingsCache;
}
export const clearSettingsCache = () => { settingsCache = null; };

export { sql };
