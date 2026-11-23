import { createContext, useContext, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Flower2, Package, Ticket, CalendarDays, HeartHandshake, IndianRupee, MapPin, Landmark, Sparkles, ClipboardList, Tags, Store, Users, ShieldCheck, Menu, X, LogOut, Clock3, CreditCard, ListChecks, RefreshCcw, CalendarClock, Boxes, ChevronDown, PanelLeftClose, PanelLeftOpen, Gift, HandHeart, Milk, Cookie, Soup, Gem, Sun, Star, Heart, Leaf, Flame, BookOpen } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { get, fmtDate } from '../api.js';
import { Toast } from './ui.jsx';

// Icons are referenced by name from the DB (BookingTypes.Icon) — admins pick from this set.
const ICONS = { Flower2, Package, Ticket, CalendarDays, Gift, HandHeart, Milk, Cookie, Soup, Gem, Sun, Star, Heart, Leaf, Flame, BookOpen, Sparkles, Landmark };
export const ICON_CHOICES = Object.keys(ICONS);
export const iconFor = (name, fallback = Ticket) => (name && ICONS[name]) || fallback;

// Screens & booking types loaded once by the layout and shared with pages (titles come from the Screens master)
export const NavContext = createContext({ screens: [], types: [] });
export const useScreenName = (key, fallback) => useContext(NavContext).screens.find((s) => s.ScreenKey === key)?.ScreenName || fallback;

// Fixed pages: ScreenKey (Screens master) → route + icon. Booking-type screens are routed dynamically to /book/:id.
export const ROUTE_REGISTRY = {
  overview: { path: '/', icon: LayoutDashboard },
  advance_booking: { path: '/advance', icon: CalendarDays },
  bookings: { path: '/bookings', icon: Ticket },
  lifetime_members: { path: '/members', icon: HeartHandshake },
  reports: { path: '/reports', icon: IndianRupee },
  locations: { path: '/locations', icon: MapPin },
  temple_mgmt: { path: '/temples', icon: Landmark },
  deity_mgmt: { path: '/deities', icon: Sparkles },
  seva_master: { path: '/sevas', icon: ClipboardList },
  item_master: { path: '/items', icon: Boxes },
  seva_categories: { path: '/categories', icon: Tags },
  counters: { path: '/counters', icon: Store },
  user_mgmt: { path: '/users', icon: Users },
  screen_allocation: { path: '/roles', icon: ShieldCheck },
  booking_types: { path: '/booking-types', icon: ListChecks },
  payment_modes: { path: '/payment-modes', icon: CreditCard },
  booking_statuses: { path: '/booking-statuses', icon: RefreshCcw },
  time_slots: { path: '/time-slots', icon: Clock3 },
  member_frequencies: { path: '/member-frequencies', icon: CalendarClock },
  member_statuses: { path: '/member-statuses', icon: CalendarClock },
};

// Resolve a screen to its route: booking-type screens → generic booking page, others → registry
export function routeForScreen(screen, bookingTypes) {
  const type = bookingTypes.find((t) => t.ScreenKey === screen.ScreenKey && t.IsActive);
  if (type) return { path: `/book/${type.BookingTypeId}`, icon: iconFor(type.Icon, Flower2), type };
  return ROUTE_REGISTRY[screen.ScreenKey] || null;
}

const SIDEBAR_KEY = 'temple_sidebar';

