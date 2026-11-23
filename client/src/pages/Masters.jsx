import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Search, Lock } from 'lucide-react';
import { get, post, put, del, money, fmtTime } from '../api.js';
import { PageHead, ICON_CHOICES, iconFor } from '../components/Layout.jsx';
import { Field, Modal, Toast, Empty, SearchBox, StatusPill, Pager, usePaged, AuditInfo, ByCell, hasAudit } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';

function useToast() { const [t, setT] = useState(null); const show = (m, err = false) => { setT({ m, err }); setTimeout(() => setT(null), 2800); }; return [t, show]; }
const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';
const activePill = (r) => <StatusPill status={r.IsActive ? 'Active' : 'Inactive'} />;
const defaultPill = (r) => (r.IsDefault ? <span className="pill green">Default</span> : <span className="muted">—</span>);
const usePill = (r) => (r.InUse ? <span className="pill gray">{r.InUse} records</span> : <span className="muted">—</span>);
export const refreshNav = () => window.dispatchEvent(new Event('nav:refresh'));

function FieldInput({ f, form, setForm, extras }) {
  const v = form[f.key];
  const set = (val) => setForm((p) => ({ ...p, [f.key]: val, ...(f.onChange ? f.onChange(val, p) : {}) }));
  if (f.type === 'select') {
    const opts = typeof f.options === 'function' ? f.options(extras, form) : f.options || [];
    return (
      <select className="input" value={v ?? ''} onChange={(e) => set(e.target.value)}>
        {f.placeholder !== false && <option value="">{f.placeholder || '— Select —'}</option>}
        {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }
  if (f.type === 'textarea') return <textarea className="input" rows={2} value={v ?? ''} onChange={(e) => set(e.target.value)} placeholder={f.placeholder} />;
  return <input className="input" type={f.type || 'text'} value={v ?? ''} onChange={(e) => set(f.upper ? e.target.value.toUpperCase() : e.target.value)} placeholder={f.placeholder} min={f.min} step={f.step} maxLength={f.maxLength} />;
}

// Generic CRUD master: table + search + optional filter + add/edit modal, all permission-gated per screen
export function MasterPage({ title, singular, eyebrow, desc, endpoint, idKey, screen, columns, formFields, fetchExtras, toForm, toPayload, filter, onSaved, locked, emptyText }) {
  const [rows, setRows] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState('');
  const [fv, setFv] = useState('');
  const [show, setShow] = useState(false);
  const [editing, setEditing] = useState(null);
  const cols = rows.some(hasAudit) ? [...columns, { key: '__by', label: 'Created by', render: (r) => <ByCell row={r} /> }] : columns; // who created / changed each record
  const [form, setForm] = useState({});
  const [extras, setExtras] = useState({});
  const [saving, setSaving] = useState(false);
  const [toast, notify] = useToast();
  const { can } = useAuth();
  const name = singular || title.replace(/s$/, '');

  const load = async () => {
    try { const [data, ex] = await Promise.all([get(endpoint), fetchExtras ? fetchExtras() : Promise.resolve({})]); setRows(data); setExtras(ex); }
    catch (e) { notify(e.message, true); } finally { setLoaded(true); }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = (f) => !f.show || f.show(form, extras);
  const openAdd = () => { setEditing(null); setForm(Object.fromEntries(formFields.map((f) => [f.key, typeof f.default === 'function' ? f.default(extras) : f.default ?? (f.type === 'checkbox' ? false : '')]))); setShow(true); };
  const openEdit = (row) => { const base = Object.fromEntries(formFields.map((f) => [f.key, row[f.key] ?? (f.type === 'checkbox' ? false : '')])); setEditing(row); setForm(toForm ? toForm(row, base) : base); setShow(true); };

  async function save(e) {
    e?.preventDefault();
    for (const f of formFields) if (f.required && visible(f) && isBlank(form[f.key])) return notify(`${f.label} is required`, true);
    const payload = {};
    formFields.forEach((f) => { if (!visible(f)) return; let v = form[f.key]; if (f.number) v = isBlank(v) ? null : Number(v); payload[f.key] = v; });
    setSaving(true);
    try {
      const res = editing ? await put(`${endpoint}/${editing[idKey]}`, toPayload ? toPayload(payload) : payload) : await post(endpoint, toPayload ? toPayload(payload) : payload);
      notify(editing ? `${name} updated` : `${name} created`); setShow(false); await load(); onSaved?.(res, editing ? 'update' : 'create');
    } catch (err) { notify(err.message, true); } finally { setSaving(false); }
  }
  async function remove(row) {
    if (!confirm(`Delete this ${name.toLowerCase()}? This cannot be undone.`)) return;
    try { await del(`${endpoint}/${row[idKey]}`); notify(`${name} deleted`); await load(); onSaved?.(row, 'delete'); } catch (e) { notify(e.message, true); }
  }

  const filterOptions = filter ? (typeof filter.options === 'function' ? filter.options(extras, rows) : filter.options) : [];
  const filtered = rows.filter((r) => (!fv || String(r[filter.key]) === fv) && (!q || JSON.stringify(r).toLowerCase().includes(q.toLowerCase())));
  const pg = usePaged(filtered, `${q}|${fv}`);
  const canEdit = can(screen, 'CanEdit'), canDelete = can(screen, 'CanDelete'), canCreate = can(screen, 'CanCreate');
  const addBtn = canCreate && <button className="btn btn-primary" onClick={openAdd}><Plus size={16} />Add {name.toLowerCase()}</button>;

  return (
    <>
      <PageHead eyebrow={eyebrow} title={title} desc={desc} action={addBtn} screen={screen} />
      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} placeholder={`Search ${title.toLowerCase()}…`} />
        {filter && <select value={fv} onChange={(e) => setFv(e.target.value)}><option value="">{filter.label}</option>{filterOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>}
        <span className="pill gray">{filtered.length} records</span>
      </div>
      <section className="card">
        {filtered.length ? (
          <div className="table-wrap"><table>
            <thead><tr>{cols.map((c) => <th key={c.key} className={c.right ? 'right' : ''}>{c.label}</th>)}{(canEdit || canDelete) && <th />}</tr></thead>
            <tbody>{pg.pageRows.map((r) => { const lock = locked?.(r); return (
              <tr key={r[idKey]}>
                {cols.map((c) => <td key={c.key} className={c.right ? 'right' : ''} data-label={c.label}>{c.render ? c.render(r) : isBlank(r[c.key]) ? '—' : String(r[c.key])}</td>)}
                {(canEdit || canDelete) && <td className="row-actions">
                  {lock ? <span className="pill gray" title={lock}><Lock size={11} /> Locked</span> : <>
                    {canEdit && <button className="btn btn-ghost btn-sm" onClick={() => openEdit(r)}><Pencil size={13} /> Edit</button>}
                    {canDelete && <button className="btn btn-danger btn-sm" onClick={() => remove(r)} aria-label="Delete"><Trash2 size={13} /></button>}
                  </>}
                </td>}
              </tr>); })}
            </tbody>
          </table></div>
        ) : loaded ? <Empty icon={Search} title={rows.length ? 'No matching records' : 'No records yet'} text={rows.length ? 'Try a different search or filter.' : emptyText || 'Add your first record to get started.'} action={!rows.length && addBtn} /> : <div className="card-body muted">Loading…</div>}
        <Pager {...pg} />
      </section>

      {show && (
        <Modal title={editing ? `Edit ${name.toLowerCase()}` : `Add ${name.toLowerCase()}`} onClose={() => setShow(false)}
          footer={<><button className="btn btn-ghost" onClick={() => setShow(false)}>Cancel</button><button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Create'}</button></>}>
          {editing && <AuditInfo row={editing} />}
          <form onSubmit={save}><div className="field-grid">
            {formFields.filter(visible).map((f) => f.type === 'checkbox' ? (
              <label key={f.key} className={`check-row ${f.wide ? 'wide' : ''}`}><input type="checkbox" checked={!!form[f.key]} onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.checked }))} /><span>{f.checkLabel || f.label}{f.hint && <small>{f.hint}</small>}</span></label>
            ) : (
              <div key={f.key} className={f.wide ? 'wide' : ''}><Field label={f.label} required={f.required} hint={f.hint}><FieldInput f={f} form={form} setForm={setForm} extras={extras} /></Field></div>
            ))}
          </div><button type="submit" hidden /></form>
        </Modal>
      )}
      <Toast msg={toast?.m} error={toast?.err} />
    </>
  );
}

