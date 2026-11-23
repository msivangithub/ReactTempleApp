import { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { useParams } from 'react-router-dom';
import { Check, Minus, Plus, Printer, X, RotateCcw, Landmark, CalendarDays, MapPin, Phone, QrCode } from 'lucide-react';
import { get, post, money, todayISO, addDaysISO, nowHHMM, isValidMobile, fmtDate, fmtTime, upiLink } from '../api.js';
import { PageHead, iconFor } from '../components/Layout.jsx';
import { Field, Toast, Empty, SearchBox, Pager, usePaged, useDevoteeLookup, DevoteeHint } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';

const blankDevotee = { DevoteeName: '', Mobile: '', Gothram: '', Nakshatram: '', Remarks: '' };
const AUTO_FIELDS = ['DevoteeName', 'Gothram', 'Nakshatram']; // filled from the devotee lookup
const defaultOf = (list) => list.find((x) => x.IsDefault && x.IsActive) || list.find((x) => x.IsActive) || list[0];

export function BookingRoute() { const { typeId } = useParams(); return <BookingPage key={typeId} typeId={Number(typeId)} />; }
export function AdvanceBookingRoute() { return <BookingPage advanceMode />; }

export default function BookingPage({ typeId = null, advanceMode = false }) {
  const { user, location, can, config } = useAuth();
  const maxQty = Number(config?.maxQuantity) || 999;
  const [types, setTypes] = useState(null);
  const [screens, setScreens] = useState([]);
  const [activeTypeId, setActiveTypeId] = useState(typeId);
  const [temples, setTemples] = useState([]);
  const [deities, setDeities] = useState([]);
  const [counters, setCounters] = useState([]);
  const [modes, setModes] = useState([]);
  const [sevas, setSevas] = useState([]);
  const [items, setItems] = useState([]);
  const [slots, setSlots] = useState([]);
  const [templeId, setTempleId] = useState('');
  const [deityId, setDeityId] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState({}); // id → { qty, amount }
  const [form, setForm] = useState({ ...blankDevotee, SevaDate: advanceMode ? addDaysISO(1) : todayISO(), SevaTime: '', PaymentMode: '', CounterId: '' });
  const [receipt, setReceipt] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const notify = (m, err = false) => { setToast({ m, err }); setTimeout(() => setToast(null), 3200); };
  const mobileRef = useRef(null);
  const summaryRef = useRef(null);
  const wide = typeof window !== 'undefined' && window.matchMedia?.('(min-width: 821px)').matches;
  const formRef = useRef(form); formRef.current = form;
  const auto = useRef({}); // values that came from the lookup
  const lookup = useDevoteeLookup(form.Mobile);
  useEffect(() => {
    if (lookup.status !== 'found' && lookup.status !== 'new') return;
    const d = lookup.status === 'found' ? lookup.data : {};
    const f = formRef.current; const patch = {};
    for (const k of AUTO_FIELDS) if (!f[k] || f[k] === auto.current[k]) patch[k] = d[k] || '';
    auto.current = { ...auto.current, ...patch };
    if (Object.keys(patch).some((k) => patch[k] !== f[k])) setForm((x) => ({ ...x, ...patch }));
  }, [lookup]);
  const isAuto = (k) => !!form[k] && form[k] === auto.current[k];
  const focusMobile = () => setTimeout(() => mobileRef.current?.focus(), 0);

  useEffect(() => { (async () => {
    try {
      const [ty, sc, te, de, co, mo] = await Promise.all([get('/booking-types?activeOnly=true'), get('/screens'), get('/temples?activeOnly=true'), get('/deities?activeOnly=true'), get('/counters?activeOnly=true'), get('/payment-modes?activeOnly=true')]);
      setTypes(ty); setScreens(sc); setTemples(te); setDeities(de); setCounters(co); setModes(mo);
      const mine = co.find((c) => c.AssignedUserId === user?.UserId); // operator's own counter at this location
      setForm((f) => ({ ...f, PaymentMode: defaultOf(mo)?.ModeName || '', CounterId: mine ? String(mine.CounterId) : '' }));
      if (advanceMode && !typeId) setActiveTypeId(ty.find((t) => t.AllowAdvance && can(t.ScreenKey, 'CanCreate'))?.BookingTypeId ?? null);
    } catch (e) { notify(e.message, true); setTypes([]); }
  })(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const type = (types || []).find((t) => t.BookingTypeId === Number(activeTypeId)) || null;
  const advanceTypes = (types || []).filter((t) => t.AllowAdvance && can(t.ScreenKey, 'CanCreate'));
  const usesSeva = !!type?.UsesSevaMaster;

  // Catalog for the active type: Seva Master (temple-wise) or Item Master (type-wise, per location)
  useEffect(() => { if (!type || usesSeva) return; get(`/items?activeOnly=true&bookingTypeId=${type.BookingTypeId}`).then(setItems).catch((e) => notify(e.message, true)); }, [type?.BookingTypeId]); // eslint-disable-line
  const showTemple = !!type && (usesSeva || type.RequiresTemple || items.some((i) => i.TempleId));
  const templeRequired = !!type && (usesSeva || type.RequiresTemple);
  useEffect(() => { // default temple per type: required → main temple; optional → none
    if (!type) return;
    setSelected({}); setDeityId(''); setQuery('');
    if (templeRequired) { const main = temples.find((t) => t.IsMainTemple) || temples[0]; setTempleId((cur) => (temples.some((t) => String(t.TempleId) === cur) ? cur : main ? String(main.TempleId) : '')); }
    else setTempleId('');
  }, [type?.BookingTypeId, temples.length, templeRequired]); // eslint-disable-line
  useEffect(() => { if (!usesSeva || !templeId) { setSevas([]); return; } get(`/sevas?activeOnly=true&templeId=${templeId}`).then(setSevas).catch((e) => notify(e.message, true)); }, [usesSeva, templeId]);

  const source = usesSeva ? sevas : items;
  const idOf = (x) => (usesSeva ? x.SevaId : x.ItemId);
  const nameOf = (x) => (usesSeva ? x.SevaName : x.ItemName);
  const templeDeities = deities.filter((d) => String(d.TempleId) === String(templeId));
  const catalog = usesSeva ? sevas.filter((s) => !deityId || String(s.DeityId) === String(deityId)) : items.filter((i) => !i.TempleId || String(i.TempleId) === String(templeId));

  // Search filter + Pagination for Step 03
  const filteredCatalog = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter((x) =>
      [nameOf(x), x.CategoryName, x.DeityName, x.TempleName, x.Description, x.Unit]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }, [catalog, query, usesSeva]); // eslint-disable-line react-hooks/exhaustive-deps

  const pagedCatalog = usePaged(filteredCatalog, `${type?.BookingTypeId}-${templeId}-${deityId}-${query}`);

  // Date & time rules come from the booking type: advance bookings always need date AND time
  const today = todayISO();
  const isAdvance = form.SevaDate > today;
  const needTime = !!type && (type.RequiresSchedule || isAdvance);
  const canAdvance = !!type?.AllowAdvance && can('advance_booking', 'CanCreate');
  useEffect(() => {
    if (!type) return;
    get(templeId ? `/time-slots?activeOnly=true&templeId=${templeId}` : '/time-slots?activeOnly=true&effective=true').then(setSlots).catch(() => setSlots([]));
  }, [type?.BookingTypeId, templeId]); // eslint-disable-line
  const slotPast = (s) => form.SevaDate === today && s.SlotTime < nowHHMM();
  useEffect(() => {
    if (!needTime || !slots.length) return;
    if (!slots.some((s) => s.SlotTime === form.SevaTime && !slotPast(s))) setForm((f) => ({ ...f, SevaTime: slots.find((s) => !slotPast(s))?.SlotTime || '' }));
  }, [slots, form.SevaDate, needTime]); // eslint-disable-line

  const lines = useMemo(() => Object.entries(selected).map(([id, v]) => {
    const x = source.find((c) => String(idOf(c)) === id); if (!x) return null;
    const unit = x.AllowCustomAmount && v.amount !== '' ? Number(v.amount) : Number(x.Amount);
    return { id: Number(id), x, qty: v.qty, unit, total: unit * v.qty };
  }).filter(Boolean), [selected, source]); // eslint-disable-line
  const total = lines.reduce((s, l) => s + (Number.isFinite(l.total) ? l.total : 0), 0);

  const toggle = (x) => setSelected((p) => { const id = idOf(x); const n = { ...p }; if (n[id]) delete n[id]; else n[id] = { qty: 1, amount: x.AllowCustomAmount ? String(x.Amount || '') : '' }; return n; });
  const setQty = (id, q) => setSelected((p) => ({ ...p, [id]: { ...p[id], qty: Math.max(1, Math.min(maxQty, q || 1)) } }));
  const setAmount = (id, a) => setSelected((p) => ({ ...p, [id]: { ...p[id], amount: a } }));
  const reset = () => { setSelected({}); setQuery(''); auto.current = {}; setForm((f) => ({ ...f, ...blankDevotee })); };

  async function submit(e) {
    e.preventDefault(); if (!type) return;
    if (type.RequiresDevotee && !form.DevoteeName.trim()) return notify('Devotee name is required', true);
    if ((type.RequiresDevotee || form.Mobile) && !isValidMobile(form.Mobile)) return notify('Enter a valid mobile number', true);
    if (templeRequired && !templeId) return notify('Select a temple', true);
    if (!lines.length) return notify(`Select at least one ${usesSeva ? 'seva' : 'item'}`, true);
    if (needTime && !form.SevaTime) return notify('Select a time', true);
    for (const l of lines) if (l.x.AllowCustomAmount && (!(l.unit > 0) || (Number(l.x.MinAmount) && l.unit < Number(l.x.MinAmount)))) return notify(`Enter a valid amount for ${nameOf(l.x)}${l.x.MinAmount ? ` (minimum ${money(l.x.MinAmount)})` : ''}`, true);
    setSaving(true);
    try {
      const rec = await post('/bookings', {
        BookingType: type.TypeName, TempleId: templeId ? Number(templeId) : null, DeityId: deityId ? Number(deityId) : null,
        DevoteeName: form.DevoteeName, Mobile: form.Mobile, Gothram: form.Gothram, Nakshatram: form.Nakshatram,
        SevaDate: form.SevaDate, SevaTime: needTime ? form.SevaTime : '', PaymentMode: form.PaymentMode, CounterId: form.CounterId ? Number(form.CounterId) : null, Remarks: form.Remarks,
        Items: lines.map((l) => (usesSeva ? { SevaId: l.id, Quantity: l.qty } : { ItemId: l.id, Quantity: l.qty, ...(l.x.AllowCustomAmount ? { UnitAmount: l.unit } : {}) })),
      });
      setReceipt(rec); reset();
    } catch (err) { notify(err.message, true); } finally { setSaving(false); }
  }

  if (types === null) return <div className="card card-body">Loading…</div>;
  if (advanceMode && !advanceTypes.length) return <Empty icon={CalendarDays} title="No booking types allow advance booking" text="Enable “Allow advance” on a booking type in Booking Types." />;
  if (!type) return <Empty icon={CalendarDays} title="Booking type not available" text="This booking type is inactive or was removed." />;
  if (!advanceMode && !can(type.ScreenKey, 'CanView')) return <Empty icon={CalendarDays} title="Access denied" text={`Your role does not have permission for ${type.TypeName} booking.`} />;
  const canCreate = can(advanceMode ? 'advance_booking' : type.ScreenKey, 'CanCreate');

  const Icon = iconFor(type.Icon);
  const screenName = (key) => screens.find((s) => s.ScreenKey === key)?.ScreenName;
  const title = advanceMode ? screenName('advance_booking') || 'Advance Booking' : screenName(type.ScreenKey) || `${type.TypeName} Booking`;
  const step = (n) => String(n).padStart(2, '0');
  const noun = usesSeva ? 'sevas' : 'items';

  return (
    <>
      <PageHead eyebrow={[location?.LocationName, advanceMode ? type.TypeName : isAdvance ? 'Advance' : ''].filter(Boolean).join(' · ')} title={title} desc={type.Description}
        action={advanceMode && advanceTypes.length > 1 && (
          <div className="type-tabs">{advanceTypes.map((t) => { const TI = iconFor(t.Icon); return <button key={t.BookingTypeId} type="button" className={t.BookingTypeId === type.BookingTypeId ? 'active' : ''} onClick={() => setActiveTypeId(t.BookingTypeId)}><TI size={14} />{t.TypeName}</button>; })}</div>
        )} />
      <form onSubmit={submit} className={lines.length > 0 ? 'has-mobile-bar' : ''}>
        <div className="booking-layout">
          <div style={{ display: 'grid', gap: 14, minWidth: 0 }}>
            <section className="card">
              <div className="card-head"><div className="step-title"><span className="step">{step(1)}</span><div><h3>Devotee details</h3><p>{type.RequiresDevotee ? 'Start with the mobile number — returning devotees are filled in automatically' : 'Optional for this booking type — a mobile number fills in returning devotees'}</p></div></div></div>
              <div className="card-body"><div className="field-grid">
                <Field label="Mobile number" required={type.RequiresDevotee}>
                  <input ref={mobileRef} className="input" inputMode="numeric" autoComplete="off" maxLength={15} autoFocus={wide} value={form.Mobile} onChange={(e) => setForm({ ...form, Mobile: e.target.value.replace(/\D/g, '') })} placeholder="Mobile number" />
                  <DevoteeHint lookup={lookup} />
                </Field>
                <Field label="Devotee name" required={type.RequiresDevotee}><input className={`input ${isAuto('DevoteeName') ? 'autofilled' : ''}`} value={form.DevoteeName} onChange={(e) => setForm({ ...form, DevoteeName: e.target.value })} placeholder="Full name" /></Field>
                {type.CaptureGothram && <Field label="Gothram"><input className={`input ${isAuto('Gothram') ? 'autofilled' : ''}`} value={form.Gothram} onChange={(e) => setForm({ ...form, Gothram: e.target.value })} /></Field>}
                {type.CaptureGothram && <Field label="Nakshatram"><input className={`input ${isAuto('Nakshatram') ? 'autofilled' : ''}`} value={form.Nakshatram} onChange={(e) => setForm({ ...form, Nakshatram: e.target.value })} /></Field>}
                <Field label="Remarks"><input className="input" value={form.Remarks} onChange={(e) => setForm({ ...form, Remarks: e.target.value })} placeholder="Optional notes" /></Field>
              </div></div>
            </section>

            <section className="card">
              <div className="card-head"><div className="step-title"><span className="step">{step(2)}</span><div><h3>{showTemple ? 'Temple & schedule' : 'Schedule'}</h3><p>{needTime ? 'Date and time are required' : 'Issued for the selected date'}</p></div></div><span className="pill gray"><MapPin size={12} />{location?.LocationName}</span></div>
              <div className="card-body" style={{ display: 'grid', gap: 12 }}>
                <div className="field-grid">
                  {showTemple && <Field label={templeRequired ? 'Temple' : 'Temple (optional)'} required={templeRequired}>
                    <select className="input" value={templeId} onChange={(e) => { setTempleId(e.target.value); setDeityId(''); setSelected({}); setQuery(''); }}>
                      {!templeRequired && <option value="">— All temples —</option>}
                      {temples.map((t) => <option key={t.TempleId} value={t.TempleId}>{t.TempleName}</option>)}
                    </select></Field>}
                  {usesSeva && templeDeities.length > 1 && <Field label="Deity"><select className="input" value={deityId} onChange={(e) => setDeityId(e.target.value)}><option value="">All deities</option>{templeDeities.map((d) => <option key={d.DeityId} value={d.DeityId}>{d.DeityName}</option>)}</select></Field>}
                  <Field label={usesSeva ? 'Seva date' : 'Date'} required>
                    <input className="input" type="date" value={form.SevaDate} min={advanceMode ? addDaysISO(1) : today} max={!advanceMode && !canAdvance ? today : undefined} onChange={(e) => setForm({ ...form, SevaDate: e.target.value })} />
                  </Field>
                  {needTime && <Field label={usesSeva ? 'Seva time' : 'Time'} required>
                    {slots.length ? (
                      <select className="input" value={form.SevaTime} onChange={(e) => setForm({ ...form, SevaTime: e.target.value })}>
                        {!slots.some((s) => !slotPast(s)) && <option value="">No slots left today</option>}
                        {slots.map((s) => <option key={s.SlotId} value={s.SlotTime} disabled={slotPast(s)}>{s.SlotLabel || fmtTime(s.SlotTime)}{slotPast(s) ? ' (passed)' : ''}</option>)}
                      </select>
                    ) : <input className="input" type="time" value={form.SevaTime} onChange={(e) => setForm({ ...form, SevaTime: e.target.value })} />}
                  </Field>}
                </div>
                {!advanceMode && canAdvance && (
                  <div className="toggle-row">
                    <div><b style={{ fontSize: 12.5 }}>Advance booking</b><small>Reserve a future date — date and time become mandatory</small></div>
                    <button type="button" className={`switch ${isAdvance ? 'on' : ''}`} aria-pressed={isAdvance} onClick={() => setForm((f) => ({ ...f, SevaDate: isAdvance ? today : addDaysISO(1) }))} />
                  </div>
                )}
              </div>
            </section>

            <section className="card">
              <div className="card-head">
                <div className="step-title">
                  <span className="step">{step(3)}</span>
                  <div><h3>Select {noun}</h3><p>{catalog.length} available · tap to select multiple</p></div>
                </div>
                <div className="seva-head-tools">
                  {catalog.length > 0 && (
                    <div className="seva-search-wrap">
                      <SearchBox value={query} onChange={setQuery} placeholder={`Search ${noun}…`} />
                      {query && <button type="button" className="icon-btn" onClick={() => setQuery('')} aria-label="Clear search"><X size={13} /></button>}
                    </div>
                  )}
                  {lines.length > 0 && <span className="pill green">{lines.length} selected</span>}
                </div>
              </div>
              <div className="card-body">
                {pagedCatalog.pageRows.length ? <div className="seva-pick">
                  {pagedCatalog.pageRows.map((x) => { const id = idOf(x); const sel = selected[id]; return (
                    <div key={id} role="button" tabIndex={0} className={`seva-card ${sel ? 'selected' : ''}`} onClick={() => toggle(x)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(x); } }}>
                      <span className="check">{sel && <Check size={13} />}</span>
                      <b>{nameOf(x)}</b>
                      <small>{usesSeva ? [x.CategoryName, x.DeityName].filter(Boolean).join(' · ') : [x.Unit && `per ${x.Unit}`, x.TempleName, x.Description].filter(Boolean).join(' · ')}</small>
                      <span className="price">{x.AllowCustomAmount ? `Any amount${Number(x.MinAmount) ? ` · min ${money(x.MinAmount)}` : ''}` : money(x.Amount)}</span>
                      {sel && <div className="card-controls" onClick={(e) => e.stopPropagation()}>
                        {x.AllowCustomAmount && <input className="input amount-input" type="number" min={Number(x.MinAmount) || 1} step="1" value={sel.amount} onChange={(e) => setAmount(id, e.target.value)} placeholder="Amount" aria-label="Amount" />}
                        <span className="qty"><button type="button" onClick={() => setQty(id, sel.qty - 1)} aria-label="Decrease"><Minus size={12} /></button><b>{sel.qty}</b><button type="button" onClick={() => setQty(id, sel.qty + 1)} aria-label="Increase"><Plus size={12} /></button></span>
                      </div>}
                    </div>); })}
                </div> : catalog.length > 0 ? (
                  <Empty icon={Icon} title={`No matching ${noun}`} text={`No ${noun} matched “${query}”.`} action={<button type="button" className="btn btn-ghost btn-sm" onClick={() => setQuery('')}>Clear search</button>} />
                ) : (
                  <Empty icon={Icon} title={`No ${noun} configured`} text={usesSeva ? (templeId ? 'Add sevas for this temple in Seva Master.' : 'Select a temple.') : `Add ${type.TypeName} items for ${location?.LocationName} in Item Master.`} />
                )}
              </div>
              {filteredCatalog.length > 0 && <Pager {...pagedCatalog} noun={noun} />}
            </section>
          </div>

          <aside ref={summaryRef} className="card summary">
            <div className="card-head"><div><h3><Icon size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} />{type.TypeName} summary</h3><p>{fmtDate(form.SevaDate)}{needTime && form.SevaTime ? ` · ${slots.find((s) => s.SlotTime === form.SevaTime)?.SlotLabel || fmtTime(form.SevaTime)}` : ''}{isAdvance ? ' · Advance' : ''}</p></div></div>
            <div className="card-body">
              {lines.length ? lines.map((l) => (
                <div className="summary-row" key={l.id}><div><b>{nameOf(l.x)}</b><small>{money(l.unit)} × {l.qty}</small></div><b>{money(l.total)}</b></div>
              )) : <p className="muted-note">Nothing selected yet — choose {noun} from step 3.</p>}
              <div className="total-row"><span>Total payable</span><span className="total-amt">{money(total)}</span></div>
              <Field label="Payment mode"><div className="pay-modes">{modes.map((m) => <button type="button" key={m.PaymentModeId} className={`pay-mode ${form.PaymentMode === m.ModeName ? 'selected' : ''}`} onClick={() => setForm({ ...form, PaymentMode: m.ModeName })}>{m.ModeName}</button>)}</div></Field>
              {modes.find((m) => m.ModeName === form.PaymentMode)?.ShowUpiQr && <p className="muted-note"><QrCode size={11} style={{ verticalAlign: '-1px' }} /> {location?.UpiVpa ? `A UPI QR for the exact amount prints on the token (pay to ${location.UpiVpa}).` : 'No UPI ID is set for this location yet — add it in Locations to print a scan-to-pay QR.'}</p>}
              {counters.length > 0 && <div style={{ marginTop: 10 }}><Field label="Counter"><select className="input" value={form.CounterId} onChange={(e) => setForm({ ...form, CounterId: e.target.value })}><option value="">— Not specified —</option>{counters.map((c) => <option key={c.CounterId} value={c.CounterId}>{c.CounterName}</option>)}</select></Field></div>}
              <div style={{ display: 'grid', gap: 8, marginTop: 14 }}>
                <button className="btn btn-primary btn-block" disabled={saving || !lines.length || !canCreate}>{!canCreate ? 'View only — no create permission' : saving ? 'Processing…' : `Confirm & generate ${type.TokenPrefix} token`}</button>
                <button type="button" className="btn btn-ghost btn-block" onClick={reset}><RotateCcw size={15} />Reset</button>
              </div>
            </div>
          </aside>
        </div>

        {/* Mobile Sticky Bottom Checkout Bar */}
        {lines.length > 0 && (
          <div className="mobile-checkout-bar">
            <button type="button" className="mobile-bar-info" onClick={() => summaryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
              <small>{lines.length} {lines.length === 1 ? 'item' : 'items'} · {form.PaymentMode || 'Cash'} · Review ↑</small>
              <b>{money(total)}</b>
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving || !canCreate}>
              {saving ? 'Saving…' : `Generate ${type.TokenPrefix}`}
            </button>
          </div>
        )}
      </form>
      {receipt && <ReceiptModal booking={receipt} onClose={() => { setReceipt(null); focusMobile(); }} />}
      <Toast msg={toast?.m} error={toast?.err} />
    </>
  );
}

