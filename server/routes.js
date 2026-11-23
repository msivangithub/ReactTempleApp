// Temple Seva Booking API — fully dynamic, location-scoped.
// Every request carries the location chosen at login (JWT). All operational data
// (temples, deities, sevas, items, counters, slots, bookings, members, reports)
// is filtered to that location. Lookups, roles, screens and permissions come from masters.
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { store, genBookingNumber, genTokenNumber, genMemberNumber, audit as writeAudit, nextId, getDefault, todayISO, nowHHMM } from './store.js';
import { authMiddleware, requirePermission, getPermissionsForRole, isSuperAdmin, canAccessLocation, allowedLocationsFor, hasPermission, signToken } from './auth.js';

const router = Router();

// ---------- helpers ----------
const S = () => store.settings;
const nowISO = () => new Date().toISOString();
const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';
const toNum = (v) => (isBlank(v) ? null : Number(v));
const toBool = (v) => v === true || v === 'true' || v === 1 || v === '1';
const pick = (obj, fields) => Object.fromEntries(fields.filter((f) => obj && obj[f] !== undefined).map((f) => [f, obj[f]]));
const byOrder = (a, b) => (Number(a.DisplayOrder) || 0) - (Number(b.DisplayOrder) || 0);
const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const mobileOk = (m) => new RegExp(S().mobilePattern || '^\\d{10}$').test(String(m ?? ''));
const bad = (res, error, code = 400) => res.status(code).json({ error });
const audit = (req, action, table, id, oldV, newV) => writeAudit(req.user?.UserId ?? null, action, table, id, oldV, newV, req.ip, req.locationId ?? null);
const sum = (rows) => rows.reduce((s, b) => s + Number(b.TotalAmount || 0), 0);
const groupBy = (rows, keyFn) => rows.reduce((acc, b) => { const k = keyFn(b) || '—'; acc[k] = acc[k] || { count: 0, amount: 0 }; acc[k].count++; acc[k].amount += Number(b.TotalAmount || 0); return acc; }, {});

const findBy = (list, key, id) => (isBlank(id) ? undefined : list.find((r) => r[key] === Number(id)));
const locById = (id) => findBy(store.locations, 'LocationId', id);
const templeById = (id) => findBy(store.temples, 'TempleId', id);
const typeById = (id) => findBy(store.bookingTypes, 'BookingTypeId', id);
const roleOf = (id) => findBy(store.roles, 'RoleId', id);
const templeInLoc = (templeId, locId) => templeById(templeId)?.LocationId === locId;
const locTempleIds = (locId) => new Set(store.temples.filter((t) => t.LocationId === locId).map((t) => t.TempleId));
const bookingLoc = (b) => b.LocationId ?? templeById(b.TempleId)?.LocationId ?? null;
const memberLoc = (m) => m.LocationId ?? templeById(m.TempleId)?.LocationId ?? null;
const cancelledNames = () => new Set(store.bookingStatuses.filter((s) => s.IsCancelled).map((s) => s.StatusName));
const isCancelled = (b) => cancelledNames().has(b.PaymentStatus);
const cancelStatus = () => [...store.bookingStatuses].sort(byOrder).find((s) => s.IsCancelled && s.IsActive)?.StatusName || null;
const typeScreen = (t) => t?.ScreenKey || 'bookings';

// ---------- shapes ----------
const LOCATION_FIELDS = ['LocationName', 'LocationCode', 'Description', 'Address', 'Phone', 'Email', 'ReceiptFooter', 'IsActive', 'DisplayOrder'];
const publicLocation = (l) => (l ? { LocationId: l.LocationId, ...pick(l, LOCATION_FIELDS) } : null);
const pubUser = ({ PasswordHash, ...rest }) => rest;
const enrichUser = (u) => ({ ...pubUser(u), RoleName: roleOf(u.RoleId)?.RoleName || '', IsSuperAdmin: isSuperAdmin(u), AllLocations: !!u.AllLocations, LocationIds: u.LocationIds || [], LocationNames: u.AllLocations ? [] : (u.LocationIds || []).map((id) => locById(id)?.LocationName).filter(Boolean) });
const enrichTemple = (t) => ({ ...t, LocationName: locById(t.LocationId)?.LocationName || '', DeityCount: store.deities.filter((d) => d.TempleId === t.TempleId).length, SevaCount: store.sevas.filter((s) => s.TempleId === t.TempleId).length });
const enrichDeity = (d) => ({ ...d, TempleName: templeById(d.TempleId)?.TempleName || '' });
const enrichSeva = (s) => { const t = templeById(s.TempleId); return { ...s, TempleName: t?.TempleName || '', LocationId: t?.LocationId ?? null, DeityName: findBy(store.deities, 'DeityId', s.DeityId)?.DeityName || '', CategoryName: findBy(store.sevaCategories, 'CategoryId', s.CategoryId)?.CategoryName || '' }; };
const enrichItem = (i) => ({ ...i, TypeName: typeById(i.BookingTypeId)?.TypeName || '', TempleName: i.TempleId ? templeById(i.TempleId)?.TempleName || '' : '' });
const enrichCounter = (c) => ({ ...c, AssignedUserName: findBy(store.users, 'UserId', c.AssignedUserId)?.FullName || '' });
const enrichMember = (m) => ({ ...m, TempleName: templeById(m.TempleId)?.TempleName || '', DeityName: findBy(store.deities, 'DeityId', m.DeityId)?.DeityName || '' });
const enrichBooking = (b) => { const l = locById(bookingLoc(b)); return { ...b, TempleName: templeById(b.TempleId)?.TempleName || '', LocationName: l?.LocationName || '', LocationCode: l?.LocationCode || '', CounterName: findBy(store.counters, 'CounterId', b.CounterId)?.CounterName || '', CreatedByName: findBy(store.users, 'UserId', b.CreatedBy)?.FullName || '', IsCancelled: isCancelled(b) }; };

function session(user, location, withToken = true) {
  const out = { user: enrichUser(user), permissions: getPermissionsForRole(user.RoleId), location: publicLocation(location), locations: allowedLocationsFor(user).map(publicLocation) };
  if (withToken) out.token = signToken(user, location.LocationId);
  return out;
}

// ---------- PUBLIC CONFIG (no auth — login screen shows locations from DB) ----------
router.get('/public/config', (req, res) => {
  const s = S();
  res.json({
    appName: s.appName || '', tagline: s.tagline || '', currencySymbol: s.currencySymbol || '', locale: s.locale || '', timeZone: s.timeZone || '', mobilePattern: s.mobilePattern || '', maxQuantity: Number(s.maxQuantity) || null,
    locations: store.locations.filter((l) => l.IsActive).sort(byOrder).map((l) => ({ ...publicLocation(l), Temples: store.temples.filter((t) => t.LocationId === l.LocationId && t.IsActive).sort(byOrder).map((t) => t.TempleName) })),
  });
});

// ---------- AUTH (login requires a location) ----------
router.post('/auth/login', async (req, res) => {
  const { username, password, locationId } = req.body || {};
  if (isBlank(username) || isBlank(password)) return bad(res, 'Username and password are required');
  const user = store.users.find((u) => same(u.Username, username));
  if (!user || !user.IsActive || !(await bcrypt.compare(String(password), user.PasswordHash))) return bad(res, 'Invalid username or password', 401);
  const allowed = allowedLocationsFor(user);
  if (!allowed.length) return bad(res, 'No active location is assigned to your account. Contact your administrator.', 403);
  let location = null;
  if (!isBlank(locationId)) {
    location = locById(locationId);
    if (!location || !location.IsActive) return bad(res, 'The selected location is not available');
    if (!canAccessLocation(user, location.LocationId)) return bad(res, `You do not have access to ${location.LocationName}. Your locations: ${allowed.map((l) => l.LocationName).join(', ')}`, 403);
  } else if (allowed.length === 1) location = allowed[0];
  else return bad(res, 'Please select a location');
  writeAudit(user.UserId, 'LOGIN', 'Users', user.UserId, null, { Username: user.Username, LocationId: location.LocationId }, req.ip, location.LocationId);
  res.json(session(user, location));
});
router.post('/auth/switch-location', authMiddleware, (req, res) => {
  const location = locById(req.body?.locationId);
  if (!location || !location.IsActive) return bad(res, 'The selected location is not available');
  if (!canAccessLocation(req.currentUser, location.LocationId)) return bad(res, `You do not have access to ${location.LocationName}`, 403);
  audit(req, 'SWITCH_LOCATION', 'Locations', location.LocationId, { LocationId: req.locationId }, { LocationId: location.LocationId });
  res.json(session(req.currentUser, location));
});
router.get('/auth/me', authMiddleware, (req, res) => res.json(session(req.currentUser, req.location, false)));
router.post('/auth/change-password', authMiddleware, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const user = req.currentUser;
  if (!(await bcrypt.compare(String(currentPassword || ''), user.PasswordHash))) return bad(res, 'Current password is incorrect');
  if (!newPassword || String(newPassword).length < 6) return bad(res, 'New password must be at least 6 characters');
  user.PasswordHash = await bcrypt.hash(String(newPassword), 10); user.UpdatedAt = nowISO();
  audit(req, 'CHANGE_PASSWORD', 'Users', user.UserId, null, null);
  res.json({ message: 'Password changed successfully' });
});

