// In-memory data store — ALL data comes from seed.json (no entity data, names or lookups in code).
// NOTE: the API currently runs on this in-memory store (data resets on restart).
// database/init.sql contains the matching MSSQL schema + seed for the SQL-backed deployment.
import bcrypt from 'bcryptjs';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(readFileSync(path.join(__dirname, 'seed.json'), 'utf-8'));

let seq = 10000;
export const nextId = () => ++seq;
const now = () => new Date().toISOString();

export const store = {
  settings: seed.settings || {},
  locations: (seed.locations || []).map(r => ({ ...r, CreatedAt: now() })),
  roles: [...(seed.roles || [])],
  screens: [...(seed.screens || [])],
  permissions: (seed.permissions || []).map((p, i) => ({ PermissionId: i + 1, ...p })),
  users: [],
  temples: [...(seed.temples || [])],
  deities: [...(seed.deities || [])],
  sevaCategories: [...(seed.sevaCategories || [])],
  sevas: (seed.sevas || []).map(r => ({ ...r, CreatedAt: now() })),
  counters: [...(seed.counters || [])],
  bookingTypes: [...(seed.bookingTypes || [])],
  paymentModes: [...(seed.paymentModes || [])],
  bookingStatuses: [...(seed.bookingStatuses || [])],
  memberFrequencies: [...(seed.memberFrequencies || [])],
  memberStatuses: [...(seed.memberStatuses || [])],
  timeSlots: [...(seed.timeSlots || [])],
  items: [...(seed.items || [])],          // Item Master — items for non-seva booking types (e.g. Laddu, Goshala), per location
  members: (seed.members || []).map(r => ({ ...r, CreatedAt: now() })),
  bookings: [...(seed.bookings || [])],
  auditLog: [],
};

// Hash seed passwords at startup (plain passwords live only in seed.json, never in code)
for (const u of seed.users || []) {
  store.users.push({
    UserId: u.UserId, Username: u.Username,
    PasswordHash: bcrypt.hashSync(u.Password, 10),
    FullName: u.FullName, Mobile: u.Mobile, Email: u.Email,
    RoleId: u.RoleId, IsActive: u.IsActive !== false,
    AllLocations: u.AllLocations === true,                                   // explicit flag — never inferred
    LocationIds: Array.isArray(u.LocationIds) ? u.LocationIds.map(Number) : [], // used when AllLocations = false
    CreatedAt: now(), UpdatedAt: now(),
  });
}

// Keep seq above every seeded id so new records never collide
const allIds = Object.values(store).filter(Array.isArray).flat().flatMap(r => Object.entries(r).filter(([k, v]) => k.endsWith('Id') && typeof v === 'number').map(([, v]) => v));
seq = Math.max(seq, ...allIds, 0);

export function getDefault(list) {
  return list.find(x => x.IsDefault && x.IsActive) || list.find(x => x.IsActive) || list[0] || null;
}

// "Today" in the configured time zone (settings.timeZone) — avoids UTC date drift
export function todayISO() {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: store.settings.timeZone || undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
  catch { return new Date().toISOString().slice(0, 10); }
}

// Current time HH:MM in the configured time zone
export function nowHHMM() {
  try { return new Intl.DateTimeFormat('en-GB', { timeZone: store.settings.timeZone || undefined, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()); }
  catch { return new Date().toTimeString().slice(0, 5); }
}

const maxSeq = (values, prefix) => values.filter(v => v && v.startsWith(prefix)).reduce((m, v) => Math.max(m, Number(v.slice(prefix.length)) || 0), 0);

export function genBookingNumber() {
  const prefix = `${store.settings.bookingNumberPrefix || 'BK'}-${todayISO().replaceAll('-', '')}-`;
  return prefix + String(maxSeq(store.bookings.map(b => b.BookingNumber), prefix) + 1).padStart(4, '0');
}

export function genTokenNumber(typeName) {
  // Token prefix comes from the BookingTypes master (dynamic — no hardcoded map)
  const type = store.bookingTypes.find(t => t.TypeName === typeName);
  const prefix = `${type?.TokenPrefix || store.settings.fallbackTokenPrefix || 'TK'}-`;
  return prefix + String(maxSeq(store.bookings.map(b => b.TokenNumber), prefix) + 1).padStart(5, '0');
}

export function genMemberNumber() {
  const prefix = `${store.settings.memberNumberPrefix || 'MEM'}-`;
  return prefix + String(maxSeq(store.members.map(m => m.MemberNumber), prefix) + 1).padStart(5, '0');
}

export function audit(userId, action, table, recordId, oldV, newV, ip, locationId = null) {
  store.auditLog.push({ LogId: store.auditLog.length + 1, UserId: userId, LocationId: locationId, Action: action, TableName: table, RecordId: recordId, OldValues: oldV ? JSON.stringify(oldV) : null, NewValues: newV ? JSON.stringify(newV) : null, IPAddress: ip, CreatedAt: now() });
}
