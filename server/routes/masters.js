// Masters: lookups, booking types, time slots, locations, temples, deities, categories, sevas, items, counters.
// Location-scoped masters always use the location chosen at login (req.locationId).
import { Router } from 'express';
import { db, tx } from '../db.js';
import { wrap, isBlank, toNum, toBool, pick, TIME_RE } from '../util.js';
import { authMiddleware, requirePermission, canAccessLocation, loadUser } from '../auth.js';
import { bad, audit, byOrder, likeArg, effectiveSlots, templeInLoc, LOCATION_FIELDS, insertRow, updateRow, updateStamp, stampParams } from './common.js';

const router = Router();
const id = (v) => Number(v) || 0;
const count = async (dbx, sqlText, params) => (await dbx.one(sqlText, params))?.n || 0;

// ---------- LOOKUP MASTERS (generic CRUD; single default; rename cascades; in-use protection) ----------
function lookupRoutes({ path, table, screen, idField, nameField, extraFields = [], requiredExtras = [], normalize, validate, usage, afterSave }) {
  const FIELDS = [nameField, ...extraFields, 'IsActive', 'IsDefault', 'DisplayOrder'];
  const clean = (b) => {
    if (b[nameField] !== undefined) b[nameField] = String(b[nameField]).trim();
    if (b.DisplayOrder !== undefined) b.DisplayOrder = Number(b.DisplayOrder) || 0;
    ['IsActive', 'IsDefault'].forEach((f) => { if (b[f] !== undefined) b[f] = toBool(b[f]); });
    normalize?.(b);
    return b;
  };
  const byId = (v) => db.one(`SELECT * FROM dbo.${table} WHERE ${idField} = @id`, { id: id(v) });
  const singleDefault = async (t, row, req) => { if (row.IsDefault) await t.exec(`UPDATE dbo.${table} SET IsDefault = 0${await updateStamp(table)} WHERE ${idField} <> @id AND IsDefault = 1`, { id: row[idField], ...stampParams(req) }); };

  router.get(path, authMiddleware, wrap(async (req, res) => {
    const rows = await db.q(`SELECT * FROM dbo.${table}${req.query.activeOnly === 'true' ? ' WHERE ISNULL(IsActive, 1) = 1' : ''} ORDER BY ${byOrder}, ${idField}`);
    const used = usage ? await usage.counts(db) : new Map();
    res.json(rows.map((r) => ({ ...r, InUse: used.get(usage?.keyOf(r)) || 0 })));
  }));
  router.post(path, authMiddleware, requirePermission(screen, 'CanCreate'), wrap(async (req, res) => {
    const b = clean(pick(req.body || {}, FIELDS));
    if (isBlank(b[nameField])) return bad(res, `${nameField} is required`);
    for (const f of requiredExtras) if (isBlank(b[f])) return bad(res, `${f} is required`);
    if (await db.one(`SELECT 1 AS x FROM dbo.${table} WHERE ${nameField} = @n`, { n: b[nameField] })) return bad(res, `'${b[nameField]}' already exists`);
    const verr = await validate?.(b, null); if (verr) return bad(res, verr);
    const row = await tx(async (t) => {
      const rec = await insertRow(t, table, { ...b, IsActive: b.IsActive !== false, IsDefault: !!b.IsDefault, DisplayOrder: b.DisplayOrder || 0 }, req);
      await singleDefault(t, rec, req); const final = (await afterSave?.(t, rec, req)) || rec;
      await audit(t, req, 'CREATE', table, rec[idField], null, final); return final;
    });
    res.status(201).json(row);
  }));
  router.put(`${path}/:id`, authMiddleware, requirePermission(screen, 'CanEdit'), wrap(async (req, res) => {
    const rec = await byId(req.params.id); if (!rec) return bad(res, 'Record not found', 404);
    const b = clean(pick(req.body || {}, FIELDS));
    if (b[nameField] !== undefined) {
      if (!b[nameField]) return bad(res, `${nameField} is required`);
      if (await db.one(`SELECT 1 AS x FROM dbo.${table} WHERE ${nameField} = @n AND ${idField} <> @id`, { n: b[nameField], id: rec[idField] })) return bad(res, `'${b[nameField]}' already exists`);
    }
    for (const f of requiredExtras) if (b[f] !== undefined && isBlank(b[f])) return bad(res, `${f} is required`);
    const verr = await validate?.(b, rec); if (verr) return bad(res, verr);
    const row = await tx(async (t) => {
      const saved = await updateRow(t, table, idField, rec[idField], b, req);
      if (usage?.rename && rec[nameField] !== saved[nameField]) await usage.rename(t, rec, saved); // keep existing records consistent
      await singleDefault(t, saved, req); const final = (await afterSave?.(t, saved, req)) || saved;
      await audit(t, req, 'UPDATE', table, rec[idField], rec, final); return final;
    });
    res.json(row);
  }));
  router.delete(`${path}/:id`, authMiddleware, requirePermission(screen, 'CanDelete'), wrap(async (req, res) => {
    const rec = await byId(req.params.id); if (!rec) return bad(res, 'Record not found', 404);
    const used = usage ? await usage.count(db, rec) : 0;
    if (used) return bad(res, `'${rec[nameField]}' is used by ${used} record(s). Deactivate it instead.`);
    await tx(async (t) => { await t.exec(`DELETE FROM dbo.${table} WHERE ${idField} = @id`, { id: rec[idField] }); await audit(t, req, 'DELETE', table, rec[idField], rec, null); });
    res.json({ message: 'Deleted' });
  }));
}
// lookup values are stored by name on bookings / members
const usageByName = (table, field, nameField) => ({
  keyOf: (r) => String(r[nameField] || '').toLowerCase(),
  counts: async (dbx) => new Map((await dbx.q(`SELECT LOWER(${field}) AS k, COUNT(*) AS n FROM dbo.${table} WHERE ${field} IS NOT NULL GROUP BY LOWER(${field})`)).map((r) => [r.k, r.n])),
  count: (dbx, r) => count(dbx, `SELECT COUNT(*) AS n FROM dbo.${table} WHERE ${field} = @v`, { v: r[nameField] }),
  rename: (dbx, o, n) => dbx.exec(`UPDATE dbo.${table} SET ${field} = @new WHERE ${field} = @old`, { new: n[nameField], old: o[nameField] }),
});

