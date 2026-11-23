// API client + formatters. Formatting rules (currency, locale, time zone, mobile pattern)
// come from the server's /public/config (settings master) — nothing is hardcoded here.
const BASE = '/api';
const fmt = { currencySymbol: '', locale: undefined, timeZone: undefined, mobilePattern: '' };

export function setFormat(cfg = {}) {
  ['currencySymbol', 'locale', 'timeZone', 'mobilePattern'].forEach((k) => { if (cfg[k]) fmt[k] = cfg[k]; });
}

export async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const token = localStorage.getItem('temple_token');
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
  if (!res.ok) {
    // Session no longer valid (user deactivated, location revoked, token expired) → global logout
    if (res.status === 401 && token && !path.startsWith('/auth/login')) window.dispatchEvent(new CustomEvent('auth:expired', { detail: data.error }));
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

export const get = (p) => api(p);
export const post = (p, body) => api(p, { method: 'POST', body: JSON.stringify(body) });
export const put = (p, body) => api(p, { method: 'PUT', body: JSON.stringify(body) });
export const del = (p) => api(p, { method: 'DELETE' });

export const money = (n) => `${fmt.currencySymbol}${Number(n || 0).toLocaleString(fmt.locale)}`;
const dateIn = (d) => { try { return new Intl.DateTimeFormat('en-CA', { timeZone: fmt.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); } catch { return d.toISOString().slice(0, 10); } };
export const todayISO = () => dateIn(new Date());
export const addDaysISO = (days) => dateIn(new Date(Date.now() + days * 86400000));
export const nowHHMM = () => { try { return new Intl.DateTimeFormat('en-GB', { timeZone: fmt.timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()); } catch { return new Date().toTimeString().slice(0, 5); } };
export const isValidMobile = (m) => (fmt.mobilePattern ? new RegExp(fmt.mobilePattern).test(String(m || '')) : String(m || '').trim().length > 0);
export const fmtDate = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString(fmt.locale, { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const fmtDateTime = (v) => {
  if (!v) return '';
  const d = new Date(v); if (Number.isNaN(d.getTime())) return '';
  const o = { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' };
  try { return d.toLocaleString(fmt.locale || undefined, { ...o, timeZone: fmt.timeZone || undefined }); } catch { return d.toLocaleString(undefined, o); }
};
export const fmtTime = (t) => {
  if (!t) return '—';
  const [h, m] = String(t).split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(fmt.locale, { hour: 'numeric', minute: '2-digit' });
};

// UPI payment link for the receipt QR. With "am" present and no "mam", UPI apps show the amount as fixed.
// "tr" (transaction ref) is a merchant field - only added when AppSettings.upiIncludeTxnRef is on (merchant UPI IDs);
// several apps decline personal UPI IDs that carry it. The booking reference always travels in the note (tn).
export function upiLink({ vpa, name, amount, note, ref, includeRef = false }) {
  const enc = (v) => encodeURIComponent(v).replace(/%40/g, '@'); // keep "@" readable for older apps; spaces become %20
  const clean = (s, n) => String(s ?? '').replace(/[&?#=%+]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
  const parts = [`pa=${enc(String(vpa).trim())}`];
  if (clean(name, 50)) parts.push(`pn=${enc(clean(name, 50))}`);
  parts.push(`am=${Number(amount).toFixed(2)}`, 'cu=INR');
  if (clean(note, 80)) parts.push(`tn=${enc(clean(note, 80))}`);
  const tr = String(ref ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 35);
  if (includeRef && tr) parts.push(`tr=${tr}`);
  return `upi://pay?${parts.join('&')}`;
}
