// End-to-end API smoke test. Run with the API server running:  node smoke-test.mjs [baseUrl]
// Credentials and ids are read from database/seed.json (run it against a freshly initialised TEST database) — nothing is hardcoded here either.
import { readFileSync } from 'fs';
const seed = JSON.parse(readFileSync(new URL('../database/seed.json', import.meta.url)));
const BASE = process.argv[2] || 'http://localhost:5000/api';
let pass = 0, fail = 0;
const ok = (cond, label, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  → ' + extra : ''}`); };
async function call(method, path, body, token) {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await r.json(); } catch {}
  return { status: r.status, data };
}
const userBy = (pred) => seed.users.find(pred);
const roleIdBy = (pred) => seed.roles.find(pred)?.RoleId;
const superUser = userBy((u) => seed.roles.find((r) => r.RoleId === u.RoleId)?.IsSuperAdmin);
const restricted = userBy((u) => !u.AllLocations && u.LocationIds.length === 1);
const viewer = userBy((u) => !seed.permissions.some((p) => p.RoleId === u.RoleId && p.CanCreate));
const [loc1, , loc3] = seed.locations;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: seed.settings.timeZone }).format(new Date());
const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: seed.settings.timeZone }).format(new Date(Date.now() + 86400000));
const typeBy = (pred) => seed.bookingTypes.find(pred);
const sevaType = typeBy((t) => t.UsesSevaMaster), itemTypes = seed.bookingTypes.filter((t) => !t.UsesSevaMaster);

const cfg = await call('GET', '/public/config');
ok(cfg.status === 200 && cfg.data.locations.length === seed.locations.filter((l) => l.IsActive).length, 'public config lists active locations for the login screen', cfg.data.locations.map((l) => l.LocationName).join(', '));

let r = await call('POST', '/auth/login', { username: superUser.Username, password: superUser.Password });
ok(r.status === 400, 'login without a location is rejected (multi-location user)', r.data?.error);
const otherLoc = seed.locations.find((l) => !restricted.LocationIds.includes(l.LocationId));
r = await call('POST', '/auth/login', { username: restricted.Username, password: restricted.Password, locationId: otherLoc.LocationId });
ok(r.status === 403, `restricted user cannot sign in to ${otherLoc.LocationName}`, r.data?.error);
r = await call('POST', '/auth/login', { username: restricted.Username, password: restricted.Password });
ok(r.status === 200 && r.data.location.LocationId === restricted.LocationIds[0], 'single-location user is auto-assigned their location', r.data?.location?.LocationName);
const opToken = r.data.token;

r = await call('POST', '/auth/login', { username: superUser.Username, password: superUser.Password, locationId: loc1.LocationId });
ok(r.status === 200 && r.data.location.LocationName === loc1.LocationName, `super admin signs in to ${loc1.LocationName}`);
let T = r.data.token;

const temples1 = (await call('GET', '/temples', null, T)).data;
ok(temples1.length === seed.temples.filter((t) => t.LocationId === loc1.LocationId).length && temples1.every((t) => t.LocationId === loc1.LocationId), 'temples are scoped to the login location', `${temples1.length} temples`);
const types = (await call('GET', '/booking-types?activeOnly=true', null, T)).data;
ok(types.length === seed.bookingTypes.length && types.every((t) => 'UsesSevaMaster' in t && t.ScreenKey), 'booking types carry their own config (screen, item source, rules)', types.map((t) => `${t.TypeName}:${t.UsesSevaMaster ? 'SevaMaster' : 'ItemMaster'}`).join(', '));
for (const t of itemTypes) {
  const items = (await call('GET', `/items?bookingTypeId=${t.BookingTypeId}&activeOnly=true`, null, T)).data;
  ok(items.length > 0 && items.every((i) => i.BookingTypeId === t.BookingTypeId && i.LocationId === loc1.LocationId), `${t.TypeName} has its own separate items at ${loc1.LocationName}`, items.map((i) => `${i.ItemName} ${i.Amount}`).join(', '));
}

