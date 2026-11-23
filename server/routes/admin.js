// Lifetime members, users (role + location access, escalation-safe), roles, screens, permissions, audit log
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db, tx, getSettings } from '../db.js';
import { wrap, isBlank, toNum, toBool, str, pick, todayISO, ints } from '../util.js';
import { authMiddleware, requirePermission, loadUsers, loadUser, canAccessLocation, getPermissionsForRole } from '../auth.js';
import { bad, audit, likeArg, paging, defaultName, templeInLoc, validDate, insertRow, updateStamp, stampParams, stampColumns, attachStamps } from './common.js';
import { pubUser, enrichUsers } from './auth.js';

const router = Router();
const id = (v) => Number(v) || 0;
const count = async (sqlText, params) => (await db.one(sqlText, params))?.n || 0;

// ---------- LIFETIME MEMBERS (current location; member numbers restart every financial year) ----------
const MEMBER_FIELDS = ['MemberName', 'Mobile', 'Email', 'Address', 'TempleId', 'DeityId', 'PoojaName', 'NextPoojaDate', 'Frequency', 'Status'];
const MEMBER_SQL = `SELECT m.MemberId, m.MemberNumber, m.MemberName, m.Mobile, ISNULL(m.Email, N'') AS Email, ISNULL(m.Address, N'') AS Address, m.TempleId, m.DeityId,
    ISNULL(m.PoojaName, N'') AS PoojaName, CONVERT(CHAR(10), m.NextPoojaDate, 23) AS NextPoojaDate, m.Frequency, m.Status, m.LocationId, m.CreatedBy, m.CreatedAt, m.UpdatedAt,
    ISNULL(t.TempleName, N'') AS TempleName, ISNULL(d.DeityName, N'') AS DeityName
  FROM dbo.LifetimeMembers m LEFT JOIN dbo.Temples t ON t.TempleId = m.TempleId LEFT JOIN dbo.Deities d ON d.DeityId = m.DeityId`;
