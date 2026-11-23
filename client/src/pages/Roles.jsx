import { useEffect, useMemo, useState } from 'react';
import { Plus, ShieldCheck, Save, Pencil, Trash2, Crown } from 'lucide-react';
import { get, post, put, del } from '../api.js';
import { PageHead } from '../components/Layout.jsx';
import { Field, Modal, Toast, Empty, AuditInfo } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';

const ACTIONS = [['CanView', 'View'], ['CanCreate', 'Create'], ['CanEdit', 'Edit'], ['CanDelete', 'Delete']];
const NONE = { CanView: false, CanCreate: false, CanEdit: false, CanDelete: false };
const blankRole = { RoleName: '', Description: '', IsActive: true, IsSuperAdmin: false };

export default function RolesPage() {
  const { user: me, can, refresh } = useAuth();
  const [roles, setRoles] = useState([]); const [screens, setScreens] = useState([]);
  const [selectedRole, setSelectedRole] = useState('');
  const [perms, setPerms] = useState({}); const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState(null);
  const [roleModal, setRoleModal] = useState(null); // null | 'add' | role object
  const [roleForm, setRoleForm] = useState(blankRole);
  const notify = (m, err = false) => { setToast({ m, err }); setTimeout(() => setToast(null), 2800); };
  const canEditPerms = can('screen_allocation', 'CanEdit');

  const load = async (keep) => {
    try {
      const [r, s] = await Promise.all([get('/roles'), get('/screens?all=true')]);
      setRoles(r); setScreens(s);
      if (!keep || !r.some((x) => String(x.RoleId) === String(keep))) setSelectedRole(r[0] ? String(r[0].RoleId) : '');
    } catch (e) { notify(e.message, true); }
  };
  useEffect(() => { load(); }, []);
  useEffect(() => { if (!selectedRole) return; (async () => {
    try { const rows = await get(`/permissions?roleId=${selectedRole}`); const map = {}; rows.forEach((p) => { map[p.ScreenId] = { CanView: !!p.CanView, CanCreate: !!p.CanCreate, CanEdit: !!p.CanEdit, CanDelete: !!p.CanDelete }; }); setPerms(map); setDirty(false); }
    catch (e) { notify(e.message, true); }
  })(); }, [selectedRole]);

  const role = roles.find((r) => String(r.RoleId) === String(selectedRole));
  const groups = useMemo(() => { const g = []; screens.forEach((s) => { const n = s.ScreenGroup || ''; let x = g.find((y) => y.name === n); if (!x) { x = { name: n, items: [] }; g.push(x); } x.items.push(s); }); return g; }, [screens]);

  function setPerm(screenId, field, value) {
    setDirty(true);
    setPerms((prev) => {
      const cur = { ...(prev[screenId] || NONE), [field]: value };
      if (field !== 'CanView' && value) cur.CanView = true;                 // any action implies view
      if (field === 'CanView' && !value) Object.assign(cur, NONE);          // no view → no actions
      return { ...prev, [screenId]: cur };
    });
  }
  const setRow = (screenId, value) => { setDirty(true); setPerms((p) => ({ ...p, [screenId]: { CanView: value, CanCreate: value, CanEdit: value, CanDelete: value } })); };
  const setColumn = (field, value) => screens.forEach((s) => setPerm(s.ScreenId, field, value));

  async function savePerms() {
    try {
      await put('/permissions/bulk', { RoleId: Number(selectedRole), permissions: screens.map((s) => ({ ScreenId: s.ScreenId, ...(perms[s.ScreenId] || NONE) })) });
      notify(`Permissions saved for ${role?.RoleName}`); setDirty(false);
      if (Number(selectedRole) === me?.RoleId) refresh(); // own role → refresh menu immediately
    } catch (e) { notify(e.message, true); }
  }

  const openRole = (r) => { setRoleModal(r || 'add'); setRoleForm(r ? { RoleName: r.RoleName, Description: r.Description || '', IsActive: r.IsActive !== false, IsSuperAdmin: !!r.IsSuperAdmin } : blankRole); };
  async function saveRole(e) {
    e?.preventDefault();
    if (!roleForm.RoleName.trim()) return notify('Role name is required', true);
    try {
      if (roleModal === 'add') { const r = await post('/roles', roleForm); notify('Role created'); setRoleModal(null); setRoleForm(blankRole); await load(r.RoleId); setSelectedRole(String(r.RoleId)); }
      else { await put(`/roles/${roleModal.RoleId}`, roleForm); notify('Role updated'); setRoleModal(null); await load(selectedRole); if (roleModal.RoleId === me?.RoleId) refresh(); }
    } catch (err) { notify(err.message, true); }
  }
  async function removeRole() {
    if (!role || !confirm(`Delete role ${role.RoleName}?`)) return;
    try { await del(`/roles/${role.RoleId}`); notify('Role deleted'); await load(); } catch (e) { notify(e.message, true); }
  }

  return (
    <>
      <PageHead screen="screen_allocation" eyebrow="Administration" title="Roles & Permissions" desc="Screen-wise access per role — View / Create / Edit / Delete for every screen, including each booking type's own screen."
        action={can('screen_allocation', 'CanCreate') && <button className="btn btn-primary" onClick={() => openRole(null)}><Plus size={16} />Add role</button>} />
      <div className="toolbar">
        <select value={selectedRole} onChange={(e) => { if (dirty && !confirm('Discard unsaved permission changes?')) return; setSelectedRole(e.target.value); }}>
          {roles.map((r) => <option key={r.RoleId} value={r.RoleId}>{r.RoleName} ({r.UserCount || 0} users){r.IsActive === false ? ' — inactive' : ''}</option>)}
        </select>
        {role?.IsSuperAdmin && <span className="pill amber"><Crown size={11} /> Super admin</span>}
        {role?.Description && <span className="pill gray hide-sm">{role.Description}</span>}
        <div className="toolbar-right">
          {role && can('screen_allocation', 'CanEdit') && <button className="btn btn-ghost btn-sm" onClick={() => openRole(role)}><Pencil size={13} />Edit role</button>}
          {role && can('screen_allocation', 'CanDelete') && role.RoleId !== me?.RoleId && <button className="btn btn-danger btn-sm" onClick={removeRole} aria-label="Delete role"><Trash2 size={13} /></button>}
          {canEditPerms && !role?.IsSuperAdmin && <button className="btn btn-dark" disabled={!dirty} onClick={savePerms}><Save size={15} />{dirty ? 'Save permissions' : 'Saved'}</button>}
        </div>
      </div>

      {role?.IsSuperAdmin ? (
        <section className="card card-body"><b><Crown size={14} style={{ verticalAlign: '-2px' }} /> {role.RoleName} is a super admin role</b><p className="muted" style={{ marginTop: 6 }}>Users with this role have full access to every screen and every location. The matrix does not apply.</p></section>
      ) : (
        <section className="card">
          {screens.length ? <div className="table-wrap"><table className="perm-table">
            <thead><tr><th>Screen</th>{ACTIONS.map(([f, l]) => <th key={f}>{l}{canEditPerms && <div className="col-toggle"><button type="button" onClick={() => setColumn(f, true)}>all</button>·<button type="button" onClick={() => setColumn(f, false)}>none</button></div>}</th>)}<th>Row</th></tr></thead>
            <tbody>{groups.map((g) => [
              g.name && <tr key={`g-${g.name}`} className="group-row"><td colSpan={6}>{g.name}</td></tr>,
              ...g.items.map((s) => { const p = perms[s.ScreenId] || NONE; const full = ACTIONS.every(([f]) => p[f]); return (
                <tr key={s.ScreenId}>
                  <td><b>{s.ScreenName}</b>{s.IsBookingScreen && <span className="pill blue" style={{ marginLeft: 6 }}>Booking</span>}{s.IsActive === false && <span className="pill gray" style={{ marginLeft: 6 }}>Inactive</span>}<small>{s.ScreenKey}</small></td>
                  {ACTIONS.map(([f]) => <td key={f}><input type="checkbox" checked={!!p[f]} disabled={!canEditPerms} onChange={(e) => setPerm(s.ScreenId, f, e.target.checked)} aria-label={`${s.ScreenName} ${f}`} /></td>)}
                  <td><button type="button" className="btn btn-ghost btn-sm" disabled={!canEditPerms} onClick={() => setRow(s.ScreenId, !full)}>{full ? 'Clear' : 'All'}</button></td>
                </tr>); }),
            ])}</tbody>
          </table></div> : <Empty icon={ShieldCheck} title="No screens configured" text="Screens are seeded from the database." />}
        </section>
      )}
      <p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>Permissions are checked on the server for every request, so changes apply immediately. Super admin roles always have full access. Advance bookings also need Create permission on the Advance Booking screen.</p>

      {roleModal && <Modal title={roleModal === 'add' ? 'Add role' : `Edit ${roleModal.RoleName}`} onClose={() => setRoleModal(null)} footer={<><button className="btn btn-ghost" onClick={() => setRoleModal(null)}>Cancel</button><button className="btn btn-primary" onClick={saveRole}>{roleModal === 'add' ? 'Create role' : 'Save changes'}</button></>}>
        {roleModal !== 'add' && <AuditInfo row={roleModal} />}
        <form onSubmit={saveRole}><div className="field-grid">
          <Field label="Role name" required><input className="input" value={roleForm.RoleName} onChange={(e) => setRoleForm({ ...roleForm, RoleName: e.target.value })} /></Field>
          <Field label="Description"><input className="input" value={roleForm.Description} onChange={(e) => setRoleForm({ ...roleForm, Description: e.target.value })} /></Field>
          <label className="check-row"><input type="checkbox" checked={roleForm.IsActive} disabled={roleModal !== 'add' && roleModal.RoleId === me?.RoleId} onChange={(e) => setRoleForm({ ...roleForm, IsActive: e.target.checked })} /><span>Active</span></label>
          {me?.IsSuperAdmin && <label className="check-row"><input type="checkbox" checked={roleForm.IsSuperAdmin} disabled={roleModal !== 'add' && roleModal.RoleId === me?.RoleId} onChange={(e) => setRoleForm({ ...roleForm, IsSuperAdmin: e.target.checked })} /><span>Super admin<small>Full access to all screens and locations</small></span></label>}
        </div><button type="submit" hidden /></form>
      </Modal>}
      <Toast msg={toast?.m} error={toast?.err} />
    </>
  );
}