// ---------- Locations (global) — each location's details drive branding, receipts and data scope ----------
export function LocationsPage() {
  const { refresh, reloadConfig } = useAuth();
  return <MasterPage title="Locations" singular="Location" eyebrow="Administration" desc="Every location has its own temples, sevas, items, counters, time slots, bookings and receipts. Users sign in to a location."
    endpoint="/locations" idKey="LocationId" screen="locations" onSaved={() => { refresh(); reloadConfig(); }}
    columns={[
      { key: 'LocationName', label: 'Location', render: (r) => <><b>{r.LocationName}</b>{r.IsCurrent && <span className="pill blue" style={{ marginLeft: 6 }}>Signed in</span>}<small>{r.Address}</small></> },
      { key: 'LocationCode', label: 'Code', render: (r) => (r.LocationCode ? <span className="pill purple">{r.LocationCode}</span> : '—') },
      { key: 'Phone', label: 'Contact', render: (r) => <>{r.Phone || '—'}<small>{r.Email}</small></> },
      { key: 'UpiVpa', label: 'UPI ID', render: (r) => (r.UpiVpa ? <>{r.UpiVpa}<small>{r.UpiPayeeName}</small></> : <span className="muted">—</span>) },
      { key: 'TempleCount', label: 'Temples', render: (r) => `${r.TempleCount || 0}` },
      { key: 'UserCount', label: 'Users', render: (r) => `${r.UserCount || 0}` },
      { key: 'IsActive', label: 'Status', render: activePill },
    ]}
    formFields={[
      { key: 'LocationName', label: 'Location name', required: true },
      { key: 'LocationCode', label: 'Short code', upper: true, maxLength: 10, placeholder: 'e.g. UTP' },
      { key: 'Phone', label: 'Phone' },
      { key: 'Email', label: 'Email', type: 'email' },
      { key: 'Address', label: 'Address', wide: true },
      { key: 'Description', label: 'Description', type: 'textarea', wide: true },
      { key: 'ReceiptFooter', label: 'Receipt footer', type: 'textarea', wide: true, placeholder: 'Printed at the bottom of every token at this location' },
      { key: 'UpiVpa', label: 'UPI ID (VPA) for receipts', placeholder: 'e.g. templename@sbi', hint: 'Prints a scan-to-pay QR with the exact amount on tokens paid by a UPI-QR payment mode. A merchant/business UPI ID keeps the amount locked in every app.' },
      { key: 'UpiPayeeName', label: 'UPI payee name', placeholder: 'Name on the UPI account', hint: 'Optional. Apps show the bank-registered name of the UPI ID.' },
      { key: 'DisplayOrder', label: 'Display order', type: 'number', number: true, default: 0 },
      { key: 'IsActive', label: 'Active', type: 'checkbox', checkLabel: 'Active — shown on the login screen', default: true },
    ]} />;
}