// Receipt — header, address, phone and footer come from the location chosen at login
export function ReceiptModal({ booking, onClose }) {
  const { location, config } = useAuth();
  const rows = [
    ['Booking ID', booking.BookingNumber], ['Type', booking.BookingType], booking.TempleName && ['Temple', booking.TempleName],
    booking.DevoteeName && ['Devotee', booking.DevoteeName], booking.Mobile && ['Mobile', booking.Mobile],
    booking.Gothram && ['Gothram', booking.Gothram], booking.Nakshatram && ['Nakshatram', booking.Nakshatram],
    ['Date & time', `${fmtDate(booking.SevaDate)} · ${fmtTime(booking.SevaTime)}`], ['Payment', `${booking.PaymentMode} · ${booking.PaymentStatus}`],
    booking.CounterName && ['Counter', booking.CounterName], booking.IsAdvanceBooking && ['Advance booking', 'Yes'],
    booking.CreatedByName && ['Booked by', booking.CreatedByName],
  ].filter(Boolean);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><b>Token {booking.TokenNumber}</b><button className="icon-btn" onClick={onClose}><X size={17} /></button></div>
        <div className="modal-body">
          <div className="receipt">
            <div className="brand-mark" style={{ margin: '0 auto' }}><Landmark size={20} /></div>
            <h2 style={{ marginTop: 10 }}>{(booking.LocationName || location?.LocationName || '').toUpperCase()}</h2>
            {location?.Address && <p className="receipt-sub"><MapPin size={11} /> {location.Address}</p>}
            {location?.Phone && <p className="receipt-sub"><Phone size={11} /> {location.Phone}</p>}
            <div className="token">{booking.TokenNumber}</div>
            <span className={`pill ${booking.IsCancelled ? 'red' : 'green'}`}>● {String(booking.PaymentStatus || '').toUpperCase()}</span>
            <div className="receipt-data">
              {rows.map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}
              {(booking.Items || []).map((i, idx) => <div key={idx}><span>{i.ItemName} × {i.Quantity}</span><b>{money(i.TotalAmount)}</b></div>)}
            </div>
            <div className="total-row"><span>Amount</span><span className="total-amt">{money(booking.TotalAmount)}</span></div>
            <UpiQr booking={booking} />
            {location?.ReceiptFooter && <p className="receipt-foot">{location.ReceiptFooter}</p>}
            {config?.brandLogoUrl && <div className="receipt-powered"><span>Powered by</span><img src={config.brandLogoUrl} alt={config.brandName || ''} /></div>}
          </div>
        </div>
        <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>Close</button><button className="btn btn-primary" onClick={() => window.print()}><Printer size={15} />Print token</button></div>
      </div>
    </div>
  );
}

