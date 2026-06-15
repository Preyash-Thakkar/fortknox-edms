import React, { useEffect, useState, useCallback } from 'react';
import { api, useAuth } from '../auth';
import { Icon, RoleBadge, Button } from '../components/ui';
import CategoryManager from '../components/CategoryManager';

const ROLES = ['Admin', 'Engineering', 'Legal', 'Management'];

const ROLE_CAPS = {
  Admin: ['Full repository access', 'Approve/deny access requests', 'View audit ledger', 'Manage users'],
  Engineering: ['CAD/PCB technical assets', 'Upload & version assets', 'Request restricted access'],
  Legal: ['Patent & compliance docs', 'Upload legal assets', 'Request restricted access'],
  Management: ['Operational reports', 'Cross-department visibility', 'Request restricted access'],
};

// Modal that shows a generated temp password exactly once.
function TempPasswordModal({ info, onClose }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(info.tempPassword);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-gutter" onClick={onClose}>
      <div className="bg-surface-container-lowest rounded-lg border border-outline-variant shadow-sharp w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="px-lg py-3 border-b border-outline-variant flex items-center gap-2">
          <Icon name="vpn_key" className="text-tertiary" fill={1} />
          <h3 className="font-headline-sm text-headline-sm text-primary">Temporary Password</h3>
        </div>
        <div className="p-lg space-y-md">
          <p className="font-body-md text-body-md text-on-surface-variant">
            Share this one-time password with <span className="font-semibold text-primary">{info.user?.email}</span> over
            a secure channel. It will <span className="font-semibold">not be shown again</span> — the user should change
            it on first login.
          </p>
          <div className="flex items-center gap-2 bg-surface-container border border-outline-variant rounded p-3">
            <code className="font-data-mono text-headline-sm text-primary flex-1 tracking-wide">{info.tempPassword}</code>
            <button onClick={copy} className="p-2 rounded hover:bg-surface-container-high text-secondary" title="Copy">
              <Icon name={copied ? 'check' : 'content_copy'} />
            </button>
          </div>
          <div className="flex items-center gap-2 text-on-secondary-container bg-secondary-container/40 rounded px-3 py-2">
            <Icon name="info" size={18} />
            <span className="font-body-sm text-body-sm">MFA code for demo accounts remains 000000.</span>
          </div>
        </div>
        <div className="flex justify-end px-lg py-3 border-t border-outline-variant">
          <Button icon="check" onClick={onClose}>Done</Button>
        </div>
      </div>
    </div>
  );
}