// ---------- Temples / Deities (current location) ----------
export function TemplesPage() {
  const { location, reloadConfig } = useAuth();
  return <MasterPage title="Temples" singular="Temple" eyebrow={location?.LocationName} desc={`Temples at ${location?.LocationName}. Each temple has its own deities, sevas and time slots.`}
    endpoint="/temples" idKey="TempleId" screen="temple_mgmt" onSaved={reloadConfig}
    columns={[
      { key: 'TempleName', label: 'Temple', render: (r) => <><b>{r.TempleName}</b>{r.IsMainTemple && <span className="pill amber" style={{ marginLeft: 6 }}>Main</span>}<small>{r.Description}</small></> },
      { key: 'DeityCount', label: 'Deities' }, { key: 'SevaCount', label: 'Sevas' },
      { key: 'Address', label: 'Address' }, { key: 'IsActive', label: 'Status', render: activePill },
    ]}
    formFields={[
      { key: 'TempleName', label: 'Temple name', required: true, wide: true },
      { key: 'Description', label: 'Description', type: 'textarea', wide: true },
      { key: 'Address', label: 'Address', wide: true },
      { key: 'DisplayOrder', label: 'Display order', type: 'number', number: true, default: 0 },
      { key: 'IsMainTemple', label: 'Main temple', type: 'checkbox', checkLabel: 'Main temple (preselected in booking)', default: false },
      { key: 'IsActive', label: 'Active', type: 'checkbox', default: true },
    ]} />;
}