// --- Seva booking (multi-seva, date + time) ---
const mainTemple = temples1.find((t) => t.IsMainTemple) || temples1[0];
const sevas = (await call('GET', `/sevas?templeId=${mainTemple.TempleId}&activeOnly=true`, null, T)).data;
const slots = (await call('GET', `/time-slots?templeId=${mainTemple.TempleId}&activeOnly=true`, null, T)).data;
const devotee = { DevoteeName: 'Smoke Test Devotee', Mobile: '9000000001' };
r = await call('POST', '/bookings', { ...devotee, BookingType: sevaType.TypeName, TempleId: mainTemple.TempleId, SevaDate: today, SevaTime: slots.at(-1).SlotTime, Items: [{ SevaId: sevas[0].SevaId, Quantity: 1 }, { SevaId: sevas[1].SevaId, Quantity: 2 }] }, T);
ok(r.status === 201 && r.data.TokenNumber.startsWith(sevaType.TokenPrefix + '-') && r.data.Items.length === 2 && r.data.TotalAmount === sevas[0].Amount + 2 * sevas[1].Amount, 'seva booking with multiple sevas priced from Seva Master', `${r.data?.TokenNumber} ₹${r.data?.TotalAmount}`);
const sevaBooking = r.data;

// --- Item-type bookings (Laddu / Goshala): separate items, own token prefix ---
for (const t of itemTypes) {
  const items = (await call('GET', `/items?bookingTypeId=${t.BookingTypeId}&activeOnly=true`, null, T)).data;
  const fixed = items.filter((i) => !i.AllowCustomAmount), custom = items.find((i) => i.AllowCustomAmount);
  const lines = [{ ItemId: fixed[0].ItemId, Quantity: 3 }, ...(custom ? [{ ItemId: custom.ItemId, Quantity: 1, UnitAmount: Number(custom.MinAmount || 0) + 500 }] : [])];
  const expected = fixed[0].Amount * 3 + (custom ? Number(custom.MinAmount || 0) + 500 : 0);
  r = await call('POST', '/bookings', { ...devotee, BookingType: t.TypeName, Items: lines }, T);
  ok(r.status === 201 && r.data.TokenNumber.startsWith(t.TokenPrefix + '-') && r.data.TotalAmount === expected, `${t.TypeName} booking uses its own items + token prefix`, `${r.data?.TokenNumber} ₹${r.data?.TotalAmount}${custom ? ' (incl. custom amount)' : ''}`);
  if (custom && custom.MinAmount) { r = await call('POST', '/bookings', { ...devotee, BookingType: t.TypeName, Items: [{ ItemId: custom.ItemId, UnitAmount: custom.MinAmount - 1 }] }, T); ok(r.status === 400, `${t.TypeName}: custom amount below minimum is rejected`, r.data?.error); }
}
const [ta, tb] = itemTypes;
if (ta && tb) {
  const bItem = (await call('GET', `/items?bookingTypeId=${tb.BookingTypeId}`, null, T)).data[0];
  r = await call('POST', '/bookings', { ...devotee, BookingType: ta.TypeName, Items: [{ ItemId: bItem.ItemId }] }, T);
  ok(r.status === 400, `${ta.TypeName} booking cannot use a ${tb.TypeName} item`, r.data?.error);
}
r = await call('POST', '/bookings', { ...devotee, BookingType: sevaType.TypeName, TempleId: seed.temples.find((t) => t.LocationId === loc3.LocationId).TempleId, SevaTime: slots[0].SlotTime, Items: [{ SevaId: sevas[0].SevaId }] }, T);
ok(r.status === 400, 'temple from another location is rejected', r.data?.error);
r = await call('POST', '/bookings', { ...devotee, BookingType: sevaType.TypeName, TempleId: mainTemple.TempleId, SevaDate: tomorrow, Items: [{ SevaId: sevas[0].SevaId }] }, T);
ok(r.status === 400, 'advance booking without time is rejected (date AND time required)', r.data?.error);
r = await call('POST', '/bookings', { ...devotee, BookingType: sevaType.TypeName, TempleId: mainTemple.TempleId, SevaDate: tomorrow, SevaTime: slots[0].SlotTime, Items: [{ SevaId: sevas[0].SevaId }] }, T);
ok(r.status === 201 && r.data.IsAdvanceBooking, 'advance booking with date + time succeeds', `${r.data?.SevaDate} ${r.data?.SevaTime}`);
r = await call('POST', '/bookings', { ...devotee, BookingType: sevaType.TypeName, TempleId: mainTemple.TempleId, SevaTime: '03:17', Items: [{ SevaId: sevas[0].SevaId }] }, T);
ok(r.status === 400, 'time outside configured slots is rejected', r.data?.error);
r = await call('POST', '/bookings', { ...devotee, BookingType: sevaType.TypeName, TempleId: mainTemple.TempleId, SevaTime: slots[0].SlotTime, Items: [{ SevaId: sevas[0].SevaId, UnitAmount: 1 }] }, T);
ok(r.status === 201 && r.data.TotalAmount === sevas[0].Amount, 'client-sent price is ignored for fixed-price sevas');

