import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Ticket, IndianRupee, Landmark, CalendarDays, ArrowUpRight, MapPin, Phone } from 'lucide-react';
import { get, money, fmtDate, fmtTime } from '../api.js';
import { PageHead, iconFor } from '../components/Layout.jsx';
import { StatusPill, Empty, Pager, usePaged } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';

const TONES = ['purple', 'orange', 'green', 'blue'];
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [types, setTypes] = useState([]);
  const [screens, setScreens] = useState([]);
  const [temples, setTemples] = useState([]);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { can, location } = useAuth();

  useEffect(() => {
    get('/dashboard/stats').then(setStats).catch((e) => setError(e.message));
    get('/booking-types?activeOnly=true').then(setTypes).catch(() => {});
    get('/screens').then(setScreens).catch(() => {});
    get('/temples?activeOnly=true').then(setTemples).catch(() => {});
  }, []);

  const paged = usePaged(stats?.recent || [], location?.LocationId);

  if (error) return <div className="card card-body">{error}</div>;
  if (!stats) return <div className="card card-body muted">Loading dashboard…</div>;

  const screenName = (key, fallback) => screens.find((s) => s.ScreenKey === key)?.ScreenName || fallback;
  // One quick card per booking type the user may use — each type has its own screen & items
  const bookable = types.filter((t) => can(t.ScreenKey, 'CanView'));
  const typeStat = (t, src) => src?.[t.TypeName] || { count: 0, amount: 0 };
  const maxAmt = Math.max(1, ...Object.values(stats.byType || {}).map((x) => x.amount));

  return (
    <>
      <PageHead eyebrow={[location?.LocationCode, 'Overview'].filter(Boolean).join(' · ')} title={location?.LocationName}
        desc={<span className="loc-line">{location?.Address && <span><MapPin size={13} />{location.Address}</span>}{location?.Phone && <span><Phone size={13} />{location.Phone}</span>}</span>} />

      <div className="stats">
        <div className="stat"><div className="stat-icon purple"><Ticket size={19} /></div><div><b>{stats.todayCount}</b><small>Bookings today</small><div className="delta">{stats.totalBookings} total</div></div></div>
        <div className="stat"><div className="stat-icon green"><IndianRupee size={19} /></div><div><b>{money(stats.todayCollection)}</b><small>Today's collection</small><div className="delta">{money(stats.totalCollection)} all-time</div></div></div>
        <div className="stat"><div className="stat-icon orange"><CalendarDays size={19} /></div><div><b>{stats.upcomingAdvance}</b><small>Upcoming advance</small><div className="delta">reserved for future dates</div></div></div>
        <div className="stat"><div className="stat-icon blue"><Landmark size={19} /></div><div><b>{stats.activeTemples}</b><small>Active temples</small><div className="delta">{stats.activeSevas} sevas · {stats.activeItems} items</div></div></div>
      </div>

      {(bookable.length > 0 || can('advance_booking', 'CanView')) && (
        <section className="card" style={{ marginBottom: 14 }}>
          <div className="card-head"><div><h3>Quick booking</h3><p>Each booking type has its own items and token series</p></div><span className="pill green"><span className="dot" />{location?.LocationName}</span></div>
          <div className="card-body type-cards">
            {bookable.map((t, i) => { const Icon = iconFor(t.Icon); const s = typeStat(t, stats.todayByType); return (
              <button key={t.BookingTypeId} className="quick-card type-card" onClick={() => navigate(`/book/${t.BookingTypeId}`)}>
                <span className={`quick-icon stat-icon ${TONES[i % TONES.length]}`}><Icon size={19} /></span>
                <b>{screenName(t.ScreenKey, `${t.TypeName} Booking`)}</b>
                <small>{t.Description}</small>
                <span className="type-foot"><span className="pill gray">{t.TokenPrefix}</span><span>{s.count} today · {money(s.amount)}</span><ArrowUpRight size={15} /></span>
              </button>); })}
            {can('advance_booking', 'CanView') && types.some((t) => t.AllowAdvance) && (
              <button className="quick-card type-card" onClick={() => navigate('/advance')}>
                <span className="quick-icon stat-icon blue"><CalendarDays size={19} /></span>
                <b>{screenName('advance_booking', 'Advance Booking')}</b>
                <small>Reserve a future date and time</small>
                <span className="type-foot"><span className="pill gray">Date + time</span><span>{stats.upcomingAdvance} upcoming</span><ArrowUpRight size={15} /></span>
              </button>
            )}
          </div>
        </section>
      )}

      <div className="grid-2" style={{ marginBottom: 14 }}>
        <section className="card">
          <div className="card-head"><div><h3>Collection by booking type</h3><p>All non-cancelled bookings at this location</p></div></div>
          <div className="card-body" style={{ display: 'grid', gap: 12 }}>
            {types.length ? types.map((t, i) => { const s = typeStat(t, stats.byType); return (
              <div key={t.BookingTypeId} className="bar-row">
                <div className="bar-top"><b>{t.TypeName}</b><span>{plural(s.count, 'booking', 'bookings')} · <b>{money(s.amount)}</b></span></div>
                <div className="bar"><span className={TONES[i % TONES.length]} style={{ width: `${(s.amount / maxAmt) * 100}%` }} /></div>
              </div>); }) : <p className="muted-note">No booking types configured.</p>}
          </div>
        </section>
        <section className="card">
          <div className="card-head"><div><h3>Temples</h3><p>{location?.LocationName}</p></div><span className="pill gray">{temples.length} active</span></div>
          <div className="card-body temple-list">
            {temples.length ? temples.map((t) => (
              <div key={t.TempleId} className="temple-row">
                <span className="stat-icon orange"><Landmark size={15} /></span>
                <div><b>{t.TempleName}{t.IsMainTemple && <span className="pill amber" style={{ marginLeft: 6 }}>Main</span>}</b><small>{plural(t.SevaCount, 'seva', 'sevas')} · {plural(t.DeityCount, 'deity', 'deities')}</small></div>
                <span className="amount">{money(stats.byTemple?.[t.TempleName]?.amount || 0)}</span>
              </div>
            )) : <p className="muted-note">No temples configured at this location yet.</p>}
          </div>
        </section>
      </div>

      <section className="card">
        <div className="card-head"><div><h3>Recent transactions</h3><p>Latest bookings at {location?.LocationName}</p></div>{can('bookings', 'CanView') && <button className="btn btn-ghost btn-sm" onClick={() => navigate('/bookings')}>View all <ArrowUpRight size={14} /></button>}</div>
        {stats.recent?.length ? (
          <>
            <div className="table-wrap"><table><thead><tr><th>Token</th><th>Type</th><th>Devotee</th><th>Items</th><th>Date & time</th><th className="right">Amount</th><th>Status</th></tr></thead>
              <tbody>{paged.pageRows.map((b) => (
                <tr key={b.BookingId}>
                  <td data-label="Token" className="nowrap"><b>{b.TokenNumber}</b><small>{b.BookingNumber}</small></td>
                  <td data-label="Type"><span className="pill purple">{b.BookingType}</span>{b.IsAdvanceBooking && <span className="pill blue" style={{ marginLeft: 4 }}>Advance</span>}</td>
                  <td data-label="Devotee">{b.DevoteeName || '—'}<small>{b.Mobile}</small></td>
                  <td data-label="Items">{(b.Items || []).map((i) => `${i.ItemName} × ${i.Quantity}`).join(', ')}<small>{b.TempleName}</small></td>
                  <td data-label="Date">{fmtDate(b.SevaDate)}<small>{fmtTime(b.SevaTime)}</small></td>
                  <td data-label="Amount" className="right amount">{money(b.TotalAmount)}</td>
                  <td data-label="Status"><StatusPill status={b.PaymentStatus} /></td>
                </tr>
              ))}</tbody></table></div>
            <Pager {...paged} noun="bookings" />
          </>
        ) : <Empty icon={Ticket} title="No transactions yet" text="Bookings created at this location will appear here." />}
      </section>
    </>
  );
}