// ---------- BOOKING TYPES: each type owns a screen (its own booking page + permissions) ----------
const TYPE_FLAGS = ['UsesSevaMaster', 'RequiresTemple', 'RequiresSchedule', 'RequiresDevotee', 'CaptureGothram', 'AllowAdvance'];
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
async function validateBookingType(b, existing) {
  if (isBlank(b.ScreenKey)) { if (existing) delete b.ScreenKey; else b.ScreenKey = `${slug(b.TypeName)}_booking`; }
  const key = slug(b.ScreenKey ?? existing?.ScreenKey); if (b.ScreenKey !== undefined) b.ScreenKey = key;
  if (!key) return 'Screen key is required';
  if (await db.one('SELECT 1 AS x FROM dbo.BookingTypes WHERE ScreenKey = @k AND BookingTypeId <> @id', { k: key, id: existing?.BookingTypeId || 0 })) return 'Another booking type already uses this screen key';
  const scr = await db.one('SELECT IsBookingScreen FROM dbo.Screens WHERE ScreenKey = @k', { k: key });
  if (scr && !scr.IsBookingScreen) return `'${key}' is a system screen — choose a different screen key`;
  return null;
}
async function ensureTypeScreen(t, type, req) {
  if (await t.one('SELECT 1 AS x FROM dbo.Screens WHERE ScreenKey = @k', { k: type.ScreenKey })) return type;
  const sibling = await t.one(`SELECT TOP 1 s.ScreenGroup, (SELECT MAX(ISNULL(x.DisplayOrder, 0)) FROM dbo.Screens x JOIN dbo.BookingTypes bt ON bt.ScreenKey = x.ScreenKey) AS MaxOrder
    FROM dbo.Screens s JOIN dbo.BookingTypes bt ON bt.ScreenKey = s.ScreenKey AND bt.BookingTypeId <> @id ORDER BY s.DisplayOrder`, { id: type.BookingTypeId });
  const group = sibling?.ScreenGroup ?? (await t.one('SELECT TOP 1 ScreenGroup FROM dbo.Screens ORDER BY DisplayOrder, ScreenId'))?.ScreenGroup ?? '';
  await insertRow(t, 'Screens', { ScreenKey: type.ScreenKey, ScreenName: `${type.TypeName} Booking`, ScreenGroup: group, DisplayOrder: sibling?.MaxOrder || 0, IsActive: true, IsBookingScreen: true }, req);
  return type;
}
lookupRoutes({
  path: '/booking-types', table: 'BookingTypes', screen: 'booking_types', idField: 'BookingTypeId', nameField: 'TypeName',
  extraFields: ['TokenPrefix', 'ScreenKey', 'Description', 'Icon', ...TYPE_FLAGS], requiredExtras: ['TokenPrefix'],
  normalize: (b) => { if (b.TokenPrefix !== undefined) b.TokenPrefix = String(b.TokenPrefix).trim().toUpperCase(); TYPE_FLAGS.forEach((f) => { if (b[f] !== undefined) b[f] = toBool(b[f]); }); },
  usage: {
    keyOf: (r) => r.BookingTypeId,
    counts: async (dbx) => new Map((await dbx.q(`SELECT bt.BookingTypeId AS k, (SELECT COUNT(*) FROM dbo.Bookings b WHERE b.BookingType = bt.TypeName) + (SELECT COUNT(*) FROM dbo.ItemMaster i WHERE i.BookingTypeId = bt.BookingTypeId) AS n FROM dbo.BookingTypes bt`)).map((r) => [r.k, r.n])),
    count: (dbx, r) => count(dbx, 'SELECT (SELECT COUNT(*) FROM dbo.Bookings WHERE BookingType = @n OR BookingTypeId = @id) + (SELECT COUNT(*) FROM dbo.ItemMaster WHERE BookingTypeId = @id) AS n', { n: r.TypeName, id: r.BookingTypeId }),
    rename: async (dbx, o, n) => {
      await dbx.exec('UPDATE dbo.Bookings SET BookingType = @new WHERE BookingType = @old', { new: n.TypeName, old: o.TypeName });
      await dbx.exec('UPDATE dbo.Screens SET ScreenName = @new WHERE ScreenKey = @k AND ScreenName = @old', { new: `${n.TypeName} Booking`, old: `${o.TypeName} Booking`, k: n.ScreenKey });
    },
  },
  validate: validateBookingType,
  afterSave: ensureTypeScreen,
});
lookupRoutes({ path: '/payment-modes', table: 'PaymentModes', screen: 'payment_modes', idField: 'PaymentModeId', nameField: 'ModeName', extraFields: ['ShowUpiQr'], normalize: (b) => { if (b.ShowUpiQr !== undefined) b.ShowUpiQr = toBool(b.ShowUpiQr); }, usage: usageByName('Bookings', 'PaymentMode', 'ModeName') });
lookupRoutes({ path: '/booking-statuses', table: 'BookingStatuses', screen: 'booking_statuses', idField: 'BookingStatusId', nameField: 'StatusName', extraFields: ['IsCancelled'], normalize: (b) => { if (b.IsCancelled !== undefined) b.IsCancelled = toBool(b.IsCancelled); }, usage: usageByName('Bookings', 'PaymentStatus', 'StatusName') });
lookupRoutes({ path: '/member-frequencies', table: 'MemberFrequencies', screen: 'member_frequencies', idField: 'FrequencyId', nameField: 'FrequencyName', usage: usageByName('LifetimeMembers', 'Frequency', 'FrequencyName') });
lookupRoutes({ path: '/member-statuses', table: 'MemberStatuses', screen: 'member_statuses', idField: 'MemberStatusId', nameField: 'StatusName', usage: usageByName('LifetimeMembers', 'Status', 'StatusName') });

// ---------- TIME SLOTS (precedence: temple-specific -> location-wide -> global default) ----------
const SLOT_SQL = `SELECT s.*, t.TempleName, t.LocationId AS TempleLocationId, l.LocationName FROM dbo.SevaTimeSlots s
  LEFT JOIN dbo.Temples t ON t.TempleId = s.TempleId LEFT JOIN dbo.Locations l ON l.LocationId = s.LocationId`;
const slotScope = (s) => (s.TempleId != null ? String(s.TempleId) : s.LocationId != null ? 'location' : 'global');
const slotLabel = (s) => (s.TempleId != null ? s.TempleName || 'Temple' : s.LocationId != null ? `${s.LocationName || 'Location'} — all temples` : 'All locations (default)');
const slotOut = ({ TempleName, TempleLocationId, LocationName, ...s }) => ({ ...s, AppliesTo: slotScope({ ...s }), AppliesToLabel: slotLabel({ ...s, TempleName, LocationName }) });
const slotVisible = (s, req) => (s.TempleId != null ? s.TempleLocationId === req.locationId : s.LocationId == null || s.LocationId === req.locationId);
async function resolveSlotScope(req, appliesTo) {
  const v = isBlank(appliesTo) ? 'location' : String(appliesTo);
  if (v === 'global') return req.user.IsSuperAdmin ? { LocationId: null, TempleId: null } : { error: 'Only a super admin can manage global default slots' };
  if (v === 'location') return { LocationId: req.locationId, TempleId: null };
  if (!(await templeInLoc(db, v, req.locationId))) return { error: 'Temple does not belong to the current location' };
  return { LocationId: req.locationId, TempleId: Number(v) };
}
const slotExists = (rec, exceptId = 0) => db.one(`SELECT 1 AS x FROM dbo.SevaTimeSlots WHERE SlotTime = @time AND SlotId <> @ex
  AND ((TempleId IS NULL AND @t IS NULL) OR TempleId = @t) AND ((LocationId IS NULL AND @l IS NULL) OR LocationId = @l)`, { time: rec.SlotTime, ex: exceptId, t: rec.TempleId ?? null, l: rec.LocationId ?? null });