export function DeitiesPage() {
  const { location } = useAuth();
  return <MasterPage title="Deities" singular="Deity" eyebrow={location?.LocationName} desc="Deities belong to a temple. Sevas can be linked to a specific deity."
    endpoint="/deities" idKey="DeityId" screen="deity_mgmt"
    fetchExtras={async () => ({ temples: await get('/temples') })}
    filter={{ key: 'TempleId', label: 'All temples', options: (ex) => (ex.temples || []).map((t) => ({ value: String(t.TempleId), label: t.TempleName })) }}
    columns={[
      { key: 'DeityName', label: 'Deity', render: (r) => <><b>{r.DeityName}</b>{r.IsMainDeity && <span className="pill amber" style={{ marginLeft: 6 }}>Main</span>}<small>{r.Description}</small></> },
      { key: 'TempleName', label: 'Temple' }, { key: 'IsActive', label: 'Status', render: activePill },
    ]}
    formFields={[
      { key: 'DeityName', label: 'Deity name', required: true },
      { key: 'TempleId', label: 'Temple', type: 'select', required: true, number: true, default: (ex) => ex.temples?.[0]?.TempleId ?? '', options: (ex) => (ex.temples || []).map((t) => ({ value: t.TempleId, label: t.TempleName })) },
      { key: 'Description', label: 'Description', type: 'textarea', wide: true },
      { key: 'DisplayOrder', label: 'Display order', type: 'number', number: true, default: 0 },
      { key: 'IsMainDeity', label: 'Main deity', type: 'checkbox', default: false },
      { key: 'IsActive', label: 'Active', type: 'checkbox', default: true },
    ]} />;
}

export function CategoriesPage() {
  return <MasterPage title="Seva Categories" singular="Category" eyebrow="Masters" desc="Categories group sevas in the Seva Master and on the seva booking screen. Shared by all locations."
    endpoint="/seva-categories" idKey="CategoryId" screen="seva_categories"
    columns={[{ key: 'CategoryName', label: 'Category', render: (r) => <b>{r.CategoryName}</b> }, { key: 'SevaCount', label: 'Sevas' }, { key: 'IsActive', label: 'Status', render: activePill }]}
    formFields={[
      { key: 'CategoryName', label: 'Category name', required: true },
      { key: 'DisplayOrder', label: 'Display order', type: 'number', number: true, default: 0 },
      { key: 'IsActive', label: 'Active', type: 'checkbox', default: true },
    ]} />;
}

export function CountersPage() {
  const { location } = useAuth();
  return <MasterPage title="Counters" singular="Counter" eyebrow={location?.LocationName} desc={`Counter stations at ${location?.LocationName}. An operator's assigned counter is preselected on booking screens.`}
    endpoint="/counters" idKey="CounterId" screen="counters"
    fetchExtras={async () => ({ users: await get('/users/lookup') })}
    columns={[
      { key: 'CounterName', label: 'Counter', render: (r) => <b>{r.CounterName}</b> },
      { key: 'Location', label: 'Area / position' },
      { key: 'AssignedUserName', label: 'Assigned to', render: (r) => r.AssignedUserName || '—' },
      { key: 'IsActive', label: 'Status', render: activePill },
    ]}
    formFields={[
      { key: 'CounterName', label: 'Counter name', required: true },
      { key: 'Location', label: 'Area / position', placeholder: 'e.g. Main gate' },
      { key: 'AssignedUserId', label: 'Assigned user', type: 'select', number: true, placeholder: '— Unassigned —', options: (ex) => (ex.users || []).map((u) => ({ value: u.UserId, label: `${u.FullName} (@${u.Username})` })) },
      { key: 'IsActive', label: 'Active', type: 'checkbox', default: true },
    ]} />;
}

