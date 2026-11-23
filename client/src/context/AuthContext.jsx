import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { get, post, setFormat } from '../api.js';

const AuthContext = createContext(null);
const KEYS = { token: 'temple_token', user: 'temple_user', perms: 'temple_perms', location: 'temple_location', locations: 'temple_locations', last: 'temple_last_location' };
const read = (k, fallback) => { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } };
const write = (k, v) => localStorage.setItem(k, JSON.stringify(v ?? null));

// Extract dominant primary & deep brand colors from logo image and apply to CSS variables
function applyLogoTheme(url) {
  if (!url || typeof document === 'undefined') return;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    try {
      const c = document.createElement('canvas');
      const size = 48;
      c.width = size; c.height = size;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, size, size);
      const { data } = ctx.getImageData(0, 0, size, size);

      const buckets = new Map();
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
        if (a < 180) continue; // skip transparent
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const lum = (max + min) / 2;
        const sat = max === min ? 0 : (max - min) / (lum > 127 ? 510 - max - min : max + min);
        if (lum > 235 || lum < 20 || sat < 0.22) continue; // skip white, near-black, and grays
        const key = `${Math.round(r / 24) * 24},${Math.round(g / 24) * 24},${Math.round(b / 24) * 24}`;
        const prev = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0, sat };
        buckets.set(key, { count: prev.count + 1, r: prev.r + r, g: prev.g + g, b: prev.b + b, sat: Math.max(prev.sat, sat) });
      }
      if (!buckets.size) return;

      const sorted = [...buckets.values()].sort((a, b) => (b.count * (1 + b.sat)) - (a.count * (1 + a.sat)));
      const top = sorted[0];
      const pr = Math.round(top.r / top.count), pg = Math.round(top.g / top.count), pb = Math.round(top.b / top.count);

      // Look for a secondary darker/contrasting brand color, or derive a deep shade from primary
      const second = sorted.slice(1).find((x) => {
        const sr = x.r / x.count, sg = x.g / x.count, sb = x.b / x.count;
        return Math.hypot(pr - sr, pg - sg, pb - sb) > 65;
      });
      const dr = second ? Math.round((second.r / second.count) * 0.65) : Math.round(pr * 0.45);
      const dg = second ? Math.round((second.g / second.count) * 0.65) : Math.round(pg * 0.45);
      const db = second ? Math.round((second.b / second.count) * 0.65) : Math.round(pb * 0.45);

      const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));
      const rgb = (r, g, b) => `rgb(${clamp(r)}, ${clamp(g)}, ${clamp(b)})`;
      const rgba = (r, g, b, alpha) => `rgba(${clamp(r)}, ${clamp(g)}, ${clamp(b)}, ${alpha})`;

      const root = document.documentElement.style;
      root.setProperty('--primary', rgb(pr, pg, pb));
      root.setProperty('--primary-dark', rgb(pr * 0.82, pg * 0.82, pb * 0.82));
      root.setProperty('--primary-tint', rgba(pr, pg, pb, 0.08));
      root.setProperty('--primary-border', rgba(pr, pg, pb, 0.28));
      root.setProperty('--primary-ring', rgba(pr, pg, pb, 0.14));
      root.setProperty('--brand-mid', rgb(dr, dg, db));
      root.setProperty('--brand-deep', rgb(dr * 0.62, dg * 0.62, db * 0.62));
    } catch {
      // Ignore CORS-tainted canvas if external logo lacks Access-Control-Allow-Origin
    }
  };
  img.src = url;
}

export function AuthProvider({ children }) {
  const [config, setConfig] = useState(null);           // settings + active locations from DB
  const [configError, setConfigError] = useState('');
  const [user, setUser] = useState(() => read(KEYS.user, null));
  const [permissions, setPermissions] = useState(() => read(KEYS.perms, []));
  const [location, setLocation] = useState(() => read(KEYS.location, null)); // location chosen at login
  const [locations, setLocations] = useState(() => read(KEYS.locations, [])); // locations this user may switch to
  const [loading, setLoading] = useState(false);
  const [sessionMessage, setSessionMessage] = useState('');

  const reloadConfig = useCallback(async () => {
    try {
      const c = await get('/public/config');
      setFormat(c);
      setConfig(c);
      setConfigError('');
      applyLogoTheme(c?.brandIconUrl || c?.brandLogoUrl);
      return c;
    } catch (e) {
      setConfigError(e.message);
      setConfig((prev) => prev || { locations: [] });
      return null;
    }
  }, []);

  const apply = useCallback((data) => {
    if (data.token) localStorage.setItem(KEYS.token, data.token);
    write(KEYS.user, data.user); write(KEYS.perms, data.permissions || []); write(KEYS.location, data.location); write(KEYS.locations, data.locations || []);
    setUser(data.user); setPermissions(data.permissions || []); setLocation(data.location); setLocations(data.locations || []);
  }, []);

  const logout = useCallback(() => {
    [KEYS.token, KEYS.user, KEYS.perms, KEYS.location, KEYS.locations].forEach((k) => localStorage.removeItem(k));
    setUser(null); setPermissions([]); setLocation(null); setLocations([]);
  }, []);

  async function login(username, password, locationId) {
    setLoading(true); setSessionMessage('');
    try {
      const data = await post('/auth/login', { username, password, locationId: locationId ? Number(locationId) : undefined });
      apply(data); localStorage.setItem(KEYS.last, String(data.location.LocationId));
      return data;
    } finally { setLoading(false); }
  }

  async function switchLocation(locationId) {
    const data = await post('/auth/switch-location', { locationId: Number(locationId) });
    apply(data); localStorage.setItem(KEYS.last, String(data.location.LocationId));
    return data;
  }

  const refresh = useCallback(async () => { try { apply(await get('/auth/me')); } catch { /* 401 handled globally */ } }, [apply]);

  useEffect(() => { reloadConfig(); if (localStorage.getItem(KEYS.token)) refresh(); }, [reloadConfig, refresh]);
  useEffect(() => {
    const onExpired = (e) => { logout(); setSessionMessage(e.detail || 'Your session has ended. Please sign in again.'); };
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, [logout]);

  function can(screenKey, action = 'CanView') {
    if (!user) return false;
    if (user.IsSuperAdmin) return true; // dynamic flag from Roles master
    const p = permissions.find((x) => x.ScreenKey === screenKey);
    return p ? !!p[action] : false;
  }

  if (!config) return <div className="boot"><span className="spinner" />Loading configuration…</div>;

  return (
    <AuthContext.Provider value={{ config, configError, reloadConfig, user, permissions, location, locations, loading, login, logout, switchLocation, refresh, can, sessionMessage, lastLocationId: localStorage.getItem(KEYS.last) }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);