const memberHere = (req) => db.one(`${MEMBER_SQL} WHERE m.MemberId = @id AND m.LocationId = @l`, { id: id(req.params.id), l: req.locationId });
async function cleanMember(req, b, existing) {
  const s = await getSettings();
  if (b.MemberName !== undefined) { b.MemberName = str(b.MemberName).slice(0, 100); if (!b.MemberName) return 'Member name is required'; }
  if (b.Mobile !== undefined) { if (!new RegExp(s.mobilePattern || '^\\d{10}$').test(String(b.Mobile))) return 'Enter a valid mobile number'; b.Mobile = String(b.Mobile).trim(); }
  if (b.TempleId !== undefined) { b.TempleId = toNum(b.TempleId); if (b.TempleId && !(await templeInLoc(db, b.TempleId, req.locationId))) return 'Select a temple at this location'; }
  if (b.DeityId !== undefined) {
    b.DeityId = toNum(b.DeityId); const templeId = b.TempleId ?? existing?.TempleId;
    if (b.DeityId && (await db.one('SELECT TempleId FROM dbo.Deities WHERE DeityId = @d', { d: b.DeityId }))?.TempleId !== templeId) return 'Deity does not belong to the selected temple';
  }
  if (b.NextPoojaDate !== undefined) { if (isBlank(b.NextPoojaDate)) b.NextPoojaDate = null; else if (!validDate(b.NextPoojaDate)) return 'Next pooja date must be YYYY-MM-DD'; }
  if (b.Frequency !== undefined && !(await db.one('SELECT 1 AS x FROM dbo.MemberFrequencies WHERE FrequencyName = @n AND ISNULL(IsActive, 1) = 1', { n: String(b.Frequency) }))) return 'Invalid frequency';
  if (b.Status !== undefined && !(await db.one('SELECT 1 AS x FROM dbo.MemberStatuses WHERE StatusName = @n AND ISNULL(IsActive, 1) = 1', { n: String(b.Status) }))) return 'Invalid member status';
  for (const [f, n] of [['Email', 100], ['Address', 300], ['PoojaName', 100]]) if (b[f] !== undefined) b[f] = str(b[f]).slice(0, n);
  if (await db.one('SELECT 1 AS x FROM dbo.LifetimeMembers WHERE LocationId = @l AND Mobile = @m AND MemberName = @n AND MemberId <> @id',
    { l: req.locationId, m: String(b.Mobile ?? existing?.Mobile), n: b.MemberName ?? existing?.MemberName, id: existing?.MemberId || 0 })) return 'This member is already registered at this location';
  return null;
}
router.get('/members', authMiddleware, requirePermission('lifetime_members'), wrap(async (req, res) => {
  const w = ['m.LocationId = @l']; const p = { l: req.locationId };
  if (req.query.search) { w.push('(m.MemberName LIKE @s OR m.Mobile LIKE @s OR m.MemberNumber LIKE @s)'); p.s = likeArg(req.query.search); }
  if (req.query.status) { w.push('m.Status = @st'); p.st = String(req.query.status); }
  const where = w.join(' AND ');
  const pg = paging(req.query);
  if (!pg) return res.json(await attachStamps('LifetimeMembers', 'MemberId', await db.q(`${MEMBER_SQL} WHERE ${where} ORDER BY m.MemberId DESC`, p)));
  const total = await count(`SELECT COUNT(*) AS n FROM dbo.LifetimeMembers m WHERE ${where}`, p);
  const rows = await attachStamps('LifetimeMembers', 'MemberId', await db.q(`${MEMBER_SQL} WHERE ${where} ORDER BY m.MemberId DESC OFFSET ${pg.offset} ROWS FETCH NEXT ${pg.pageSize} ROWS ONLY`, p));
  res.json({ rows, total, page: pg.page, pageSize: pg.pageSize });
}));
router.post('/members', authMiddleware, requirePermission('lifetime_members', 'CanCreate'), wrap(async (req, res) => {
  const b = pick(req.body || {}, MEMBER_FIELDS);
  if (isBlank(b.MemberName) || isBlank(b.Mobile)) return bad(res, 'Member name and mobile are required');
  if (isBlank(b.Frequency)) b.Frequency = await defaultName(db, 'MemberFrequencies', 'FrequencyName');
  if (isBlank(b.Status)) b.Status = await defaultName(db, 'MemberStatuses', 'StatusName');
  const err = await cleanMember(req, b, null); if (err) return bad(res, err);
  const s = await getSettings();
  const memberId = await tx(async (t) => {
    const rec = { Email: '', Address: '', TempleId: null, DeityId: null, PoojaName: '', NextPoojaDate: null, ...b };
    const cols = Object.keys(rec);
    const row = await t.one(`DECLARE @no NVARCHAR(50); EXEC dbo.sp_NextNumber @Kind = N'MEMBER', @BusinessDate = @__d, @LocationId = @__l, @Number = @no OUTPUT;
      INSERT INTO dbo.LifetimeMembers (MemberNumber, LocationId, CreatedBy, CreatedAt, ${cols.join(', ')}) OUTPUT inserted.* VALUES (@no, @__l, @__u, GETDATE(), ${cols.map((c) => `@${c}`).join(', ')})`,
    { ...rec, __d: todayISO(s.timeZone), __l: req.locationId, __u: req.user.UserId });
    await audit(t, req, 'CREATE', 'LifetimeMembers', row.MemberId, null, row);
    return row.MemberId;
  });
  res.status(201).json(await attachStamps('LifetimeMembers', 'MemberId', await db.one(`${MEMBER_SQL} WHERE m.MemberId = @id`, { id: memberId })));
}));
router.put('/members/:id', authMiddleware, requirePermission('lifetime_members', 'CanEdit'), wrap(async (req, res) => {
  const rec = await memberHere(req); if (!rec) return bad(res, 'Member not found at this location', 404);
  const b = pick(req.body || {}, MEMBER_FIELDS); const err = await cleanMember(req, b, rec); if (err) return bad(res, err);
  await tx(async (t) => {
    const cols = Object.keys(b);
    if (cols.length) await t.exec(`UPDATE dbo.LifetimeMembers SET ${cols.map((c) => `${c} = @${c}`).join(', ')}${await updateStamp('LifetimeMembers')} WHERE MemberId = @__id`, { ...b, __id: rec.MemberId, ...stampParams(req) });
    await audit(t, req, 'UPDATE', 'LifetimeMembers', rec.MemberId, rec, b);
  });
  res.json(await attachStamps('LifetimeMembers', 'MemberId', await memberHere(req)));
}));
router.delete('/members/:id', authMiddleware, requirePermission('lifetime_members', 'CanDelete'), wrap(async (req, res) => {
  const rec = await memberHere(req); if (!rec) return bad(res, 'Member not found at this location', 404);
  await tx(async (t) => { await t.exec('DELETE FROM dbo.LifetimeMembers WHERE MemberId = @id', { id: rec.MemberId }); await audit(t, req, 'DELETE', 'LifetimeMembers', rec.MemberId, rec, null); });
  res.json({ message: 'Member deleted' });
}));