// --- edit / cancel ---
const altMode = (await call('GET', '/payment-modes?activeOnly=true', null, T)).data.find((m) => m.ModeName !== sevaBooking.PaymentMode);
r = await call('PUT', `/bookings/${sevaBooking.BookingId}`, { PaymentMode: altMode.ModeName, Remarks: 'edited' }, T);
ok(r.status === 200 && r.data.PaymentMode === altMode.ModeName, 'booking can be edited (CRUD: update)');
r = await call('PUT', `/bookings/${sevaBooking.BookingId}/cancel`, {}, T);
ok(r.status === 200 && r.data.IsCancelled, 'booking can be cancelled', r.data?.PaymentStatus);
r = await call('PUT', `/bookings/${sevaBooking.BookingId}/cancel`, {}, T);
ok(r.status === 400, 'double cancel is rejected');

// --- permissions ---
r = await call('POST', '/auth/login', { username: viewer.Username, password: viewer.Password, locationId: loc1.LocationId });
const vT = r.data.token;
r = await call('POST', '/bookings', { ...devotee, BookingType: sevaType.TypeName, TempleId: mainTemple.TempleId, SevaTime: slots[0].SlotTime, Items: [{ SevaId: sevas[0].SevaId }] }, vT);
ok(r.status === 403, 'viewer cannot create bookings (screen permission)', r.data?.error);
r = await call('POST', '/items', { BookingTypeId: itemTypes[0].BookingTypeId, ItemName: 'X', Amount: 1 }, opToken);
ok(r.status === 403, 'operator cannot manage Item Master', r.data?.error);

// --- location switch: everything follows the location ---
r = await call('POST', '/auth/switch-location', { locationId: loc3.LocationId }, T);
ok(r.status === 200 && r.data.location.LocationId === loc3.LocationId, `switch location → ${loc3.LocationName}`);
const T3 = r.data.token;
const temples3 = (await call('GET', '/temples', null, T3)).data;
const b3 = (await call('GET', '/bookings', null, T3)).data;
const slots3 = (await call('GET', `/time-slots?templeId=${temples3[0].TempleId}&activeOnly=true`, null, T3)).data;
const items3 = (await call('GET', `/items?bookingTypeId=${itemTypes[0].BookingTypeId}`, null, T3)).data;
ok(temples3.every((t) => t.LocationId === loc3.LocationId) && b3.length === 0, `${loc3.LocationName}: only its temples, none of ${loc1.LocationName}'s bookings`, `${temples3.length} temple(s), ${b3.length} bookings`);
ok(slots3.length && slots3.every((s) => s.LocationId === loc3.LocationId), `${loc3.LocationName}: location-specific time slots apply`, slots3.map((s) => s.SlotTime).join(' '));
ok(items3.length && items3.every((i) => i.LocationId === loc3.LocationId), `${loc3.LocationName}: its own ${itemTypes[0].TypeName} items & prices`, items3.map((i) => `${i.ItemName} ${i.Amount}`).join(', '));
const d1 = (await call('GET', '/dashboard/stats', null, T)).data, d3 = (await call('GET', '/dashboard/stats', null, T3)).data;
ok(d1.todayCount > 0 && d3.todayCount === 0, 'dashboard stats are per location', `${loc1.LocationCode}: ${d1.todayCount} today, ${loc3.LocationCode}: ${d3.todayCount} today`);