// ---------- DASHBOARD / REPORTS (current location) ----------
router.get('/dashboard/stats', authMiddleware, requirePermission('overview'), (req, res) => {
  const loc = req.locationId, t0 = todayISO();
  const all = store.bookings.filter((b) => bookingLoc(b) === loc);
  const live = all.filter((b) => !isCancelled(b));
  const todays = live.filter((b) => b.BookingDate === t0);
  const templeIds = locTempleIds(loc);
  const activeMember = getDefault(store.memberStatuses)?.StatusName;
  res.json({
    location: publicLocation(req.location),
    todayCount: todays.length, todayCollection: sum(todays),
    totalBookings: live.length, totalCollection: sum(live),
    upcomingAdvance: live.filter((b) => b.IsAdvanceBooking && b.SevaDate >= t0).length,
    activeTemples: store.temples.filter((t) => t.LocationId === loc && t.IsActive).length,
    activeSevas: store.sevas.filter((s) => templeIds.has(s.TempleId) && s.IsActive).length,
    activeItems: store.items.filter((i) => i.LocationId === loc && i.IsActive).length,
    activeUsers: store.users.filter((u) => u.IsActive && canAccessLocation(u, loc)).length,
    activeMembers: store.members.filter((m) => memberLoc(m) === loc && m.Status === activeMember).length,
    activeCounters: store.counters.filter((c) => c.LocationId === loc && c.IsActive).length,
    todayByType: groupBy(todays, (b) => b.BookingType), byType: groupBy(live, (b) => b.BookingType),
    byTemple: groupBy(live, (b) => templeById(b.TempleId)?.TempleName), byPayment: groupBy(live, (b) => b.PaymentMode),
    recent: [...all].reverse().slice(0, 8).map(enrichBooking),
  });
});
router.get('/reports/summary', authMiddleware, requirePermission('reports'), (req, res) => {
  const { from, to, templeId, bookingType, paymentMode, paymentStatus } = req.query;
  let rows = store.bookings.filter((b) => bookingLoc(b) === req.locationId);
  rows = paymentStatus ? rows.filter((b) => b.PaymentStatus === paymentStatus) : rows.filter((b) => !isCancelled(b));
  if (from) rows = rows.filter((b) => b.BookingDate >= from);
  if (to) rows = rows.filter((b) => b.BookingDate <= to);
  if (templeId) rows = rows.filter((b) => String(b.TempleId) === String(templeId));
  if (bookingType) rows = rows.filter((b) => b.BookingType === bookingType);
  if (paymentMode) rows = rows.filter((b) => b.PaymentMode === paymentMode);
  res.json({ location: publicLocation(req.location), count: rows.length, total: sum(rows), byType: groupBy(rows, (b) => b.BookingType), byStatus: groupBy(rows, (b) => b.PaymentStatus), byMode: groupBy(rows, (b) => b.PaymentMode), rows: [...rows].reverse().map(enrichBooking) });
});

// ---------- LOOKUP MASTERS (generic CRUD; single default; rename cascades; in-use protection) ----------
function lookupRoutes({ path, table, screen, idField, nameField, extraFields = [], requiredExtras = [], normalize, validate, usage, afterSave }) {
  const FIELDS = [nameField, ...extraFields, 'IsActive', 'IsDefault', 'DisplayOrder'];
  const list = () => store[table];
  const singleDefault = (rec) => { if (rec.IsDefault) list().forEach((r) => { if (r !== rec) r.IsDefault = false; }); };
  const clean = (b) => { if (b[nameField] !== undefined) b[nameField] = String(b[nameField]).trim(); if (b.DisplayOrder !== undefined) b.DisplayOrder = Number(b.DisplayOrder) || 0; ['IsActive', 'IsDefault'].forEach((f) => { if (b[f] !== undefined) b[f] = toBool(b[f]); }); normalize?.(b); return b; };
  router.get(path, authMiddleware, (req, res) => {
    let rows = [...list()].sort(byOrder);
    if (req.query.activeOnly === 'true') rows = rows.filter((r) => r.IsActive);
    res.json(rows.map((r) => ({ ...r, InUse: usage ? usage.count(r) : 0 })));
  });
  router.post(path, authMiddleware, requirePermission(screen, 'CanCreate'), (req, res) => {
    const b = clean(pick(req.body || {}, FIELDS));
    if (isBlank(b[nameField])) return bad(res, `${nameField} is required`);
    for (const f of requiredExtras) if (isBlank(b[f])) return bad(res, `${f} is required`);
    if (list().some((r) => same(r[nameField], b[nameField]))) return bad(res, `'${b[nameField]}' already exists`);
    const verr = validate?.(b, null); if (verr) return bad(res, verr);
    const rec = { [idField]: nextId(), ...b, IsActive: b.IsActive !== false, IsDefault: !!b.IsDefault, DisplayOrder: b.DisplayOrder || 0 };
    list().push(rec); singleDefault(rec); afterSave?.(rec); audit(req, 'CREATE', table, rec[idField], null, rec); res.status(201).json(rec);
  });
  router.put(`${path}/:id`, authMiddleware, requirePermission(screen, 'CanEdit'), (req, res) => {
    const rec = findBy(list(), idField, req.params.id); if (!rec) return bad(res, 'Record not found', 404);
    const b = clean(pick(req.body || {}, FIELDS));
    if (b[nameField] !== undefined) { if (!b[nameField]) return bad(res, `${nameField} is required`); if (list().some((r) => r !== rec && same(r[nameField], b[nameField]))) return bad(res, `'${b[nameField]}' already exists`); }
    for (const f of requiredExtras) if (b[f] !== undefined && isBlank(b[f])) return bad(res, `${f} is required`);
    const verr = validate?.(b, rec); if (verr) return bad(res, verr);
    const old = { ...rec }; Object.assign(rec, b);
    if (usage?.rename && old[nameField] !== rec[nameField]) usage.rename(old, rec); // keep existing records consistent
    singleDefault(rec); afterSave?.(rec); audit(req, 'UPDATE', table, rec[idField], old, rec); res.json(rec);
  });
  router.delete(`${path}/:id`, authMiddleware, requirePermission(screen, 'CanDelete'), (req, res) => {
    const rec = findBy(list(), idField, req.params.id); if (!rec) return bad(res, 'Record not found', 404);
    const used = usage ? usage.count(rec) : 0;
    if (used) return bad(res, `'${rec[nameField]}' is used by ${used} record(s). Deactivate it instead.`);
    list().splice(list().indexOf(rec), 1); audit(req, 'DELETE', table, rec[idField], rec, null); res.json({ message: 'Deleted' });
  });
}
const usageByName = (coll, field, nameField) => ({ count: (r) => store[coll].filter((x) => x[field] === r[nameField]).length, rename: (o, n) => store[coll].forEach((x) => { if (x[field] === o[nameField]) x[field] = n[nameField]; }) });

const TYPE_FLAGS = ['UsesSevaMaster', 'RequiresTemple', 'RequiresSchedule', 'RequiresDevotee', 'CaptureGothram', 'AllowAdvance'];
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
// A booking type owns a screen (its own booking page + permissions). New key → screen is created automatically.
function ensureTypeScreen(type) {
  if (!type.ScreenKey) type.ScreenKey = `${slug(type.TypeName)}_booking`;
  else type.ScreenKey = slug(type.ScreenKey);
  if (store.screens.some((s) => s.ScreenKey === type.ScreenKey)) return;
  const typeScreens = store.screens.filter((s) => store.bookingTypes.some((t) => t !== type && t.ScreenKey === s.ScreenKey));
  const group = typeScreens[0]?.ScreenGroup || store.screens[0]?.ScreenGroup || '';
  const order = typeScreens.reduce((m, s) => Math.max(m, Number(s.DisplayOrder) || 0), 0);
  store.screens.push({ ScreenId: nextId(), ScreenKey: type.ScreenKey, ScreenName: `${type.TypeName} Booking`, ScreenGroup: group, DisplayOrder: order, IsActive: true, IsBookingScreen: true });
}
function validateBookingType(b, existing) {
  if (isBlank(b.ScreenKey)) { if (existing) delete b.ScreenKey; else b.ScreenKey = `${slug(b.TypeName)}_booking`; }
  const key = slug(b.ScreenKey ?? existing?.ScreenKey); if (b.ScreenKey !== undefined) b.ScreenKey = key;
  if (!key) return 'Screen key is required';
  if (store.bookingTypes.some((t) => t !== existing && t.ScreenKey === key)) return 'Another booking type already uses this screen key';
  const scr = store.screens.find((s) => s.ScreenKey === key);
  if (scr && !scr.IsBookingScreen) return `'${key}' is a system screen — choose a different screen key`;
  return null;
}
lookupRoutes({
  path: '/booking-types', table: 'bookingTypes', screen: 'booking_types', idField: 'BookingTypeId', nameField: 'TypeName',
  extraFields: ['TokenPrefix', 'ScreenKey', 'Description', 'Icon', ...TYPE_FLAGS], requiredExtras: ['TokenPrefix'],
  normalize: (b) => { if (b.TokenPrefix !== undefined) b.TokenPrefix = String(b.TokenPrefix).trim().toUpperCase(); TYPE_FLAGS.forEach((f) => { if (b[f] !== undefined) b[f] = toBool(b[f]); }); },
  usage: { count: (r) => store.bookings.filter((x) => x.BookingType === r.TypeName).length + store.items.filter((i) => i.BookingTypeId === r.BookingTypeId).length, rename: (o, n) => {
    store.bookings.forEach((x) => { if (x.BookingType === o.TypeName) x.BookingType = n.TypeName; });
    const scr = store.screens.find((s) => s.ScreenKey === n.ScreenKey); if (scr && same(scr.ScreenName, `${o.TypeName} Booking`)) scr.ScreenName = `${n.TypeName} Booking`;
  } },
  validate: validateBookingType,
  afterSave: ensureTypeScreen,
});
lookupRoutes({ path: '/payment-modes', table: 'paymentModes', screen: 'payment_modes', idField: 'PaymentModeId', nameField: 'ModeName', usage: usageByName('bookings', 'PaymentMode', 'ModeName') });
lookupRoutes({ path: '/booking-statuses', table: 'bookingStatuses', screen: 'booking_statuses', idField: 'BookingStatusId', nameField: 'StatusName', extraFields: ['IsCancelled'], normalize: (b) => { if (b.IsCancelled !== undefined) b.IsCancelled = toBool(b.IsCancelled); }, usage: usageByName('bookings', 'PaymentStatus', 'StatusName') });
lookupRoutes({ path: '/member-frequencies', table: 'memberFrequencies', screen: 'member_frequencies', idField: 'FrequencyId', nameField: 'FrequencyName', usage: usageByName('members', 'Frequency', 'FrequencyName') });
lookupRoutes({ path: '/member-statuses', table: 'memberStatuses', screen: 'member_statuses', idField: 'MemberStatusId', nameField: 'StatusName', usage: usageByName('members', 'Status', 'StatusName') });