// ---------- USERS ----------
const USER_FIELDS = ['FullName', 'Mobile', 'Email', 'RoleId', 'IsActive'];
async function resolveAccess(req, body, existing) {
  const all = body.AllLocations !== undefined ? toBool(body.AllLocations) : existing ? !!existing.AllLocations : false;
  let ids = body.LocationIds !== undefined ? body.LocationIds : existing ? existing.LocationIds || [] : [req.locationId];
  if (!Array.isArray(ids)) return { error: 'LocationIds must be a list' };
  ids = ints(ids).sort((a, b) => a - b);
  const known = new Map((await db.q('SELECT LocationId, LocationName FROM dbo.Locations')).map((l) => [l.LocationId, l.LocationName]));
  if (ids.some((x) => !known.has(x))) return { error: 'One or more selected locations do not exist' };
  if (!all && !ids.length) return { error: 'Select at least one location or grant access to all locations' };
  const before = existing?.LocationIds || [];
  const changed = !existing || all !== !!existing.AllLocations || ids.join(',') !== [...before].sort((a, b) => a - b).join(',');
  const me = req.currentUser;
  if (changed && !me.IsSuperAdmin && !me.AllLocations) {
    if (all && !existing?.AllLocations) return { error: 'You can only grant access to locations you have access to' };
    const outside = ids.filter((x) => !before.includes(x) && !(me.LocationIds || []).includes(x)); // only newly granted ones
    if (outside.length) return { error: `You cannot grant access to: ${outside.map((x) => known.get(x)).join(', ')}` };
  }
  return { AllLocations: all, LocationIds: all ? [] : ids };
}
const saveLocations = async (t, userId, access, req) => {
  const keep = access.AllLocations ? [] : [...new Set(access.LocationIds.map(Number).filter(Number.isInteger))];
  await t.exec(`DELETE FROM dbo.UserLocations WHERE UserId = @u${keep.length ? ` AND LocationId NOT IN (${keep.join(', ')})` : ''}`, { u: userId });
  if (!keep.length) return;
  const has = await stampColumns('UserLocations'); // who granted the access, and when
  const extra = [has.has('CreatedBy') && ['CreatedBy', '@__uid'], has.has('CreatedAt') && ['CreatedAt', 'GETDATE()']].filter(Boolean);
  await t.exec(`INSERT INTO dbo.UserLocations (UserId, LocationId${extra.map(([c]) => `, ${c}`).join('')})
    SELECT @u, v.l${extra.map(([, v]) => `, ${v}`).join('')} FROM (VALUES ${keep.map((l) => `(${l})`).join(', ')}) v (l)
    WHERE NOT EXISTS (SELECT 1 FROM dbo.UserLocations x WHERE x.UserId = @u AND x.LocationId = v.l)`, { u: userId, ...stampParams(req) });
};
const userOut = async (userId) => (await attachStamps('Users', 'UserId', await enrichUsers(db, [await loadUser(userId)])))[0];
router.get('/users', authMiddleware, requirePermission('user_mgmt'), wrap(async (req, res) => {
  const users = await loadUsers();
  res.json(await attachStamps('Users', 'UserId', (await enrichUsers(db, users)).map((u, i) => ({ ...u, CanAccessCurrent: canAccessLocation(users[i], req.locationId) }))));
}));
router.get('/users/lookup', authMiddleware, wrap(async (req, res) => {
  const users = await loadUsers('WHERE ISNULL(u.IsActive, 1) = 1');
  res.json(users.filter((u) => canAccessLocation(u, req.locationId)).map((u) => ({ UserId: u.UserId, FullName: u.FullName, Username: u.Username })));
}));
router.post('/users', authMiddleware, requirePermission('user_mgmt', 'CanCreate'), wrap(async (req, res) => {
  const body = req.body || {}; const b = pick(body, USER_FIELDS);
  const username = str(body.Username).slice(0, 50);
  if (!username || isBlank(body.Password) || isBlank(b.RoleId)) return bad(res, 'Username, password and role are required');
  if (String(body.Password).length < 6) return bad(res, 'Password must be at least 6 characters');
  if (await db.one('SELECT 1 AS x FROM dbo.Users WHERE Username = @n', { n: username })) return bad(res, 'Username already exists');
  const role = await db.one('SELECT * FROM dbo.Roles WHERE RoleId = @r', { r: id(b.RoleId) });
  if (!role || role.IsActive === false) return bad(res, 'Select a valid role');
  if (role.IsSuperAdmin && !req.user.IsSuperAdmin) return bad(res, 'Only a super admin can assign a super admin role', 403);
  const access = await resolveAccess(req, body, null); if (access.error) return bad(res, access.error);
  const hash = await bcrypt.hash(String(body.Password), 10);
  const userId = await tx(async (t) => {
    const row = await insertRow(t, 'Users', { Username: username, PasswordHash: hash, FullName: str(b.FullName || username).slice(0, 100), Mobile: str(b.Mobile).slice(0, 15),
      Email: str(b.Email).slice(0, 100), RoleId: role.RoleId, IsActive: b.IsActive !== false && b.IsActive !== 'false', AllLocations: access.AllLocations }, req);
    await saveLocations(t, row.UserId, access, req);
    await audit(t, req, 'CREATE', 'Users', row.UserId, null, { Username: username, RoleId: role.RoleId, ...access });
    return row.UserId;
  });
  res.status(201).json(await userOut(userId));
}));
router.put('/users/:id', authMiddleware, requirePermission('user_mgmt', 'CanEdit'), wrap(async (req, res) => {
  const rec = await loadUser(req.params.id); if (!rec) return bad(res, 'User not found', 404);
  const body = req.body || {}; const b = pick(body, USER_FIELDS); const self = rec.UserId === req.user.UserId;
  if (rec.IsSuperAdmin && !req.user.IsSuperAdmin) return bad(res, 'Only a super admin can edit a super admin user', 403);
  if (b.RoleId !== undefined) {
    b.RoleId = Number(b.RoleId); const role = await db.one('SELECT * FROM dbo.Roles WHERE RoleId = @r', { r: b.RoleId || 0 }); if (!role) return bad(res, 'Select a valid role');
    if (self && b.RoleId !== rec.RoleId) return bad(res, 'You cannot change your own role');
    if (role.IsSuperAdmin && !req.user.IsSuperAdmin) return bad(res, 'Only a super admin can assign a super admin role', 403);
  }
  if (b.IsActive !== undefined) { b.IsActive = toBool(b.IsActive); if (self && !b.IsActive) return bad(res, 'You cannot deactivate your own account'); }
  const access = await resolveAccess(req, body, rec); if (access.error) return bad(res, access.error);
  if (self && !rec.IsSuperAdmin && !access.AllLocations && !access.LocationIds.includes(req.locationId)) return bad(res, 'You cannot remove your own access to the location you are signed in to');
  if (!isBlank(body.Password) && String(body.Password).length < 6) return bad(res, 'Password must be at least 6 characters');
  for (const [f, n] of [['FullName', 100], ['Mobile', 15], ['Email', 100]]) if (b[f] !== undefined) b[f] = str(b[f]).slice(0, n);
  const patch = { ...b, AllLocations: access.AllLocations };
  if (!isBlank(body.Password)) patch.PasswordHash = await bcrypt.hash(String(body.Password), 10);
  await tx(async (t) => {
    const cols = Object.keys(patch);
    await t.exec(`UPDATE dbo.Users SET ${cols.map((c) => `${c} = @${c}`).join(', ')}${await updateStamp('Users')} WHERE UserId = @__id`, { ...patch, __id: rec.UserId, ...stampParams(req) });
    await saveLocations(t, rec.UserId, access, req);
    await audit(t, req, 'UPDATE', 'Users', rec.UserId, pubUser(rec), { ...b, ...access, PasswordChanged: !isBlank(body.Password) });
  });
  res.json(await userOut(rec.UserId));
}));
// Records that name this user as creator / editor / canceller (the user's own row and own location rows excluded).
async function userReferences(userId) {
  const cols = await db.q(`SELECT c.TABLE_NAME AS t, c.COLUMN_NAME AS c FROM INFORMATION_SCHEMA.COLUMNS c JOIN INFORMATION_SCHEMA.TABLES tb ON tb.TABLE_NAME = c.TABLE_NAME AND tb.TABLE_SCHEMA = c.TABLE_SCHEMA
    WHERE c.TABLE_SCHEMA = N'dbo' AND tb.TABLE_TYPE = 'BASE TABLE' AND c.COLUMN_NAME IN (N'CreatedBy', N'UpdatedBy', N'CancelledBy')`);
  const byTable = cols.reduce((m, r) => m.set(r.t, [...(m.get(r.t) || []), r.c]), new Map());
  if (!byTable.size) return [];
  const own = { Users: ' AND UserId <> @u', UserLocations: ' AND UserId <> @u' };
  const parts = [...byTable].map(([tbl, cs]) => `SELECT N'${tbl}' AS t, COUNT(*) AS n FROM dbo.${tbl} WHERE (${cs.map((c) => `${c} = @u`).join(' OR ')})${own[tbl] || ''}`);
  return (await db.q(parts.join(' UNION ALL '), { u: userId })).filter((r) => r.n > 0);
}
router.delete('/users/:id', authMiddleware, requirePermission('user_mgmt', 'CanDelete'), wrap(async (req, res) => {
  const rec = await loadUser(req.params.id); if (!rec) return bad(res, 'User not found', 404);
  if (rec.UserId === req.user.UserId) return bad(res, 'You cannot delete your own account');
  if (rec.IsSuperAdmin && !req.user.IsSuperAdmin) return bad(res, 'Only a super admin can delete a super admin user', 403);
  const refs = await userReferences(rec.UserId);
  if (refs.length) return bad(res, `This user has created or changed records (${refs.slice(0, 4).map((r) => `${r.t}: ${r.n}`).join(', ')}${refs.length > 4 ? ', ...' : ''}). Deactivate the account instead, so the record of who did what stays intact.`);
  await tx(async (t) => {
    await t.exec(`UPDATE dbo.Counters SET AssignedUserId = NULL WHERE AssignedUserId = @u;
      UPDATE dbo.AuditLog SET UserId = NULL WHERE UserId = @u;
      DELETE FROM dbo.UserLocations WHERE UserId = @u; DELETE FROM dbo.Users WHERE UserId = @u;`, { u: rec.UserId });
    await audit(t, req, 'DELETE', 'Users', rec.UserId, pubUser(rec), null);
  });
  res.json({ message: 'User deleted' });
}));