// --- safety rules ---
r = await call('PUT', `/locations/${loc1.LocationId}`, { IsActive: false }, T);
ok(r.status === 400, 'cannot deactivate the location you are signed in to', r.data?.error);
const mgr = userBy((u) => !u.AllLocations && u.LocationIds.length > 1);
if (mgr) {
  const mT = (await call('POST', '/auth/login', { username: mgr.Username, password: mgr.Password, locationId: mgr.LocationIds[0] })).data.token;
  r = await call('POST', '/users', { Username: 'smoke_user', Password: 'secret1', RoleId: roleIdBy((x) => !x.IsSuperAdmin && x.RoleId !== mgr.RoleId), AllLocations: true }, mT);
  ok(r.status === 400, 'location-restricted admin cannot grant all-location access', r.data?.error);
  r = await call('POST', '/users', { Username: 'smoke_user', Password: 'secret1', RoleId: roleIdBy((x) => x.IsSuperAdmin) }, mT);
  ok(r.status === 403, 'non-super admin cannot assign the super admin role', r.data?.error);
}
r = await call('POST', '/users', { Username: 'smoke_temp', Password: 'secret1', RoleId: restricted.RoleId, LocationIds: [loc1.LocationId] }, T);
const tmpId = r.data?.UserId;
const tmpT = (await call('POST', '/auth/login', { username: 'smoke_temp', password: 'secret1' })).data?.token;
await call('PUT', `/users/${tmpId}`, { IsActive: false }, T);
r = await call('GET', '/temples', null, tmpT);
ok(r.status === 401, 'deactivated user is locked out immediately (live session check)', r.data?.error);
r = await call('DELETE', `/payment-modes/${altMode.PaymentModeId}`, null, T);
ok(r.status === 400, 'in-use lookup value cannot be deleted', r.data?.error);