// ---------- TIME SLOTS (precedence: temple-specific → location-wide → global default) ----------
function effectiveSlots({ templeId = null, locationId, activeOnly = true }) {
  const pool = activeOnly ? store.timeSlots.filter((s) => s.IsActive) : store.timeSlots;
  const sorted = (rows) => [...rows].sort((a, b) => String(a.SlotTime).localeCompare(String(b.SlotTime)));
  if (templeId) { const specific = pool.filter((s) => s.TempleId === Number(templeId)); if (specific.length) return sorted(specific); }
  const locWide = pool.filter((s) => s.TempleId == null && s.LocationId === locationId);
  if (locWide.length) return sorted(locWide);
  return sorted(pool.filter((s) => s.TempleId == null && s.LocationId == null));
}
const slotAllowed = (templeId, locationId, time) => { const slots = effectiveSlots({ templeId, locationId }); return !slots.length || slots.some((s) => s.SlotTime === time); };
const slotScope = (s) => (s.TempleId != null ? String(s.TempleId) : s.LocationId != null ? 'location' : 'global');
const slotLabel = (s) => (s.TempleId != null ? templeById(s.TempleId)?.TempleName || 'Temple' : s.LocationId != null ? `${locById(s.LocationId)?.LocationName || 'Location'} — all temples` : 'All locations (default)');
const slotVisible = (s, req) => (s.TempleId != null ? templeInLoc(s.TempleId, req.locationId) : s.LocationId == null || s.LocationId === req.locationId);
function resolveSlotScope(req, appliesTo) {
  const v = isBlank(appliesTo) ? 'location' : String(appliesTo);
  if (v === 'global') return isSuperAdmin(req.user) ? { LocationId: null, TempleId: null } : { error: 'Only a super admin can manage global default slots' };
  if (v === 'location') return { LocationId: req.locationId, TempleId: null };
  if (!templeInLoc(v, req.locationId)) return { error: 'Temple does not belong to the current location' };
  return { LocationId: req.locationId, TempleId: Number(v) };
}
router.get('/time-slots', authMiddleware, (req, res) => {
  const activeOnly = req.query.activeOnly === 'true';
  let rows;
  if (req.query.templeId) rows = templeInLoc(req.query.templeId, req.locationId) ? effectiveSlots({ templeId: req.query.templeId, locationId: req.locationId, activeOnly }) : [];
  else if (req.query.effective === 'true') rows = effectiveSlots({ locationId: req.locationId, activeOnly });
  else rows = store.timeSlots.filter((s) => slotVisible(s, req) && (!activeOnly || s.IsActive)).sort((a, b) => slotLabel(a).localeCompare(slotLabel(b)) || String(a.SlotTime).localeCompare(String(b.SlotTime)));
  res.json(rows.map((s) => ({ ...s, AppliesTo: slotScope(s), AppliesToLabel: slotLabel(s) })));
});
router.post('/time-slots', authMiddleware, requirePermission('time_slots', 'CanCreate'), (req, res) => {
  const b = req.body || {};
  if (!TIME_RE.test(String(b.SlotTime || ''))) return bad(res, 'Slot time must be HH:MM (24-hour)');
  const scope = resolveSlotScope(req, b.AppliesTo); if (scope.error) return bad(res, scope.error, 403);
  if (store.timeSlots.some((s) => s.SlotTime === b.SlotTime && s.TempleId === scope.TempleId && s.LocationId === scope.LocationId)) return bad(res, 'This slot already exists for the selected scope');
  const rec = { SlotId: nextId(), ...scope, SlotTime: b.SlotTime, SlotLabel: String(b.SlotLabel || '').trim() || b.SlotTime, IsActive: b.IsActive !== false, DisplayOrder: Number(b.DisplayOrder) || 0 };
  store.timeSlots.push(rec); audit(req, 'CREATE', 'SevaTimeSlots', rec.SlotId, null, rec); res.status(201).json(rec);
});
router.put('/time-slots/:id', authMiddleware, requirePermission('time_slots', 'CanEdit'), (req, res) => {
  const rec = findBy(store.timeSlots, 'SlotId', req.params.id); if (!rec || !slotVisible(rec, req)) return bad(res, 'Slot not found', 404);
  if (rec.LocationId == null && rec.TempleId == null && !isSuperAdmin(req.user)) return bad(res, 'Only a super admin can edit global default slots', 403);
  const b = req.body || {};
  if (b.SlotTime !== undefined && !TIME_RE.test(String(b.SlotTime))) return bad(res, 'Slot time must be HH:MM (24-hour)');
  const scope = b.AppliesTo !== undefined ? resolveSlotScope(req, b.AppliesTo) : { LocationId: rec.LocationId, TempleId: rec.TempleId };
  if (scope.error) return bad(res, scope.error, 403);
  const old = { ...rec };
  Object.assign(rec, scope, pick(b, ['SlotTime', 'SlotLabel', 'DisplayOrder'])); if (b.IsActive !== undefined) rec.IsActive = toBool(b.IsActive);
  if (store.timeSlots.some((s) => s !== rec && s.SlotTime === rec.SlotTime && s.TempleId === rec.TempleId && s.LocationId === rec.LocationId)) { Object.assign(rec, old); return bad(res, 'This slot already exists for the selected scope'); }
  audit(req, 'UPDATE', 'SevaTimeSlots', rec.SlotId, old, rec); res.json(rec);
});
router.delete('/time-slots/:id', authMiddleware, requirePermission('time_slots', 'CanDelete'), (req, res) => {
  const rec = findBy(store.timeSlots, 'SlotId', req.params.id); if (!rec || !slotVisible(rec, req)) return bad(res, 'Slot not found', 404);
  if (rec.LocationId == null && rec.TempleId == null && !isSuperAdmin(req.user)) return bad(res, 'Only a super admin can delete global default slots', 403);
  store.timeSlots.splice(store.timeSlots.indexOf(rec), 1); audit(req, 'DELETE', 'SevaTimeSlots', rec.SlotId, rec, null); res.json({ message: 'Slot deleted' });
});

// ---------- LOCATIONS (global master; per-location information drives the whole app) ----------
function cleanLocation(b, existing) {
  if (b.LocationName !== undefined) { b.LocationName = String(b.LocationName).trim(); if (!b.LocationName) return 'Location name is required'; if (store.locations.some((l) => l !== existing && same(l.LocationName, b.LocationName))) return 'A location with this name already exists'; }
  if (b.LocationCode !== undefined) { b.LocationCode = String(b.LocationCode || '').trim().toUpperCase(); if (b.LocationCode && store.locations.some((l) => l !== existing && same(l.LocationCode, b.LocationCode))) return 'Location code is already in use'; }
  if (b.DisplayOrder !== undefined) b.DisplayOrder = Number(b.DisplayOrder) || 0;
  if (b.IsActive !== undefined) b.IsActive = toBool(b.IsActive);
  return null;
}
router.get('/locations', authMiddleware, (req, res) => {
  res.json([...store.locations].sort(byOrder).map((l) => ({ ...l, TempleCount: store.temples.filter((t) => t.LocationId === l.LocationId).length, UserCount: store.users.filter((u) => u.IsActive && canAccessLocation(u, l.LocationId)).length, IsCurrent: l.LocationId === req.locationId, CanAccess: canAccessLocation(req.currentUser, l.LocationId) })));
});
router.post('/locations', authMiddleware, requirePermission('locations', 'CanCreate'), (req, res) => {
  const b = pick(req.body || {}, LOCATION_FIELDS);
  if (isBlank(b.LocationName)) return bad(res, 'Location name is required');
  const err = cleanLocation(b, null); if (err) return bad(res, err);
  const rec = { LocationId: nextId(), LocationCode: '', Description: '', Address: '', Phone: '', Email: '', ReceiptFooter: '', DisplayOrder: 0, ...b, IsActive: b.IsActive !== false, CreatedAt: nowISO() };
  store.locations.push(rec);
  const me = req.currentUser; if (!isSuperAdmin(me) && !me.AllLocations) me.LocationIds = [...(me.LocationIds || []), rec.LocationId]; // creator can access what they create
  audit(req, 'CREATE', 'Locations', rec.LocationId, null, rec); res.status(201).json(rec);
});
router.put('/locations/:id', authMiddleware, requirePermission('locations', 'CanEdit'), (req, res) => {
  const rec = locById(req.params.id); if (!rec) return bad(res, 'Location not found', 404);
  if (!canAccessLocation(req.currentUser, rec.LocationId)) return bad(res, 'You do not have access to this location', 403);
  const b = pick(req.body || {}, LOCATION_FIELDS);
  const err = cleanLocation(b, rec); if (err) return bad(res, err);
  if (rec.LocationId === req.locationId && b.IsActive === false) return bad(res, 'You are signed in to this location. Switch to another location before deactivating it.');
  const old = { ...rec }; Object.assign(rec, b); audit(req, 'UPDATE', 'Locations', rec.LocationId, old, rec); res.json(rec);
});
router.delete('/locations/:id', authMiddleware, requirePermission('locations', 'CanDelete'), (req, res) => {
  const rec = locById(req.params.id); if (!rec) return bad(res, 'Location not found', 404);
  if (!canAccessLocation(req.currentUser, rec.LocationId)) return bad(res, 'You do not have access to this location', 403);
  if (rec.LocationId === req.locationId) return bad(res, 'You cannot delete the location you are signed in to.');
  if (store.temples.some((t) => t.LocationId === rec.LocationId)) return bad(res, 'Location has temples. Move or delete them first.');
  if (store.bookings.some((b) => bookingLoc(b) === rec.LocationId)) return bad(res, 'Location has bookings. Deactivate it instead.');
  if (store.counters.some((c) => c.LocationId === rec.LocationId) || store.items.some((i) => i.LocationId === rec.LocationId)) return bad(res, 'Location has counters or items. Delete them first.');
  store.locations.splice(store.locations.indexOf(rec), 1);
  store.users.forEach((u) => { if ((u.LocationIds || []).includes(rec.LocationId)) u.LocationIds = u.LocationIds.filter((id) => id !== rec.LocationId); });
  store.timeSlots = store.timeSlots.filter((s) => s.LocationId !== rec.LocationId);
  audit(req, 'DELETE', 'Locations', rec.LocationId, rec, null); res.json({ message: 'Location deleted' });
});

