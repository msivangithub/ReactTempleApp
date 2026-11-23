// Bookings (type-driven: Seva uses the Seva Master; Laddu / Goshala / ... use the Item Master), devotee lookup,
// dashboard and reports. Everything is read from and written to MSSQL, scoped to the location chosen at login.
import { Router } from 'express';
import { db, tx, getSettings } from '../db.js';
import { wrap, isBlank, toNum, str, pick, TIME_RE, todayISO, nowHHMM } from '../util.js';
import { authMiddleware, requirePermission, hasPermission } from '../auth.js';
import { bad, audit, LIVE, loadBookings, loadBooking, bookingFilters, paging, defaultName, slotAllowed, validDate, groupBy, toGroups, publicLocation, stampColumns } from './common.js';

const router = Router();
const id = (v) => Number(v) || 0;
const mobileTest = (s) => { const re = new RegExp(s.mobilePattern || '^\\d{10}$'); return (m) => re.test(String(m ?? '')); };
const cut = (v, n) => str(v).slice(0, n); // column sizes from the schema

// ---------- list (server-side paging) / one ----------
router.get('/bookings', authMiddleware, requirePermission('bookings'), wrap(async (req, res) => {
  const { where, params } = bookingFilters(req.locationId, req.query);
  const pg = paging(req.query);
  if (!pg) return res.json(await loadBookings(db, { where, params }));
  const s = await db.one(`SELECT COUNT(*) AS total, SUM(CASE WHEN xs.StatusName IS NULL THEN 1 ELSE 0 END) AS liveCount,
      ISNULL(SUM(CASE WHEN xs.StatusName IS NULL THEN b.TotalAmount END), 0) AS liveAmount
    FROM dbo.Bookings b LEFT JOIN dbo.BookingStatuses xs ON xs.StatusName = b.PaymentStatus AND xs.IsCancelled = 1 WHERE ${where}`, params);
  const rows = await loadBookings(db, { where, params, offset: pg.offset, limit: pg.pageSize });
  res.json({ rows, total: s.total, page: pg.page, pageSize: pg.pageSize, summary: { count: s.liveCount || 0, amount: Number(s.liveAmount || 0) } });
}));
router.get('/bookings/:id', authMiddleware, wrap(async (req, res) => {
  const rec = /^\d+$/.test(req.params.id) ? await loadBooking(db, req.params.id, req.locationId)
    : (await loadBookings(db, { where: 'b.BookingNumber = @n AND b.LocationId = @loc', params: { n: req.params.id, loc: req.locationId } }))[0];
  if (!rec) return bad(res, 'Booking not found', 404);
  res.json(rec);
}));

// ---------- devotee lookup by mobile: last booking details + lifetime membership (locations the user can access) ----------
router.get('/devotees/lookup', authMiddleware, wrap(async (req, res) => {
  const s = await getSettings();
  const mobile = str(req.query.mobile);
  if (!mobileTest(s)(mobile)) return bad(res, 'Enter a valid mobile number');
  const allowed = req.user.IsSuperAdmin || hasPermission(req, 'bookings') || [...req.perms.values()].some((p) => p.IsBookingScreen && p.CanCreate);
  if (!allowed) return bad(res, 'You do not have permission to look up devotees', 403);
  const me = req.currentUser;
  const scope = me.IsSuperAdmin || me.AllLocations ? '' : ` AND LocationId IN (${[...new Set([...(me.LocationIds || []), req.locationId])].map(Number).join(',')})`;
  const here = 'CASE WHEN LocationId = @loc THEN 0 ELSE 1 END';
  const [named, gothram, stats, member] = await db.sets(`
    SELECT TOP 1 DevoteeName FROM dbo.Bookings WHERE Mobile = @m AND DevoteeName <> N''${scope} ORDER BY ${here}, BookingId DESC;
    SELECT TOP 1 ISNULL(Gothram, N'') AS Gothram, ISNULL(Nakshatram, N'') AS Nakshatram FROM dbo.Bookings
      WHERE Mobile = @m AND (ISNULL(Gothram, N'') <> N'' OR ISNULL(Nakshatram, N'') <> N'')${scope} ORDER BY ${here}, BookingId DESC;
    SELECT COUNT(*) AS visits, CONVERT(CHAR(10), MAX(BookingDate), 23) AS lastVisit FROM dbo.Bookings WHERE Mobile = @m${scope};
    SELECT TOP 1 MemberNumber, MemberName, ISNULL(Email, N'') AS Email, ISNULL(Address, N'') AS Address, Status FROM dbo.LifetimeMembers WHERE Mobile = @m${scope} ORDER BY ${here}, MemberId DESC;`,
  { m: mobile, loc: req.locationId });
  const mem = member[0] || null;
  res.json({
    found: Boolean(named[0] || mem), Mobile: mobile,
    DevoteeName: named[0]?.DevoteeName || mem?.MemberName || '', Gothram: gothram[0]?.Gothram || '', Nakshatram: gothram[0]?.Nakshatram || '',
    visits: stats[0]?.visits || 0, lastVisit: stats[0]?.lastVisit || null, member: mem,
  });
}));

