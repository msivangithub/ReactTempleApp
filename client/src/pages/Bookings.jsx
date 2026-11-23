import { useEffect, useState } from 'react';
import { Ticket, Printer, Ban, Pencil, Trash2 } from 'lucide-react';
import { get, put, del, money, fmtDate, fmtTime, todayISO, isValidMobile } from '../api.js';
import { PageHead, iconFor } from '../components/Layout.jsx';
import { Field, Modal, SearchBox, StatusPill, Empty, Toast, Pager, usePageSize, AuditInfo, ByCell } from '../components/ui.jsx';
import { ReceiptModal } from './Booking.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export default function BookingsPage() {
  const { can, location } = useAuth();
  const [rows, setRows] = useState([]); const [total, setTotal] = useState(0); const [summary, setSummary] = useState({ count: 0, amount: 0 });
  const [page, setPage] = useState(1); const [pageSize, setPageSize, sizeOptions] = usePageSize(); const [loaded, setLoaded] = useState(false);
  const [types, setTypes] = useState([]); const [temples, setTemples] = useState([]); const [statuses, setStatuses] = useState([]); const [modes, setModes] = useState([]);
  const [f, setF] = useState({ search: '', bookingType: '', templeId: '', paymentStatus: '', from: '', to: '', advance: false });
  const [toast, setToast] = useState(null);
  const [view, setView] = useState(null);
  const [edit, setEdit] = useState(null); const [slots, setSlots] = useState([]);
  const notify = (m, err = false) => { setToast({ m, err }); setTimeout(() => setToast(null), 3000); };

  // Paged on the server (SQL OFFSET/FETCH) — only one page of bookings is ever sent to the browser
  const load = async (pg = page) => {
    try {
      const p = new URLSearchParams({ page: String(pg), pageSize: String(pageSize) });
      Object.entries(f).forEach(([k, v]) => { if (v) p.set(k, v === true ? 'true' : v); });
      const d = await get(`/bookings?${p}`);
      if (!d.rows.length && d.total && pg > 1) { setPage(Math.ceil(d.total / pageSize)); return; } // e.g. last row of the last page deleted
      setRows(d.rows); setTotal(d.total); setSummary(d.summary || { count: 0, amount: 0 });
    } catch (e) { notify(e.message, true); } finally { setLoaded(true); }
  };
  useEffect(() => {
    Promise.all([get('/booking-types'), get('/temples'), get('/booking-statuses'), get('/payment-modes?activeOnly=true')])
      .then(([t, te, s, m]) => { setTypes(t); setTemples(te); setStatuses(s); setModes(m); }).catch(() => {});
  }, []);
  useEffect(() => { setPage(1); }, [f, pageSize]);
  useEffect(() => { const h = setTimeout(() => load(page), 200); return () => clearTimeout(h); }, [f, page, pageSize]); // eslint-disable-line react-hooks/exhaustive-deps

  async function cancel(b) {
    const reason = prompt(`Cancel ${b.TokenNumber}? Optional reason:`, '');
    if (reason === null) return;
    try { await put(`/bookings/${b.BookingId}/cancel`, { reason }); notify('Booking cancelled'); load(); } catch (e) { notify(e.message, true); }
  }
  async function remove(b) {
    if (!confirm(`Permanently delete ${b.BookingNumber}? Prefer Cancel to keep the audit trail.`)) return;
    try { await del(`/bookings/${b.BookingId}`); notify('Booking deleted'); load(); } catch (e) { notify(e.message, true); }
  }
  async function openEdit(b) {
    setEdit({ b, form: { DevoteeName: b.DevoteeName, Mobile: b.Mobile, Gothram: b.Gothram || '', Nakshatram: b.Nakshatram || '', SevaDate: b.SevaDate, SevaTime: b.SevaTime, PaymentMode: b.PaymentMode, PaymentStatus: b.PaymentStatus, Remarks: b.Remarks || '' } });
    try { setSlots(await get(b.TempleId ? `/time-slots?activeOnly=true&templeId=${b.TempleId}` : '/time-slots?activeOnly=true&effective=true')); } catch { setSlots([]); }
  }
  async function saveEdit(e) {
    e?.preventDefault();
    const { b, form } = edit; const type = types.find((t) => t.TypeName === b.BookingType);
    if (type?.RequiresDevotee && (!form.DevoteeName.trim() || !isValidMobile(form.Mobile))) return notify('Valid devotee name and mobile are required', true);
    try { await put(`/bookings/${b.BookingId}`, form); notify('Booking updated'); setEdit(null); load(); } catch (err) { notify(err.message, true); }
  }

  const editType = edit && types.find((t) => t.TypeName === edit.b.BookingType);
  const setForm = (patch) => setEdit((x) => ({ ...x, form: { ...x.form, ...patch } }));

  return (
    <>
      <PageHead screen="bookings" eyebrow={location?.LocationName} title="Bookings" desc="All tokens at this location — search, filter by booking type, edit, cancel or reprint." />
      <div className="type-tabs" style={{ marginBottom: 10 }}>
        <button className={!f.bookingType ? 'active' : ''} onClick={() => setF({ ...f, bookingType: '' })}>All types</button>
        {types.map((t) => { const I = iconFor(t.Icon); return <button key={t.BookingTypeId} className={f.bookingType === t.TypeName ? 'active' : ''} onClick={() => setF({ ...f, bookingType: t.TypeName })}><I size={14} />{t.TypeName}</button>; })}
      </div>
      <div className="toolbar">
        <SearchBox value={f.search} onChange={(v) => setF({ ...f, search: v })} placeholder="Booking no, token, name, mobile…" />
        <select value={f.templeId} onChange={(e) => setF({ ...f, templeId: e.target.value })}><option value="">All temples</option>{temples.map((t) => <option key={t.TempleId} value={t.TempleId}>{t.TempleName}</option>)}</select>
        <select value={f.paymentStatus} onChange={(e) => setF({ ...f, paymentStatus: e.target.value })}><option value="">All statuses</option>{statuses.map((s) => <option key={s.BookingStatusId} value={s.StatusName}>{s.StatusName}</option>)}</select>
        <label className="date-range"><span>From</span><input type="date" className="input" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
        <label className="date-range"><span>To</span><input type="date" className="input" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
        <label className="check-inline"><input type="checkbox" checked={f.advance} onChange={(e) => setF({ ...f, advance: e.target.checked })} /> Advance only</label>
        <span className="pill gray" title="Excludes cancelled bookings">{summary.count} active · {money(summary.amount)}</span>
      </div>
      <section className="card">
        {rows.length ? <div className="table-wrap"><table><thead><tr><th>Token</th><th>Type</th><th>Devotee</th><th>Items</th><th>Date & time</th><th className="right">Amount</th><th>Status</th><th>Booked by</th><th /></tr></thead>
          <tbody>{rows.map((b) => (
            <tr key={b.BookingId} className={b.IsCancelled ? 'row-muted' : ''}>
              <td data-label="Token" className="nowrap"><b>{b.TokenNumber}</b><small>{b.BookingNumber}</small></td>
              <td data-label="Type"><span className="pill purple">{b.BookingType}</span>{b.IsAdvanceBooking && <span className="pill blue" style={{ marginLeft: 4 }}>Advance</span>}</td>
              <td data-label="Devotee">{b.DevoteeName || '—'}<small>{b.Mobile}</small></td>
              <td data-label="Items">{(b.Items || []).map((i) => `${i.ItemName} × ${i.Quantity}`).join(', ') || '—'}<small>{b.TempleName}</small></td>
              <td data-label="Date">{fmtDate(b.SevaDate)}<small>{fmtTime(b.SevaTime)}</small></td>
              <td data-label="Amount" className="right amount">{money(b.TotalAmount)}<small>{b.PaymentMode}</small></td>
              <td data-label="Status"><StatusPill status={b.PaymentStatus} /></td>
              <td data-label="Booked by"><ByCell row={b} /></td>
              <td className="row-actions">
                <button className="btn btn-ghost btn-sm" onClick={() => setView(b)} title="View / reprint"><Printer size={13} /></button>
                {!b.IsCancelled && can('bookings', 'CanEdit') && <button className="btn btn-ghost btn-sm" onClick={() => openEdit(b)} title="Edit"><Pencil size={13} /></button>}
                {!b.IsCancelled && can('bookings', 'CanEdit') && <button className="btn btn-danger btn-sm" onClick={() => cancel(b)} title="Cancel"><Ban size={13} /></button>}
                {can('bookings', 'CanDelete') && <button className="btn btn-ghost btn-sm" onClick={() => remove(b)} title="Delete"><Trash2 size={13} /></button>}
              </td>
            </tr>
          ))}</tbody></table></div>
          : loaded ? <Empty icon={Ticket} title="No bookings found" text="Try changing the filters, or create a booking from one of the booking screens." /> : <div className="card-body muted">Loading…</div>}
        <Pager page={page} pageSize={pageSize} total={total} setPage={setPage} setPageSize={setPageSize} options={sizeOptions} noun="bookings" />
      </section>

      {view && <ReceiptModal booking={view} onClose={() => setView(null)} />}
      {edit && <Modal title={`Edit ${edit.b.TokenNumber}`} onClose={() => setEdit(null)} footer={<><button className="btn btn-ghost" onClick={() => setEdit(null)}>Close</button><button className="btn btn-primary" onClick={saveEdit}>Save changes</button></>}>
        <AuditInfo row={edit.b} verb="Booked" />
        <form onSubmit={saveEdit}><div className="field-grid">
          <Field label="Devotee name" required={editType?.RequiresDevotee}><input className="input" value={edit.form.DevoteeName} onChange={(e) => setForm({ DevoteeName: e.target.value })} /></Field>
          <Field label="Mobile" required={editType?.RequiresDevotee}><input className="input" inputMode="numeric" value={edit.form.Mobile} onChange={(e) => setForm({ Mobile: e.target.value.replace(/\D/g, '') })} /></Field>
          {editType?.CaptureGothram && <Field label="Gothram"><input className="input" value={edit.form.Gothram} onChange={(e) => setForm({ Gothram: e.target.value })} /></Field>}
          {editType?.CaptureGothram && <Field label="Nakshatram"><input className="input" value={edit.form.Nakshatram} onChange={(e) => setForm({ Nakshatram: e.target.value })} /></Field>}
          <Field label="Date"><input className="input" type="date" min={todayISO()} value={edit.form.SevaDate} onChange={(e) => setForm({ SevaDate: e.target.value })} /></Field>
          <Field label="Time">{slots.length ? <select className="input" value={edit.form.SevaTime} onChange={(e) => setForm({ SevaTime: e.target.value })}>{!slots.some((s) => s.SlotTime === edit.form.SevaTime) && <option value={edit.form.SevaTime}>{fmtTime(edit.form.SevaTime)} (current)</option>}{slots.map((s) => <option key={s.SlotId} value={s.SlotTime}>{s.SlotLabel || fmtTime(s.SlotTime)}</option>)}</select> : <input className="input" type="time" value={edit.form.SevaTime} onChange={(e) => setForm({ SevaTime: e.target.value })} />}</Field>
          <Field label="Payment mode"><select className="input" value={edit.form.PaymentMode} onChange={(e) => setForm({ PaymentMode: e.target.value })}>{modes.map((m) => <option key={m.PaymentModeId} value={m.ModeName}>{m.ModeName}</option>)}</select></Field>
          <Field label="Payment status"><select className="input" value={edit.form.PaymentStatus} onChange={(e) => setForm({ PaymentStatus: e.target.value })}>{statuses.filter((s) => s.IsActive && !s.IsCancelled).map((s) => <option key={s.BookingStatusId} value={s.StatusName}>{s.StatusName}</option>)}</select></Field>
          <div className="wide"><Field label="Remarks"><input className="input" value={edit.form.Remarks} onChange={(e) => setForm({ Remarks: e.target.value })} /></Field></div>
        </div><p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>Items and amounts can't be changed after payment — cancel and re-book instead.</p><button type="submit" hidden /></form>
      </Modal>}
      <Toast msg={toast?.m} error={toast?.err} />
    </>
  );
}
