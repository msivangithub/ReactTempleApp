// Shared helpers for the route modules. Every helper takes `dbx` (the shared pool or a transaction),
// so the same code runs inside or outside a transaction.
import { pick, isBlank, DATE_RE } from '../util.js';
import { q } from '../db.js';

export const bad = (res, error, code = 400) => res.status(code).json({ error });
export const byOrder = 'ISNULL(DisplayOrder, 0)';
export const likeArg = (s) => `%${String(s).trim().replace(/[[%_]/g, (c) => `[${c}]`)}%`;
export const validDate = (v) => DATE_RE.test(String(v || '')) && !Number.isNaN(Date.parse(String(v)));

// ---------- locations ----------
export const LOCATION_FIELDS = ['LocationName', 'LocationCode', 'Description', 'Address', 'Phone', 'Email', 'ReceiptFooter', 'UpiVpa', 'UpiPayeeName', 'IsActive', 'DisplayOrder'];
const LOGIN_FIELDS = LOCATION_FIELDS.filter((f) => !f.startsWith('Upi')); // the login screen does not need payment details
export const publicLocation = (l, forLogin = false) => (l ? { LocationId: l.LocationId, ...pick(l, forLogin ? LOGIN_FIELDS : LOCATION_FIELDS) } : null);

// ---------- who created / changed a record (CreatedBy, CreatedAt, UpdatedBy, UpdatedAt) ----------
// The stamp columns are read from the schema (cached), so every table that has them is stamped automatically -
// no route can forget it - and a database that has not been upgraded yet still works. Times come from the
// database server (GETDATE()), the same clock as the rest of the data.
const STAMP_COLS = ['CreatedBy', 'CreatedAt', 'UpdatedBy', 'UpdatedAt'];
let stampCache = { at: 0, map: new Map() };
export async function stampColumns(table) {
  if (Date.now() - stampCache.at > 5 * 60 * 1000) {
    const rows = await q(`SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = N'dbo' AND COLUMN_NAME IN (${STAMP_COLS.map((c) => `N'${c}'`).join(', ')})`);
    const map = new Map();
    for (const r of rows) { if (!map.has(r.t)) map.set(r.t, new Set()); map.get(r.t).add(r.c); }
    stampCache = { at: Date.now(), map };
  }
  return stampCache.map.get(table) || new Set();
}
export const clearStampCache = () => { stampCache = { at: 0, map: new Map() }; };
const userIdOf = (req) => req?.user?.UserId ?? null;

/** INSERT ... OUTPUT inserted.* with CreatedBy / CreatedAt filled in for the signed-in user */
export async function insertRow(dbx, table, rec, req) {
  const has = await stampColumns(table);
  const data = { ...rec };
  STAMP_COLS.forEach((c) => delete data[c]); // never trust the client for these
  const cols = Object.keys(data); const vals = cols.map((c) => `@${c}`);
  if (has.has('CreatedBy')) { cols.push('CreatedBy'); vals.push('@__uid'); }
  if (has.has('CreatedAt')) { cols.push('CreatedAt'); vals.push('GETDATE()'); }
  return dbx.one(`INSERT INTO dbo.${table} (${cols.join(', ')}) OUTPUT inserted.* VALUES (${vals.join(', ')})`, { ...data, __uid: userIdOf(req) });
}

/** ", UpdatedBy = @__uid, UpdatedAt = GETDATE()" for tables that have the columns (append to any UPDATE ... SET) */
export async function updateStamp(table) {
  const has = await stampColumns(table);
  return `${has.has('UpdatedBy') ? ', UpdatedBy = @__uid' : ''}${has.has('UpdatedAt') ? ', UpdatedAt = GETDATE()' : ''}`;
}

/** UPDATE ... OUTPUT inserted.* with UpdatedBy / UpdatedAt filled in for the signed-in user */
export async function updateRow(dbx, table, idField, idValue, b, req) {
  const data = { ...b };
  STAMP_COLS.forEach((c) => delete data[c]);
  const cols = Object.keys(data);
  if (!cols.length) return dbx.one(`SELECT * FROM dbo.${table} WHERE ${idField} = @__id`, { __id: idValue });
  const set = cols.map((c) => `${c} = @${c}`).join(', ') + (await updateStamp(table));
  return dbx.one(`UPDATE dbo.${table} SET ${set} OUTPUT inserted.* WHERE ${idField} = @__id`, { ...data, __id: idValue, __uid: userIdOf(req) });
}
export const stampParams = (req) => ({ __uid: userIdOf(req) });