// ---------- TEMPLES (current location) ----------
const TEMPLE_FIELDS = ['TempleName', 'Description', 'Address', 'IsMainTemple', 'IsActive', 'DisplayOrder'];
const singleMainTemple = (rec) => { if (rec.IsMainTemple) store.temples.forEach((t) => { if (t !== rec && t.LocationId === rec.LocationId) t.IsMainTemple = false; }); };
function cleanTemple(req, b, existing) {
  if (b.TempleName !== undefined) { b.TempleName = String(b.TempleName).trim(); if (!b.TempleName) return 'Temple name is required'; if (store.temples.some((t) => t !== existing && t.LocationId === req.locationId && same(t.TempleName, b.TempleName))) return `'${b.TempleName}' already exists at ${req.location.LocationName}`; }
  ['IsMainTemple', 'IsActive'].forEach((f) => { if (b[f] !== undefined) b[f] = toBool(b[f]); });
  if (b.DisplayOrder !== undefined) b.DisplayOrder = Number(b.DisplayOrder) || 0;
  return null;
}
router.get('/temples', authMiddleware, (req, res) => {
  let rows = store.temples.filter((t) => t.LocationId === req.locationId);
  if (req.query.activeOnly === 'true') rows = rows.filter((t) => t.IsActive);
  if (req.query.search) rows = rows.filter((t) => t.TempleName.toLowerCase().includes(String(req.query.search).toLowerCase()));
  res.json([...rows].sort(byOrder).map(enrichTemple));
});
router.post('/temples', authMiddleware, requirePermission('temple_mgmt', 'CanCreate'), (req, res) => {
  const b = pick(req.body || {}, TEMPLE_FIELDS);
  if (isBlank(b.TempleName)) return bad(res, 'Temple name is required');
  const err = cleanTemple(req, b, null); if (err) return bad(res, err);
  const rec = { TempleId: nextId(), LocationId: req.locationId, Description: '', Address: '', IsMainTemple: false, DisplayOrder: 0, ...b, IsActive: b.IsActive !== false };
  store.temples.push(rec); singleMainTemple(rec); audit(req, 'CREATE', 'Temples', rec.TempleId, null, rec); res.status(201).json(enrichTemple(rec));
});
router.put('/temples/:id', authMiddleware, requirePermission('temple_mgmt', 'CanEdit'), (req, res) => {
  const rec = templeById(req.params.id); if (!rec || rec.LocationId !== req.locationId) return bad(res, 'Temple not found at this location', 404);
  const b = pick(req.body || {}, TEMPLE_FIELDS); const err = cleanTemple(req, b, rec); if (err) return bad(res, err);
  const old = { ...rec }; Object.assign(rec, b); singleMainTemple(rec); audit(req, 'UPDATE', 'Temples', rec.TempleId, old, rec); res.json(enrichTemple(rec));
});
router.delete('/temples/:id', authMiddleware, requirePermission('temple_mgmt', 'CanDelete'), (req, res) => {
  const rec = templeById(req.params.id); if (!rec || rec.LocationId !== req.locationId) return bad(res, 'Temple not found at this location', 404);
  if (store.sevas.some((s) => s.TempleId === rec.TempleId) || store.deities.some((d) => d.TempleId === rec.TempleId)) return bad(res, 'Temple has deities or sevas. Delete them first or deactivate the temple.');
  if (store.bookings.some((b) => b.TempleId === rec.TempleId)) return bad(res, 'Temple has bookings. Deactivate it instead.');
  store.temples.splice(store.temples.indexOf(rec), 1); store.timeSlots = store.timeSlots.filter((s) => s.TempleId !== rec.TempleId); store.items.forEach((i) => { if (i.TempleId === rec.TempleId) i.TempleId = null; });
  audit(req, 'DELETE', 'Temples', rec.TempleId, rec, null); res.json({ message: 'Temple deleted' });
});

// ---------- DEITIES (temples of current location) ----------
const DEITY_FIELDS = ['DeityName', 'TempleId', 'Description', 'IsMainDeity', 'IsActive', 'DisplayOrder'];
function cleanDeity(req, b, existing) {
  if (b.TempleId !== undefined) { b.TempleId = toNum(b.TempleId); if (!templeInLoc(b.TempleId, req.locationId)) return 'Select a temple at this location'; }
  if (b.DeityName !== undefined) { b.DeityName = String(b.DeityName).trim(); if (!b.DeityName) return 'Deity name is required'; }
  const templeId = b.TempleId ?? existing?.TempleId, name = b.DeityName ?? existing?.DeityName;
  if (store.deities.some((d) => d !== existing && d.TempleId === templeId && same(d.DeityName, name))) return `'${name}' already exists in this temple`;
  ['IsMainDeity', 'IsActive'].forEach((f) => { if (b[f] !== undefined) b[f] = toBool(b[f]); });
  if (b.DisplayOrder !== undefined) b.DisplayOrder = Number(b.DisplayOrder) || 0;
  return null;
}
router.get('/deities', authMiddleware, (req, res) => {
  const ids = locTempleIds(req.locationId);
  let rows = store.deities.filter((d) => ids.has(d.TempleId));
  if (req.query.templeId) rows = rows.filter((d) => d.TempleId === Number(req.query.templeId));
  if (req.query.activeOnly === 'true') rows = rows.filter((d) => d.IsActive);
  res.json([...rows].sort(byOrder).map(enrichDeity));
});
router.post('/deities', authMiddleware, requirePermission('deity_mgmt', 'CanCreate'), (req, res) => {
  const b = pick(req.body || {}, DEITY_FIELDS);
  if (isBlank(b.DeityName) || isBlank(b.TempleId)) return bad(res, 'Deity name and temple are required');
  const err = cleanDeity(req, b, null); if (err) return bad(res, err);
  const rec = { DeityId: nextId(), Description: '', IsMainDeity: false, DisplayOrder: 0, ...b, IsActive: b.IsActive !== false };
  store.deities.push(rec); audit(req, 'CREATE', 'Deities', rec.DeityId, null, rec); res.status(201).json(enrichDeity(rec));
});
router.put('/deities/:id', authMiddleware, requirePermission('deity_mgmt', 'CanEdit'), (req, res) => {
  const rec = findBy(store.deities, 'DeityId', req.params.id); if (!rec || !templeInLoc(rec.TempleId, req.locationId)) return bad(res, 'Deity not found at this location', 404);
  const b = pick(req.body || {}, DEITY_FIELDS); const err = cleanDeity(req, b, rec); if (err) return bad(res, err);
  if (b.TempleId !== undefined && b.TempleId !== rec.TempleId && store.sevas.some((s) => s.DeityId === rec.DeityId)) return bad(res, 'Deity is linked to sevas — cannot move it to another temple');
  const old = { ...rec }; Object.assign(rec, b); audit(req, 'UPDATE', 'Deities', rec.DeityId, old, rec); res.json(enrichDeity(rec));
});
router.delete('/deities/:id', authMiddleware, requirePermission('deity_mgmt', 'CanDelete'), (req, res) => {
  const rec = findBy(store.deities, 'DeityId', req.params.id); if (!rec || !templeInLoc(rec.TempleId, req.locationId)) return bad(res, 'Deity not found at this location', 404);
  if (store.sevas.some((s) => s.DeityId === rec.DeityId)) return bad(res, 'Deity is linked to sevas. Unlink or delete those sevas first.');
  store.deities.splice(store.deities.indexOf(rec), 1); audit(req, 'DELETE', 'Deities', rec.DeityId, rec, null); res.json({ message: 'Deity deleted' });
});

// ---------- SEVA CATEGORIES (shared master) ----------
router.get('/seva-categories', authMiddleware, (req, res) => res.json([...store.sevaCategories].sort(byOrder).map((c) => ({ ...c, SevaCount: store.sevas.filter((s) => s.CategoryId === c.CategoryId).length }))));
router.post('/seva-categories', authMiddleware, requirePermission('seva_categories', 'CanCreate'), (req, res) => {
  const name = String(req.body?.CategoryName || '').trim(); if (!name) return bad(res, 'Category name is required');
  if (store.sevaCategories.some((c) => same(c.CategoryName, name))) return bad(res, 'Category already exists');
  const rec = { CategoryId: nextId(), CategoryName: name, IsActive: req.body.IsActive !== false, DisplayOrder: Number(req.body.DisplayOrder) || 0 };
  store.sevaCategories.push(rec); audit(req, 'CREATE', 'SevaCategories', rec.CategoryId, null, rec); res.status(201).json(rec);
});
router.put('/seva-categories/:id', authMiddleware, requirePermission('seva_categories', 'CanEdit'), (req, res) => {
  const rec = findBy(store.sevaCategories, 'CategoryId', req.params.id); if (!rec) return bad(res, 'Category not found', 404);
  const b = pick(req.body || {}, ['CategoryName', 'IsActive', 'DisplayOrder']);
  if (b.CategoryName !== undefined) { b.CategoryName = String(b.CategoryName).trim(); if (!b.CategoryName) return bad(res, 'Category name is required'); if (store.sevaCategories.some((c) => c !== rec && same(c.CategoryName, b.CategoryName))) return bad(res, 'Category already exists'); }
  if (b.IsActive !== undefined) b.IsActive = toBool(b.IsActive);
  const old = { ...rec }; Object.assign(rec, b); audit(req, 'UPDATE', 'SevaCategories', rec.CategoryId, old, rec); res.json(rec);
});
router.delete('/seva-categories/:id', authMiddleware, requirePermission('seva_categories', 'CanDelete'), (req, res) => {
  const rec = findBy(store.sevaCategories, 'CategoryId', req.params.id); if (!rec) return bad(res, 'Category not found', 404);
  if (store.sevas.some((s) => s.CategoryId === rec.CategoryId)) return bad(res, 'Category is used by sevas. Deactivate it instead.');
  store.sevaCategories.splice(store.sevaCategories.indexOf(rec), 1); audit(req, 'DELETE', 'SevaCategories', rec.CategoryId, rec, null); res.json({ message: 'Category deleted' });
});