// ---------- Seva Master (temple-wise sevas & prices for Seva-type bookings) ----------
export function SevasPage() {
  const { location, config } = useAuth();
  return <MasterPage title="Seva Master" singular="Seva" eyebrow={location?.LocationName} desc="Temple-wise sevas and prices for seva bookings. Prices are applied automatically at booking."
    endpoint="/sevas" idKey="SevaId" screen="seva_master"
    fetchExtras={async () => { const [temples, deities, categories] = await Promise.all([get('/temples'), get('/deities'), get('/seva-categories')]); return { temples, deities, categories }; }}
    filter={{ key: 'TempleId', label: 'All temples', options: (ex) => (ex.temples || []).map((t) => ({ value: String(t.TempleId), label: t.TempleName })) }}
    emptyText="Add a seva for a temple to start taking seva bookings."
    columns={[
      { key: 'SevaName', label: 'Seva', render: (r) => <><b>{r.SevaName}</b><small>{r.Description}</small></> },
      { key: 'TempleName', label: 'Temple / deity', render: (r) => <>{r.TempleName}<small>{r.DeityName}</small></> },
      { key: 'CategoryName', label: 'Category', render: (r) => <span className="pill purple">{r.CategoryName}</span> },
      { key: 'Amount', label: 'Amount', right: true, render: (r) => <b>{money(r.Amount)}</b> },
      { key: 'IsActive', label: 'Status', render: activePill },
    ]}
    formFields={[
      { key: 'SevaName', label: 'Seva name', required: true, wide: true },
      { key: 'TempleId', label: 'Temple', type: 'select', required: true, number: true, default: (ex) => ex.temples?.[0]?.TempleId ?? '', options: (ex) => (ex.temples || []).map((t) => ({ value: t.TempleId, label: t.TempleName })), onChange: () => ({ DeityId: '' }) },
      { key: 'DeityId', label: 'Deity', type: 'select', number: true, placeholder: '— None —', options: (ex, f) => (ex.deities || []).filter((d) => String(d.TempleId) === String(f.TempleId)).map((d) => ({ value: d.DeityId, label: d.DeityName })) },
      { key: 'CategoryId', label: 'Category', type: 'select', required: true, number: true, default: (ex) => ex.categories?.find((c) => c.IsActive)?.CategoryId ?? '', options: (ex) => (ex.categories || []).filter((c) => c.IsActive).map((c) => ({ value: c.CategoryId, label: c.CategoryName })) },
      { key: 'Amount', label: `Amount${config?.currencySymbol ? ` (${config.currencySymbol})` : ''}`, type: 'number', number: true, required: true, min: 0, step: '0.01' },
      { key: 'Description', label: 'Description', wide: true },
      { key: 'IsActive', label: 'Active', type: 'checkbox', default: true },
    ]} />;
}