/** Adds the stamp columns to rows loaded by a query that lists its columns explicitly (works before and after db:upgrade) */
export async function attachStamps(table, idField, list) {
  const rows = (Array.isArray(list) ? list : [list]).filter((r) => r && typeof r === 'object');
  const has = await stampColumns(table); const cols = STAMP_COLS.filter((c) => has.has(c));
  const ids = [...new Set(rows.map((r) => Number(r[idField])).filter(Number.isInteger))];
  if (!cols.length || !ids.length) return list;
  const found = new Map((await q(`SELECT ${idField} AS __id, ${cols.join(', ')} FROM dbo.${table} WHERE ${idField} IN (${ids.join(',')})`)).map((r) => [r.__id, r]));
  for (const r of rows) { const s = found.get(Number(r[idField])); if (s) cols.forEach((c) => { r[c] = s[c]; }); }
  return list;
}
/** Adds CreatedByName / UpdatedByName / CancelledByName to every row that carries those user ids (one query) */
const NAME_FIELDS = [['CreatedBy', 'CreatedByName'], ['UpdatedBy', 'UpdatedByName'], ['CancelledBy', 'CancelledByName']];
export async function withUserNames(body) {
  const list = Array.isArray(body) ? body : Array.isArray(body?.rows) ? body.rows : Array.isArray(body?.recent) ? body.recent : body && typeof body === 'object' ? [body] : [];
  const rows = list.filter((r) => r && typeof r === 'object' && NAME_FIELDS.some(([f]) => f in r));
  const ids = [...new Set(rows.flatMap((r) => NAME_FIELDS.map(([f]) => r[f])).filter((v) => Number.isInteger(v)))];
  if (!ids.length) return body;
  const names = new Map((await q(`SELECT UserId, ISNULL(NULLIF(FullName, N''), Username) AS Name FROM dbo.Users WHERE UserId IN (${ids.join(',')})`)).map((u) => [u.UserId, u.Name]));
  for (const r of rows) for (const [f, n] of NAME_FIELDS) if (f in r) r[n] = names.get(r[f]) || '';
  return body;
}

// ---------- audit trail (AuditLog table) ----------
export async function audit(dbx, req, action, table, id, oldV, newV) {
  const recordId = Number(id);
  await dbx.exec(`INSERT INTO dbo.AuditLog (UserId, Action, TableName, RecordId, OldValues, NewValues, IPAddress, LocationId, CreatedAt)
    VALUES (@u, @a, @t, @r, @o, @n, @ip, @l, GETDATE())`, {
    u: req.user?.UserId ?? null, a: action, t: table, r: Number.isInteger(recordId) ? recordId : null,
    o: oldV ? JSON.stringify(oldV) : null, n: newV ? JSON.stringify(newV) : null, ip: String(req.ip || '').slice(0, 50), l: req.locationId ?? null
  });
}

// ---------- lookups ----------
/** Name of the default active row of a lookup table (falls back to the first active row) */
export async function defaultName(dbx, table, nameField) {
  const r = await dbx.one(`SELECT TOP 1 ${nameField} AS n FROM dbo.${table} WHERE ISNULL(IsActive, 1) = 1 ORDER BY CASE WHEN IsDefault = 1 THEN 0 ELSE 1 END, ${byOrder}, 1`);
  return r?.n ?? null;
}
export const templeInLoc = async (dbx, templeId, locationId) => !isBlank(templeId) && Boolean(await dbx.one('SELECT 1 AS ok FROM dbo.Temples WHERE TempleId = @t AND LocationId = @l', { t: Number(templeId), l: locationId }));