// ---------- SEVA MASTER (temple-wise sevas at current location) ----------
const SEVA_FIELDS = ['TempleId', 'DeityId', 'CategoryId', 'SevaName', 'Amount', 'Description', 'IsActive'];
function cleanSeva(req, b, existing) {
  if (b.TempleId !== undefined) { b.TempleId = toNum(b.TempleId); if (!templeInLoc(b.TempleId, req.locationId)) return 'Select a temple at this location'; }
  const templeId = b.TempleId ?? existing?.TempleId;
  if (b.DeityId !== undefined) { b.DeityId = toNum(b.DeityId); if (b.DeityId && findBy(store.deities, 'DeityId', b.DeityId)?.TempleId !== templeId) return 'Deity does not belong to the selected temple'; }
  else if (existing?.DeityId && b.TempleId !== undefined && findBy(store.deities, 'DeityId', existing.DeityId)?.TempleId !== templeId) b.DeityId = null;
  if (b.CategoryId !== undefined) { b.CategoryId = toNum(b.CategoryId); if (!findBy(store.sevaCategories, 'CategoryId', b.CategoryId)) return 'Select a valid category'; }
  if (b.SevaName !== undefined) { b.SevaName = String(b.SevaName).trim(); if (!b.SevaName) return 'Seva name is required'; }
  if (b.Amount !== undefined) { b.Amount = Number(b.Amount); if (!Number.isFinite(b.Amount) || b.Amount < 0) return 'Amount must be 0 or more'; }
  if (b.IsActive !== undefined) b.IsActive = toBool(b.IsActive);
  const name = b.SevaName ?? existing?.SevaName;
  if (store.sevas.some((s) => s !== existing && s.TempleId === templeId && same(s.SevaName, name))) return `'${name}' already exists for this temple`;
  return null;
}
router.get('/sevas', authMiddleware, (req, res) => {
  const ids = locTempleIds(req.locationId), q = req.query;
  let rows = store.sevas.filter((s) => ids.has(s.TempleId));
  if (q.templeId) rows = rows.filter((s) => s.TempleId === Number(q.templeId));
  if (q.deityId) rows = rows.filter((s) => s.DeityId === Number(q.deityId));
  if (q.categoryId) rows = rows.filter((s) => s.CategoryId === Number(q.categoryId));
  if (q.search) rows = rows.filter((s) => s.SevaName.toLowerCase().includes(String(q.search).toLowerCase()));
  if (q.activeOnly === 'true') rows = rows.filter((s) => s.IsActive);
  res.json(rows.map(enrichSeva));
});
router.get('/sevas/:id', authMiddleware, (req, res) => {
  const rec = findBy(store.sevas, 'SevaId', req.params.id); if (!rec || !templeInLoc(rec.TempleId, req.locationId)) return bad(res, 'Seva not found', 404); res.json(enrichSeva(rec));
});
router.post('/sevas', authMiddleware, requirePermission('seva_master', 'CanCreate'), (req, res) => {
  const b = pick(req.body || {}, SEVA_FIELDS);
  if (isBlank(b.SevaName) || isBlank(b.TempleId) || isBlank(b.CategoryId) || isBlank(b.Amount)) return bad(res, 'Seva name, temple, category and amount are required');
  const err = cleanSeva(req, b, null); if (err) return bad(res, err);
  const rec = { SevaId: nextId(), DeityId: null, Description: '', ...b, IsActive: b.IsActive !== false, CreatedAt: nowISO() };
  store.sevas.push(rec); audit(req, 'CREATE', 'SevaMaster', rec.SevaId, null, rec); res.status(201).json(enrichSeva(rec));
});
router.put('/sevas/:id', authMiddleware, requirePermission('seva_master', 'CanEdit'), (req, res) => {
  const rec = findBy(store.sevas, 'SevaId', req.params.id); if (!rec || !templeInLoc(rec.TempleId, req.locationId)) return bad(res, 'Seva not found at this location', 404);
  const b = pick(req.body || {}, SEVA_FIELDS); const err = cleanSeva(req, b, rec); if (err) return bad(res, err);
  const old = { ...rec }; Object.assign(rec, b); audit(req, 'UPDATE', 'SevaMaster', rec.SevaId, old, rec); res.json(enrichSeva(rec));
});
router.delete('/sevas/:id', authMiddleware, requirePermission('seva_master', 'CanDelete'), (req, res) => {
  const rec = findBy(store.sevas, 'SevaId', req.params.id); if (!rec || !templeInLoc(rec.TempleId, req.locationId)) return bad(res, 'Seva not found at this location', 404);
  store.sevas.splice(store.sevas.indexOf(rec), 1); audit(req, 'DELETE', 'SevaMaster', rec.SevaId, rec, null); res.json({ message: 'Seva deleted' });
});

// ---------- ITEM MASTER (separate items per booking type, e.g. Laddu / Goshala — per location) ----------
const ITEM_FIELDS = ['BookingTypeId', 'TempleId', 'ItemName', 'Amount', 'AllowCustomAmount', 'MinAmount', 'Unit', 'Description', 'IsActive', 'DisplayOrder'];
function cleanItem(req, b, existing) {
  if (b.BookingTypeId !== undefined) b.BookingTypeId = toNum(b.BookingTypeId);
  const type = typeById(b.BookingTypeId ?? existing?.BookingTypeId);
  if (!type) return 'Select a booking type';
  if (type.UsesSevaMaster) return `${type.TypeName} bookings use the Seva Master — add sevas there instead`;
  if (b.TempleId !== undefined) { b.TempleId = toNum(b.TempleId); if (b.TempleId && !templeInLoc(b.TempleId, req.locationId)) return 'Temple does not belong to this location'; }
  if (b.ItemName !== undefined) { b.ItemName = String(b.ItemName).trim(); if (!b.ItemName) return 'Item name is required'; }
  if (b.Amount !== undefined) { b.Amount = Number(b.Amount); if (!Number.isFinite(b.Amount) || b.Amount < 0) return 'Amount must be 0 or more'; }
  if (b.MinAmount !== undefined) b.MinAmount = Number(b.MinAmount) || 0;
  ['AllowCustomAmount', 'IsActive'].forEach((f) => { if (b[f] !== undefined) b[f] = toBool(b[f]); });
  if (b.DisplayOrder !== undefined) b.DisplayOrder = Number(b.DisplayOrder) || 0;
  const name = b.ItemName ?? existing?.ItemName;
  if (store.items.some((i) => i !== existing && i.LocationId === req.locationId && i.BookingTypeId === type.BookingTypeId && same(i.ItemName, name))) return `'${name}' already exists for ${type.TypeName}`;
  return null;
}
router.get('/items', authMiddleware, (req, res) => {
  let rows = store.items.filter((i) => i.LocationId === req.locationId);
  if (req.query.bookingTypeId) rows = rows.filter((i) => i.BookingTypeId === Number(req.query.bookingTypeId));
  if (req.query.templeId) rows = rows.filter((i) => !i.TempleId || i.TempleId === Number(req.query.templeId));
  if (req.query.activeOnly === 'true') rows = rows.filter((i) => i.IsActive);
  res.json([...rows].sort(byOrder).map(enrichItem));
});
router.post('/items', authMiddleware, requirePermission('item_master', 'CanCreate'), (req, res) => {
  const b = pick(req.body || {}, ITEM_FIELDS);
  if (isBlank(b.ItemName) || isBlank(b.BookingTypeId) || isBlank(b.Amount)) return bad(res, 'Booking type, item name and amount are required');
  const err = cleanItem(req, b, null); if (err) return bad(res, err);
  const rec = { ItemId: nextId(), LocationId: req.locationId, TempleId: null, AllowCustomAmount: false, MinAmount: 0, Unit: '', Description: '', DisplayOrder: 0, ...b, IsActive: b.IsActive !== false };
  store.items.push(rec); audit(req, 'CREATE', 'ItemMaster', rec.ItemId, null, rec); res.status(201).json(enrichItem(rec));
});
router.put('/items/:id', authMiddleware, requirePermission('item_master', 'CanEdit'), (req, res) => {
  const rec = findBy(store.items, 'ItemId', req.params.id); if (!rec || rec.LocationId !== req.locationId) return bad(res, 'Item not found at this location', 404);
  const b = pick(req.body || {}, ITEM_FIELDS); const err = cleanItem(req, b, rec); if (err) return bad(res, err);
  const old = { ...rec }; Object.assign(rec, b); audit(req, 'UPDATE', 'ItemMaster', rec.ItemId, old, rec); res.json(enrichItem(rec));
});
router.delete('/items/:id', authMiddleware, requirePermission('item_master', 'CanDelete'), (req, res) => {
  const rec = findBy(store.items, 'ItemId', req.params.id); if (!rec || rec.LocationId !== req.locationId) return bad(res, 'Item not found at this location', 404);
  store.items.splice(store.items.indexOf(rec), 1); audit(req, 'DELETE', 'ItemMaster', rec.ItemId, rec, null); res.json({ message: 'Item deleted' });
});

// ---------- COUNTERS (current location) ----------
const COUNTER_FIELDS = ['CounterName', 'Location', 'IsActive', 'AssignedUserId'];
function cleanCounter(req, b, existing) {
  if (b.CounterName !== undefined) { b.CounterName = String(b.CounterName).trim(); if (!b.CounterName) return 'Counter name is required'; if (store.counters.some((c) => c !== existing && c.LocationId === req.locationId && same(c.CounterName, b.CounterName))) return 'Counter name already exists at this location'; }
  if (b.AssignedUserId !== undefined) { b.AssignedUserId = toNum(b.AssignedUserId); const u = findBy(store.users, 'UserId', b.AssignedUserId); if (b.AssignedUserId && (!u || !canAccessLocation(u, req.locationId))) return 'Assigned user does not have access to this location'; }
  if (b.IsActive !== undefined) b.IsActive = toBool(b.IsActive);
  return null;
}
router.get('/counters', authMiddleware, (req, res) => {
  let rows = store.counters.filter((c) => c.LocationId === req.locationId);
  if (req.query.activeOnly === 'true') rows = rows.filter((c) => c.IsActive);
  res.json(rows.map(enrichCounter));
});
router.post('/counters', authMiddleware, requirePermission('counters', 'CanCreate'), (req, res) => {
  const b = pick(req.body || {}, COUNTER_FIELDS); if (isBlank(b.CounterName)) return bad(res, 'Counter name is required');
  const err = cleanCounter(req, b, null); if (err) return bad(res, err);
  const rec = { CounterId: nextId(), LocationId: req.locationId, Location: '', AssignedUserId: null, ...b, IsActive: b.IsActive !== false };
  store.counters.push(rec); audit(req, 'CREATE', 'Counters', rec.CounterId, null, rec); res.status(201).json(enrichCounter(rec));
});
router.put('/counters/:id', authMiddleware, requirePermission('counters', 'CanEdit'), (req, res) => {
  const rec = findBy(store.counters, 'CounterId', req.params.id); if (!rec || rec.LocationId !== req.locationId) return bad(res, 'Counter not found at this location', 404);
  const b = pick(req.body || {}, COUNTER_FIELDS); const err = cleanCounter(req, b, rec); if (err) return bad(res, err);
  const old = { ...rec }; Object.assign(rec, b); audit(req, 'UPDATE', 'Counters', rec.CounterId, old, rec); res.json(enrichCounter(rec));
});
router.delete('/counters/:id', authMiddleware, requirePermission('counters', 'CanDelete'), (req, res) => {
  const rec = findBy(store.counters, 'CounterId', req.params.id); if (!rec || rec.LocationId !== req.locationId) return bad(res, 'Counter not found at this location', 404);
  if (store.bookings.some((b) => b.CounterId === rec.CounterId)) return bad(res, 'Counter has bookings. Deactivate it instead.');
  store.counters.splice(store.counters.indexOf(rec), 1); audit(req, 'DELETE', 'Counters', rec.CounterId, rec, null); res.json({ message: 'Counter deleted' });
});