// ---------- Item Master (separate items per booking type, e.g. Laddu / Goshala — per location) ----------
export function ItemsPage() {
  const { location, config } = useAuth();
  const cur = config?.currencySymbol ? ` (${config.currencySymbol})` : '';
  return <MasterPage title="Item Master" singular="Item" eyebrow={location?.LocationName} desc={`Separate items and prices for each non-seva booking type at ${location?.LocationName} — e.g. laddu varieties, goshala tickets and donations.`}
    endpoint="/items" idKey="ItemId" screen="item_master"
    fetchExtras={async () => { const [types, temples] = await Promise.all([get('/booking-types'), get('/temples')]); return { types: types.filter((t) => !t.UsesSevaMaster), temples }; }}
    filter={{ key: 'BookingTypeId', label: 'All booking types', options: (ex) => (ex.types || []).map((t) => ({ value: String(t.BookingTypeId), label: t.TypeName })) }}
    emptyText="Add items for a booking type (for example Laddu or Goshala)."
    columns={[
      { key: 'ItemName', label: 'Item', render: (r) => <><b>{r.ItemName}</b><small>{r.Description}</small></> },
      { key: 'TypeName', label: 'Booking type', render: (r) => <span className="pill purple">{r.TypeName}</span> },
      { key: 'TempleName', label: 'Temple', render: (r) => r.TempleName || <span className="muted">All temples</span> },
      { key: 'Unit', label: 'Unit' },
      { key: 'Amount', label: 'Price', right: true, render: (r) => <><b>{money(r.Amount)}</b>{r.AllowCustomAmount && <small>any amount{Number(r.MinAmount) ? ` · min ${money(r.MinAmount)}` : ''}</small>}</> },
      { key: 'IsActive', label: 'Status', render: activePill },
    ]}
    formFields={[
      { key: 'BookingTypeId', label: 'Booking type', type: 'select', required: true, number: true, default: (ex) => ex.types?.[0]?.BookingTypeId ?? '', options: (ex) => (ex.types || []).map((t) => ({ value: t.BookingTypeId, label: t.TypeName })) },
      { key: 'ItemName', label: 'Item name', required: true },
      { key: 'Amount', label: `Price${cur}`, type: 'number', number: true, required: true, min: 0, step: '0.01' },
      { key: 'Unit', label: 'Unit', placeholder: 'e.g. Nos, Person' },
      { key: 'TempleId', label: 'Temple', type: 'select', number: true, placeholder: 'All temples at this location', options: (ex) => (ex.temples || []).map((t) => ({ value: t.TempleId, label: t.TempleName })) },
      { key: 'DisplayOrder', label: 'Display order', type: 'number', number: true, default: 0 },
      { key: 'AllowCustomAmount', label: 'Custom amount', type: 'checkbox', checkLabel: 'Devotee may enter an amount (donations)', default: false, wide: true },
      { key: 'MinAmount', label: `Minimum amount${cur}`, type: 'number', number: true, min: 0, default: 0, show: (f) => !!f.AllowCustomAmount },
      { key: 'Description', label: 'Description', wide: true },
      { key: 'IsActive', label: 'Active', type: 'checkbox', default: true },
    ]} />;
}