const slotById = async (req) => { const s = await db.one(`${SLOT_SQL} WHERE s.SlotId = @id`, { id: id(req.params.id) }); return s && slotVisible(s, req) ? s : null; };

router.get('/time-slots', authMiddleware, wrap(async (req, res) => {
  const activeOnly = req.query.activeOnly === 'true';
  let rows;
  if (req.query.templeId) rows = (await templeInLoc(db, req.query.templeId, req.locationId)) ? await effectiveSlots(db, { templeId: req.query.templeId, locationId: req.locationId, activeOnly }) : [];
  else if (req.query.effective === 'true') rows = await effectiveSlots(db, { locationId: req.locationId, activeOnly });
  else rows = null;
  if (rows) { // add labels
    const names = new Map((await db.q('SELECT TempleId, TempleName FROM dbo.Temples WHERE LocationId = @l', { l: req.locationId })).map((t) => [t.TempleId, t.TempleName]));
    return res.json(rows.map((s) => slotOut({ ...s, TempleName: names.get(s.TempleId), LocationName: req.location.LocationName })));
  }
  const all = (await db.q(`${SLOT_SQL} WHERE ((s.TempleId IS NOT NULL AND t.LocationId = @l) OR (s.TempleId IS NULL AND (s.LocationId = @l OR s.LocationId IS NULL)))${activeOnly ? ' AND ISNULL(s.IsActive, 1) = 1' : ''}`, { l: req.locationId })).map(slotOut);
  res.json(all.sort((a, b) => a.AppliesToLabel.localeCompare(b.AppliesToLabel) || String(a.SlotTime).localeCompare(String(b.SlotTime))));
}));
router.post('/time-slots', authMiddleware, requirePermission('time_slots', 'CanCreate'), wrap(async (req, res) => {
  const b = req.body || {};
  if (!TIME_RE.test(String(b.SlotTime || ''))) return bad(res, 'Slot time must be HH:MM (24-hour)');
  const scope = await resolveSlotScope(req, b.AppliesTo); if (scope.error) return bad(res, scope.error, 403);
  const rec = { ...scope, SlotTime: b.SlotTime, SlotLabel: String(b.SlotLabel || '').trim() || b.SlotTime, IsActive: b.IsActive !== false && b.IsActive !== 'false', DisplayOrder: Number(b.DisplayOrder) || 0 };
  if (await slotExists(rec)) return bad(res, 'This slot already exists for the selected scope');
  const row = await tx(async (t) => { const r = await insertRow(t, 'SevaTimeSlots', rec, req); await audit(t, req, 'CREATE', 'SevaTimeSlots', r.SlotId, null, r); return r; });
  res.status(201).json(row);
}));
router.put('/time-slots/:id', authMiddleware, requirePermission('time_slots', 'CanEdit'), wrap(async (req, res) => {
  const rec = await slotById(req); if (!rec) return bad(res, 'Slot not found', 404);
  if (rec.LocationId == null && rec.TempleId == null && !req.user.IsSuperAdmin) return bad(res, 'Only a super admin can edit global default slots', 403);
  const b = req.body || {};
  if (b.SlotTime !== undefined && !TIME_RE.test(String(b.SlotTime))) return bad(res, 'Slot time must be HH:MM (24-hour)');
  const scope = b.AppliesTo !== undefined ? await resolveSlotScope(req, b.AppliesTo) : { LocationId: rec.LocationId, TempleId: rec.TempleId };
  if (scope.error) return bad(res, scope.error, 403);
  const patch = { ...scope, ...pick(b, ['SlotTime', 'SlotLabel']) };
  if (b.DisplayOrder !== undefined) patch.DisplayOrder = Number(b.DisplayOrder) || 0;
  if (b.IsActive !== undefined) patch.IsActive = toBool(b.IsActive);
  if (await slotExists({ SlotTime: patch.SlotTime ?? rec.SlotTime, TempleId: patch.TempleId, LocationId: patch.LocationId }, rec.SlotId)) return bad(res, 'This slot already exists for the selected scope');
  const row = await tx(async (t) => { const r = await updateRow(t, 'SevaTimeSlots', 'SlotId', rec.SlotId, patch, req); await audit(t, req, 'UPDATE', 'SevaTimeSlots', r.SlotId, rec, r); return r; });
  res.json(row);
}));
router.delete('/time-slots/:id', authMiddleware, requirePermission('time_slots', 'CanDelete'), wrap(async (req, res) => {
  const rec = await slotById(req); if (!rec) return bad(res, 'Slot not found', 404);
  if (rec.LocationId == null && rec.TempleId == null && !req.user.IsSuperAdmin) return bad(res, 'Only a super admin can delete global default slots', 403);
  await tx(async (t) => { await t.exec('DELETE FROM dbo.SevaTimeSlots WHERE SlotId = @id', { id: rec.SlotId }); await audit(t, req, 'DELETE', 'SevaTimeSlots', rec.SlotId, rec, null); });
  res.json({ message: 'Slot deleted' });
}));