// ---------- BOOKINGS (type-driven: Seva uses Seva Master; Laddu/Goshala/etc. use Item Master) ----------
const findBookingHere = (req) => { const id = req.params.id; const rec = store.bookings.find((b) => b.BookingId === Number(id) || b.BookingNumber === id); return rec && bookingLoc(rec) === req.locationId ? rec : null; };
router.get('/bookings', authMiddleware, requirePermission('bookings'), (req, res) => {
  const q = req.query;
  let rows = store.bookings.filter((b) => bookingLoc(b) === req.locationId);
  if (q.search) { const s = String(q.search).toLowerCase(); rows = rows.filter((b) => [b.BookingNumber, b.TokenNumber, b.DevoteeName, b.Mobile].join(' ').toLowerCase().includes(s)); }
  if (q.templeId) rows = rows.filter((b) => String(b.TempleId) === String(q.templeId));
  if (q.bookingType) rows = rows.filter((b) => b.BookingType === q.bookingType);
  if (q.paymentStatus) rows = rows.filter((b) => b.PaymentStatus === q.paymentStatus);
  if (q.paymentMode) rows = rows.filter((b) => b.PaymentMode === q.paymentMode);
  if (q.from) rows = rows.filter((b) => b.BookingDate >= q.from);
  if (q.to) rows = rows.filter((b) => b.BookingDate <= q.to);
  if (q.sevaDate) rows = rows.filter((b) => b.SevaDate === q.sevaDate);
  if (q.advance === 'true') rows = rows.filter((b) => b.IsAdvanceBooking);
  res.json([...rows].reverse().map(enrichBooking));
});
router.get('/bookings/:id', authMiddleware, (req, res) => { const rec = findBookingHere(req); if (!rec) return bad(res, 'Booking not found', 404); res.json(enrichBooking(rec)); });

router.post('/bookings', authMiddleware, (req, res) => {
  const b = req.body || {};
  const type = isBlank(b.BookingType) ? getDefault(store.bookingTypes) : store.bookingTypes.find((t) => t.TypeName === b.BookingType);
  if (!type || !type.IsActive) return bad(res, 'Invalid or inactive booking type');
  if (!hasPermission(req.user, typeScreen(type), 'CanCreate')) return bad(res, `You do not have create permission for ${type.TypeName} booking`, 403);
  const t0 = todayISO();
  const sevaDate = isBlank(b.SevaDate) ? t0 : String(b.SevaDate);
  if (!DATE_RE.test(sevaDate)) return bad(res, 'Date must be YYYY-MM-DD');
  if (sevaDate < t0) return bad(res, 'Date cannot be in the past');
  const isAdvance = sevaDate > t0;
  if (isAdvance && !type.AllowAdvance) return bad(res, `${type.TypeName} bookings cannot be made for a future date`);
  if (isAdvance && !hasPermission(req.user, 'advance_booking', 'CanCreate')) return bad(res, 'You do not have permission to create advance bookings', 403);
  const devotee = String(b.DevoteeName || '').trim();
  if (type.RequiresDevotee && !devotee) return bad(res, 'Devotee name is required');
  if ((type.RequiresDevotee || !isBlank(b.Mobile)) && !mobileOk(b.Mobile)) return bad(res, 'Enter a valid mobile number');
  let temple = null;
  if (!isBlank(b.TempleId)) { temple = templeById(b.TempleId); if (!temple || temple.LocationId !== req.locationId || !temple.IsActive) return bad(res, `Temple is not available at ${req.location.LocationName}`); }
  if ((type.RequiresTemple || type.UsesSevaMaster) && !temple) return bad(res, 'Temple is required');
  const needTime = type.RequiresSchedule || isAdvance; // advance bookings always need date AND time
  let sevaTime = isBlank(b.SevaTime) ? '' : String(b.SevaTime);
  if (needTime && !sevaTime) return bad(res, 'Time is required');
  if (sevaTime && !TIME_RE.test(sevaTime)) return bad(res, 'Time must be HH:MM');
  if (sevaTime && !slotAllowed(temple?.TempleId, req.locationId, sevaTime)) return bad(res, 'Selected time is not an available slot');
  if (!sevaTime) sevaTime = nowHHMM();
  let deityId = null;
  if (!isBlank(b.DeityId)) { const d = findBy(store.deities, 'DeityId', b.DeityId); if (!d || !temple || d.TempleId !== temple.TempleId) return bad(res, 'Deity does not belong to the selected temple'); deityId = d.DeityId; }
  let counterId = null;
  if (!isBlank(b.CounterId)) { const c = findBy(store.counters, 'CounterId', b.CounterId); if (!c || c.LocationId !== req.locationId || !c.IsActive) return bad(res, 'Counter is not available at this location'); counterId = c.CounterId; }
  const paymentMode = isBlank(b.PaymentMode) ? getDefault(store.paymentModes)?.ModeName : b.PaymentMode;
  if (!store.paymentModes.some((m) => m.ModeName === paymentMode && m.IsActive)) return bad(res, 'Invalid payment mode');
  const paymentStatus = isBlank(b.PaymentStatus) ? getDefault(store.bookingStatuses)?.StatusName : b.PaymentStatus;
  const statusRec = store.bookingStatuses.find((s) => s.StatusName === paymentStatus && s.IsActive);
  if (!statusRec || statusRec.IsCancelled) return bad(res, 'Invalid payment status');

  // Items — always priced from masters; only items flagged AllowCustomAmount accept an entered amount
  const lines = Array.isArray(b.Items) ? b.Items : [];
  if (!lines.length) return bad(res, `Select at least one ${type.UsesSevaMaster ? 'seva' : 'item'}`);
  const maxQty = Number(S().maxQuantity) || 999;
  const priced = [];
  for (const it of lines) {
    const qty = Math.floor(Number(it.Quantity) || 1);
    if (qty < 1 || qty > maxQty) return bad(res, `Quantity must be between 1 and ${maxQty}`);
    if (type.UsesSevaMaster) {
      const seva = findBy(store.sevas, 'SevaId', it.SevaId);
      if (!seva || !seva.IsActive || seva.TempleId !== temple.TempleId) return bad(res, `A selected seva is not available at ${temple.TempleName}`);
      priced.push({ SevaId: seva.SevaId, ItemId: null, ItemName: seva.SevaName, Quantity: qty, UnitAmount: Number(seva.Amount), TotalAmount: Number(seva.Amount) * qty });
    } else {
      const item = findBy(store.items, 'ItemId', it.ItemId);
      if (!item || !item.IsActive || item.BookingTypeId !== type.BookingTypeId || item.LocationId !== req.locationId || (item.TempleId && item.TempleId !== temple?.TempleId)) return bad(res, `A selected item is not available for ${type.TypeName} at this location`);
      let unit = Number(item.Amount);
      if (item.AllowCustomAmount && !isBlank(it.UnitAmount)) {
        unit = Number(it.UnitAmount);
        if (!Number.isFinite(unit) || unit <= 0) return bad(res, `Enter a valid amount for ${item.ItemName}`);
        if (Number(item.MinAmount) && unit < Number(item.MinAmount)) return bad(res, `Minimum amount for ${item.ItemName} is ${item.MinAmount}`);
      }
      priced.push({ SevaId: null, ItemId: item.ItemId, ItemName: item.ItemName, Quantity: qty, UnitAmount: unit, TotalAmount: unit * qty });
    }
  }
  const rec = {
    BookingId: nextId(), BookingNumber: genBookingNumber(), TokenNumber: genTokenNumber(type.TypeName),
    BookingType: type.TypeName, BookingTypeId: type.BookingTypeId, LocationId: req.locationId, TempleId: temple?.TempleId ?? null, DeityId: deityId,
    DevoteeName: devotee, Mobile: isBlank(b.Mobile) ? '' : String(b.Mobile).trim(),
    Gothram: type.CaptureGothram ? String(b.Gothram || '').trim() : '', Nakshatram: type.CaptureGothram ? String(b.Nakshatram || '').trim() : '',
    BookingDate: t0, SevaDate: sevaDate, SevaTime: sevaTime, Remarks: String(b.Remarks || '').trim(),
    TotalAmount: priced.reduce((s, i) => s + i.TotalAmount, 0), PaymentMode: paymentMode, PaymentStatus: paymentStatus, CounterId: counterId,
    CreatedBy: req.user.UserId, CreatedAt: nowISO(), IsAdvanceBooking: isAdvance, Items: priced,
  };
  store.bookings.push(rec); audit(req, 'CREATE', 'Bookings', rec.BookingId, null, rec);
  res.status(201).json(enrichBooking(rec));
});

