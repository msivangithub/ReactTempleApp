// Small shared helpers (no data access here)
export const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';
export const toNum = (v) => (isBlank(v) ? null : Number(v));
export const toBool = (v) => v === true || v === 'true' || v === 1 || v === '1';
export const str = (v) => (isBlank(v) ? '' : String(v).trim());
export const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
export const pick = (obj, fields) => Object.fromEntries(fields.filter((f) => obj && obj[f] !== undefined).map((f) => [f, obj[f]]));
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const ints = (list) => [...new Set((list || []).map(Number).filter((n) => Number.isInteger(n)))];

/** "Today" (YYYY-MM-DD) in the configured time zone (AppSettings.timeZone) - avoids UTC date drift */
export function todayISO(timeZone) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
  catch { return new Date().toISOString().slice(0, 10); }
}
/** Current time HH:MM in the configured time zone */
export function nowHHMM(timeZone) {
  try { return new Intl.DateTimeFormat('en-GB', { timeZone: timeZone || undefined, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()); }
  catch { return new Date().toTimeString().slice(0, 5); }
}

/** Financial year of a date, e.g. 2026-11-21 with start month 4 -> { start: 2026, label: '2026-27', from: '2026-04-01', to: '2027-03-31' } */
export function financialYear(dateISO, startMonth = 4) {
  const m = Math.min(12, Math.max(1, Number(startMonth) || 4));
  const [y, mo] = dateISO.split('-').map(Number);
  const start = mo < m ? y - 1 : y;
  const pad = (n) => String(n).padStart(2, '0');
  const endMonth = m === 1 ? 12 : m - 1;
  const endYear = m === 1 ? start : start + 1;
  const lastDay = new Date(Date.UTC(endYear, endMonth, 0)).getUTCDate();
  return { start, label: m === 1 ? String(start) : `${start}-${String(start + 1).slice(2)}`, from: `${start}-${pad(m)}-01`, to: `${endYear}-${pad(endMonth)}-${pad(lastDay)}` };
}

/** Error with an HTTP status that is safe to show to the user */
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; this.expose = true; }
}
export const fail = (status, message) => { throw new HttpError(status, message); };
/** Express wrapper for async handlers: rejected promises go to the error middleware */
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