// ---------- time slots: temple-specific -> location-wide -> global default ----------
export async function effectiveSlots(dbx, { templeId = null, locationId, activeOnly = true }) {
  const rows = await dbx.q(`SELECT * FROM dbo.SevaTimeSlots WHERE (${templeId ? 'TempleId = @t OR ' : ''}(TempleId IS NULL AND (LocationId = @l OR LocationId IS NULL)))${activeOnly ? ' AND ISNULL(IsActive, 1) = 1' : ''}`,
    { t: templeId ? Number(templeId) : undefined, l: locationId });
  const sorted = (list) => [...list].sort((a, b) => String(a.SlotTime).localeCompare(String(b.SlotTime)));
  if (templeId) { const own = rows.filter((s) => s.TempleId === Number(templeId)); if (own.length) return sorted(own); }
  const locWide = rows.filter((s) => s.TempleId == null && s.LocationId === locationId);
  if (locWide.length) return sorted(locWide);
  return sorted(rows.filter((s) => s.TempleId == null && s.LocationId == null));
}
export async function slotAllowed(dbx, templeId, locationId, time) {
  const slots = await effectiveSlots(dbx, { templeId, locationId });
  return !slots.length || slots.some((s) => s.SlotTime === time);
}

// ---------- bookings ----------
export const LIVE = 'NOT EXISTS (SELECT 1 FROM dbo.BookingStatuses xs WHERE xs.StatusName = b.PaymentStatus AND xs.IsCancelled = 1)';
const BOOKING_SELECT = `SELECT b.BookingId, b.BookingNumber, b.TokenNumber, b.BookingType, b.BookingTypeId, b.TempleId, b.DeityId, b.LocationId,
    b.DevoteeName, b.Mobile, ISNULL(b.Gothram, N'') AS Gothram, ISNULL(b.Nakshatram, N'') AS Nakshatram,
    CONVERT(CHAR(10), b.SevaDate, 23) AS SevaDate, ISNULL(b.SevaTime, N'') AS SevaTime, CONVERT(CHAR(10), b.BookingDate, 23) AS BookingDate,
    CAST(ISNULL(b.IsAdvanceBooking, 0) AS BIT) AS IsAdvanceBooking, ISNULL(b.TotalAmount, 0) AS TotalAmount, b.PaymentMode, b.PaymentStatus,
    b.CounterId, ISNULL(b.Remarks, N'') AS Remarks, b.CreatedBy, b.CreatedAt, ISNULL(b.CancelReason, N'') AS CancelReason, b.CancelledAt, b.CancelledBy, b.UpdatedAt, b.UpdatedBy,
    ISNULL(t.TempleName, N'') AS TempleName, ISNULL(d.DeityName, N'') AS DeityName, ISNULL(l.LocationName, N'') AS LocationName, ISNULL(l.LocationCode, N'') AS LocationCode,
    ISNULL(c.CounterName, N'') AS CounterName, ISNULL(NULLIF(u.FullName, N''), ISNULL(u.Username, N'')) AS CreatedByName, ISNULL(u.Username, N'') AS CreatedByUsername,
    ISNULL(NULLIF(uu.FullName, N''), ISNULL(uu.Username, N'')) AS UpdatedByName, ISNULL(NULLIF(cu.FullName, N''), ISNULL(cu.Username, N'')) AS CancelledByName, CAST(ISNULL(pm.ShowUpiQr, 0) AS BIT) AS ShowUpiQr,
    CAST(CASE WHEN ${LIVE} THEN 0 ELSE 1 END AS BIT) AS IsCancelled
  FROM dbo.Bookings b
  LEFT JOIN dbo.Temples t ON t.TempleId = b.TempleId
  LEFT JOIN dbo.Deities d ON d.DeityId = b.DeityId
  LEFT JOIN dbo.Locations l ON l.LocationId = b.LocationId
  LEFT JOIN dbo.Counters c ON c.CounterId = b.CounterId
  LEFT JOIN dbo.Users u ON u.UserId = b.CreatedBy
  LEFT JOIN dbo.Users uu ON uu.UserId = b.UpdatedBy
  LEFT JOIN dbo.Users cu ON cu.UserId = b.CancelledBy
  LEFT JOIN dbo.PaymentModes pm ON pm.ModeName = b.PaymentMode`;
const ITEM_COLS = 'bi.ItemId AS LineId, bi.BookingId, bi.SevaId, bi.MasterItemId AS ItemId, bi.ItemName, ISNULL(bi.Quantity, 1) AS Quantity, ISNULL(bi.UnitAmount, 0) AS UnitAmount, ISNULL(bi.TotalAmount, 0) AS TotalAmount';

