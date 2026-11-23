import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Users, MapPin, Globe2 } from 'lucide-react';
import { get, post, put, del } from '../api.js';
import { PageHead } from '../components/Layout.jsx';
import { Field, Modal, Toast, Empty, SearchBox, StatusPill, Pager, usePaged, AuditInfo, ByCell } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export default function UsersPage() {
  const { user: me, can, location, locations: myLocations, refresh } = useAuth();
  const [rows, setRows] = useState([]); const [roles, setRoles] = useState([]); const [allLocations, setAllLocations] = useState([]);
  const [q, setQ] = useState(''); const [scope, setScope] = useState(''); const [show, setShow] = useState(false); const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({}); const [saving, setSaving] = useState(false); const [toast, setToast] = useState(null);
  const notify = (m, err = false) => { setToast({ m, err }); setTimeout(() => setToast(null), 3000); };
  const load = async () => {
    try { const [u, r, l] = await Promise.all([get('/users'), get('/roles'), get('/locations')]); setRows(u); setRoles(r); setAllLocations(l); }
    catch (e) { notify(e.message, true); }
  };
  useEffect(() => { load(); }, []);

  // Only offer roles / locations the current admin is allowed to grant (server enforces the same rules)
  const grantableRoles = roles.filter((r) => r.IsActive !== false && (me?.IsSuperAdmin || !r.IsSuperAdmin));
  const canGrantAll = me?.IsSuperAdmin || me?.AllLocations;
  const grantableLocs = canGrantAll ? allLocations : allLocations.filter((l) => myLocations.some((m) => m.LocationId === l.LocationId));

  const openAdd = () => { setEditing(null); setForm({ Username: '', Password: '', FullName: '', Mobile: '', Email: '', RoleId: grantableRoles.find((r) => !r.IsSuperAdmin)?.RoleId || '', IsActive: true, AllLocations: false, LocationIds: [location.LocationId] }); setShow(true); };
  const openEdit = (r) => { setEditing(r); setForm({ ...r, Password: '', LocationIds: r.LocationIds || [] }); setShow(true); };
  const toggleLoc = (id) => setForm((f) => ({ ...f, LocationIds: f.LocationIds.includes(id) ? f.LocationIds.filter((x) => x !== id) : [...f.LocationIds, id] }));
  const selectedRole = roles.find((r) => String(r.RoleId) === String(form.RoleId));

  async function save(e) {
    e?.preventDefault();
    if (!editing && (!form.Username?.trim() || !form.Password)) return notify('Username and password are required', true);
    if (!form.FullName?.trim()) return notify('Full name is required', true);
    if (!selectedRole?.IsSuperAdmin && !form.AllLocations && !form.LocationIds.length) return notify('Select at least one location', true);
    const payload = { FullName: form.FullName, Mobile: form.Mobile, Email: form.Email, RoleId: Number(form.RoleId), IsActive: !!form.IsActive, AllLocations: !!form.AllLocations, LocationIds: form.AllLocations ? [] : form.LocationIds };
    if (!editing) payload.Username = form.Username.trim();
    if (form.Password) payload.Password = form.Password;
    setSaving(true);
    try {
      if (editing) { await put(`/users/${editing.UserId}`, payload); notify('User updated'); if (editing.UserId === me?.UserId) refresh(); }
      else { await post('/users', payload); notify('User created'); }
      setShow(false); load();
    } catch (err) { notify(err.message, true); } finally { setSaving(false); }
  }
  async function remove(r) { if (!confirm(`Delete user ${r.Username}?`)) return; try { await del(`/users/${r.UserId}`); notify('User deleted'); load(); } catch (e) { notify(e.message, true); } }

  const access = (u) => (u.IsSuperAdmin || u.AllLocations ? <span className="pill blue"><Globe2 size={11} /> All locations</span> : <div className="pill-row">{u.LocationNames.map((n) => <span key={n} className="pill gray">{n}</span>)}</div>);
  const filtered = rows.filter((r) => (!scope || (scope === 'here' ? r.CanAccessCurrent : String(r.RoleId) === scope)) && (!q || [r.FullName, r.Username, r.Mobile, r.Email, r.RoleName].join(' ').toLowerCase().includes(q.toLowerCase())));
  const editLocked = (u) => u.IsSuperAdmin && !me?.IsSuperAdmin;
  const pg = usePaged(filtered, `${q}|${scope}`);

  return (
    <>
      <PageHead screen="user_mgmt" eyebrow="Administration" title="User Management" desc="Create users, assign a role (screen permissions) and the locations each user can sign in to."
        action={can('user_mgmt', 'CanCreate') && <button className="btn btn-primary" onClick={openAdd}><Plus size={16} />Add user</button>} />
      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} placeholder="Search users…" />
        <select value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="">All users</option><option value="here">Can access {location?.LocationName}</option>
          {roles.map((r) => <option key={r.RoleId} value={r.RoleId}>Role: {r.RoleName}</option>)}
        </select>
        <span className="pill gray">{filtered.length} users</span>
      </div>
      <section className="card">
        {filtered.length ? <div className="table-wrap"><table><thead><tr><th>User</th><th>Contact</th><th>Role</th><th>Location access</th><th>Status</th><th>Created by</th><th /></tr></thead>
          <tbody>{pg.pageRows.map((u) => (
            <tr key={u.UserId}>
              <td data-label="User"><b>{u.FullName}</b>{u.UserId === me?.UserId && <span className="pill blue" style={{ marginLeft: 6 }}>You</span>}<small>@{u.Username}</small></td>
              <td data-label="Contact">{u.Mobile || '—'}<small>{u.Email}</small></td>
              <td data-label="Role"><span className={`pill ${u.IsSuperAdmin ? 'amber' : 'purple'}`}>{u.RoleName}</span></td>
              <td data-label="Access">{access(u)}</td>
              <td data-label="Status"><StatusPill status={u.IsActive ? 'Active' : 'Inactive'} /></td>
              <td data-label="Created by"><ByCell row={u} /></td>
              <td className="row-actions">
                {can('user_mgmt', 'CanEdit') && !editLocked(u) && <button className="btn btn-ghost btn-sm" onClick={() => openEdit(u)}><Pencil size={13} /> Edit</button>}
                {can('user_mgmt', 'CanDelete') && u.UserId !== me?.UserId && !editLocked(u) && <button className="btn btn-danger btn-sm" onClick={() => remove(u)} aria-label="Delete"><Trash2 size={13} /></button>}
              </td>
            </tr>
          ))}</tbody></table></div>
          : <Empty icon={Users} title="No users found" text="Add a user to grant counter or admin access." />}
        <Pager {...pg} noun="users" />
      </section>

      {show && <Modal title={editing ? `Edit ${editing.Username}` : 'Add user'} onClose={() => setShow(false)} footer={<><button className="btn btn-ghost" onClick={() => setShow(false)}>Cancel</button><button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Create user'}</button></>}>
        {editing && <AuditInfo row={editing} />}
        <form onSubmit={save}><div className="field-grid">
          <Field label="Username" required><input className="input" disabled={!!editing} value={form.Username} onChange={(e) => setForm({ ...form, Username: e.target.value })} autoComplete="off" /></Field>
          <Field label={editing ? 'New password' : 'Password'} required={!editing} hint={editing ? 'Leave blank to keep the current password' : 'Minimum 6 characters'}><input className="input" type="password" value={form.Password || ''} onChange={(e) => setForm({ ...form, Password: e.target.value })} autoComplete="new-password" /></Field>
          <Field label="Full name" required><input className="input" value={form.FullName} onChange={(e) => setForm({ ...form, FullName: e.target.value })} /></Field>
          <Field label="Role" required hint={selectedRole?.Description}>
            <select className="input" value={form.RoleId} disabled={editing?.UserId === me?.UserId} onChange={(e) => setForm({ ...form, RoleId: Number(e.target.value) })}>
              {(editing && !grantableRoles.some((r) => r.RoleId === editing.RoleId) ? roles.filter((r) => r.RoleId === editing.RoleId) : []).concat(grantableRoles).map((r) => <option key={r.RoleId} value={r.RoleId}>{r.RoleName}{r.IsSuperAdmin ? ' (super admin)' : ''}</option>)}
            </select>
          </Field>
          <Field label="Mobile"><input className="input" inputMode="numeric" value={form.Mobile || ''} onChange={(e) => setForm({ ...form, Mobile: e.target.value.replace(/\D/g, '') })} /></Field>
          <Field label="Email"><input className="input" type="email" value={form.Email || ''} onChange={(e) => setForm({ ...form, Email: e.target.value })} /></Field>

          <div className="wide">
            <div className="field-label-row"><span><MapPin size={13} style={{ verticalAlign: '-2px' }} /> Location access <i>*</i></span></div>
            {selectedRole?.IsSuperAdmin ? <div className="alert subtle">Super admin roles can access every location.</div> : <>
              {canGrantAll && <label className="check-row" style={{ marginBottom: 8 }}><input type="checkbox" checked={!!form.AllLocations} onChange={(e) => setForm({ ...form, AllLocations: e.target.checked })} /><span>All locations<small>Includes locations added in future</small></span></label>}
              {!form.AllLocations && <div className="loc-checks">
                {grantableLocs.map((l) => (
                  <label key={l.LocationId} className={`check-row ${form.LocationIds.includes(l.LocationId) ? 'on' : ''}`}>
                    <input type="checkbox" checked={form.LocationIds.includes(l.LocationId)} onChange={() => toggleLoc(l.LocationId)} />
                    <span>{l.LocationName}<small>{[l.LocationCode, !l.IsActive && 'inactive'].filter(Boolean).join(' · ')}</small></span>
                  </label>
                ))}
                {(form.LocationIds || []).filter((id) => !grantableLocs.some((l) => l.LocationId === id)).map((id) => <span key={id} className="pill gray">+ {allLocations.find((l) => l.LocationId === id)?.LocationName || `#${id}`} (kept)</span>)}
              </div>}
            </>}
          </div>
          <label className="check-row"><input type="checkbox" checked={!!form.IsActive} disabled={editing?.UserId === me?.UserId} onChange={(e) => setForm({ ...form, IsActive: e.target.checked })} /><span>Active<small>Inactive users are signed out immediately</small></span></label>
        </div><button type="submit" hidden /></form>
      </Modal>}
      <Toast msg={toast?.m} error={toast?.err} />
    </>
  );
}