const BOOKING_EDIT_FIELDS = ['DevoteeName', 'Mobile', 'Gothram', 'Nakshatram', 'SevaDate', 'SevaTime', 'Remarks', 'PaymentMode', 'PaymentStatus', 'CounterId'];
router.put('/bookings/:id', authMiddleware, requirePermission('bookings', 'CanEdit'), (req, res) => {
  const rec = findBookingHere(req); if (!rec) return bad(res, 'Booking not found', 404);
  if (isCancelled(rec)) return bad(res, 'Cancelled bookings cannot be edited');
  const type = store.bookingTypes.find((t) => t.TypeName === rec.BookingType) || {};
  const b = pick(req.body || {}, BOOKING_EDIT_FIELDS);
  if (b.DevoteeName !== undefined) { b.DevoteeName = String(b.DevoteeName).trim(); if (type.RequiresDevotee && !b.DevoteeName) return bad(res, 'Devotee name is required'); }
  if (b.Mobile !== undefined && (type.RequiresDevotee || !isBlank(b.Mobile)) && !mobileOk(b.Mobile)) return bad(res, 'Enter a valid mobile number');
  const newDate = b.SevaDate ?? rec.SevaDate, newTime = b.SevaTime ?? rec.SevaTime;
  if (b.SevaDate !== undefined && b.SevaDate !== rec.SevaDate) {
    if (!DATE_RE.test(String(b.SevaDate))) return bad(res, 'Date must be YYYY-MM-DD');
    if (b.SevaDate < todayISO()) return bad(res, 'Date cannot be in the past');
    if (b.SevaDate > rec.BookingDate && !type.AllowAdvance) return bad(res, `${rec.BookingType} bookings cannot be moved to a future date`);
    if (b.SevaDate > todayISO() && !hasPermission(req.user, 'advance_booking', 'CanCreate')) return bad(res, 'You do not have permission for advance bookings', 403);
  }
  if (b.SevaTime !== undefined && b.SevaTime !== rec.SevaTime) {
    if (!TIME_RE.test(String(b.SevaTime))) return bad(res, 'Time must be HH:MM');
    if (!slotAllowed(rec.TempleId, req.locationId, b.SevaTime)) return bad(res, 'Selected time is not an available slot');
  }
  if (b.PaymentMode !== undefined && !store.paymentModes.some((m) => m.ModeName === b.PaymentMode && m.IsActive)) return bad(res, 'Invalid payment mode');
  if (b.PaymentStatus !== undefined && !store.bookingStatuses.some((s) => s.StatusName === b.PaymentStatus && s.IsActive)) return bad(res, 'Invalid payment status');
  if (b.CounterId !== undefined) { b.CounterId = toNum(b.CounterId); const c = findBy(store.counters, 'CounterId', b.CounterId); if (b.CounterId && (!c || c.LocationId !== req.locationId)) return bad(res, 'Counter is not available at this location'); }
  if (!type.CaptureGothram) { delete b.Gothram; delete b.Nakshatram; }
  const old = { ...rec }; Object.assign(rec, b);
  rec.IsAdvanceBooking = newDate > rec.BookingDate; rec.SevaDate = newDate; rec.SevaTime = newTime; rec.UpdatedAt = nowISO(); rec.UpdatedBy = req.user.UserId;
  if (isCancelled(rec)) { rec.CancelledAt = nowISO(); rec.CancelledBy = req.user.UserId; }
  audit(req, 'UPDATE', 'Bookings', rec.BookingId, old, rec); res.json(enrichBooking(rec));
});
router.put('/bookings/:id/cancel', authMiddleware, requirePermission('bookings', 'CanEdit'), (req, res) => {
  const rec = findBookingHere(req); if (!rec) return bad(res, 'Booking not found', 404);
  if (isCancelled(rec)) return bad(res, 'Booking is already cancelled');
  const status = cancelStatus(); if (!status) return bad(res, 'No cancellation status is configured. Flag a booking status as "Is cancelled" in Booking Statuses.');
  const old = { ...rec };
  rec.PaymentStatus = status; rec.CancelledAt = nowISO(); rec.CancelledBy = req.user.UserId; rec.CancelReason = String(req.body?.reason || '').trim();
  audit(req, 'CANCEL', 'Bookings', rec.BookingId, old, rec); res.json(enrichBooking(rec));
});
router.delete('/bookings/:id', authMiddleware, requirePermission('bookings', 'CanDelete'), (req, res) => {
  const rec = findBookingHere(req); if (!rec) return bad(res, 'Booking not found', 404);
  store.bookings.splice(store.bookings.indexOf(rec), 1); audit(req, 'DELETE', 'Bookings', rec.BookingId, rec, null); res.json({ message: 'Booking deleted' });
});

// ---------- LIFETIME MEMBERS (current location) ----------
const MEMBER_FIELDS = ['MemberName', 'Mobile', 'Email', 'Address', 'TempleId', 'DeityId', 'PoojaName', 'NextPoojaDate', 'Frequency', 'Status'];
function cleanMember(req, b, existing) {
  if (b.MemberName !== undefined) { b.MemberName = String(b.MemberName).trim(); if (!b.MemberName) return 'Member name is required'; }
  if (b.Mobile !== undefined && !mobileOk(b.Mobile)) return 'Enter a valid mobile number';
  if (b.TempleId !== undefined) { b.TempleId = toNum(b.TempleId); if (b.TempleId && !templeInLoc(b.TempleId, req.locationId)) return 'Select a temple at this location'; }
  if (b.DeityId !== undefined) { b.DeityId = toNum(b.DeityId); const templeId = b.TempleId ?? existing?.TempleId; if (b.DeityId && findBy(store.deities, 'DeityId', b.DeityId)?.TempleId !== templeId) return 'Deity does not belong to the selected temple'; }
  if (b.NextPoojaDate !== undefined && !isBlank(b.NextPoojaDate) && !DATE_RE.test(String(b.NextPoojaDate))) return 'Next pooja date must be YYYY-MM-DD';
  if (b.Frequency !== undefined && !store.memberFrequencies.some((f) => f.FrequencyName === b.Frequency && f.IsActive)) return 'Invalid frequency';
  if (b.Status !== undefined && !store.memberStatuses.some((s) => s.StatusName === b.Status && s.IsActive)) return 'Invalid member status';
  const mobile = b.Mobile ?? existing?.Mobile;
  if (store.members.some((m) => m !== existing && memberLoc(m) === req.locationId && m.Mobile === String(mobile) && same(m.MemberName, b.MemberName ?? existing?.MemberName))) return 'This member is already registered at this location';
  return null;
}
router.get('/members', authMiddleware, requirePermission('lifetime_members'), (req, res) => {
  let rows = store.members.filter((m) => memberLoc(m) === req.locationId);
  if (req.query.search) { const s = String(req.query.search).toLowerCase(); rows = rows.filter((m) => m.MemberName.toLowerCase().includes(s) || String(m.Mobile).includes(s) || String(m.MemberNumber || '').toLowerCase().includes(s)); }
  if (req.query.status) rows = rows.filter((m) => m.Status === req.query.status);
  res.json(rows.map(enrichMember));
});
router.post('/members', authMiddleware, requirePermission('lifetime_members', 'CanCreate'), (req, res) => {
  const b = pick(req.body || {}, MEMBER_FIELDS);
  if (isBlank(b.MemberName) || isBlank(b.Mobile)) return bad(res, 'Member name and mobile are required');
  if (isBlank(b.Frequency)) b.Frequency = getDefault(store.memberFrequencies)?.FrequencyName;
  if (isBlank(b.Status)) b.Status = getDefault(store.memberStatuses)?.StatusName;
  const err = cleanMember(req, b, null); if (err) return bad(res, err);
  const rec = { MemberId: nextId(), MemberNumber: genMemberNumber(), LocationId: req.locationId, Email: '', Address: '', TempleId: null, DeityId: null, PoojaName: '', NextPoojaDate: null, ...b, Mobile: String(b.Mobile), CreatedBy: req.user.UserId, CreatedAt: nowISO() };
  store.members.push(rec); audit(req, 'CREATE', 'LifetimeMembers', rec.MemberId, null, rec); res.status(201).json(enrichMember(rec));
});
router.put('/members/:id', authMiddleware, requirePermission('lifetime_members', 'CanEdit'), (req, res) => {
  const rec = findBy(store.members, 'MemberId', req.params.id); if (!rec || memberLoc(rec) !== req.locationId) return bad(res, 'Member not found at this location', 404);
  const b = pick(req.body || {}, MEMBER_FIELDS); const err = cleanMember(req, b, rec); if (err) return bad(res, err);
  const old = { ...rec }; Object.assign(rec, b); rec.UpdatedAt = nowISO(); audit(req, 'UPDATE', 'LifetimeMembers', rec.MemberId, old, rec); res.json(enrichMember(rec));
});
router.delete('/members/:id', authMiddleware, requirePermission('lifetime_members', 'CanDelete'), (req, res) => {
  const rec = findBy(store.members, 'MemberId', req.params.id); if (!rec || memberLoc(rec) !== req.locationId) return bad(res, 'Member not found at this location', 404);
  store.members.splice(store.members.indexOf(rec), 1); audit(req, 'DELETE', 'LifetimeMembers', rec.MemberId, rec, null); res.json({ message: 'Member deleted' });
});