// ---------- Lookup masters ----------
export function BookingTypesPage() {
  const { refresh } = useAuth();
  return <MasterPage title="Booking Types" singular="Booking type" eyebrow="Masters" desc="Each booking type has its own booking screen, items, token prefix and rules. New types appear in the menu automatically — grant access in Roles & Permissions."
    endpoint="/booking-types" idKey="BookingTypeId" screen="booking_types" onSaved={() => { refreshNav(); refresh(); }}
    columns={[
      { key: 'TypeName', label: 'Type', render: (r) => { const I = iconFor(r.Icon); return <div className="cell-icon"><span className="mini-icon"><I size={15} /></span><div><b>{r.TypeName}</b><small>{r.Description}</small></div></div>; } },
      { key: 'TokenPrefix', label: 'Token', render: (r) => <span className="pill purple">{r.TokenPrefix}-00001</span> },
      { key: 'UsesSevaMaster', label: 'Items from', render: (r) => <span className={`pill ${r.UsesSevaMaster ? 'amber' : 'blue'}`}>{r.UsesSevaMaster ? 'Seva Master' : 'Item Master'}</span> },
      { key: 'Rules', label: 'Rules', render: (r) => <div className="pill-row">{[r.RequiresTemple && 'Temple', r.RequiresSchedule && 'Time', r.RequiresDevotee && 'Devotee', r.CaptureGothram && 'Gothram', r.AllowAdvance && 'Advance'].filter(Boolean).map((x) => <span key={x} className="pill gray">{x}</span>)}</div> },
      { key: 'IsDefault', label: 'Default', render: defaultPill },
      { key: 'IsActive', label: 'Status', render: activePill },
    ]}
    formFields={[
      { key: 'TypeName', label: 'Type name', required: true, placeholder: 'e.g. Prasadam' },
      { key: 'TokenPrefix', label: 'Token prefix', required: true, upper: true, maxLength: 5, placeholder: 'e.g. PR' },
      { key: 'Description', label: 'Description', placeholder: 'Shown on the booking screen and dashboard', wide: true },
      { key: 'Icon', label: 'Icon', type: 'select', placeholder: false, default: 'Ticket', options: ICON_CHOICES.map((i) => ({ value: i, label: i })) },
      { key: 'ScreenKey', label: 'Screen key', placeholder: 'Auto-generated from name', hint: 'Its own screen & permissions' },
      { key: 'UsesSevaMaster', label: 'Seva Master', type: 'checkbox', checkLabel: 'Items come from Seva Master (temple-wise sevas)', hint: 'Unchecked = items come from Item Master', default: false, wide: true },
      { key: 'RequiresTemple', label: 'Temple', type: 'checkbox', checkLabel: 'Temple is required', default: false },
      { key: 'RequiresSchedule', label: 'Time', type: 'checkbox', checkLabel: 'Time is always required', default: false },
      { key: 'RequiresDevotee', label: 'Devotee', type: 'checkbox', checkLabel: 'Devotee name & mobile required', default: true },
      { key: 'CaptureGothram', label: 'Gothram', type: 'checkbox', checkLabel: 'Capture gothram & nakshatram', default: false },
      { key: 'AllowAdvance', label: 'Advance', type: 'checkbox', checkLabel: 'Allow advance booking (date + time)', default: true },
      { key: 'IsDefault', label: 'Default', type: 'checkbox', checkLabel: 'Default type', default: false },
      { key: 'IsActive', label: 'Active', type: 'checkbox', default: true },
      { key: 'DisplayOrder', label: 'Display order', type: 'number', number: true, default: 0 },
    ]} />;
}

const lookupFields = (nameKey, nameLabel, extra = []) => [
  { key: nameKey, label: nameLabel, required: true }, ...extra,
  { key: 'DisplayOrder', label: 'Display order', type: 'number', number: true, default: 0 },
  { key: 'IsDefault', label: 'Default', type: 'checkbox', checkLabel: 'Default (preselected)', default: false },
  { key: 'IsActive', label: 'Active', type: 'checkbox', default: true },
];
const lookupColumns = (nameKey, label, pill = false, extra = []) => [
  { key: nameKey, label, render: (r) => (pill ? <StatusPill status={r[nameKey]} /> : <b>{r[nameKey]}</b>) }, ...extra,
  { key: 'InUse', label: 'Used by', render: usePill }, { key: 'IsDefault', label: 'Default', render: defaultPill }, { key: 'IsActive', label: 'Status', render: activePill },
];