// Scan-to-pay UPI QR (VPA + exact amount) — shown when the booking's payment mode is flagged "Show UPI QR",
// the location has a UPI ID, the booking is not cancelled and the amount is within AppSettings.upiMaxAmount.
function UpiQr({ booking }) {
  const { location, config } = useAuth();
  const [src, setSrc] = useState('');
  const amount = Number(booking.TotalAmount || 0);
  const max = Number(config?.upiMaxAmount) || 0;
  const vpa = location?.UpiVpa || '';
  const eligible = !!booking.ShowUpiQr && !booking.IsCancelled && amount > 0;
  const ok = eligible && !!vpa && (!max || amount <= max);
  const link = ok ? upiLink({ vpa, name: location.UpiPayeeName || location.LocationName, amount, note: `${booking.BookingType} ${booking.TokenNumber} ${booking.BookingNumber}`, ref: booking.BookingNumber, includeRef: !!config?.upiIncludeTxnRef }) : '';
  useEffect(() => {
    let alive = true;
    if (!link) { setSrc(''); return undefined; }
    QRCode.toString(link, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
      .then((svg) => { if (alive) setSrc(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`); })
      .catch(() => { if (alive) setSrc(''); });
    return () => { alive = false; };
  }, [link]);
  if (!eligible) return null;
  if (!vpa) return <p className="upi-note no-print">No UPI ID is set for {location?.LocationName}. Add it in Locations to print a scan-to-pay QR.</p>;
  if (!ok) return <p className="upi-note no-print">{money(amount)} is above the UPI limit of {money(max)} per payment — collect it by another mode.</p>;
  return (
    <div className="upi-box" data-upi={link}>
      <b>Scan &amp; pay with any UPI app</b>
      {src ? <img src={src} alt={`UPI QR to pay ${money(amount)} to ${vpa}`} /> : <span className="spinner" />}
      <span className="upi-amt">{money(amount)}</span>
      <small>Pay to <code>{vpa}</code>{location.UpiPayeeName ? ` · ${location.UpiPayeeName}` : ''}</small>
      <small>Amount is fixed in the QR · note {booking.TokenNumber}</small>
    </div>
  );
}