// ---------- create ----------
router.post('/bookings', authMiddleware, wrap(async (req, res) => {
  const b = req.body || {};
  const s = await getSettings();
  const type = isBlank(b.BookingType)
    ? await db.one('SELECT TOP 1 * FROM dbo.BookingTypes WHERE ISNULL(IsActive, 1) = 1 ORDER BY CASE WHEN IsDefault = 1 THEN 0 ELSE 1 END, ISNULL(DisplayOrder, 0), BookingTypeId')
    : await db.one('SELECT * FROM dbo.BookingTypes WHERE TypeName = @n', { n: String(b.BookingType) });
  if (!type || type.IsActive === false) return bad(res, 'Invalid or inactive booking type');
  if (!hasPermission(req, type.ScreenKey || 'bookings', 'CanCreate')) return bad(res, `You do not have create permission for ${type.TypeName} booking`, 403);
  const t0 = todayISO(s.timeZone);
  const sevaDate = isBlank(b.SevaDate) ? t0 : String(b.SevaDate);
  if (!validDate(sevaDate)) return bad(res, 'Date must be YYYY-MM-DD');
  if (sevaDate < t0) return bad(res, 'Date cannot be in the past');
  const isAdvance = sevaDate > t0;
  if (isAdvance && !type.AllowAdvance) return bad(res, `${type.TypeName} bookings cannot be made for a future date`);
  if (isAdvance && !hasPermission(req, 'advance_booking', 'CanCreate')) return bad(res, 'You do not have permission to create advance bookings', 403);
  const devotee = cut(b.DevoteeName, 100);
  if (type.RequiresDevotee && !devotee) return bad(res, 'Devotee name is required');
  if ((type.RequiresDevotee || !isBlank(b.Mobile)) && !mobileTest(s)(b.Mobile)) return bad(res, 'Enter a valid mobile number');
  let temple = null;
  if (!isBlank(b.TempleId)) {
    temple = await db.one('SELECT * FROM dbo.Temples WHERE TempleId = @t', { t: id(b.TempleId) });
    if (!temple || temple.LocationId !== req.locationId || temple.IsActive === false) return bad(res, `Temple is not available at ${req.location.LocationName}`);
  }
  if ((type.RequiresTemple || type.UsesSevaMaster) && !temple) return bad(res, 'Temple is required');
  const needTime = type.RequiresSchedule || isAdvance; // advance bookings always need date AND time
  let sevaTime = isBlank(b.SevaTime) ? '' : String(b.SevaTime);
  if (needTime && !sevaTime) return bad(res, 'Time is required');
  if (sevaTime && !TIME_RE.test(sevaTime)) return bad(res, 'Time must be HH:MM');
  if (sevaTime && !(await slotAllowed(db, temple?.TempleId, req.locationId, sevaTime))) return bad(res, 'Selected time is not an available slot');
  if (!sevaTime) sevaTime = nowHHMM(s.timeZone);
  let deityId = null;
  if (!isBlank(b.DeityId)) {
    const d = await db.one('SELECT DeityId, TempleId FROM dbo.Deities WHERE DeityId = @d', { d: id(b.DeityId) });
    if (!d || !temple || d.TempleId !== temple.TempleId) return bad(res, 'Deity does not belong to the selected temple');
    deityId = d.DeityId;
  }
  let counterId = null;
  if (!isBlank(b.CounterId)) {
    const c = await db.one('SELECT * FROM dbo.Counters WHERE CounterId = @c', { c: id(b.CounterId) });
    if (!c || c.LocationId !== req.locationId || c.IsActive === false) return bad(res, 'Counter is not available at this location');
    counterId = c.CounterId;
  }
  const paymentMode = isBlank(b.PaymentMode) ? await defaultName(db, 'PaymentModes', 'ModeName') : String(b.PaymentMode);
  if (!(await db.one('SELECT 1 AS x FROM dbo.PaymentModes WHERE ModeName = @n AND ISNULL(IsActive, 1) = 1', { n: paymentMode || '' }))) return bad(res, 'Invalid payment mode');
  const paymentStatus = isBlank(b.PaymentStatus) ? await defaultName(db, 'BookingStatuses', 'StatusName') : String(b.PaymentStatus);
  const statusRec = await db.one('SELECT * FROM dbo.BookingStatuses WHERE StatusName = @n AND ISNULL(IsActive, 1) = 1', { n: paymentStatus || '' });
  if (!statusRec || statusRec.IsCancelled) return bad(res, 'Invalid payment status');

  // Items - always priced from the masters; only Item Master rows flagged AllowCustomAmount accept an entered amount
  const lines = Array.isArray(b.Items) ? b.Items : [];
  if (!lines.length) return bad(res, `Select at least one ${type.UsesSevaMaster ? 'seva' : 'item'}`);
  const maxQty = Number(s.maxQuantity) || 999;
  const ids = [...new Set(lines.map((it) => id(type.UsesSevaMaster ? it.SevaId : it.ItemId)).filter(Boolean))];
  const catalog = new Map((ids.length ? await db.q(`SELECT * FROM dbo.${type.UsesSevaMaster ? 'SevaMaster WHERE SevaId' : 'ItemMaster WHERE ItemId'} IN (${ids.join(',')})`) : [])
    .map((x) => [type.UsesSevaMaster ? x.SevaId : x.ItemId, x]));
  const priced = [];
  for (const it of lines) {
    const qty = Math.floor(Number(it.Quantity) || 1);
    if (qty < 1 || qty > maxQty) return bad(res, `Quantity must be between 1 and ${maxQty}`);
    if (type.UsesSevaMaster) {
      const seva = catalog.get(id(it.SevaId));
      if (!seva || seva.IsActive === false || seva.TempleId !== temple.TempleId) return bad(res, `A selected seva is not available at ${temple.TempleName}`);
      priced.push({ SevaId: seva.SevaId, ItemId: null, ItemName: seva.SevaName, Quantity: qty, UnitAmount: Number(seva.Amount), TotalAmount: Number(seva.Amount) * qty });
    } else {
      const item = catalog.get(id(it.ItemId));
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
  const total = priced.reduce((sum, i) => sum + i.TotalAmount, 0);

  // numbers (financial-year series), booking and items are written in ONE transaction
  const bookingId = await tx(async (t) => {
    const head = await t.one(`DECLARE @bn NVARCHAR(50), @tn NVARCHAR(50);
      EXEC dbo.sp_NextNumber @Kind = N'BOOKING', @BusinessDate = @d, @LocationId = @loc, @Number = @bn OUTPUT;
      EXEC dbo.sp_NextNumber @Kind = N'TOKEN', @BusinessDate = @d, @LocationId = @loc, @BookingTypeId = @bt, @Number = @tn OUTPUT;
      INSERT INTO dbo.Bookings (BookingNumber, TokenNumber, BookingType, BookingTypeId, LocationId, TempleId, DeityId, DevoteeName, Mobile, Gothram, Nakshatram,
        BookingDate, SevaDate, SevaTime, Remarks, TotalAmount, PaymentMode, PaymentStatus, CounterId, CreatedBy, CreatedAt, IsAdvanceBooking)
      OUTPUT inserted.BookingId, inserted.BookingNumber, inserted.TokenNumber
      VALUES (@bn, @tn, @type, @bt, @loc, @temple, @deity, @dev, @mob, @goth, @nak, @d, @sd, @st, @rem, @total, @pm, @ps, @ctr, @uid, GETDATE(), @adv);`, {
      d: t0, loc: req.locationId, bt: type.BookingTypeId, type: type.TypeName, temple: temple?.TempleId ?? null, deity: deityId,
      dev: devotee, mob: cut(b.Mobile, 15), goth: type.CaptureGothram ? cut(b.Gothram, 100) : '', nak: type.CaptureGothram ? cut(b.Nakshatram, 50) : '',
      sd: sevaDate, st: sevaTime, rem: cut(b.Remarks, 300), total, pm: paymentMode, ps: paymentStatus, ctr: counterId, uid: req.user.UserId, adv: isAdvance,
    });
    const params = { b: head.BookingId, uid: req.user.UserId };
    const byCol = (await stampColumns('BookingItems')).has('CreatedBy'); // the user who booked is stored on every line too
    const values = priced.map((p, i) => {
      Object.assign(params, { [`s${i}`]: p.SevaId, [`i${i}`]: p.ItemId, [`n${i}`]: p.ItemName.slice(0, 150), [`q${i}`]: p.Quantity, [`u${i}`]: p.UnitAmount, [`t${i}`]: p.TotalAmount });
      return `(@b, @s${i}, @i${i}, @n${i}, @q${i}, @u${i}, @t${i}, GETDATE()${byCol ? ', @uid' : ''})`;
    });
    await t.exec(`INSERT INTO dbo.BookingItems (BookingId, SevaId, MasterItemId, ItemName, Quantity, UnitAmount, TotalAmount, CreatedAt${byCol ? ', CreatedBy' : ''}) VALUES ${values.join(', ')}`, params);
    await audit(t, req, 'CREATE', 'Bookings', head.BookingId, null, { ...head, BookingType: type.TypeName, TotalAmount: total, Items: priced });
    return head.BookingId;
  });
  res.status(201).json(await loadBooking(db, bookingId, req.locationId));
}));

// ---------- edit / cancel / delete ----------
const BOOKING_EDIT_FIELDS = ['DevoteeName', 'Mobile', 'Gothram', 'Nakshatram', 'SevaDate', 'SevaTime', 'Remarks', 'PaymentMode', 'PaymentStatus', 'CounterId'];
router.put('/bookings/:id', authMiddleware, requirePermission('bookings', 'CanEdit'), wrap(async (req, res) => {
  const rec = await loadBooking(db, req.params.id, req.locationId); if (!rec) return bad(res, 'Booking not found', 404);
  if (rec.IsCancelled) return bad(res, 'Cancelled bookings cannot be edited');
  const s = await getSettings(); const today = todayISO(s.timeZone);
  const type = (await db.one('SELECT * FROM dbo.BookingTypes WHERE TypeName = @n', { n: rec.BookingType })) || {};
  const b = pick(req.body || {}, BOOKING_EDIT_FIELDS);
  if (b.DevoteeName !== undefined) { b.DevoteeName = cut(b.DevoteeName, 100); if (type.RequiresDevotee && !b.DevoteeName) return bad(res, 'Devotee name is required'); }
  if (b.Mobile !== undefined) { if ((type.RequiresDevotee || !isBlank(b.Mobile)) && !mobileTest(s)(b.Mobile)) return bad(res, 'Enter a valid mobile number'); b.Mobile = cut(b.Mobile, 15); }
  if (b.SevaDate !== undefined && b.SevaDate !== rec.SevaDate) {
    if (!validDate(b.SevaDate)) return bad(res, 'Date must be YYYY-MM-DD');
    if (b.SevaDate < today) return bad(res, 'Date cannot be in the past');
    if (b.SevaDate > rec.BookingDate && !type.AllowAdvance) return bad(res, `${rec.BookingType} bookings cannot be moved to a future date`);
    if (b.SevaDate > today && !hasPermission(req, 'advance_booking', 'CanCreate')) return bad(res, 'You do not have permission for advance bookings', 403);
  }
  if (b.SevaTime !== undefined && b.SevaTime !== rec.SevaTime) {
    if (!TIME_RE.test(String(b.SevaTime))) return bad(res, 'Time must be HH:MM');
    if (!(await slotAllowed(db, rec.TempleId, req.locationId, b.SevaTime))) return bad(res, 'Selected time is not an available slot');
  }
  if (b.PaymentMode !== undefined && !(await db.one('SELECT 1 AS x FROM dbo.PaymentModes WHERE ModeName = @n AND ISNULL(IsActive, 1) = 1', { n: String(b.PaymentMode) }))) return bad(res, 'Invalid payment mode');
  let cancelling = false;
  if (b.PaymentStatus !== undefined) {
    const st = await db.one('SELECT * FROM dbo.BookingStatuses WHERE StatusName = @n AND ISNULL(IsActive, 1) = 1', { n: String(b.PaymentStatus) });
    if (!st) return bad(res, 'Invalid payment status');
    cancelling = Boolean(st.IsCancelled);
  }
  if (b.CounterId !== undefined) {
    b.CounterId = toNum(b.CounterId);
    if (b.CounterId && !(await db.one('SELECT 1 AS x FROM dbo.Counters WHERE CounterId = @c AND LocationId = @l', { c: b.CounterId, l: req.locationId }))) return bad(res, 'Counter is not available at this location');
  }
  if (!type.CaptureGothram) { delete b.Gothram; delete b.Nakshatram; } else { if (b.Gothram !== undefined) b.Gothram = cut(b.Gothram, 100); if (b.Nakshatram !== undefined) b.Nakshatram = cut(b.Nakshatram, 50); }
  if (b.Remarks !== undefined) b.Remarks = cut(b.Remarks, 300);
  const newDate = b.SevaDate ?? rec.SevaDate;
  const patch = { ...b, IsAdvanceBooking: newDate > rec.BookingDate, UpdatedBy: req.user.UserId };
  await tx(async (t) => {
    const cols = Object.keys(patch);
    await t.exec(`UPDATE dbo.Bookings SET ${cols.map((c) => `${c} = @${c}`).join(', ')}, UpdatedAt = GETDATE()${cancelling ? ', CancelledAt = GETDATE(), CancelledBy = @UpdatedBy' : ''} WHERE BookingId = @__id`, { ...patch, __id: rec.BookingId });
    await audit(t, req, 'UPDATE', 'Bookings', rec.BookingId, rec, patch);
  });
  res.json(await loadBooking(db, rec.BookingId, req.locationId));
}));
router.put('/bookings/:id/cancel', authMiddleware, requirePermission('bookings', 'CanEdit'), wrap(async (req, res) => {
  const rec = await loadBooking(db, req.params.id, req.locationId); if (!rec) return bad(res, 'Booking not found', 404);
  if (rec.IsCancelled) return bad(res, 'Booking is already cancelled');
  const status = (await db.one('SELECT TOP 1 StatusName FROM dbo.BookingStatuses WHERE IsCancelled = 1 AND ISNULL(IsActive, 1) = 1 ORDER BY ISNULL(DisplayOrder, 0), BookingStatusId'))?.StatusName;
  if (!status) return bad(res, 'No cancellation status is configured. Flag a booking status as "Is cancelled" in Booking Statuses.');
  const reason = cut(req.body?.reason, 300);
  await tx(async (t) => {
    await t.exec('UPDATE dbo.Bookings SET PaymentStatus = @s, CancelledAt = GETDATE(), CancelledBy = @u, CancelReason = @r, UpdatedAt = GETDATE(), UpdatedBy = @u WHERE BookingId = @id', { s: status, u: req.user.UserId, r: reason, id: rec.BookingId });
    await audit(t, req, 'CANCEL', 'Bookings', rec.BookingId, rec, { PaymentStatus: status, CancelReason: reason });
  });
  res.json(await loadBooking(db, rec.BookingId, req.locationId));
}));
router.delete('/bookings/:id', authMiddleware, requirePermission('bookings', 'CanDelete'), wrap(async (req, res) => {
  const rec = await loadBooking(db, req.params.id, req.locationId); if (!rec) return bad(res, 'Booking not found', 404);
  await tx(async (t) => {
    await t.exec('DELETE FROM dbo.BookingItems WHERE BookingId = @id; DELETE FROM dbo.Bookings WHERE BookingId = @id;', { id: rec.BookingId });
    await audit(t, req, 'DELETE', 'Bookings', rec.BookingId, rec, null);
  });
  res.json({ message: 'Booking deleted' });
}));

// ---------- DASHBOARD / REPORTS (current location) ----------
router.get('/dashboard/stats', authMiddleware, requirePermission('overview'), wrap(async (req, res) => {
  const s = await getSettings(); const t0 = todayISO(s.timeZone);
  const live = `b.LocationId = @loc AND ${LIVE}`;
  const grp = (key, join = '', extra = '') => `SELECT ${key} AS k, COUNT(*) AS [count], ISNULL(SUM(b.TotalAmount), 0) AS amount FROM dbo.Bookings b ${join} WHERE ${live}${extra} GROUP BY ${key};`;
  const [[k], todayByType, byType, byTemple, byPayment] = await db.sets(`
    SELECT
      (SELECT COUNT(*) FROM dbo.Bookings b WHERE ${live} AND b.BookingDate = @t0) AS todayCount,
      (SELECT ISNULL(SUM(b.TotalAmount), 0) FROM dbo.Bookings b WHERE ${live} AND b.BookingDate = @t0) AS todayCollection,
      (SELECT COUNT(*) FROM dbo.Bookings b WHERE ${live}) AS totalBookings,
      (SELECT ISNULL(SUM(b.TotalAmount), 0) FROM dbo.Bookings b WHERE ${live}) AS totalCollection,
      (SELECT COUNT(*) FROM dbo.Bookings b WHERE ${live} AND b.IsAdvanceBooking = 1 AND b.SevaDate >= @t0) AS upcomingAdvance,
      (SELECT COUNT(*) FROM dbo.Temples WHERE LocationId = @loc AND ISNULL(IsActive, 1) = 1) AS activeTemples,
      (SELECT COUNT(*) FROM dbo.SevaMaster sm JOIN dbo.Temples t ON t.TempleId = sm.TempleId WHERE t.LocationId = @loc AND ISNULL(sm.IsActive, 1) = 1) AS activeSevas,
      (SELECT COUNT(*) FROM dbo.ItemMaster WHERE LocationId = @loc AND IsActive = 1) AS activeItems,
      (SELECT COUNT(*) FROM dbo.Users u LEFT JOIN dbo.Roles r ON r.RoleId = u.RoleId WHERE ISNULL(u.IsActive, 1) = 1 AND (u.AllLocations = 1 OR (r.IsSuperAdmin = 1 AND ISNULL(r.IsActive, 1) = 1)
         OR EXISTS (SELECT 1 FROM dbo.UserLocations ul WHERE ul.UserId = u.UserId AND ul.LocationId = @loc))) AS activeUsers,
      (SELECT COUNT(*) FROM dbo.LifetimeMembers m WHERE m.LocationId = @loc AND m.Status = (SELECT TOP 1 StatusName FROM dbo.MemberStatuses WHERE ISNULL(IsActive, 1) = 1
         ORDER BY CASE WHEN IsDefault = 1 THEN 0 ELSE 1 END, ISNULL(DisplayOrder, 0), MemberStatusId)) AS activeMembers,
      (SELECT COUNT(*) FROM dbo.Counters WHERE LocationId = @loc AND ISNULL(IsActive, 1) = 1) AS activeCounters;
    ${grp('b.BookingType', '', ' AND b.BookingDate = @t0')}
    ${grp('b.BookingType')}
    ${grp('t.TempleName', 'LEFT JOIN dbo.Temples t ON t.TempleId = b.TempleId')}
    ${grp('b.PaymentMode')}`, { loc: req.locationId, t0 });
  const recent = await loadBookings(db, { where: 'b.LocationId = @loc', params: { loc: req.locationId }, limit: 8 });
  res.json({ location: publicLocation(req.location), ...k, todayCollection: Number(k.todayCollection), totalCollection: Number(k.totalCollection),
    todayByType: toGroups(todayByType), byType: toGroups(byType), byTemple: toGroups(byTemple), byPayment: toGroups(byPayment), recent });
}));
router.get('/reports/summary', authMiddleware, requirePermission('reports'), wrap(async (req, res) => {
  const f = req.query;
  const { where, params } = bookingFilters(req.locationId, pick(f, ['from', 'to', 'templeId', 'bookingType', 'paymentMode', 'paymentStatus']));
  const rows = await loadBookings(db, { where: isBlank(f.paymentStatus) ? `${where} AND ${LIVE}` : where, params });
  res.json({ location: publicLocation(req.location), count: rows.length, total: rows.reduce((sum, r) => sum + Number(r.TotalAmount || 0), 0),
    byType: groupBy(rows, (r) => r.BookingType), byStatus: groupBy(rows, (r) => r.PaymentStatus), byMode: groupBy(rows, (r) => r.PaymentMode), rows });
}));

export default router;