// ---------- USERS (role + location access per user; escalation-safe) ----------
const USER_FIELDS = ['FullName', 'Mobile', 'Email', 'RoleId', 'IsActive'];
function resolveAccess(req, body, existing) {
  const all = body.AllLocations !== undefined ? toBool(body.AllLocations) : existing ? !!existing.AllLocations : false;
  let ids = body.LocationIds !== undefined ? body.LocationIds : existing ? existing.LocationIds || [] : [req.locationId];
  if (!Array.isArray(ids)) return { error: 'LocationIds must be a list' };
  ids = [...new Set(ids.map(Number))];
  if (ids.some((id) => !locById(id))) return { error: 'One or more selected locations do not exist' };
  if (!all && !ids.length) return { error: 'Select at least one location or grant access to all locations' };
  const changed = !existing || all !== !!existing.AllLocations || ids.join(',') !== [...(existing.LocationIds || [])].join(',');
  const me = req.currentUser;
  if (changed && !isSuperAdmin(me) && !me.AllLocations) {
    if (all && !existing?.AllLocations) return { error: 'You can only grant access to locations you have access to' };
    const before = existing?.LocationIds || [];
    const outside = ids.filter((id) => !before.includes(id) && !(me.LocationIds || []).includes(id)); // only newly granted ones
    if (outside.length) return { error: `You cannot grant access to: ${outside.map((id) => locById(id)?.LocationName).join(', ')}` };
  }
  return { AllLocations: all, LocationIds: all ? [] : ids };
}
router.get('/users', authMiddleware, requirePermission('user_mgmt'), (req, res) => res.json(store.users.map((u) => ({ ...enrichUser(u), CanAccessCurrent: canAccessLocation(u, req.locationId) }))));
router.get('/users/lookup', authMiddleware, (req, res) => res.json(store.users.filter((u) => u.IsActive && canAccessLocation(u, req.locationId)).map((u) => ({ UserId: u.UserId, FullName: u.FullName, Username: u.Username }))));
router.post('/users', authMiddleware, requirePermission('user_mgmt', 'CanCreate'), async (req, res) => {
  const body = req.body || {}; const b = pick(body, USER_FIELDS);
  const username = String(body.Username || '').trim();
  if (!username || isBlank(body.Password) || isBlank(b.RoleId)) return bad(res, 'Username, password and role are required');
  if (String(body.Password).length < 6) return bad(res, 'Password must be at least 6 characters');
  if (store.users.some((u) => same(u.Username, username))) return bad(res, 'Username already exists');
  const role = roleOf(b.RoleId); if (!role || role.IsActive === false) return bad(res, 'Select a valid role');
  if (role.IsSuperAdmin && !isSuperAdmin(req.user)) return bad(res, 'Only a super admin can assign a super admin role', 403);
  const access = resolveAccess(req, body, null); if (access.error) return bad(res, access.error);
  const rec = { UserId: nextId(), Username: username, PasswordHash: await bcrypt.hash(String(body.Password), 10), FullName: String(b.FullName || username).trim(), Mobile: b.Mobile || '', Email: b.Email || '', RoleId: role.RoleId, IsActive: b.IsActive !== false && b.IsActive !== 'false', ...access, CreatedAt: nowISO(), UpdatedAt: nowISO() };
  store.users.push(rec); audit(req, 'CREATE', 'Users', rec.UserId, null, pubUser(rec)); res.status(201).json(enrichUser(rec));
});
router.put('/users/:id', authMiddleware, requirePermission('user_mgmt', 'CanEdit'), async (req, res) => {
  const rec = findBy(store.users, 'UserId', req.params.id); if (!rec) return bad(res, 'User not found', 404);
  const body = req.body || {}; const b = pick(body, USER_FIELDS); const self = rec.UserId === req.user.UserId;
  if (isSuperAdmin(rec) && !isSuperAdmin(req.user)) return bad(res, 'Only a super admin can edit a super admin user', 403);
  if (b.RoleId !== undefined) {
    b.RoleId = Number(b.RoleId); const role = roleOf(b.RoleId); if (!role) return bad(res, 'Select a valid role');
    if (self && b.RoleId !== rec.RoleId) return bad(res, 'You cannot change your own role');
    if (role.IsSuperAdmin && !isSuperAdmin(req.user)) return bad(res, 'Only a super admin can assign a super admin role', 403);
  }
  if (b.IsActive !== undefined) { b.IsActive = toBool(b.IsActive); if (self && !b.IsActive) return bad(res, 'You cannot deactivate your own account'); }
  const access = resolveAccess(req, body, rec); if (access.error) return bad(res, access.error);
  if (self && !isSuperAdmin(rec) && !access.AllLocations && !access.LocationIds.includes(req.locationId)) return bad(res, 'You cannot remove your own access to the location you are signed in to');
  if (!isBlank(body.Password) && String(body.Password).length < 6) return bad(res, 'Password must be at least 6 characters');
  const old = pubUser(rec); Object.assign(rec, b, access);
  if (!isBlank(body.Password)) rec.PasswordHash = await bcrypt.hash(String(body.Password), 10);
  rec.UpdatedAt = nowISO(); audit(req, 'UPDATE', 'Users', rec.UserId, old, pubUser(rec)); res.json(enrichUser(rec));
});
router.delete('/users/:id', authMiddleware, requirePermission('user_mgmt', 'CanDelete'), (req, res) => {
  const rec = findBy(store.users, 'UserId', req.params.id); if (!rec) return bad(res, 'User not found', 404);
  if (rec.UserId === req.user.UserId) return bad(res, 'You cannot delete your own account');
  if (isSuperAdmin(rec) && !isSuperAdmin(req.user)) return bad(res, 'Only a super admin can delete a super admin user', 403);
  store.users.splice(store.users.indexOf(rec), 1); store.counters.forEach((c) => { if (c.AssignedUserId === rec.UserId) c.AssignedUserId = null; });
  audit(req, 'DELETE', 'Users', rec.UserId, pubUser(rec), null); res.json({ message: 'User deleted' });
});

// ---------- ROLES ----------
router.get('/roles', authMiddleware, (req, res) => res.json(store.roles.map((r) => ({ ...r, UserCount: store.users.filter((u) => u.RoleId === r.RoleId).length }))));
router.post('/roles', authMiddleware, requirePermission('screen_allocation', 'CanCreate'), (req, res) => {
  const b = req.body || {}; const name = String(b.RoleName || '').trim();
  if (!name) return bad(res, 'Role name is required');
  if (store.roles.some((r) => same(r.RoleName, name))) return bad(res, 'Role already exists');
  if (toBool(b.IsSuperAdmin) && !isSuperAdmin(req.user)) return bad(res, 'Only a super admin can create a super admin role', 403);
  const rec = { RoleId: nextId(), RoleName: name, Description: String(b.Description || '').trim(), IsActive: b.IsActive !== false, IsSuperAdmin: toBool(b.IsSuperAdmin) };
  store.roles.push(rec); audit(req, 'CREATE', 'Roles', rec.RoleId, null, rec); res.status(201).json(rec);
});
router.put('/roles/:id', authMiddleware, requirePermission('screen_allocation', 'CanEdit'), (req, res) => {
  const rec = findBy(store.roles, 'RoleId', req.params.id); if (!rec) return bad(res, 'Role not found', 404);
  const b = pick(req.body || {}, ['RoleName', 'Description', 'IsActive', 'IsSuperAdmin']); const own = rec.RoleId === req.user.RoleId;
  if (b.RoleName !== undefined) { b.RoleName = String(b.RoleName).trim(); if (!b.RoleName) return bad(res, 'Role name is required'); if (store.roles.some((r) => r !== rec && same(r.RoleName, b.RoleName))) return bad(res, 'Role already exists'); }
  if (b.IsSuperAdmin !== undefined) { b.IsSuperAdmin = toBool(b.IsSuperAdmin); if (b.IsSuperAdmin !== !!rec.IsSuperAdmin) { if (!isSuperAdmin(req.user)) return bad(res, 'Only a super admin can change the super admin flag', 403); if (own) return bad(res, 'You cannot change the super admin flag of your own role'); } }
  if (b.IsActive !== undefined) { b.IsActive = toBool(b.IsActive); if (own && !b.IsActive) return bad(res, 'You cannot deactivate your own role'); }
  const old = { ...rec }; Object.assign(rec, b); audit(req, 'UPDATE', 'Roles', rec.RoleId, old, rec); res.json(rec);
});
router.delete('/roles/:id', authMiddleware, requirePermission('screen_allocation', 'CanDelete'), (req, res) => {
  const rec = findBy(store.roles, 'RoleId', req.params.id); if (!rec) return bad(res, 'Role not found', 404);
  if (rec.RoleId === req.user.RoleId) return bad(res, 'You cannot delete your own role');
  if (store.users.some((u) => u.RoleId === rec.RoleId)) return bad(res, 'Role has users. Reassign them first.');
  store.roles.splice(store.roles.indexOf(rec), 1); store.permissions = store.permissions.filter((p) => p.RoleId !== rec.RoleId);
  audit(req, 'DELETE', 'Roles', rec.RoleId, rec, null); res.json({ message: 'Role deleted' });
});

// ---------- SCREENS (names, groups and order are editable — the nav is built from this) ----------
router.get('/screens', authMiddleware, (req, res) => res.json([...store.screens].filter((s) => req.query.all === 'true' || s.IsActive !== false).sort(byOrder)));
router.put('/screens/:id', authMiddleware, requirePermission('screen_allocation', 'CanEdit'), (req, res) => {
  const rec = findBy(store.screens, 'ScreenId', req.params.id); if (!rec) return bad(res, 'Screen not found', 404);
  const b = pick(req.body || {}, ['ScreenName', 'ScreenGroup', 'DisplayOrder', 'IsActive']);
  if (b.ScreenName !== undefined) { b.ScreenName = String(b.ScreenName).trim(); if (!b.ScreenName) return bad(res, 'Screen name is required'); }
  if (b.ScreenGroup !== undefined) b.ScreenGroup = String(b.ScreenGroup).trim();
  if (b.DisplayOrder !== undefined) b.DisplayOrder = Number(b.DisplayOrder) || 0;
  if (b.IsActive !== undefined) b.IsActive = toBool(b.IsActive);
  const old = { ...rec }; Object.assign(rec, b); audit(req, 'UPDATE', 'Screens', rec.ScreenId, old, rec); res.json(rec);
});

// ---------- PERMISSIONS ----------
router.get('/permissions', authMiddleware, (req, res) => {
  let rows = store.permissions.map((p) => ({ ...p, ScreenName: findBy(store.screens, 'ScreenId', p.ScreenId)?.ScreenName || '', ScreenKey: findBy(store.screens, 'ScreenId', p.ScreenId)?.ScreenKey || '', RoleName: roleOf(p.RoleId)?.RoleName || '' }));
  if (req.query.roleId) rows = rows.filter((p) => p.RoleId === Number(req.query.roleId));
  res.json(rows);
});
const upsertPerm = (roleId, p) => {
  let perm = store.permissions.find((x) => x.RoleId === roleId && x.ScreenId === Number(p.ScreenId));
  const flags = { CanView: toBool(p.CanView), CanCreate: toBool(p.CanCreate), CanEdit: toBool(p.CanEdit), CanDelete: toBool(p.CanDelete) };
  if (!perm) { perm = { PermissionId: nextId(), RoleId: roleId, ScreenId: Number(p.ScreenId), ...flags }; store.permissions.push(perm); } else Object.assign(perm, flags);
  return perm;
};
router.put('/permissions', authMiddleware, requirePermission('screen_allocation', 'CanEdit'), (req, res) => {
  const { RoleId, ScreenId } = req.body || {};
  if (!roleOf(RoleId) || !findBy(store.screens, 'ScreenId', ScreenId)) return bad(res, 'Valid RoleId and ScreenId are required');
  const perm = upsertPerm(Number(RoleId), req.body); audit(req, 'UPDATE', 'ScreenPermissions', perm.PermissionId, null, perm); res.json(perm);
});
router.put('/permissions/bulk', authMiddleware, requirePermission('screen_allocation', 'CanEdit'), (req, res) => {
  const { RoleId, permissions } = req.body || {};
  if (!roleOf(RoleId) || !Array.isArray(permissions)) return bad(res, 'Valid RoleId and permissions list are required');
  permissions.filter((p) => findBy(store.screens, 'ScreenId', p.ScreenId)).forEach((p) => upsertPerm(Number(RoleId), p));
  audit(req, 'UPDATE', 'ScreenPermissions', Number(RoleId), null, { RoleId, count: permissions.length });
  res.json({ message: 'Permissions updated', permissions: getPermissionsForRole(Number(RoleId)) });
});

// ---------- AUDIT / HEALTH ----------
router.get('/audit-log', authMiddleware, requirePermission('screen_allocation'), (req, res) => res.json([...store.auditLog].filter((a) => isSuperAdmin(req.user) || a.LocationId === req.locationId).reverse().slice(0, 200)));
router.get('/health', (req, res) => res.json({ status: 'ok', storage: 'in-memory (seed.json)', mssqlConfigured: Boolean(process.env.DB_PASSWORD && process.env.DB_SERVER), time: nowISO() }));

export default router;