export default function Layout() {
  const [open, setOpen] = useState(false); // mobile drawer
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(SIDEBAR_KEY) === 'collapsed'); // desktop icon rail (remembered)
  const toggleCollapsed = () => setCollapsed((c) => { localStorage.setItem(SIDEBAR_KEY, c ? 'expanded' : 'collapsed'); return !c; });
  const [screens, setScreens] = useState([]);
  const [types, setTypes] = useState([]);
  const [toast, setToast] = useState(null);
  const [switching, setSwitching] = useState(false);
  const { user, logout, can, config, location, locations, switchLocation } = useAuth();
  const navigate = useNavigate();
  const loc = useLocation();
  const initials = (user?.FullName || user?.Username || '?').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();

  useEffect(() => {
    const loadNav = () => { get('/screens').then(setScreens).catch(() => {}); get('/booking-types?activeOnly=true').then(setTypes).catch(() => {}); };
    loadNav();
    window.addEventListener('nav:refresh', loadNav);
    return () => window.removeEventListener('nav:refresh', loadNav);
  }, [location?.LocationId]);
  useEffect(() => { document.title = [location?.LocationName, config?.appName].filter(Boolean).join(' · '); }, [location, config]);

  async function onSwitch(id) {
    if (String(id) === String(location?.LocationId)) return;
    setSwitching(true);
    try { const d = await switchLocation(id); setToast({ m: `Switched to ${d.location.LocationName}` }); navigate('/'); }
    catch (e) { setToast({ m: e.message, err: true }); }
    finally { setSwitching(false); setTimeout(() => setToast(null), 2600); }
  }

  // Nav = Screens master (grouped by ScreenGroup, ordered by DisplayOrder) filtered by permission
  const groups = [];
  screens.filter((s) => can(s.ScreenKey, 'CanView')).forEach((s) => {
    const route = routeForScreen(s, types); if (!route) return;
    const g = s.ScreenGroup || '';
    let grp = groups.find((x) => x.name === g); if (!grp) { grp = { name: g, items: [] }; groups.push(grp); }
    grp.items.push({ ...s, ...route });
  });
  const current = groups.flatMap((g) => g.items).find((s) => (s.path === '/' ? loc.pathname === '/' : loc.pathname.startsWith(s.path)));

  return (
    <div className={`app ${collapsed ? 'nav-collapsed' : ''}`}>
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          {config?.brandIconUrl ? <img className="brand-logo-mark" src={config.brandIconUrl} alt={config.brandName || ''} /> : <div className="brand-mark"><Landmark size={20} /></div>}
          <div className="brand-text"><b className="truncate">{location?.LocationName}</b><small>{[location?.LocationCode, config?.appName].filter(Boolean).join(' · ')}</small></div>
          <button className="icon-btn sidebar-close" onClick={() => setOpen(false)}><X size={16} /></button>
        </div>
        <nav className="nav">
          {groups.map((g) => (
            <div key={g.name}>
              {g.name && <div className="nav-label"><span>{g.name}</span></div>}
              {g.items.map((s) => (
                <NavLink key={s.ScreenId} to={s.path} end={s.path === '/'} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={() => setOpen(false)} title={collapsed ? s.ScreenName : undefined}>
                  <s.icon size={17} /><span>{s.ScreenName}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="counter-chip" title={collapsed ? `${user?.FullName} · ${user?.RoleName}` : undefined}><span className="dot" /><div><b>{user?.FullName}</b><small>{user?.RoleName}</small></div></div>
          <button className="nav-item" onClick={() => { logout(); navigate('/login'); }} title={collapsed ? 'Sign out' : undefined}><LogOut size={17} /><span>Sign out</span></button>
          {config?.brandLogoUrl && <div className="powered" title={config.brandName ? `Powered by ${config.brandName}` : undefined}><span>Powered by</span><img src={config.brandLogoUrl} alt={config.brandName || ''} /></div>}
        </div>
      </aside>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <div className="main">
        <header className="topbar">
          <button className="icon-btn hamburger" onClick={() => setOpen(true)} aria-label="Open menu"><Menu size={18} /></button>
          <button className="icon-btn collapse-btn" onClick={toggleCollapsed} title={collapsed ? 'Expand menu' : 'Collapse menu'} aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}>{collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}</button>
          <div className="crumb"><span className="hide-sm">{location?.LocationName} <span>/</span> </span><b>{current?.ScreenName || ''}</b></div>
          <div className="top-actions">
            {config?.financialYear?.label && <span className="date-chip" title={`Financial year ${fmtDate(config.financialYear.from)} – ${fmtDate(config.financialYear.to)}. Booking, token and member numbers restart every new financial year.`}>FY {config.financialYear.label}</span>}
            {locations.length > 1 ? (
              <label className={`loc-switch ${switching ? 'busy' : ''}`} title="Switch location">
                <MapPin size={14} />
                <select value={location?.LocationId || ''} onChange={(e) => onSwitch(e.target.value)} disabled={switching}>
                  {locations.map((l) => <option key={l.LocationId} value={l.LocationId}>{l.LocationName}</option>)}
                </select>
                <ChevronDown size={14} />
              </label>
            ) : <span className="loc-switch static"><MapPin size={14} />{location?.LocationName}</span>}
            <div className="avatar" title={user?.FullName}>{initials}</div>
            <div className="user-meta"><b>{user?.FullName}</b><small>{user?.RoleName}</small></div>
          </div>
        </header>
        {/* key → every page remounts and reloads its data when the location changes */}
        <NavContext.Provider value={{ screens, types }}><div className="page" key={location?.LocationId}><Outlet /></div></NavContext.Provider>
      </div>
      <Toast msg={toast?.m} error={toast?.err} />
    </div>
  );
}

export function PageHead({ eyebrow, title, desc, action, screen }) {
  const name = useScreenName(screen, title); // DB screen name wins when a screen key is given
  return <div className="page-head"><div><div className="eyebrow">{eyebrow}</div><h1>{screen ? name : title}</h1>{desc && <p>{desc}</p>}</div>{action}</div>;
}
