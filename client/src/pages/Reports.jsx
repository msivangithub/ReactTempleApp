import { useEffect, useState } from 'react';
import { Download, IndianRupee, Ticket } from 'lucide-react';
import { get, money, fmtDate, fmtTime, todayISO } from '../api.js';
import { PageHead, iconFor } from '../components/Layout.jsx';
import { StatusPill, Empty, Pager, usePaged } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export default function ReportsPage() {
  const { location } = useAuth();
  const [data, setData] = useState(null);
  const [temples, setTemples] = useState([]); const [types, setTypes] = useState([]); const [statuses, setStatuses] = useState([]); const [modes, setModes] = useState([]);
  const [f, setF] = useState({ from: todayISO(), to: todayISO(), templeId: '', bookingType: '', paymentMode: '', paymentStatus: '' });
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([get('/temples'), get('/booking-types'), get('/booking-statuses'), get('/payment-modes')])
      .then(([t, ty, s, m]) => { setTemples(t); setTypes(ty); setStatuses(s); setModes(m); }).catch(() => {});
  }, []);
  useEffect(() => {
    const p = new URLSearchParams(); Object.entries(f).forEach(([k, v]) => { if (v) p.set(k, v); });
    get(`/reports/summary?${p}`).then((d) => { setData(d); setError(''); }).catch((e) => setError(e.message));
  }, [f]);

  function exportCSV() {
    const rows = data?.rows || [];
    const head = ['Location', 'Booking ID', 'Token', 'Type', 'Temple', 'Devotee', 'Mobile', 'Items', 'Date', 'Time', 'Advance', 'Amount', 'Mode', 'Status', 'Counter', 'Booked by'];
    const csv = [head.join(','), ...rows.map((b) => [b.LocationName, b.BookingNumber, b.TokenNumber, b.BookingType, b.TempleName, b.DevoteeName, b.Mobile, (b.Items || []).map((i) => `${i.ItemName} x${i.Quantity}`).join('; '), b.SevaDate, b.SevaTime, b.IsAdvanceBooking ? 'Yes' : 'No', b.TotalAmount, b.PaymentMode, b.PaymentStatus, b.CounterName, b.CreatedByName].map((x) => `"${String(x ?? '').replaceAll('"', '""')}"`).join(','))].join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `${location?.LocationCode || 'bookings'}-report-${f.from || 'all'}-to-${f.to || 'all'}.csv`; a.click(); URL.revokeObjectURL(a.href);
  }

  const rows = data?.rows || [];
  const pg = usePaged(rows, JSON.stringify(f)); // all rows stay loaded for the CSV export; the table shows one page
  const set = (patch) => setF((x) => ({ ...x, ...patch }));

  return (
    <>
      <PageHead screen="reports" eyebrow={location?.LocationName} title="Reports" desc="Booking and collection register for reconciliation. Cancelled bookings are excluded unless you filter by their status."
        action={<button className="btn btn-ghost" onClick={exportCSV} disabled={!rows.length}><Download size={15} />Export CSV</button>} />
      <div className="toolbar">
        <label className="date-range"><span>From</span><input type="date" className="input" value={f.from} onChange={(e) => set({ from: e.target.value })} /></label>
        <label className="date-range"><span>To</span><input type="date" className="input" value={f.to} onChange={(e) => set({ to: e.target.value })} /></label>
        <select value={f.bookingType} onChange={(e) => set({ bookingType: e.target.value })}><option value="">All booking types</option>{types.map((t) => <option key={t.BookingTypeId} value={t.TypeName}>{t.TypeName}</option>)}</select>
        <select value={f.templeId} onChange={(e) => set({ templeId: e.target.value })}><option value="">All temples</option>{temples.map((t) => <option key={t.TempleId} value={t.TempleId}>{t.TempleName}</option>)}</select>
        <select value={f.paymentMode} onChange={(e) => set({ paymentMode: e.target.value })}><option value="">All payment modes</option>{modes.map((m) => <option key={m.PaymentModeId} value={m.ModeName}>{m.ModeName}</option>)}</select>
        <select value={f.paymentStatus} onChange={(e) => set({ paymentStatus: e.target.value })}><option value="">All active statuses</option>{statuses.map((s) => <option key={s.BookingStatusId} value={s.StatusName}>{s.StatusName}</option>)}</select>
        <button className="btn btn-ghost btn-sm" onClick={() => set({ from: '', to: '' })}>All dates</button>
      </div>
      {error && <div className="alert">{error}</div>}

      <div className="stats">
        <div className="stat"><div className="stat-icon purple"><Ticket size={19} /></div><div><b>{data?.count ?? 0}</b><small>Transactions</small></div></div>
        <div className="stat"><div className="stat-icon green"><IndianRupee size={19} /></div><div><b>{money(data?.total)}</b><small>Gross collection</small></div></div>
        {types.slice(0, 2).map((t, i) => { const I = iconFor(t.Icon); const s = data?.byType?.[t.TypeName] || { count: 0, amount: 0 }; return (
          <div className="stat" key={t.BookingTypeId}><div className={`stat-icon ${['orange', 'blue'][i]}`}><I size={19} /></div><div><b>{money(s.amount)}</b><small>{t.TypeName} · {s.count} bookings</small></div></div>); })}
      </div>

      <div className="grid-3" style={{ marginBottom: 14 }}>
        {[['By booking type', data?.byType], ['By payment mode', data?.byMode], ['By status', data?.byStatus]].map(([title, g]) => (
          <section className="card" key={title}><div className="card-head"><div><h3>{title}</h3></div></div>
            <div className="card-body breakdown">{g && Object.keys(g).length ? Object.entries(g).map(([k, v]) => <div key={k}><span>{k}</span><small>{v.count}</small><b>{money(v.amount)}</b></div>) : <p className="muted-note">No data</p>}</div>
          </section>
        ))}
      </div>

      <section className="card">
        {rows.length ? <div className="table-wrap"><table><thead><tr><th>Token</th><th>Type</th><th>Devotee</th><th>Items</th><th>Date & time</th><th className="right">Amount</th><th>Mode</th><th>Status</th></tr></thead>
          <tbody>{pg.pageRows.map((b) => (
            <tr key={b.BookingId}>
              <td data-label="Token" className="nowrap"><b>{b.TokenNumber}</b><small>{b.BookingNumber}</small></td>
              <td data-label="Type"><span className="pill purple">{b.BookingType}</span></td>
              <td data-label="Devotee">{b.DevoteeName || '—'}<small>{b.Mobile}</small></td>
              <td data-label="Items">{(b.Items || []).map((i) => `${i.ItemName} × ${i.Quantity}`).join(', ')}<small>{b.TempleName}</small></td>
              <td data-label="Date">{fmtDate(b.SevaDate)}<small>{fmtTime(b.SevaTime)}</small></td>
              <td data-label="Amount" className="right amount">{money(b.TotalAmount)}</td>
              <td data-label="Mode">{b.PaymentMode}</td>
              <td data-label="Status"><StatusPill status={b.PaymentStatus} /></td>
            </tr>
          ))}</tbody></table></div>
          : <Empty icon={Ticket} title="No data for the selected filters" text="Adjust the date range or filters." />}
        <Pager {...pg} noun="transactions" />
      </section>
    </>
  );
}