// ---------- LOCATIONS (global master; each location's details drive branding, receipts, UPI QR and data scope) ----------
const VPA_RE = /^[A-Za-z0-9._-]{2,256}@[A-Za-z][A-Za-z0-9.-]{1,63}$/;
async function cleanLocation(b, existing) {
  if (b.LocationName !== undefined) {
    b.LocationName = String(b.LocationName).trim(); if (!b.LocationName) return 'Location name is required';
    if (await db.one('SELECT 1 AS x FROM dbo.Locations WHERE LocationName = @n AND LocationId <> @id', { n: b.LocationName, id: existing?.LocationId || 0 })) return 'A location with this name already exists';
  }
  if (b.LocationCode !== undefined) {
    b.LocationCode = String(b.LocationCode || '').trim().toUpperCase();
    if (b.LocationCode && (await db.one('SELECT 1 AS x FROM dbo.Locations WHERE LocationCode = @c AND LocationId <> @id', { c: b.LocationCode, id: existing?.LocationId || 0 }))) return 'Location code is already in use';
  }
  if (b.UpiVpa !== undefined) { b.UpiVpa = String(b.UpiVpa || '').trim(); if (b.UpiVpa && !VPA_RE.test(b.UpiVpa)) return 'Enter a valid UPI ID, e.g. templename@sbi'; }
  if (b.UpiPayeeName !== undefined) b.UpiPayeeName = String(b.UpiPayeeName || '').trim().slice(0, 100);
  for (const f of ['Description', 'Address', 'Phone', 'Email', 'ReceiptFooter']) if (b[f] !== undefined) b[f] = String(b[f] ?? '').trim();
  if (b.DisplayOrder !== undefined) b.DisplayOrder = Number(b.DisplayOrder) || 0;
  if (b.IsActive !== undefined) b.IsActive = toBool(b.IsActive);
  return null;
}
router.get('/locations', authMiddleware, wrap(async (req, res) => {
  const rows = await db.q(`SELECT l.*, (SELECT COUNT(*) FROM dbo.Temples t WHERE t.LocationId = l.LocationId) AS TempleCount,
      (SELECT COUNT(*) FROM dbo.Users u LEFT JOIN dbo.Roles r ON r.RoleId = u.RoleId WHERE ISNULL(u.IsActive, 1) = 1 AND (u.AllLocations = 1 OR (r.IsSuperAdmin = 1 AND ISNULL(r.IsActive, 1) = 1)
        OR EXISTS (SELECT 1 FROM dbo.UserLocations ul WHERE ul.UserId = u.UserId AND ul.LocationId = l.LocationId))) AS UserCount
    FROM dbo.Locations l ORDER BY ISNULL(l.DisplayOrder, 0), l.LocationId`);
  res.json(rows.map((l) => ({ ...l, IsCurrent: l.LocationId === req.locationId, CanAccess: canAccessLocation(req.currentUser, l.LocationId) })));
}));
router.post('/locations', authMiddleware, requirePermission('locations', 'CanCreate'), wrap(async (req, res) => {
  const b = pick(req.body || {}, LOCATION_FIELDS);
  if (isBlank(b.LocationName)) return bad(res, 'Location name is required');
  const err = await cleanLocation(b, null); if (err) return bad(res, err);
  const row = await tx(async (t) => {
    const r = await insertRow(t, 'Locations', { LocationCode: '', Description: '', Address: '', Phone: '', Email: '', ReceiptFooter: '', UpiVpa: '', UpiPayeeName: '', DisplayOrder: 0, ...b, IsActive: b.IsActive !== false }, req);
    const me = req.currentUser; // the creator can access what they create
    if (!me.IsSuperAdmin && !me.AllLocations) await insertRow(t, 'UserLocations', { UserId: me.UserId, LocationId: r.LocationId }, req);
    await audit(t, req, 'CREATE', 'Locations', r.LocationId, null, r); return r;
  });
  res.status(201).json(row);
}));
router.put('/locations/:id', authMiddleware, requirePermission('locations', 'CanEdit'), wrap(async (req, res) => {
  const rec = await db.one('SELECT * FROM dbo.Locations WHERE LocationId = @id', { id: id(req.params.id) }); if (!rec) return bad(res, 'Location not found', 404);
  if (!canAccessLocation(req.currentUser, rec.LocationId)) return bad(res, 'You do not have access to this location', 403);
  const b = pick(req.body || {}, LOCATION_FIELDS);
  const err = await cleanLocation(b, rec); if (err) return bad(res, err);
  if (rec.LocationId === req.locationId && b.IsActive === false) return bad(res, 'You are signed in to this location. Switch to another location before deactivating it.');
  const row = await tx(async (t) => { const r = await updateRow(t, 'Locations', 'LocationId', rec.LocationId, b, req); await audit(t, req, 'UPDATE', 'Locations', r.LocationId, rec, r); return r; });
  res.json(row);
}));
router.delete('/locations/:id', authMiddleware, requirePermission('locations', 'CanDelete'), wrap(async (req, res) => {
  const rec = await db.one('SELECT * FROM dbo.Locations WHERE LocationId = @id', { id: id(req.params.id) }); if (!rec) return bad(res, 'Location not found', 404);
  if (!canAccessLocation(req.currentUser, rec.LocationId)) return bad(res, 'You do not have access to this location', 403);
  if (rec.LocationId === req.locationId) return bad(res, 'You cannot delete the location you are signed in to.');
  const p = { l: rec.LocationId };
  if (await count(db, 'SELECT COUNT(*) AS n FROM dbo.Temples WHERE LocationId = @l', p)) return bad(res, 'Location has temples. Move or delete them first.');
  if (await count(db, 'SELECT COUNT(*) AS n FROM dbo.Bookings WHERE LocationId = @l', p)) return bad(res, 'Location has bookings. Deactivate it instead.');
  if (await count(db, 'SELECT (SELECT COUNT(*) FROM dbo.Counters WHERE LocationId = @l) + (SELECT COUNT(*) FROM dbo.ItemMaster WHERE LocationId = @l) AS n', p)) return bad(res, 'Location has counters or items. Delete them first.');
  if (await count(db, 'SELECT COUNT(*) AS n FROM dbo.LifetimeMembers WHERE LocationId = @l', p)) return bad(res, 'Location has lifetime members. Deactivate it instead.');
  await tx(async (t) => {
    await t.exec('DELETE FROM dbo.SevaTimeSlots WHERE LocationId = @l; DELETE FROM dbo.UserLocations WHERE LocationId = @l; UPDATE dbo.AuditLog SET LocationId = NULL WHERE LocationId = @l; DELETE FROM dbo.Locations WHERE LocationId = @l;', p);
    await audit(t, req, 'DELETE', 'Locations', rec.LocationId, rec, null);
  });
  res.json({ message: 'Location deleted' });
}));

// ---------- TEMPLES (current location) ----------
const TEMPLE_FIELDS = ['TempleName', 'Description', 'Address', 'IsMainTemple', 'IsActive', 'DisplayOrder'];
const TEMPLE_SQL = `SELECT t.*, ISNULL(l.LocationName, N'') AS LocationName,
    (SELECT COUNT(*) FROM dbo.Deities d WHERE d.TempleId = t.TempleId) AS DeityCount, (SELECT COUNT(*) FROM dbo.SevaMaster s WHERE s.TempleId = t.TempleId) AS SevaCount
  FROM dbo.Temples t LEFT JOIN dbo.Locations l ON l.LocationId = t.LocationId`;