// ---------- ROLES ----------
router.get('/roles', authMiddleware, wrap(async (req, res) => {
  res.json(await db.q('SELECT r.*, (SELECT COUNT(*) FROM dbo.Users u WHERE u.RoleId = r.RoleId) AS UserCount FROM dbo.Roles r ORDER BY r.RoleId'));
}));
router.post('/roles', authMiddleware, requirePermission('screen_allocation', 'CanCreate'), wrap(async (req, res) => {
  const b = req.body || {}; const name = str(b.RoleName).slice(0, 50);
  if (!name) return bad(res, 'Role name is required');
  if (await db.one('SELECT 1 AS x FROM dbo.Roles WHERE RoleName = @n', { n: name })) return bad(res, 'Role already exists');
  if (toBool(b.IsSuperAdmin) && !req.user.IsSuperAdmin) return bad(res, 'Only a super admin can create a super admin role', 403);
  const row = await tx(async (t) => {
    const r = await insertRow(t, 'Roles', { RoleName: name, Description: str(b.Description).slice(0, 200), IsActive: b.IsActive !== false && b.IsActive !== 'false', IsSuperAdmin: toBool(b.IsSuperAdmin) }, req);
    await audit(t, req, 'CREATE', 'Roles', r.RoleId, null, r); return r;
  });
  res.status(201).json(row);
}));
router.put('/roles/:id', authMiddleware, requirePermission('screen_allocation', 'CanEdit'), wrap(async (req, res) => {
  const rec = await db.one('SELECT * FROM dbo.Roles WHERE RoleId = @r', { r: id(req.params.id) }); if (!rec) return bad(res, 'Role not found', 404);
  const b = pick(req.body || {}, ['RoleName', 'Description', 'IsActive', 'IsSuperAdmin']); const own = rec.RoleId === req.user.RoleId;
  if (b.RoleName !== undefined) {
    b.RoleName = str(b.RoleName).slice(0, 50); if (!b.RoleName) return bad(res, 'Role name is required');
    if (await db.one('SELECT 1 AS x FROM dbo.Roles WHERE RoleName = @n AND RoleId <> @r', { n: b.RoleName, r: rec.RoleId })) return bad(res, 'Role already exists');
  }
  if (b.IsSuperAdmin !== undefined) {
    b.IsSuperAdmin = toBool(b.IsSuperAdmin);
    if (b.IsSuperAdmin !== !!rec.IsSuperAdmin) { if (!req.user.IsSuperAdmin) return bad(res, 'Only a super admin can change the super admin flag', 403); if (own) return bad(res, 'You cannot change the super admin flag of your own role'); }
  }
  if (b.IsActive !== undefined) { b.IsActive = toBool(b.IsActive); if (own && !b.IsActive) return bad(res, 'You cannot deactivate your own role'); }
  if (b.Description !== undefined) b.Description = str(b.Description).slice(0, 200);
  const row = await tx(async (t) => {
    const cols = Object.keys(b);
    const r = cols.length ? await t.one(`UPDATE dbo.Roles SET ${cols.map((c) => `${c} = @${c}`).join(', ')}${await updateStamp('Roles')} OUTPUT inserted.* WHERE RoleId = @__id`, { ...b, __id: rec.RoleId, ...stampParams(req) }) : rec;
    await audit(t, req, 'UPDATE', 'Roles', rec.RoleId, rec, r); return r;
  });
  res.json(row);
}));
router.delete('/roles/:id', authMiddleware, requirePermission('screen_allocation', 'CanDelete'), wrap(async (req, res) => {
  const rec = await db.one('SELECT * FROM dbo.Roles WHERE RoleId = @r', { r: id(req.params.id) }); if (!rec) return bad(res, 'Role not found', 404);
  if (rec.RoleId === req.user.RoleId) return bad(res, 'You cannot delete your own role');
  if (await count('SELECT COUNT(*) AS n FROM dbo.Users WHERE RoleId = @r', { r: rec.RoleId })) return bad(res, 'Role has users. Reassign them first.');
  await tx(async (t) => { await t.exec('DELETE FROM dbo.ScreenPermissions WHERE RoleId = @r; DELETE FROM dbo.Roles WHERE RoleId = @r;', { r: rec.RoleId }); await audit(t, req, 'DELETE', 'Roles', rec.RoleId, rec, null); });
  res.json({ message: 'Role deleted' });
}));