// Add-operator form (collapsible).
function AddOperator({ onCreated }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('Engineering');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    if (!name || !email) return setErr('Name and email are required.');
    setBusy(true);
    setErr('');
    try {
      const { data } = await api.post('/users', { name, email, role, title });
      setName(''); setEmail(''); setTitle(''); setRole('Engineering'); setOpen(false);
      onCreated(data);
    } catch (e) {
      setErr(e.response?.data?.error || 'Could not create user.');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return <Button icon="person_add" onClick={() => setOpen(true)}>Add Operator</Button>;
  }

  return (
    <div className="bg-surface-container-lowest border border-outline-variant rounded-lg shadow-sm">
      <div className="px-lg py-3 border-b border-outline-variant flex items-center justify-between">
        <h3 className="font-headline-sm text-headline-sm text-primary flex items-center gap-2">
          <Icon name="person_add" /> New Operator
        </h3>
        <button onClick={() => setOpen(false)} className="p-1.5 rounded hover:bg-surface-container-high"><Icon name="close" /></button>
      </div>
      <div className="p-lg grid grid-cols-1 md:grid-cols-2 gap-md">
        <div>
          <label className="font-label-lg text-label-lg text-on-surface-variant block mb-1">FULL NAME</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. R. Patel"
            className="w-full px-3 py-2 bg-white border border-outline-variant rounded focus:border-primary outline-none font-body-md" />
        </div>
        <div>
          <label className="font-label-lg text-label-lg text-on-surface-variant block mb-1">EMAIL</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@edms.local"
            className="w-full px-3 py-2 bg-white border border-outline-variant rounded focus:border-primary outline-none font-body-md" />
        </div>
        <div>
          <label className="font-label-lg text-label-lg text-on-surface-variant block mb-1">ROLE</label>
          <select value={role} onChange={(e) => setRole(e.target.value)}
            className="w-full px-3 py-2 bg-white border border-outline-variant rounded focus:border-primary outline-none font-body-md">
            {ROLES.map((r) => <option key={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <label className="font-label-lg text-label-lg text-on-surface-variant block mb-1">TITLE (OPTIONAL)</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. PCB Designer"
            className="w-full px-3 py-2 bg-white border border-outline-variant rounded focus:border-primary outline-none font-body-md" />
        </div>
        {err && <div className="md:col-span-2 text-error font-body-sm text-body-sm bg-error-container px-3 py-2 rounded">{err}</div>}
        <div className="md:col-span-2 flex items-center justify-between">
          <p className="font-body-sm text-body-sm text-on-surface-variant flex items-center gap-1">
            <Icon name="vpn_key" size={16} /> A temporary password is generated automatically.
          </p>
          <Button icon="check" onClick={submit} disabled={busy}>{busy ? 'Creating…' : 'Create Operator'}</Button>
        </div>
      </div>
    </div>
  );
}

export default function Settings() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tempInfo, setTempInfo] = useState(null);
  const [msg, setMsg] = useState('');
  const [editingRole, setEditingRole] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/users');
      setUsers(data.users);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const changeRole = async (id, role) => {
    try {
      await api.patch(`/users/${id}/role`, { role });
      setEditingRole(null);
      setMsg('Role updated.');
      load();
    } catch (e) {
      setMsg(e.response?.data?.error || 'Could not update role.');
    }
  };

  const toggleActive = async (u) => {
    try {
      await api.patch(`/users/${u._id}/active`, { active: !u.active });
      setMsg(u.active ? 'User deactivated.' : 'User reactivated.');
      load();
    } catch (e) {
      setMsg(e.response?.data?.error || 'Could not update status.');
    }
  };

  const resetPassword = async (u) => {
    if (!window.confirm(`Generate a new temporary password for ${u.email}?`)) return;
    try {
      const { data } = await api.post(`/users/${u._id}/reset-password`);
      setTempInfo(data);
    } catch (e) {
      setMsg(e.response?.data?.error || 'Could not reset password.');
    }
  };

  return (
    <>
      <div className="flex justify-between items-center mb-lg">
        <h2 className="font-headline-md text-headline-md text-primary">Access Control &amp; Security Settings</h2>
      </div>

      {msg && (
        <div className="mb-md px-4 py-2 bg-secondary-container/40 border border-secondary-container rounded font-body-sm text-body-sm flex items-center justify-between">
          <span>{msg}</span>
          <button onClick={() => setMsg('')}><Icon name="close" size={16} /></button>
        </div>
      )}

      {/* Role matrix */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-md mb-xl">
        {Object.entries(ROLE_CAPS).map(([role, caps]) => (
          <div key={role} className="bg-surface-container-lowest border border-outline-variant rounded-lg p-lg">
            <div className="flex items-center gap-2 mb-md">
              <Icon name="badge" className="text-secondary" fill={1} />
              <span className="font-headline-sm text-headline-sm text-primary">{role}</span>
            </div>
            <ul className="space-y-2">
              {caps.map((c) => (
                <li key={c} className="flex items-start gap-2 font-body-sm text-body-sm text-on-surface-variant">
                  <Icon name="check" size={16} className="text-on-tertiary-container mt-0.5 shrink-0" />
                  {c}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Categories & Departments management */}
      <CategoryManager />

      {/* Operators */}
      <div className="flex justify-between items-center mb-md">
        <h3 className="font-headline-sm text-headline-sm text-primary flex items-center gap-2">
          <Icon name="group" className="text-secondary" /> Operators
        </h3>
      </div>
      <div className="mb-lg"><AddOperator onCreated={(data) => { setTempInfo(data); load(); }} /></div>

      <div className="bg-surface-container-lowest border border-outline-variant rounded-lg shadow-sm overflow-hidden">
        <div className="grid grid-cols-12 gap-gutter px-md py-3 bg-surface-container-low border-b border-outline-variant">
          <div className="col-span-3 font-label-md text-label-md text-on-surface-variant uppercase tracking-widest">Name</div>
          <div className="col-span-3 font-label-md text-label-md text-on-surface-variant uppercase tracking-widest">Email</div>
          <div className="col-span-2 font-label-md text-label-md text-on-surface-variant uppercase tracking-widest">Role</div>
          <div className="col-span-1 font-label-md text-label-md text-on-surface-variant uppercase tracking-widest">Status</div>
          <div className="col-span-3 text-right font-label-md text-label-md text-on-surface-variant uppercase tracking-widest">Actions</div>
        </div>

        {loading ? (
          <div className="p-xl text-center text-on-surface-variant">Loading operators…</div>
        ) : (
          <div className="divide-y divide-outline-variant">
            {users.map((u) => (
              <div key={u._id} className="grid grid-cols-12 gap-gutter px-md py-3 items-center">
                <div className="col-span-3 flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-secondary-container flex items-center justify-center text-on-secondary-container font-bold text-sm shrink-0">
                    {u.name?.charAt(0)}
                  </div>
                  <span className="font-body-md text-body-md font-semibold text-primary truncate">{u.name}</span>
                </div>
                <div className="col-span-3 font-data-mono text-data-mono text-on-surface-variant truncate">{u.email}</div>
                <div className="col-span-2">
                  {editingRole === u._id ? (
                    <select
                      autoFocus
                      defaultValue={u.role}
                      onChange={(e) => changeRole(u._id, e.target.value)}
                      onBlur={() => setEditingRole(null)}
                      className="px-2 py-1 bg-white border border-primary rounded outline-none font-body-sm"
                    >
                      {ROLES.map((r) => <option key={r}>{r}</option>)}
                    </select>
                  ) : (
                    <button onClick={() => setEditingRole(u._id)} className="flex items-center gap-1 group" title="Edit role">
                      <RoleBadge role={u.role} />
                      <Icon name="edit" size={14} className="text-on-surface-variant opacity-0 group-hover:opacity-100" />
                    </button>
                  )}
                </div>
                <div className="col-span-1">
                  {u.active === false ? (
                    <span className="flex items-center gap-1 text-error font-label-md text-label-md"><Icon name="block" size={14} fill={1} /> Off</span>
                  ) : (
                    <span className="flex items-center gap-1 text-on-tertiary-container font-label-md text-label-md"><Icon name="check_circle" size={14} fill={1} /> On</span>
                  )}
                </div>
                <div className="col-span-3 flex justify-end gap-1">
                  <button onClick={() => resetPassword(u)} title="Reset password"
                    className="p-2 rounded hover:bg-surface-container-high text-secondary"><Icon name="lock_reset" size={20} /></button>
                  {String(u._id) !== String(me.id) && (
                    <button onClick={() => toggleActive(u)} title={u.active === false ? 'Reactivate' : 'Deactivate'}
                      className={`p-2 rounded hover:bg-surface-container-high ${u.active === false ? 'text-on-tertiary-container' : 'text-error'}`}>
                      <Icon name={u.active === false ? 'person_check' : 'person_off'} size={20} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {tempInfo && <TempPasswordModal info={tempInfo} onClose={() => setTempInfo(null)} />}
    </>
  );
}