const templeHere = (req) => db.one('SELECT * FROM dbo.Temples WHERE TempleId = @id AND LocationId = @l', { id: id(req.params.id), l: req.locationId });
async function cleanTemple(req, b, existing) {
  if (b.TempleName !== undefined) {
    b.TempleName = String(b.TempleName).trim(); if (!b.TempleName) return 'Temple name is required';
    if (await db.one('SELECT 1 AS x FROM dbo.Temples WHERE LocationId = @l AND TempleName = @n AND TempleId <> @id', { l: req.locationId, n: b.TempleName, id: existing?.TempleId || 0 })) return `'${b.TempleName}' already exists at ${req.location.LocationName}`;
  }
  ['IsMainTemple', 'IsActive'].forEach((f) => { if (b[f] !== undefined) b[f] = toBool(b[f]); });
  if (b.DisplayOrder !== undefined) b.DisplayOrder = Number(b.DisplayOrder) || 0;
  return null;
}
const singleMainTemple = async (t, row, req) => (row.IsMainTemple ? t.exec(`UPDATE dbo.Temples SET IsMainTemple = 0${await updateStamp('Temples')} WHERE LocationId = @l AND TempleId <> @id AND IsMainTemple = 1`, { l: row.LocationId, id: row.TempleId, ...stampParams(req) }) : null);
router.get('/temples', authMiddleware, wrap(async (req, res) => {
  const w = ['t.LocationId = @l']; const p = { l: req.locationId };
  if (req.query.activeOnly === 'true') w.push('ISNULL(t.IsActive, 1) = 1');
  if (req.query.search) { w.push('t.TempleName LIKE @s'); p.s = likeArg(req.query.search); }
  res.json(await db.q(`${TEMPLE_SQL} WHERE ${w.join(' AND ')} ORDER BY ISNULL(t.DisplayOrder, 0), t.TempleId`, p));
}));
router.post('/temples', authMiddleware, requirePermission('temple_mgmt', 'CanCreate'), wrap(async (req, res) => {
  const b = pick(req.body || {}, TEMPLE_FIELDS);
  if (isBlank(b.TempleName)) return bad(res, 'Temple name is required');
  const err = await cleanTemple(req, b, null); if (err) return bad(res, err);
  const row = await tx(async (t) => {
    const r = await insertRow(t, 'Temples', { LocationId: req.locationId, Description: '', Address: '', IsMainTemple: false, DisplayOrder: 0, ...b, IsActive: b.IsActive !== false }, req);
    await singleMainTemple(t, r, req); await audit(t, req, 'CREATE', 'Temples', r.TempleId, null, r); return r;
  });
  res.status(201).json(await db.one(`${TEMPLE_SQL} WHERE t.TempleId = @id`, { id: row.TempleId }));
}));
router.put('/temples/:id', authMiddleware, requirePermission('temple_mgmt', 'CanEdit'), wrap(async (req, res) => {
  const rec = await templeHere(req); if (!rec) return bad(res, 'Temple not found at this location', 404);
  const b = pick(req.body || {}, TEMPLE_FIELDS); const err = await cleanTemple(req, b, rec); if (err) return bad(res, err);
  await tx(async (t) => { const r = await updateRow(t, 'Temples', 'TempleId', rec.TempleId, b, req); await singleMainTemple(t, r, req); await audit(t, req, 'UPDATE', 'Temples', r.TempleId, rec, r); });
  res.json(await db.one(`${TEMPLE_SQL} WHERE t.TempleId = @id`, { id: rec.TempleId }));
}));
router.delete('/temples/:id', authMiddleware, requirePermission('temple_mgmt', 'CanDelete'), wrap(async (req, res) => {
  const rec = await templeHere(req); if (!rec) return bad(res, 'Temple not found at this location', 404);
  const p = { t: rec.TempleId };
  if (await count(db, 'SELECT (SELECT COUNT(*) FROM dbo.SevaMaster WHERE TempleId = @t) + (SELECT COUNT(*) FROM dbo.Deities WHERE TempleId = @t) AS n', p)) return bad(res, 'Temple has deities or sevas. Delete them first or deactivate the temple.');
  if (await count(db, 'SELECT COUNT(*) AS n FROM dbo.Bookings WHERE TempleId = @t', p)) return bad(res, 'Temple has bookings. Deactivate it instead.');
  if (await count(db, 'SELECT COUNT(*) AS n FROM dbo.LifetimeMembers WHERE TempleId = @t', p)) return bad(res, 'Temple has lifetime members. Deactivate it instead.');
  await tx(async (t) => {
    await t.exec('DELETE FROM dbo.SevaTimeSlots WHERE TempleId = @t; UPDATE dbo.ItemMaster SET TempleId = NULL WHERE TempleId = @t; DELETE FROM dbo.Temples WHERE TempleId = @t;', p);
    await audit(t, req, 'DELETE', 'Temples', rec.TempleId, rec, null);
  });
  res.json({ message: 'Temple deleted' });
}));

// ---------- DEITIES (temples of the current location) ----------
const DEITY_FIELDS = ['DeityName', 'TempleId', 'Description', 'IsMainDeity', 'IsActive', 'DisplayOrder'];
const DEITY_SQL = 'SELECT d.*, ISNULL(t.TempleName, N\'\') AS TempleName FROM dbo.Deities d JOIN dbo.Temples t ON t.TempleId = d.TempleId';
const deityHere = (req) => db.one(`${DEITY_SQL} WHERE d.DeityId = @id AND t.LocationId = @l`, { id: id(req.params.id), l: req.locationId });
async function cleanDeity(req, b, existing) {
  if (b.TempleId !== undefined) { b.TempleId = toNum(b.TempleId); if (!(await templeInLoc(db, b.TempleId, req.locationId))) return 'Select a temple at this location'; }
  if (b.DeityName !== undefined) { b.DeityName = String(b.DeityName).trim(); if (!b.DeityName) return 'Deity name is required'; }
  const templeId = b.TempleId ?? existing?.TempleId; const name = b.DeityName ?? existing?.DeityName;
  if (await db.one('SELECT 1 AS x FROM dbo.Deities WHERE TempleId = @t AND DeityName = @n AND DeityId <> @id', { t: templeId, n: name, id: existing?.DeityId || 0 })) return `'${name}' already exists in this temple`;
  ['IsMainDeity', 'IsActive'].forEach((f) => { if (b[f] !== undefined) b[f] = toBool(b[f]); });
  if (b.DisplayOrder !== undefined) b.DisplayOrder = Number(b.DisplayOrder) || 0;
  return null;
}
router.get('/deities', authMiddleware, wrap(async (req, res) => {
  const w = ['t.LocationId = @l']; const p = { l: req.locationId };
  if (req.query.templeId) { w.push('d.TempleId = @t'); p.t = id(req.query.templeId); }
  if (req.query.activeOnly === 'true') w.push('ISNULL(d.IsActive, 1) = 1');
  res.json(await db.q(`${DEITY_SQL} WHERE ${w.join(' AND ')} ORDER BY ISNULL(d.DisplayOrder, 0), d.DeityId`, p));
}));
router.post('/deities', authMiddleware, requirePermission('deity_mgmt', 'CanCreate'), wrap(async (req, res) => {
  const b = pick(req.body || {}, DEITY_FIELDS);
  if (isBlank(b.DeityName) || isBlank(b.TempleId)) return bad(res, 'Deity name and temple are required');
  const err = await cleanDeity(req, b, null); if (err) return bad(res, err);
  const row = await tx(async (t) => { const r = await insertRow(t, 'Deities', { Description: '', IsMainDeity: false, DisplayOrder: 0, ...b, IsActive: b.IsActive !== false }, req); await audit(t, req, 'CREATE', 'Deities', r.DeityId, null, r); return r; });
  res.status(201).json(await db.one(`${DEITY_SQL} WHERE d.DeityId = @id`, { id: row.DeityId }));
}));
router.put('/deities/:id', authMiddleware, requirePermission('deity_mgmt', 'CanEdit'), wrap(async (req, res) => {
  const rec = await deityHere(req); if (!rec) return bad(res, 'Deity not found at this location', 404);
  const b = pick(req.body || {}, DEITY_FIELDS); const err = await cleanDeity(req, b, rec); if (err) return bad(res, err);
  if (b.TempleId !== undefined && b.TempleId !== rec.TempleId && (await count(db, 'SELECT COUNT(*) AS n FROM dbo.SevaMaster WHERE DeityId = @d', { d: rec.DeityId }))) return bad(res, 'Deity is linked to sevas — cannot move it to another temple');
  await tx(async (t) => { const r = await updateRow(t, 'Deities', 'DeityId', rec.DeityId, b, req); await audit(t, req, 'UPDATE', 'Deities', r.DeityId, rec, r); });
  res.json(await db.one(`${DEITY_SQL} WHERE d.DeityId = @id`, { id: rec.DeityId }));
}));
router.delete('/deities/:id', authMiddleware, requirePermission('deity_mgmt', 'CanDelete'), wrap(async (req, res) => {
  const rec = await deityHere(req); if (!rec) return bad(res, 'Deity not found at this location', 404);
  const p = { d: rec.DeityId };
  if (await count(db, 'SELECT COUNT(*) AS n FROM dbo.SevaMaster WHERE DeityId = @d', p)) return bad(res, 'Deity is linked to sevas. Unlink or delete those sevas first.');
  if (await count(db, 'SELECT (SELECT COUNT(*) FROM dbo.Bookings WHERE DeityId = @d) + (SELECT COUNT(*) FROM dbo.LifetimeMembers WHERE DeityId = @d) AS n', p)) return bad(res, 'Deity is used by bookings or members. Deactivate it instead.');
  await tx(async (t) => { await t.exec('DELETE FROM dbo.Deities WHERE DeityId = @d', p); await audit(t, req, 'DELETE', 'Deities', rec.DeityId, rec, null); });
  res.json({ message: 'Deity deleted' });
}));