// ---------- SCREENS (names, groups and order are editable - the navigation is built from this) ----------
router.get('/screens', authMiddleware, wrap(async (req, res) => {
  res.json(await db.q(`SELECT * FROM dbo.Screens${req.query.all === 'true' ? '' : ' WHERE ISNULL(IsActive, 1) = 1'} ORDER BY ISNULL(DisplayOrder, 0), ScreenId`));
}));
router.put('/screens/:id', authMiddleware, requirePermission('screen_allocation', 'CanEdit'), wrap(async (req, res) => {
  const rec = await db.one('SELECT * FROM dbo.Screens WHERE ScreenId = @s', { s: id(req.params.id) }); if (!rec) return bad(res, 'Screen not found', 404);
  const b = pick(req.body || {}, ['ScreenName', 'ScreenGroup', 'DisplayOrder', 'IsActive']);
  if (b.ScreenName !== undefined) { b.ScreenName = str(b.ScreenName).slice(0, 100); if (!b.ScreenName) return bad(res, 'Screen name is required'); }
  if (b.ScreenGroup !== undefined) b.ScreenGroup = str(b.ScreenGroup).slice(0, 50);
  if (b.DisplayOrder !== undefined) b.DisplayOrder = Number(b.DisplayOrder) || 0;
  if (b.IsActive !== undefined) b.IsActive = toBool(b.IsActive);
  const row = await tx(async (t) => {
    const cols = Object.keys(b);
    const r = cols.length ? await t.one(`UPDATE dbo.Screens SET ${cols.map((c) => `${c} = @${c}`).join(', ')}${await updateStamp('Screens')} OUTPUT inserted.* WHERE ScreenId = @__id`, { ...b, __id: rec.ScreenId, ...stampParams(req) }) : rec;
    await audit(t, req, 'UPDATE', 'Screens', rec.ScreenId, rec, r); return r;
  });
  res.json(row);
}));

