// Public config, sign-in (location chosen at login), session, password, health
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db, getSettings, dbStatus } from '../db.js';
import { wrap, isBlank, todayISO, financialYear } from '../util.js';
import { authMiddleware, findUserByName, loadUser, allowedLocationsFor, canAccessLocation, getPermissionsForRole, signToken } from '../auth.js';
import { bad, audit, publicLocation, updateStamp, stampParams } from './common.js';

const router = Router();

export const pubUser = ({ PasswordHash, ...rest }) => rest;
export async function enrichUsers(dbx, users) {
  const names = new Map((await dbx.q('SELECT LocationId, LocationName FROM dbo.Locations')).map((l) => [l.LocationId, l.LocationName]));
  return users.map((u) => ({ ...pubUser(u), LocationIds: u.AllLocations ? [] : u.LocationIds || [], LocationNames: u.AllLocations ? [] : (u.LocationIds || []).map((id) => names.get(id)).filter(Boolean) }));
}

async function session(user, location, withToken = true) {
  const [enriched] = await enrichUsers(db, [user]);
  const out = { user: enriched, permissions: await getPermissionsForRole(user.RoleId), location: publicLocation(location), locations: (await allowedLocationsFor(user)).map((l) => publicLocation(l)) };
  if (withToken) out.token = await signToken(user, location.LocationId);
  return out;
}

// ---------- PUBLIC CONFIG (no auth: the login screen lists locations from the database) ----------
router.get('/public/config', wrap(async (req, res) => {
  const s = await getSettings();
  const locations = await db.q('SELECT * FROM dbo.Locations WHERE ISNULL(IsActive, 1) = 1 ORDER BY ISNULL(DisplayOrder, 0), LocationId');
  const temples = await db.q('SELECT LocationId, TempleName FROM dbo.Temples WHERE ISNULL(IsActive, 1) = 1 ORDER BY ISNULL(DisplayOrder, 0), TempleId');
  const fy = financialYear(todayISO(s.timeZone), s.financialYearStartMonth);
  res.json({
    appName: s.appName || '', tagline: s.tagline || '', currencySymbol: s.currencySymbol || '', locale: s.locale || '', timeZone: s.timeZone || '',
    brandName: s.brandName || '', brandLogoUrl: s.brandLogoUrl || '', brandIconUrl: s.brandIconUrl || '',
    mobilePattern: s.mobilePattern || '', maxQuantity: Number(s.maxQuantity) || null, upiMaxAmount: Number(s.upiMaxAmount) || null,
    financialYearStartMonth: Number(s.financialYearStartMonth) || null, financialYear: fy,
    defaultPageSize: Number(s.defaultPageSize) || null, pageSizeOptions: String(s.pageSizeOptions || '').split(',').map(Number).filter((n) => n > 0),
    upiIncludeTxnRef: ['1', 'true', 'yes'].includes(String(s.upiIncludeTxnRef).toLowerCase()),
    locations: locations.map((l) => ({ ...publicLocation(l, true), Temples: temples.filter((t) => t.LocationId === l.LocationId).map((t) => t.TempleName) })),
  });
}));

// ---------- AUTH ----------
router.post('/auth/login', wrap(async (req, res) => {
  const { username, password, locationId } = req.body || {};
  if (isBlank(username) || isBlank(password)) return bad(res, 'Username and password are required');
  const user = await findUserByName(username);
  if (!user || !user.IsActive || !(await bcrypt.compare(String(password), user.PasswordHash))) return bad(res, 'Invalid username or password', 401);
  const allowed = await allowedLocationsFor(user);
  if (!allowed.length) return bad(res, 'No active location is assigned to your account. Contact your administrator.', 403);
  let location = null;
  if (!isBlank(locationId)) {
    location = await db.one('SELECT * FROM dbo.Locations WHERE LocationId = @id', { id: Number(locationId) || 0 });
    if (!location || location.IsActive === false) return bad(res, 'The selected location is not available');
    if (!canAccessLocation(user, location.LocationId)) return bad(res, `You do not have access to ${location.LocationName}. Your locations: ${allowed.map((l) => l.LocationName).join(', ')}`, 403);
  } else if (allowed.length === 1) location = allowed[0];
  else return bad(res, 'Please select a location');
  await audit(db, { user, locationId: location.LocationId, ip: req.ip }, 'LOGIN', 'Users', user.UserId, null, { Username: user.Username, LocationId: location.LocationId });
  res.json(await session(user, location));
}));

router.post('/auth/switch-location', authMiddleware, wrap(async (req, res) => {
  const location = await db.one('SELECT * FROM dbo.Locations WHERE LocationId = @id', { id: Number(req.body?.locationId) || 0 });
  if (!location || location.IsActive === false) return bad(res, 'The selected location is not available');
  if (!canAccessLocation(req.currentUser, location.LocationId)) return bad(res, `You do not have access to ${location.LocationName}`, 403);
  await audit(db, req, 'SWITCH_LOCATION', 'Locations', location.LocationId, { LocationId: req.locationId }, { LocationId: location.LocationId });
  res.json(await session(req.currentUser, location));
}));

router.get('/auth/me', authMiddleware, wrap(async (req, res) => res.json(await session(req.currentUser, req.location, false))));

router.post('/auth/change-password', authMiddleware, wrap(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const user = await loadUser(req.user.UserId);
  if (!(await bcrypt.compare(String(currentPassword || ''), user.PasswordHash))) return bad(res, 'Current password is incorrect');
  if (!newPassword || String(newPassword).length < 6) return bad(res, 'New password must be at least 6 characters');
  await db.exec(`UPDATE dbo.Users SET PasswordHash = @h${await updateStamp('Users')} WHERE UserId = @id`, { h: await bcrypt.hash(String(newPassword), 10), id: user.UserId, ...stampParams(req) });
  await audit(db, req, 'CHANGE_PASSWORD', 'Users', user.UserId, null, null);
  res.json({ message: 'Password changed successfully' });
}));

// ---------- HEALTH (no auth) ----------
router.get('/health', wrap(async (req, res) => {
  let database = 'connected';
  try { await db.one('SELECT 1 AS ok'); } catch (e) { database = e.message; }
  res.status(database === 'connected' ? 200 : 503).json({ status: database === 'connected' ? 'ok' : 'degraded', storage: 'MSSQL', database, ...dbStatus(), time: new Date().toISOString() });
}));

export default router;