// ---------- SEVA CATEGORIES (shared master) ----------
router.get('/seva-categories', authMiddleware, wrap(async (req, res) => {
  res.json(await db.q('SELECT c.*, (SELECT COUNT(*) FROM dbo.SevaMaster s WHERE s.CategoryId = c.CategoryId) AS SevaCount FROM dbo.SevaCategories c ORDER BY ISNULL(c.DisplayOrder, 0), c.CategoryId'));
}));
router.post('/seva-categories', authMiddleware, requirePermission('seva_categories', 'CanCreate'), wrap(async (req, res) => {
  const name = String(req.body?.CategoryName || '').trim(); if (!name) return bad(res, 'Category name is required');
  if (await db.one('SELECT 1 AS x FROM dbo.SevaCategories WHERE CategoryName = @n', { n: name })) return bad(res, 'Category already exists');
  const row = await tx(async (t) => { const r = await insertRow(t, 'SevaCategories', { CategoryName: name, IsActive: req.body.IsActive !== false && req.body.IsActive !== 'false', DisplayOrder: Number(req.body.DisplayOrder) || 0 }, req); await audit(t, req, 'CREATE', 'SevaCategories', r.CategoryId, null, r); return r; });
  res.status(201).json(row);
}));
router.put('/seva-categories/:id', authMiddleware, requirePermission('seva_categories', 'CanEdit'), wrap(async (req, res) => {
  const rec = await db.one('SELECT * FROM dbo.SevaCategories WHERE CategoryId = @id', { id: id(req.params.id) }); if (!rec) return bad(res, 'Category not found', 404);
  const b = pick(req.body || {}, ['CategoryName', 'IsActive', 'DisplayOrder']);
  if (b.CategoryName !== undefined) {
    b.CategoryName = String(b.CategoryName).trim(); if (!b.CategoryName) return bad(res, 'Category name is required');
    if (await db.one('SELECT 1 AS x FROM dbo.SevaCategories WHERE CategoryName = @n AND CategoryId <> @id', { n: b.CategoryName, id: rec.CategoryId })) return bad(res, 'Category already exists');
  }
  if (b.IsActive !== undefined) b.IsActive = toBool(b.IsActive);
  if (b.DisplayOrder !== undefined) b.DisplayOrder = Number(b.DisplayOrder) || 0;
  const row = await tx(async (t) => { const r = await updateRow(t, 'SevaCategories', 'CategoryId', rec.CategoryId, b, req); await audit(t, req, 'UPDATE', 'SevaCategories', r.CategoryId, rec, r); return r; });
  res.json(row);
}));
router.delete('/seva-categories/:id', authMiddleware, requirePermission('seva_categories', 'CanDelete'), wrap(async (req, res) => {
  const rec = await db.one('SELECT * FROM dbo.SevaCategories WHERE CategoryId = @id', { id: id(req.params.id) }); if (!rec) return bad(res, 'Category not found', 404);
  if (await count(db, 'SELECT COUNT(*) AS n FROM dbo.SevaMaster WHERE CategoryId = @c', { c: rec.CategoryId })) return bad(res, 'Category is used by sevas. Deactivate it instead.');
  await tx(async (t) => { await t.exec('DELETE FROM dbo.SevaCategories WHERE CategoryId = @c', { c: rec.CategoryId }); await audit(t, req, 'DELETE', 'SevaCategories', rec.CategoryId, rec, null); });
  res.json({ message: 'Category deleted' });
}));

// ---------- SEVA MASTER (temple-wise sevas at the current location) ----------
const SEVA_FIELDS = ['TempleId', 'DeityId', 'CategoryId', 'SevaName', 'Amount', 'Description', 'IsActive'];
const SEVA_SQL = `SELECT s.*, ISNULL(t.TempleName, N'') AS TempleName, t.LocationId, ISNULL(d.DeityName, N'') AS DeityName, ISNULL(c.CategoryName, N'') AS CategoryName
  FROM dbo.SevaMaster s JOIN dbo.Temples t ON t.TempleId = s.TempleId LEFT JOIN dbo.Deities d ON d.DeityId = s.DeityId LEFT JOIN dbo.SevaCategories c ON c.CategoryId = s.CategoryId`;