// ---------- PERMISSIONS ----------
router.get('/permissions', authMiddleware, wrap(async (req, res) => {
  const p = {}; let where = '';
  if (req.query.roleId) { where = ' WHERE p.RoleId = @r'; p.r = id(req.query.roleId); }
  res.json(await db.q(`SELECT p.PermissionId, p.RoleId, p.ScreenId, CAST(ISNULL(p.CanView, 0) AS BIT) AS CanView, CAST(ISNULL(p.CanCreate, 0) AS BIT) AS CanCreate,
      CAST(ISNULL(p.CanEdit, 0) AS BIT) AS CanEdit, CAST(ISNULL(p.CanDelete, 0) AS BIT) AS CanDelete, s.ScreenName, s.ScreenKey, r.RoleName
    FROM dbo.ScreenPermissions p JOIN dbo.Screens s ON s.ScreenId = p.ScreenId JOIN dbo.Roles r ON r.RoleId = p.RoleId${where} ORDER BY p.RoleId, s.DisplayOrder`, p));
}));
async function upsertPerm(t, roleId, p, req) {
  const has = await stampColumns('ScreenPermissions');
  const ins = [has.has('CreatedBy') && ['CreatedBy', '@__uid'], has.has('CreatedAt') && ['CreatedAt', 'GETDATE()']].filter(Boolean);
  const params = { r: roleId, s: Number(p.ScreenId), cv: toBool(p.CanView), cc: toBool(p.CanCreate), ce: toBool(p.CanEdit), cd: toBool(p.CanDelete), ...stampParams(req) };
  const row = await t.one(`MERGE dbo.ScreenPermissions WITH (HOLDLOCK) AS x USING (SELECT @r AS RoleId, @s AS ScreenId) AS v ON x.RoleId = v.RoleId AND x.ScreenId = v.ScreenId
  WHEN MATCHED AND (ISNULL(x.CanView, 0) <> @cv OR ISNULL(x.CanCreate, 0) <> @cc OR ISNULL(x.CanEdit, 0) <> @ce OR ISNULL(x.CanDelete, 0) <> @cd)
    THEN UPDATE SET CanView = @cv, CanCreate = @cc, CanEdit = @ce, CanDelete = @cd${await updateStamp('ScreenPermissions')}
  WHEN NOT MATCHED THEN INSERT (RoleId, ScreenId, CanView, CanCreate, CanEdit, CanDelete${ins.map(([c]) => `, ${c}`).join('')}) VALUES (@r, @s, @cv, @cc, @ce, @cd${ins.map(([, v]) => `, ${v}`).join('')})
  OUTPUT inserted.*;`, params);
  return row || t.one('SELECT * FROM dbo.ScreenPermissions WHERE RoleId = @r AND ScreenId = @s', params); // unchanged row
}
router.put('/permissions', authMiddleware, requirePermission('screen_allocation', 'CanEdit'), wrap(async (req, res) => {
  const { RoleId, ScreenId } = req.body || {};
  if (!(await db.one('SELECT 1 AS x FROM dbo.Roles WHERE RoleId = @r', { r: id(RoleId) })) || !(await db.one('SELECT 1 AS x FROM dbo.Screens WHERE ScreenId = @s', { s: id(ScreenId) }))) return bad(res, 'Valid RoleId and ScreenId are required');
  const perm = await tx(async (t) => { const r = await upsertPerm(t, id(RoleId), req.body, req); await audit(t, req, 'UPDATE', 'ScreenPermissions', r.PermissionId, null, r); return r; });
  res.json(perm);
}));
router.put('/permissions/bulk', authMiddleware, requirePermission('screen_allocation', 'CanEdit'), wrap(async (req, res) => {
  const { RoleId, permissions } = req.body || {};
  if (!(await db.one('SELECT 1 AS x FROM dbo.Roles WHERE RoleId = @r', { r: id(RoleId) })) || !Array.isArray(permissions)) return bad(res, 'Valid RoleId and permissions list are required');
  const screens = new Set((await db.q('SELECT ScreenId FROM dbo.Screens')).map((s) => s.ScreenId));
  await tx(async (t) => {
    for (const p of permissions.filter((x) => screens.has(Number(x.ScreenId)))) await upsertPerm(t, id(RoleId), p, req);
    await audit(t, req, 'UPDATE', 'ScreenPermissions', id(RoleId), null, { RoleId, count: permissions.length });
  });
  res.json({ message: 'Permissions updated', permissions: await getPermissionsForRole(id(RoleId)) });
}));

// ---------- AUDIT LOG ----------
router.get('/audit-log', authMiddleware, requirePermission('screen_allocation'), wrap(async (req, res) => {
  res.json(await db.q(`SELECT TOP 200 a.*, ISNULL(u.Username, N'') AS Username FROM dbo.AuditLog a LEFT JOIN dbo.Users u ON u.UserId = a.UserId
    ${req.user.IsSuperAdmin ? '' : 'WHERE a.LocationId = @l'} ORDER BY a.LogId DESC`, { l: req.locationId }));
}));

export default router;