/**
 * Bookings with their items. `where` may only use the alias b (Bookings). With `limit` the query is paged
 * (OFFSET/FETCH, SQL Server 2012+). BookingItems.ItemId is the line key, so the Item Master link is exposed as Items[].ItemId.
 */
export async function loadBookings(dbx, { where = '1 = 1', params = {}, order = 'b.BookingId DESC', offset = 0, limit = null } = {}) {
  const page = limit != null ? ` OFFSET ${Math.max(0, Number(offset) || 0)} ROWS FETCH NEXT ${Math.max(1, Number(limit) || 1)} ROWS ONLY` : '';
  const rows = await dbx.q(`${BOOKING_SELECT} WHERE ${where} ORDER BY ${order}${page}`, params);
  if (!rows.length) return rows;
  const items = rows.length <= 500
    ? await dbx.q(`SELECT ${ITEM_COLS} FROM dbo.BookingItems bi WHERE bi.BookingId IN (${rows.map((r) => Number(r.BookingId)).join(',')}) ORDER BY bi.ItemId`)
    : await dbx.q(`SELECT ${ITEM_COLS} FROM dbo.BookingItems bi JOIN dbo.Bookings b ON b.BookingId = bi.BookingId WHERE ${where} ORDER BY bi.ItemId`, params);
  const byId = new Map(rows.map((r) => { r.Items = []; return [r.BookingId, r]; }));
  for (const it of items) byId.get(it.BookingId)?.Items.push(it);
  return rows;
}
export const loadBooking = async (dbx, bookingId, locationId) => (await loadBookings(dbx, { where: 'b.BookingId = @id AND b.LocationId = @loc', params: { id: Number(bookingId) || 0, loc: locationId } }))[0] || null;

/** Filters shared by the booking list and reports (only b.* columns, so they also work for the items query) */
export function bookingFilters(locationId, f = {}) {
  const w = ['b.LocationId = @loc'];
  const p = { loc: locationId };
  if (!isBlank(f.search)) { w.push('(b.BookingNumber LIKE @s OR b.TokenNumber LIKE @s OR b.DevoteeName LIKE @s OR b.Mobile LIKE @s)'); p.s = likeArg(f.search); }
  if (!isBlank(f.templeId)) { w.push('b.TempleId = @tid'); p.tid = Number(f.templeId) || 0; }
  if (!isBlank(f.bookingType)) { w.push('b.BookingType = @bt'); p.bt = String(f.bookingType); }
  if (!isBlank(f.paymentMode)) { w.push('b.PaymentMode = @pm'); p.pm = String(f.paymentMode); }
  if (!isBlank(f.paymentStatus)) { w.push('b.PaymentStatus = @ps'); p.ps = String(f.paymentStatus); }
  if (validDate(f.from)) { w.push('b.BookingDate >= @from'); p.from = f.from; }
  if (validDate(f.to)) { w.push('b.BookingDate <= @to'); p.to = f.to; }
  if (validDate(f.sevaDate)) { w.push('b.SevaDate = @sd'); p.sd = f.sevaDate; }
  if (f.advance === 'true' || f.advance === true) w.push('b.IsAdvanceBooking = 1');
  return { where: w.join(' AND '), params: p };
}

/** page / pageSize from the query string (pageSize 1-200); null when the caller did not ask for paging */
export function paging(query, fallbackSize = 25) {
  if (isBlank(query.page) && isBlank(query.pageSize)) return null;
  const pageSize = Math.min(200, Math.max(1, parseInt(query.pageSize, 10) || fallbackSize));
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  return { page, pageSize, offset: (page - 1) * pageSize };
}

/** { label: { count, amount } } grouping of booking rows */
export const groupBy = (rows, keyFn) => rows.reduce((acc, b) => { const k = keyFn(b) || '—'; acc[k] = acc[k] || { count: 0, amount: 0 }; acc[k].count++; acc[k].amount += Number(b.TotalAmount || 0); return acc; }, {});
/** SQL GROUP BY result -> { label: { count, amount } } */
export const toGroups = (rows) => Object.fromEntries(rows.map((r) => [r.k || '—', { count: r.count, amount: Number(r.amount || 0) }]));
