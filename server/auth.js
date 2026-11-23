import jwt from 'jsonwebtoken';
import { q, sets, one, getSettings } from './db.js';
import { HttpError } from './util.js';

export const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production-use-a-long-random-secret';

// Users with role name, the role's live super-admin flag (no hardcoded role names) and their location access
const USER_SQL = `SELECT u.UserId, u.Username, u.PasswordHash, u.FullName, u.Mobile, u.Email, u.RoleId,
    CAST(ISNULL(u.IsActive, 1) AS BIT) AS IsActive, CAST(ISNULL(u.AllLocations, 0) AS BIT) AS AllLocations, u.CreatedAt, u.UpdatedAt,
    ISNULL(r.RoleName, N'') AS RoleName,
    CAST(CASE WHEN r.IsSuperAdmin = 1 AND ISNULL(r.IsActive, 1) = 1 THEN 1 ELSE 0 END AS BIT) AS IsSuperAdmin
  FROM dbo.Users u LEFT JOIN dbo.Roles r ON r.RoleId = u.RoleId`;

export async function loadUsers(where = '', params = {}, runner) {
  const users = await q(`${USER_SQL} ${where} ORDER BY u.UserId`, params, runner);
  if (!users.length) return users;
  const links = await q(`SELECT UserId, LocationId FROM dbo.UserLocations WHERE UserId IN (${users.map((u) => Number(u.UserId)).join(',')})`, {}, runner);
  for (const u of users) u.LocationIds = links.filter((l) => l.UserId === u.UserId).map((l) => l.LocationId).sort((a, b) => a - b);
  return users;
}
export const loadUser = async (id, runner) => (await loadUsers('WHERE u.UserId = @id', { id: Number(id) || 0 }, runner))[0] || null;
export const findUserByName = async (username) => (await loadUsers('WHERE u.Username = @n', { n: String(username || '').trim() }))[0] || null;

export const isSuperAdmin = (user) => Boolean(user?.IsSuperAdmin);

// Location access: super admin role -> all; AllLocations -> all; otherwise only the user's UserLocations rows
export function canAccessLocation(user, locationId) {
  if (!user) return false;
  if (user.IsSuperAdmin || user.AllLocations) return true;
  return (user.LocationIds || []).includes(Number(locationId));
}
export async function allowedLocationsFor(user, runner) {
  const rows = await q('SELECT * FROM dbo.Locations WHERE ISNULL(IsActive, 1) = 1 ORDER BY ISNULL(DisplayOrder, 0), LocationId', {}, runner);
  return rows.filter((l) => canAccessLocation(user, l.LocationId));
}

const PERM_SQL = `SELECT p.PermissionId, p.RoleId, p.ScreenId, s.ScreenKey, s.ScreenName, CAST(ISNULL(s.IsBookingScreen, 0) AS BIT) AS IsBookingScreen,
    CAST(ISNULL(p.CanView, 0) AS BIT) AS CanView, CAST(ISNULL(p.CanCreate, 0) AS BIT) AS CanCreate,
    CAST(ISNULL(p.CanEdit, 0) AS BIT) AS CanEdit, CAST(ISNULL(p.CanDelete, 0) AS BIT) AS CanDelete
  FROM dbo.ScreenPermissions p JOIN dbo.Screens s ON s.ScreenId = p.ScreenId`;
export const getPermissionsForRole = (roleId, runner) => q(`${PERM_SQL} WHERE p.RoleId = @r ORDER BY s.DisplayOrder, s.ScreenId`, { r: Number(roleId) || 0 }, runner);

export async function signToken(user, locationId) {
  const s = await getSettings();
  return jwt.sign({ UserId: user.UserId, Username: user.Username, RoleId: user.RoleId, LocationId: Number(locationId) }, JWT_SECRET, { expiresIn: s.sessionExpiry || '12h' });
}

/**
 * Verifies the token AND the live database state in one round trip: user still active, location still active
 * and still allowed, current role and permissions. Sets req.user, req.currentUser, req.location, req.locationId, req.perms.
 */
export async function authMiddleware(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new HttpError(401, 'Authentication required. Please login.');
    let payload;
    try { payload = jwt.verify(token, JWT_SECRET); } catch { throw new HttpError(401, 'Invalid or expired session. Please login again.'); }
    if (!payload.LocationId) throw new HttpError(401, 'Session has no location. Please login again and select a location.');

    const [users, links, locations, perms] = await sets(`${USER_SQL} WHERE u.UserId = @uid;
      SELECT LocationId FROM dbo.UserLocations WHERE UserId = @uid;
      SELECT * FROM dbo.Locations WHERE LocationId = @lid;
      ${PERM_SQL} JOIN dbo.Users pu ON pu.RoleId = p.RoleId WHERE pu.UserId = @uid;`, { uid: Number(payload.UserId) || 0, lid: Number(payload.LocationId) || 0 });
    const user = users[0];
    if (!user || !user.IsActive) throw new HttpError(401, 'Your account is inactive or was removed. Contact your administrator.');
    user.LocationIds = links.map((l) => l.LocationId);
    const location = locations[0];
    if (!location || location.IsActive === false) throw new HttpError(401, 'The selected location is no longer available. Please login again.');
    if (!canAccessLocation(user, location.LocationId)) throw new HttpError(401, `Your access to ${location.LocationName} was revoked. Please login again.`);

    req.user = { UserId: user.UserId, Username: user.Username, RoleId: user.RoleId, IsSuperAdmin: user.IsSuperAdmin }; // role changes apply immediately
    req.currentUser = user;
    req.location = location;
    req.locationId = location.LocationId;
    req.perms = new Map(perms.map((p) => [p.ScreenKey, p]));
    next();
  } catch (e) { next(e); }
}

/** Boolean permission check on the permissions loaded for this request */
export function hasPermission(req, screenKey, action = 'CanView') {
  if (req.user?.IsSuperAdmin) return true;
  return Boolean(req.perms?.get(screenKey)?.[action]);
}

/** Screen permission middleware, fail-closed: an unknown screen only lets super admins through */
export function requirePermission(screenKey, action = 'CanView') {
  return async (req, res, next) => {
    try {
      if (hasPermission(req, screenKey, action)) return next();
      const screen = req.perms?.get(screenKey) || (await one('SELECT ScreenName FROM dbo.Screens WHERE ScreenKey = @k', { k: screenKey }));
      if (!screen) throw new HttpError(403, `Screen '${screenKey}' is not configured`);
      throw new HttpError(403, `You do not have ${action.replace('Can', '').toLowerCase()} permission for ${screen.ScreenName}`);
    } catch (e) { next(e); }
  };
}