// --- dynamic booking types: a new type gets its own screen, items and token series ---
r = await call('POST', '/booking-types', { TypeName: 'Prasadam', TokenPrefix: 'pr', Description: 'Prasadam counter', Icon: 'Gift', RequiresDevotee: false, AllowAdvance: false }, T);
ok(r.status === 201 && r.data.ScreenKey === 'prasadam_booking' && r.data.TokenPrefix === 'PR', 'new booking type created with auto screen key', `${r.data?.TypeName} → ${r.data?.ScreenKey}`);
const prType = r.data;
const scr = (await call('GET', '/screens', null, T)).data.find((s) => s.ScreenKey === prType.ScreenKey);
ok(!!scr && scr.IsBookingScreen, 'its booking screen is created automatically (menu + permissions)', scr?.ScreenName);
r = await call('POST', '/booking-types', { TypeName: 'Hack', TokenPrefix: 'HK', ScreenKey: 'user_mgmt' }, T);
ok(r.status === 400, 'a booking type cannot hijack a system screen key', r.data?.error);
r = await call('POST', '/items', { BookingTypeId: prType.BookingTypeId, ItemName: 'Pulihora', Amount: 25, Unit: 'Packet' }, T);
ok(r.status === 201, 'item added for the new type in Item Master', `${r.data?.ItemName} ${r.data?.Amount}`);
r = await call('POST', '/items', { BookingTypeId: sevaType.BookingTypeId, ItemName: 'X', Amount: 1 }, T);
ok(r.status === 400, 'Item Master refuses items for Seva-Master types', r.data?.error);
const pul = (await call('GET', `/items?bookingTypeId=${prType.BookingTypeId}`, null, T)).data[0];
r = await call('POST', '/bookings', { BookingType: 'Prasadam', Items: [{ ItemId: pul.ItemId, Quantity: 4 }] }, T);
ok(r.status === 201 && r.data.TokenNumber.startsWith('PR-') && r.data.TotalAmount === 100, 'new type books immediately (no devotee required per its rules)', `${r.data?.TokenNumber} ₹${r.data?.TotalAmount}`);
r = await call('POST', '/bookings', { BookingType: 'Prasadam', SevaDate: tomorrow, SevaTime: '06:00', Items: [{ ItemId: pul.ItemId }] }, T);
ok(r.status === 400, 'advance booking blocked for a type with AllowAdvance = false', r.data?.error);
r = await call('POST', '/bookings', { BookingType: 'Prasadam', Items: [{ ItemId: pul.ItemId }] }, opToken);
ok(r.status === 403, 'operator has no access to the new type until granted in Roles', r.data?.error);
if (mgr) {
  const mT = (await call('POST', '/auth/login', { username: mgr.Username, password: mgr.Password, locationId: mgr.LocationIds[0] })).data.token;
  const u = (await call('POST', '/users', { Username: 'smoke_multi', Password: 'secret1', RoleId: restricted.RoleId, LocationIds: [loc1.LocationId, loc3.LocationId] }, T)).data;
  r = await call('PUT', `/users/${u.UserId}`, { FullName: 'Edited by manager', LocationIds: u.LocationIds }, mT);
  ok(r.status === 200, 'restricted admin can edit a user while keeping locations outside their scope', r.data?.error || r.data?.LocationNames?.join(', '));
}

// --- v4.1: database-only storage, financial-year numbers, devotee lookup, paging, UPI QR settings ---
const s1 = (await call('POST', '/auth/login', { username: superUser.Username, password: superUser.Password, locationId: loc1.LocationId })).data.token;
const fyStart = Number(seed.settings.financialYearStartMonth) || 4;
const [yy, mm] = today.split('-').map(Number); const fyY = mm < fyStart ? yy - 1 : yy;
const fyCode = fyStart === 1 ? String(fyY) : `${String(fyY).slice(2)}${String(fyY + 1).slice(2)}`;
ok(new RegExp(`^${seed.settings.bookingNumberPrefix}-${fyCode}-\\d{6}$`).test(sevaBooking.BookingNumber) && sevaBooking.TokenNumber.startsWith(`${sevaType.TokenPrefix}-${fyCode}-`), `numbers carry the financial year (${fyCode}) and restart every year`, `${sevaBooking.BookingNumber} / ${sevaBooking.TokenNumber}`);
r = await call('GET', `/devotees/lookup?mobile=${devotee.Mobile}`, null, s1);
ok(r.status === 200 && r.data.found && r.data.DevoteeName === devotee.DevoteeName && r.data.visits >= 1, 'devotee lookup by mobile returns the saved details', `${r.data?.DevoteeName}, ${r.data?.visits} visit(s), last ${r.data?.lastVisit}`);
r = await call('GET', '/devotees/lookup?mobile=9999999990', null, s1);
ok(r.status === 200 && !r.data.found, 'unknown mobile number → not found (form stays empty)');
r = await call('GET', '/devotees/lookup?mobile=123', null, s1);
ok(r.status === 400, 'devotee lookup rejects an invalid mobile number', r.data?.error);
r = await call('GET', '/bookings?page=1&pageSize=2', null, s1);
ok(r.status === 200 && r.data.rows?.length === 2 && r.data.total >= 4 && r.data.page === 1 && 'summary' in r.data, 'bookings list is paged on the server', `page 1 of ${Math.ceil((r.data?.total || 0) / 2)} (${r.data?.total} bookings)`);
const page2 = await call('GET', '/bookings?page=2&pageSize=2', null, s1);
ok(page2.status === 200 && page2.data.rows.length >= 1 && !page2.data.rows.some((x) => r.data.rows.some((y) => y.BookingId === x.BookingId)), 'page 2 continues without repeating rows');
r = await call('PUT', `/locations/${loc1.LocationId}`, { UpiVpa: 'not a vpa' }, s1);
ok(r.status === 400, 'an invalid UPI ID is rejected', r.data?.error);
r = await call('PUT', `/locations/${loc1.LocationId}`, { UpiVpa: 'smoketest.temple@upi', UpiPayeeName: 'Smoke Test Temple' }, s1);
const me = await call('GET', '/auth/me', null, s1);
ok(r.status === 200 && me.data.location.UpiVpa === 'smoketest.temple@upi', 'UPI ID is saved per location and reaches the session (for the QR)', me.data.location.UpiVpa);
await call('PUT', `/locations/${loc1.LocationId}`, { UpiVpa: '', UpiPayeeName: '' }, s1); // leave no test UPI ID behind
const payModes = (await call('GET', '/payment-modes', null, s1)).data;
ok(payModes.some((m) => m.ShowUpiQr) && payModes.every((m) => typeof m.ShowUpiQr === 'boolean'), 'payment modes say which ones show the UPI QR', payModes.filter((m) => m.ShowUpiQr).map((m) => m.ModeName).join(', '));