const sevaHere = (req) => db.one(`${SEVA_SQL} WHERE s.SevaId = @id AND t.LocationId = @l`, { id: id(req.params.id), l: req.locationId });
async function cleanSeva(req, b, existing) {
  if (b.TempleId !== undefined) { b.TempleId = toNum(b.TempleId); if (!(await templeInLoc(db, b.TempleId, req.locationId))) return 'Select a temple at this location'; }
  const templeId = b.TempleId ?? existing?.TempleId;
  const deityTemple = async (deityId) => (await db.one('SELECT TempleId FROM dbo.Deities WHERE DeityId = @d', { d: deityId }))?.TempleId;
  if (b.DeityId !== undefined) { b.DeityId = toNum(b.DeityId); if (b.DeityId && (await deityTemple(b.DeityId)) !== templeId) return 'Deity does not belong to the selected temple'; }
  else if (existing?.DeityId && b.TempleId !== undefined && (await deityTemple(existing.DeityId)) !== templeId) b.DeityId = null;
  if (b.CategoryId !== undefined) { b.CategoryId = toNum(b.CategoryId); if (!(await db.one('SELECT 1 AS x FROM dbo.SevaCategories WHERE CategoryId = @c', { c: b.CategoryId || 0 }))) return 'Select a valid category'; }
  if (b.SevaName !== undefined) { b.SevaName = String(b.SevaName).trim(); if (!b.SevaName) return 'Seva name is required'; }
  if (b.Amount !== undefined) { b.Amount = Number(b.Amount); if (!Number.isFinite(b.Amount) || b.Amount < 0) return 'Amount must be 0 or more'; }
  if (b.IsActive !== undefined) b.IsActive = toBool(b.IsActive);
  if (b.Description !== undefined) b.Description = String(b.Description ?? '').trim();
  const name = b.SevaName ?? existing?.SevaName;
  if (await db.one('SELECT 1 AS x FROM dbo.SevaMaster WHERE TempleId = @t AND SevaName = @n AND SevaId <> @id', { t: templeId, n: name, id: existing?.SevaId || 0 })) return `'${name}' already exists for this temple`;
  return null;
}
router.get('/sevas', authMiddleware, wrap(async (req, res) => {
  const qy = req.query; const w = ['t.LocationId = @l']; const p = { l: req.locationId };
  if (qy.templeId) { w.push('s.TempleId = @t'); p.t = id(qy.templeId); }
  if (qy.deityId) { w.push('s.DeityId = @d'); p.d = id(qy.deityId); }
  if (qy.categoryId) { w.push('s.CategoryId = @c'); p.c = id(qy.categoryId); }
  if (qy.search) { w.push('s.SevaName LIKE @s'); p.s = likeArg(qy.search); }
  if (qy.activeOnly === 'true') w.push('ISNULL(s.IsActive, 1) = 1');
  res.json(await db.q(`${SEVA_SQL} WHERE ${w.join(' AND ')} ORDER BY t.DisplayOrder, s.SevaId`, p));
}));
router.get('/sevas/:id', authMiddleware, wrap(async (req, res) => { const rec = await sevaHere(req); if (!rec) return bad(res, 'Seva not found', 404); res.json(rec); }));
router.post('/sevas', authMiddleware, requirePermission('seva_master', 'CanCreate'), wrap(async (req, res) => {
  const b = pick(req.body || {}, SEVA_FIELDS);
  if (isBlank(b.SevaName) || isBlank(b.TempleId) || isBlank(b.CategoryId) || isBlank(b.Amount)) return bad(res, 'Seva name, temple, category and amount are required');
  const err = await cleanSeva(req, b, null); if (err) return bad(res, err);
  const row = await tx(async (t) => { const r = await insertRow(t, 'SevaMaster', { DeityId: null, Description: '', ...b, IsActive: b.IsActive !== false }, req); await audit(t, req, 'CREATE', 'SevaMaster', r.SevaId, null, r); return r; });
  res.status(201).json(await db.one(`${SEVA_SQL} WHERE s.SevaId = @id`, { id: row.SevaId }));
}));
router.put('/sevas/:id', authMiddleware, requirePermission('seva_master', 'CanEdit'), wrap(async (req, res) => {
  const rec = await sevaHere(req); if (!rec) return bad(res, 'Seva not found at this location', 404);
  const b = pick(req.body || {}, SEVA_FIELDS); const err = await cleanSeva(req, b, rec); if (err) return bad(res, err);
  await tx(async (t) => { const r = await updateRow(t, 'SevaMaster', 'SevaId', rec.SevaId, b, req); await audit(t, req, 'UPDATE', 'SevaMaster', r.SevaId, rec, r); });
  res.json(await db.one(`${SEVA_SQL} WHERE s.SevaId = @id`, { id: rec.SevaId }));
}));
router.delete('/sevas/:id', authMiddleware, requirePermission('seva_master', 'CanDelete'), wrap(async (req, res) => {
  const rec = await sevaHere(req); if (!rec) return bad(res, 'Seva not found at this location', 404);
  if (await count(db, 'SELECT COUNT(*) AS n FROM dbo.BookingItems WHERE SevaId = @s', { s: rec.SevaId })) return bad(res, 'This seva has bookings. Deactivate it instead.');
  await tx(async (t) => { await t.exec('DELETE FROM dbo.SevaMaster WHERE SevaId = @s', { s: rec.SevaId }); await audit(t, req, 'DELETE', 'SevaMaster', rec.SevaId, rec, null); });
  res.json({ message: 'Seva deleted' });
}));

// ---------- ITEM MASTER (separate items per booking type, e.g. Laddu / Goshala - per location) ----------
const ITEM_FIELDS = ['BookingTypeId', 'TempleId', 'ItemName', 'Amount', 'AllowCustomAmount', 'MinAmount', 'Unit', 'Description', 'IsActive', 'DisplayOrder'];
const ITEM_SQL = `SELECT i.*, ISNULL(bt.TypeName, N'') AS TypeName, ISNULL(t.TempleName, N'') AS TempleName
  FROM dbo.ItemMaster i LEFT JOIN dbo.BookingTypes bt ON bt.BookingTypeId = i.BookingTypeId LEFT JOIN dbo.Temples t ON t.TempleId = i.TempleId`;