export function PaymentModesPage() {
  return <MasterPage title="Payment Modes" singular="Payment mode" eyebrow="Masters" desc="Payment modes shown on every booking screen." endpoint="/payment-modes" idKey="PaymentModeId" screen="payment_modes"
    columns={lookupColumns('ModeName', 'Mode', false, [{ key: 'ShowUpiQr', label: 'UPI QR', render: (r) => (r.ShowUpiQr ? <span className="pill blue">QR on receipt</span> : <span className="muted">—</span>) }])}
    formFields={lookupFields('ModeName', 'Mode name', [{ key: 'ShowUpiQr', label: 'UPI QR', type: 'checkbox', checkLabel: 'Print a UPI scan-to-pay QR (exact amount) on receipts', hint: "Uses the UPI ID of the signed-in location", default: false, wide: true }])} />;
}
export function BookingStatusesPage() {
  return <MasterPage title="Booking Statuses" singular="Booking status" eyebrow="Masters" desc="Payment / booking statuses. Statuses flagged as cancelled are excluded from collections and used by the Cancel action."
    endpoint="/booking-statuses" idKey="BookingStatusId" screen="booking_statuses"
    columns={lookupColumns('StatusName', 'Status', true, [{ key: 'IsCancelled', label: 'Cancelled?', render: (r) => (r.IsCancelled ? <span className="pill red">Cancelled state</span> : <span className="muted">—</span>) }])}
    formFields={lookupFields('StatusName', 'Status name', [{ key: 'IsCancelled', label: 'Cancelled', type: 'checkbox', checkLabel: 'Represents a cancelled / refunded booking', default: false, wide: true }])} />;
}
export function MemberFrequenciesPage() {
  return <MasterPage title="Member Frequencies" singular="Frequency" eyebrow="Masters" desc="Pooja frequencies for lifetime members." endpoint="/member-frequencies" idKey="FrequencyId" screen="member_frequencies"
    columns={lookupColumns('FrequencyName', 'Frequency')} formFields={lookupFields('FrequencyName', 'Frequency name')} />;
}
export function MemberStatusesPage() {
  return <MasterPage title="Member Statuses" singular="Member status" eyebrow="Masters" desc="Lifetime member statuses. The default status is treated as active on the dashboard." endpoint="/member-statuses" idKey="MemberStatusId" screen="member_statuses"
    columns={lookupColumns('StatusName', 'Status', true)} formFields={lookupFields('StatusName', 'Status name')} />;
}

// ---------- Time slots: temple-specific → location-wide → global default ----------
export function TimeSlotsPage() {
  const { location, user } = useAuth();
  const scopeTone = (s) => (s === 'global' ? 'gray' : s === 'location' ? 'blue' : 'purple');
  return <MasterPage title="Time Slots" singular="Time slot" eyebrow={location?.LocationName} desc="Times offered when a booking needs a time (seva and advance bookings). Temple slots override location slots, which override the global default."
    endpoint="/time-slots" idKey="SlotId" screen="time_slots"
    fetchExtras={async () => ({ temples: await get('/temples') })}
    locked={(r) => (r.AppliesTo === 'global' && !user?.IsSuperAdmin ? 'Global default slots can only be changed by a super admin' : null)}
    filter={{ key: 'AppliesTo', label: 'All scopes', options: (ex, rows) => [...new Map(rows.map((r) => [r.AppliesTo, r.AppliesToLabel])).entries()].map(([value, label]) => ({ value, label })) }}
    columns={[
      { key: 'SlotTime', label: 'Time', render: (r) => <><b>{fmtTime(r.SlotTime)}</b>{r.SlotLabel && r.SlotLabel !== r.SlotTime && <small>{r.SlotLabel}</small>}</> },
      { key: 'AppliesToLabel', label: 'Applies to', render: (r) => <span className={`pill ${scopeTone(r.AppliesTo)}`}>{r.AppliesToLabel}</span> },
      { key: 'IsActive', label: 'Status', render: activePill },
    ]}
    toForm={(row, base) => ({ ...base, AppliesTo: row.AppliesTo })}
    formFields={[
      { key: 'SlotTime', label: 'Slot time', type: 'time', required: true },
      { key: 'SlotLabel', label: 'Display label', placeholder: 'Optional, e.g. Suprabhatam' },
      { key: 'AppliesTo', label: 'Applies to', type: 'select', required: true, placeholder: false, default: 'location', wide: true,
        options: (ex) => [{ value: 'location', label: `All temples at ${location?.LocationName}` }, ...(ex.temples || []).map((t) => ({ value: String(t.TempleId), label: t.TempleName })), ...(user?.IsSuperAdmin ? [{ value: 'global', label: 'All locations (global default)' }] : [])] },
      { key: 'DisplayOrder', label: 'Display order', type: 'number', number: true, default: 0 },
      { key: 'IsActive', label: 'Active', type: 'checkbox', default: true },
    ]} />;
}