// --- v4.2: the database stores WHO created / changed every record (CreatedBy / UpdatedBy / CancelledBy -> Users.UserId) ---
const whoAmI = async (tok) => (await call('GET', '/auth/me', null, tok)).data?.user || {};
const mgrU = userBy((u) => !u.AllLocations && u.LocationIds.length > 1 && u.LocationIds.includes(loc1.LocationId));
const mgrT = (await call('POST', '/auth/login', { username: mgrU.Username, password: mgrU.Password, locationId: loc1.LocationId })).data.token;
const [adminU, opU, mgrMe] = [await whoAmI(s1), await whoAmI(opToken), await whoAmI(mgrT)];
const auditType = itemTypes[0];
const auditItem = (await call('GET', `/items?bookingTypeId=${auditType.BookingTypeId}&activeOnly=true`, null, opToken)).data.find((i) => !i.AllowCustomAmount);
const voucher = (await call('POST', '/bookings', { ...devotee, BookingType: auditType.TypeName, Items: [{ ItemId: auditItem.ItemId, Quantity: 2 }] }, opToken)).data;
ok(voucher?.CreatedBy === opU.UserId && voucher?.CreatedByName === opU.FullName && !voucher?.UpdatedBy, 'a booking (voucher) stores the user who created it', `${voucher?.TokenNumber} → CreatedBy ${voucher?.CreatedBy} (${voucher?.CreatedByName})`);
r = await call('PUT', `/bookings/${voucher.BookingId}`, { Remarks: 'checked by manager' }, mgrT);
ok(r.status === 200 && r.data.CreatedBy === opU.UserId && r.data.UpdatedBy === mgrMe.UserId && r.data.UpdatedByName === mgrMe.FullName && !!r.data.UpdatedAt, 'editing a booking stores who changed it; the creator is kept', `UpdatedBy ${r.data?.UpdatedBy} (${r.data?.UpdatedByName})`);
r = await call('PUT', `/bookings/${voucher.BookingId}/cancel`, { reason: 'audit check' }, s1);
ok(r.status === 200 && r.data.CancelledBy === adminU.UserId && r.data.CancelledByName === adminU.FullName && r.data.CreatedBy === opU.UserId, 'cancelling a booking stores who cancelled it', `CancelledBy ${r.data?.CancelledBy} (${r.data?.CancelledByName})`);
// masters: lookup values, categories and counters were not stamped before v4.2
const stampName = `Audit ${Date.now() % 100000}`;
r = await call('POST', '/payment-modes', { ModeName: stampName }, s1);
ok(r.status === 201 && r.data.CreatedBy === adminU.UserId && r.data.CreatedByName === adminU.FullName && !!r.data.CreatedAt && !r.data.UpdatedBy, 'a lookup master stores who created it', `${r.data?.ModeName} → CreatedBy ${r.data?.CreatedBy}`);
const pmId = r.data.PaymentModeId;
r = await call('PUT', `/payment-modes/${pmId}`, { DisplayOrder: 77 }, mgrT);
ok(r.status === 200 && r.data.CreatedBy === adminU.UserId && r.data.UpdatedBy === mgrMe.UserId && r.data.UpdatedByName === mgrMe.FullName, 'editing a master stores who changed it; the creator is kept', `UpdatedBy ${r.data?.UpdatedBy} (${r.data?.UpdatedByName})`);
const listed = (await call('GET', '/payment-modes', null, s1)).data.find((m) => m.PaymentModeId === pmId);
ok(listed?.CreatedByName === adminU.FullName && listed?.UpdatedByName === mgrMe.FullName, 'master lists return the creator / editor names for the screens');
await call('DELETE', `/payment-modes/${pmId}`, null, s1);
r = await call('POST', '/seva-categories', { CategoryName: stampName }, mgrT);
ok(r.status === 201 && r.data.CreatedBy === mgrMe.UserId, 'seva categories store who created them', `CreatedBy ${r.data?.CreatedBy}`);
await call('DELETE', `/seva-categories/${r.data?.CategoryId}`, null, mgrT);
r = await call('POST', '/counters', { CounterName: stampName }, mgrT);
ok(r.status === 201 && r.data.CreatedBy === mgrMe.UserId && r.data.CreatedByName === mgrMe.FullName, 'counters store who created them', `CreatedBy ${r.data?.CreatedBy}`);
await call('DELETE', `/counters/${r.data?.CounterId}`, null, mgrT);
const memberRes = await call('POST', '/members', { MemberName: 'Audit Member', Mobile: `98${String(Date.now()).slice(-8)}` }, mgrT);
r = await call('PUT', `/members/${memberRes.data?.MemberId}`, { PoojaName: 'Audit pooja' }, s1);
ok(memberRes.status === 201 && memberRes.data.CreatedBy === mgrMe.UserId && r.status === 200 && r.data.UpdatedBy === adminU.UserId && r.data.UpdatedByName === adminU.FullName, 'lifetime members store who created and who changed them', `CreatedBy ${memberRes.data?.CreatedBy}, UpdatedBy ${r.data?.UpdatedBy}`);
await call('DELETE', `/members/${memberRes.data?.MemberId}`, null, s1);
// users: the creator of an account is stored; deleting someone must never erase who did what
const role = (await call('GET', '/roles', null, s1)).data.find((x) => !x.IsSuperAdmin);
r = await call('POST', '/users', { Username: `audit${Date.now() % 100000}`, Password: 'secret123', FullName: 'Audit Temp', RoleId: role.RoleId, LocationIds: [loc1.LocationId] }, mgrT);
ok(r.status === 201 && r.data.CreatedBy === mgrMe.UserId && r.data.CreatedByName === mgrMe.FullName, 'a new user account stores who created it', `CreatedBy ${r.data?.CreatedBy}`);
const del = await call('DELETE', `/users/${r.data?.UserId}`, null, s1);
ok(del.status === 200, 'a user who has not created anything can still be deleted', del.data?.error);
r = await call('DELETE', `/users/${opU.UserId}`, null, s1);
ok(r.status === 400 && /created or changed/.test(r.data?.error || ''), 'a user who created records cannot be deleted (deactivate instead), so the history stays', r.data?.error);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