const itemHere = (req) => db.one(`${ITEM_SQL} WHERE i.ItemId = @id AND i.LocationId = @l`, { id: id(req.params.id), l: req.locationId });
async function cleanItem(req, b, existing) {
  if (b.BookingTypeId !== undefined) b.BookingTypeId = toNum(b.BookingTypeId);
  const type = await db.one('SELECT * FROM dbo.BookingTypes WHERE BookingTypeId = @id', { id: b.BookingTypeId ?? existing?.BookingTypeId ?? 0 });
  if (!type) return 'Select a booking type';
  if (type.UsesSevaMaster) return `${type.TypeName} bookings use the Seva Master — add sevas there instead`;
  if (b.TempleId !== undefined) { b.TempleId = toNum(b.TempleId); if (b.TempleId && !(await templeInLoc(db, b.TempleId, req.locationId))) return 'Temple does not belong to this location'; }
  if (b.ItemName !== undefined) { b.ItemName = String(b.ItemName).trim(); if (!b.ItemName) return 'Item name is required'; }
  if (b.Amount !== undefined) { b.Amount = Number(b.Amount); if (!Number.isFinite(b.Amount) || b.Amount < 0) return 'Amount must be 0 or more'; }
  if (b.MinAmount !== undefined) b.MinAmount = Number(b.MinAmount) || 0;
  ['AllowCustomAmount', 'IsActive'].forEach((f) => { if (b[f] !== undefined) b[f] = toBool(b[f]); });
  if (b.DisplayOrder !== undefined) b.DisplayOrder = Number(b.DisplayOrder) || 0;
  for (const f of ['Unit', 'Description']) if (b[f] !== undefined) b[f] = String(b[f] ?? '').trim();
  const name = b.ItemName ?? existing?.ItemName;
  if (await db.one('SELECT 1 AS x FROM dbo.ItemMaster WHERE LocationId = @l AND BookingTypeId = @bt AND ItemName = @n AND ItemId <> @id', { l: req.locationId, bt: type.BookingTypeId, n: name, id: existing?.ItemId || 0 })) return `'${name}' already exists for ${type.TypeName}`;
  return null;
}
router.get('/items', authMiddleware, wrap(async (req, res) => {
  const w = ['i.LocationId = @l']; const p = { l: req.locationId };
  if (req.query.bookingTypeId) { w.push('i.BookingTypeId = @bt'); p.bt = id(req.query.bookingTypeId); }
  if (req.query.templeId) { w.push('(i.TempleId IS NULL OR i.TempleId = @t)'); p.t = id(req.query.templeId); }
  if (req.query.activeOnly === 'true') w.push('i.IsActive = 1');
  res.json(await db.q(`${ITEM_SQL} WHERE ${w.join(' AND ')} ORDER BY i.DisplayOrder, i.ItemId`, p));
}));
router.post('/items', authMiddleware, requirePermission('item_master', 'CanCreate'), wrap(async (req, res) => {
  const b = pick(req.body || {}, ITEM_FIELDS);
  if (isBlank(b.ItemName) || isBlank(b.BookingTypeId) || isBlank(b.Amount)) return bad(res, 'Booking type, item name and amount are required');
  const err = await cleanItem(req, b, null); if (err) return bad(res, err);
  const row = await tx(async (t) => { const r = await insertRow(t, 'ItemMaster', { LocationId: req.locationId, TempleId: null, AllowCustomAmount: false, MinAmount: 0, Unit: '', Description: '', DisplayOrder: 0, ...b, IsActive: b.IsActive !== false }, req); await audit(t, req, 'CREATE', 'ItemMaster', r.ItemId, null, r); return r; });
  res.status(201).json(await db.one(`${ITEM_SQL} WHERE i.ItemId = @id`, { id: row.ItemId }));
}));
router.put('/items/:id', authMiddleware, requirePermission('item_master', 'CanEdit'), wrap(async (req, res) => {
  const rec = await itemHere(req); if (!rec) return bad(res, 'Item not found at this location', 404);
  const b = pick(req.body || {}, ITEM_FIELDS); const err = await cleanItem(req, b, rec); if (err) return bad(res, err);
  await tx(async (t) => { const r = await updateRow(t, 'ItemMaster', 'ItemId', rec.ItemId, b, req); await audit(t, req, 'UPDATE', 'ItemMaster', r.ItemId, rec, r); });
  res.json(await db.one(`${ITEM_SQL} WHERE i.ItemId = @id`, { id: rec.ItemId }));
}));
router.delete('/items/:id', authMiddleware, requirePermission('item_master', 'CanDelete'), wrap(async (req, res) => {
  const rec = await itemHere(req); if (!rec) return bad(res, 'Item not found at this location', 404);
  if (await count(db, 'SELECT COUNT(*) AS n FROM dbo.BookingItems WHERE MasterItemId = @i', { i: rec.ItemId })) return bad(res, 'This item has bookings. Deactivate it instead.');
  await tx(async (t) => { await t.exec('DELETE FROM dbo.ItemMaster WHERE ItemId = @i', { i: rec.ItemId }); await audit(t, req, 'DELETE', 'ItemMaster', rec.ItemId, rec, null); });
  res.json({ message: 'Item deleted' });
}));

// ---------- COUNTERS (current location) ----------
const COUNTER_FIELDS = ['CounterName', 'Location', 'IsActive', 'AssignedUserId'];
const COUNTER_SQL = 'SELECT c.*, ISNULL(u.FullName, N\'\') AS AssignedUserName FROM dbo.Counters c LEFT JOIN dbo.Users u ON u.UserId = c.AssignedUserId';
const counterHere = (req) => db.one(`${COUNTER_SQL} WHERE c.CounterId = @id AND c.LocationId = @l`, { id: id(req.params.id), l: req.locationId });
async function cleanCounter(req, b, existing) {
  if (b.CounterName !== undefined) {
    b.CounterName = String(b.CounterName).trim(); if (!b.CounterName) return 'Counter name is required';
    if (await db.one('SELECT 1 AS x FROM dbo.Counters WHERE LocationId = @l AND CounterName = @n AND CounterId <> @id', { l: req.locationId, n: b.CounterName, id: existing?.CounterId || 0 })) return 'Counter name already exists at this location';
  }
  if (b.AssignedUserId !== undefined) {
    b.AssignedUserId = toNum(b.AssignedUserId);
    if (b.AssignedUserId) { const u = await loadUser(b.AssignedUserId); if (!u || !canAccessLocation(u, req.locationId)) return 'Assigned user does not have access to this location'; }
  }
  if (b.Location !== undefined) b.Location = String(b.Location ?? '').trim();
  if (b.IsActive !== undefined) b.IsActive = toBool(b.IsActive);
  return null;
}
router.get('/counters', authMiddleware, wrap(async (req, res) => {
  res.json(await db.q(`${COUNTER_SQL} WHERE c.LocationId = @l${req.query.activeOnly === 'true' ? ' AND ISNULL(c.IsActive, 1) = 1' : ''} ORDER BY c.CounterId`, { l: req.locationId }));
}));
router.post('/counters', authMiddleware, requirePermission('counters', 'CanCreate'), wrap(async (req, res) => {
  const b = pick(req.body || {}, COUNTER_FIELDS); if (isBlank(b.CounterName)) return bad(res, 'Counter name is required');
  const err = await cleanCounter(req, b, null); if (err) return bad(res, err);
  const row = await tx(async (t) => { const r = await insertRow(t, 'Counters', { LocationId: req.locationId, Location: '', AssignedUserId: null, ...b, IsActive: b.IsActive !== false }, req); await audit(t, req, 'CREATE', 'Counters', r.CounterId, null, r); return r; });
  res.status(201).json(await db.one(`${COUNTER_SQL} WHERE c.CounterId = @id`, { id: row.CounterId }));
}));
router.put('/counters/:id', authMiddleware, requirePermission('counters', 'CanEdit'), wrap(async (req, res) => {
  const rec = await counterHere(req); if (!rec) return bad(res, 'Counter not found at this location', 404);
  const b = pick(req.body || {}, COUNTER_FIELDS); const err = await cleanCounter(req, b, rec); if (err) return bad(res, err);
  await tx(async (t) => { const r = await updateRow(t, 'Counters', 'CounterId', rec.CounterId, b, req); await audit(t, req, 'UPDATE', 'Counters', r.CounterId, rec, r); });
  res.json(await db.one(`${COUNTER_SQL} WHERE c.CounterId = @id`, { id: rec.CounterId }));
}));
router.delete('/counters/:id', authMiddleware, requirePermission('counters', 'CanDelete'), wrap(async (req, res) => {
  const rec = await counterHere(req); if (!rec) return bad(res, 'Counter not found at this location', 404);
  if (await count(db, 'SELECT COUNT(*) AS n FROM dbo.Bookings WHERE CounterId = @c', { c: rec.CounterId })) return bad(res, 'Counter has bookings. Deactivate it instead.');
  await tx(async (t) => { await t.exec('DELETE FROM dbo.Counters WHERE CounterId = @c', { c: rec.CounterId }); await audit(t, req, 'DELETE', 'Counters', rec.CounterId, rec, null); });
  res.json({ message: 'Counter deleted' });
}));

export default router;
