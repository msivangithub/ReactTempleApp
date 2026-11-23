import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, HeartHandshake } from 'lucide-react';
import { get, post, put, del, todayISO, fmtDate, isValidMobile } from '../api.js';
import { PageHead } from '../components/Layout.jsx';
import { Field, Modal, Toast, Empty, SearchBox, StatusPill, Pager, usePageSize, useDevoteeLookup, DevoteeHint, AuditInfo, ByCell } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';

const defaultOf = (list) => list.find((x) => x.IsDefault && x.IsActive) || list.find((x) => x.IsActive) || list[0];

export default function MembersPage() {
  const { can, location } = useAuth();
  const [rows, setRows] = useState([]); const [temples, setTemples] = useState([]); const [deities, setDeities] = useState([]);
  const [frequencies, setFrequencies] = useState([]); const [statuses, setStatuses] = useState([]);
  const [q, setQ] = useState(''); const [status, setStatus] = useState(''); const [show, setShow] = useState(false); const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({}); const [toast, setToast] = useState(null);
  const [total, setTotal] = useState(0); const [page, setPage] = useState(1); const [pageSize, setPageSize, sizeOptions] = usePageSize(); const [loaded, setLoaded] = useState(false);
  const lookup = useDevoteeLookup(form.Mobile, show && !editing); // new member: reuse details from earlier bookings
  const notify = (m, err = false) => { setToast({ m, err }); setTimeout(() => setToast(null), 2800); };

  useEffect(() => {
    Promise.all([get('/temples?activeOnly=true'), get('/deities?activeOnly=true'), get('/member-frequencies'), get('/member-statuses')])
      .then(([t, d, f, s]) => { setTemples(t); setDeities(d); setFrequencies(f); setStatuses(s); }).catch((e) => notify(e.message, true));
  }, []);
  const load = async (pg = page) => {
    try {
      const p = new URLSearchParams({ page: String(pg), pageSize: String(pageSize) }); if (q) p.set('search', q); if (status) p.set('status', status);
      const d = await get(`/members?${p}`);
      if (!d.rows.length && d.total && pg > 1) { setPage(Math.ceil(d.total / pageSize)); return; }
      setRows(d.rows); setTotal(d.total);
    } catch (e) { notify(e.message, true); } finally { setLoaded(true); }
  };
  useEffect(() => { setPage(1); }, [q, status, pageSize]);
  useEffect(() => { const h = setTimeout(() => load(page), 200); return () => clearTimeout(h); }, [q, status, page, pageSize]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { // prefill the name from the devotee's earlier bookings (only into empty fields)
    if (lookup.status === 'found' && !lookup.data.member) setForm((f) => ({ ...f, MemberName: f.MemberName || lookup.data.DevoteeName || '' }));
  }, [lookup]);

  const openAdd = () => { setEditing(null); setForm({ MemberName: '', Mobile: '', Email: '', Address: '', TempleId: (temples.find((t) => t.IsMainTemple) || temples[0])?.TempleId || '', DeityId: '', PoojaName: '', NextPoojaDate: todayISO(), Frequency: defaultOf(frequencies.filter((x) => x.IsActive))?.FrequencyName || '', Status: defaultOf(statuses.filter((x) => x.IsActive))?.StatusName || '' }); setShow(true); };
  const openEdit = (r) => { setEditing(r); setForm({ ...r, TempleId: r.TempleId ?? '', DeityId: r.DeityId ?? '' }); setShow(true); };
  async function save(e) {
    e?.preventDefault();
    if (!form.MemberName?.trim()) return notify('Member name is required', true);
    if (!isValidMobile(form.Mobile)) return notify('Enter a valid mobile number', true);
    const payload = { ...form, TempleId: form.TempleId ? Number(form.TempleId) : null, DeityId: form.DeityId ? Number(form.DeityId) : null };
    try { if (editing) { await put(`/members/${editing.MemberId}`, payload); notify('Member updated'); } else { await post('/members', payload); notify('Member registered'); } setShow(false); load(); }
    catch (err) { notify(err.message, true); }
  }
  async function remove(r) { if (!confirm(`Delete member ${r.MemberName}?`)) return; try { await del(`/members/${r.MemberId}`); notify('Deleted'); load(); } catch (e) { notify(e.message, true); } }
  const templeDeities = deities.filter((d) => String(d.TempleId) === String(form.TempleId));
  const opts = (list, nameKey, current) => list.filter((x) => x.IsActive || x[nameKey] === current);

  return (
    <>
      <PageHead screen="lifetime_members" eyebrow={location?.LocationName} title="Lifetime Members" desc={`Members registered at ${location?.LocationName} and their upcoming pooja schedules.`}
        action={can('lifetime_members', 'CanCreate') && <button className="btn btn-primary" onClick={openAdd}><Plus size={16} />Register member</button>} />
      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} placeholder="Search name, mobile or member no…" />
        <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{statuses.map((s) => <option key={s.MemberStatusId} value={s.StatusName}>{s.StatusName}</option>)}</select>
        <span className="pill gray">{total} members</span>
      </div>
      <section className="card">
        {rows.length ? <div className="table-wrap"><table><thead><tr><th>Member</th><th>Mobile</th><th>Temple / pooja</th><th>Next pooja</th><th>Frequency</th><th>Status</th><th>Created by</th><th /></tr></thead>
          <tbody>{rows.map((m) => (
            <tr key={m.MemberId}>
              <td data-label="Member"><b>{m.MemberName}</b><small>{m.MemberNumber}</small></td>
              <td data-label="Mobile">{m.Mobile}<small>{m.Email}</small></td>
              <td data-label="Temple">{m.TempleName || '—'}<small>{[m.DeityName, m.PoojaName].filter(Boolean).join(' · ')}</small></td>
              <td data-label="Next pooja">{fmtDate(m.NextPoojaDate)}</td>
              <td data-label="Frequency">{m.Frequency}</td>
              <td data-label="Status"><StatusPill status={m.Status} /></td>
              <td data-label="Created by"><ByCell row={m} /></td>
              <td className="row-actions">{can('lifetime_members', 'CanEdit') && <button className="btn btn-ghost btn-sm" onClick={() => openEdit(m)}><Pencil size={13} /> Edit</button>}{can('lifetime_members', 'CanDelete') && <button className="btn btn-danger btn-sm" onClick={() => remove(m)} aria-label="Delete"><Trash2 size={13} /></button>}</td>
            </tr>
          ))}</tbody></table></div>
          : loaded ? <Empty icon={HeartHandshake} title="No members found" text="Register a lifetime member to maintain pooja schedules." /> : <div className="card-body muted">Loading…</div>}
        <Pager page={page} pageSize={pageSize} total={total} setPage={setPage} setPageSize={setPageSize} options={sizeOptions} noun="members" />
      </section>
      {show && <Modal title={editing ? `Edit ${editing.MemberNumber}` : 'Register member'} onClose={() => setShow(false)} footer={<><button className="btn btn-ghost" onClick={() => setShow(false)}>Cancel</button><button className="btn btn-primary" onClick={save}>{editing ? 'Save changes' : 'Register'}</button></>}>
        {editing && <AuditInfo row={editing} />}
        <form onSubmit={save}><div className="field-grid">
          <Field label="Mobile" required><input className="input" inputMode="numeric" maxLength={15} autoFocus={!editing} value={form.Mobile} onChange={(e) => setForm({ ...form, Mobile: e.target.value.replace(/\D/g, '') })} />
            {!editing && (lookup.status === 'found' && lookup.data.member ? <span className="lookup-hint" style={{ color: 'var(--amber)' }}><span>Already a member: {lookup.data.member.MemberNumber} · {lookup.data.member.MemberName}</span></span> : <DevoteeHint lookup={lookup} />)}</Field>
          <Field label="Member name" required><input className="input" value={form.MemberName} onChange={(e) => setForm({ ...form, MemberName: e.target.value })} /></Field>
          <Field label="Email"><input className="input" type="email" value={form.Email || ''} onChange={(e) => setForm({ ...form, Email: e.target.value })} /></Field>
          <Field label="Temple"><select className="input" value={form.TempleId} onChange={(e) => setForm({ ...form, TempleId: e.target.value, DeityId: '' })}><option value="">— None —</option>{temples.map((t) => <option key={t.TempleId} value={t.TempleId}>{t.TempleName}</option>)}</select></Field>
          <Field label="Deity"><select className="input" value={form.DeityId} onChange={(e) => setForm({ ...form, DeityId: e.target.value })}><option value="">— None —</option>{templeDeities.map((d) => <option key={d.DeityId} value={d.DeityId}>{d.DeityName}</option>)}</select></Field>
          <Field label="Pooja name"><input className="input" value={form.PoojaName || ''} onChange={(e) => setForm({ ...form, PoojaName: e.target.value })} /></Field>
          <Field label="Next pooja date"><input className="input" type="date" value={form.NextPoojaDate || ''} onChange={(e) => setForm({ ...form, NextPoojaDate: e.target.value })} /></Field>
          <Field label="Frequency"><select className="input" value={form.Frequency} onChange={(e) => setForm({ ...form, Frequency: e.target.value })}>{opts(frequencies, 'FrequencyName', form.Frequency).map((f) => <option key={f.FrequencyId} value={f.FrequencyName}>{f.FrequencyName}</option>)}</select></Field>
          <Field label="Status"><select className="input" value={form.Status} onChange={(e) => setForm({ ...form, Status: e.target.value })}>{opts(statuses, 'StatusName', form.Status).map((s) => <option key={s.MemberStatusId} value={s.StatusName}>{s.StatusName}</option>)}</select></Field>
          <div className="wide"><Field label="Address"><input className="input" value={form.Address || ''} onChange={(e) => setForm({ ...form, Address: e.target.value })} /></Field></div>
        </div><button type="submit" hidden /></form>
      </Modal>}
      <Toast msg={toast?.m} error={toast?.err} />
    </>
  );
}
