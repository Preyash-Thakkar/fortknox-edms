import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../auth';
import { Icon } from './ui';

const SENS = ['Public', 'Internal', 'Confidential', 'Strictly Confidential'];

// Admin tools for a single asset: edit metadata, move/copy, per-user grants, delete.
export default function AssetAdminModal({ asset, categories, onClose, onChanged }) {
  const [tab, setTab] = useState('edit');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  // edit state
  const [filename, setFilename] = useState(asset.filename);
  const [keywords, setKeywords] = useState(asset.keywords || '');
  const [sensitivity, setSensitivity] = useState(asset.sensitivity);

  // move/copy state
  const [targetCat, setTargetCat] = useState('');
  const [targetDept, setTargetDept] = useState('');
  const [mode, setMode] = useState('move');

  // grants state
  const [users, setUsers] = useState([]);
  const [grants, setGrants] = useState({ viewGrants: [], downloadGrants: [] });
  const [grantUser, setGrantUser] = useState('');
  const [grantKind, setGrantKind] = useState('view');

  const targetCategory = categories.find((c) => c._id === targetCat);

  const loadGrants = useCallback(async () => {
    try {
      const [g, u] = await Promise.all([api.get(`/assets/${asset._id}/grants`), api.get('/users')]);
      setGrants(g.data);
      setUsers(u.data.users.filter((x) => x.role !== 'Admin'));
    } catch { /* ignore */ }
  }, [asset._id]);

  useEffect(() => { if (tab === 'grants') loadGrants(); }, [tab, loadGrants]);

  const flash = (m, isErr) => { if (isErr) { setErr(m); setMsg(''); } else { setMsg(m); setErr(''); } };

  const saveEdit = async () => {
    try {
      await api.patch(`/assets/${asset._id}`, { filename, keywords, sensitivity });
      flash('Saved.'); onChanged();
    } catch (e) { flash(e.response?.data?.error || 'Save failed.', true); }
  };

  const doMove = async () => {
    if (!targetCat) return flash('Pick a target category.', true);
    try {
      await api.post(`/assets/${asset._id}/move`, { categoryId: targetCat, departmentId: targetDept || undefined, mode });
      flash(mode === 'copy' ? 'Copied.' : 'Moved.'); onChanged();
      if (mode === 'move') onClose();
    } catch (e) { flash(e.response?.data?.error || 'Operation failed.', true); }
  };

  const addGrant = async () => {
    if (!grantUser) return flash('Pick a user.', true);
    try {
      await api.post(`/assets/${asset._id}/grant`, { userId: grantUser, kind: grantKind, revoke: false });
      flash('Grant added.'); loadGrants(); onChanged();
    } catch (e) { flash(e.response?.data?.error || 'Grant failed.', true); }
  };
  const revokeGrant = async (userId, kind) => {
    try {
      await api.post(`/assets/${asset._id}/grant`, { userId, kind, revoke: true });
      loadGrants(); onChanged();
    } catch (e) { flash(e.response?.data?.error || 'Revoke failed.', true); }
  };

  const doDelete = async () => {
    if (!window.confirm(`Permanently delete "${asset.filename}"? This cannot be undone.`)) return;
    try { await api.delete(`/assets/${asset._id}`); onChanged(); onClose(); }
    catch (e) { flash(e.response?.data?.error || 'Delete failed.', true); }
  };

  const TabBtn = ({ id, label, icon }) => (
    <button onClick={() => { setTab(id); setMsg(''); setErr(''); }}
      className={`flex items-center gap-1.5 px-3 py-2 font-label-lg text-label-lg font-bold border-b-2 transition-all ${tab === id ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-primary'}`}>
      <Icon name={icon} size={16} /> {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-gutter" onClick={onClose}>
      <div className="bg-surface-container-lowest rounded-lg border border-outline-variant shadow-sharp w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-lg py-3 border-b border-outline-variant">
          <h3 className="font-headline-sm text-headline-sm text-primary flex items-center gap-2 min-w-0">
            <Icon name="settings" /> <span className="truncate">Manage: {asset.filename}</span>
          </h3>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-surface-container-high"><Icon name="close" /></button>
        </div>

        <div className="flex gap-1 px-lg border-b border-outline-variant overflow-x-auto">
          <TabBtn id="edit" label="Edit" icon="edit" />
          <TabBtn id="move" label="Move / Copy" icon="drive_file_move" />
          <TabBtn id="grants" label="User Access" icon="key" />
          <TabBtn id="delete" label="Delete" icon="delete" />
        </div>

        <div className="p-lg space-y-md min-h-[240px]">
          {msg && <div className="text-on-tertiary-container font-body-sm text-body-sm bg-secondary-container/40 px-3 py-2 rounded">{msg}</div>}
          {err && <div className="text-error font-body-sm text-body-sm bg-error-container px-3 py-2 rounded">{err}</div>}

          {tab === 'edit' && (
            <>
              <div><label className="font-label-lg text-label-lg text-on-surface-variant block mb-1">DISPLAY NAME</label>
                <input value={filename} onChange={(e) => setFilename(e.target.value)} className="w-full px-3 py-2 bg-white border border-outline-variant rounded focus:border-primary outline-none font-body-md" /></div>
              <div><label className="font-label-lg text-label-lg text-on-surface-variant block mb-1">KEYWORDS</label>
                <input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="comma-separated" className="w-full px-3 py-2 bg-white border border-outline-variant rounded focus:border-primary outline-none font-body-md" /></div>
              <div><label className="font-label-lg text-label-lg text-on-surface-variant block mb-1">SENSITIVITY</label>
                <select value={sensitivity} onChange={(e) => setSensitivity(e.target.value)} className="w-full px-3 py-2 bg-white border border-outline-variant rounded focus:border-primary outline-none font-body-md">
                  {SENS.map((s) => <option key={s}>{s}</option>)}
                </select></div>
              <div className="flex justify-end"><button onClick={saveEdit} className="px-4 py-2 rounded bg-primary text-on-primary font-bold font-label-lg text-label-lg hover:opacity-90">Save changes</button></div>
            </>
          )}

          {tab === 'move' && (
            <>
              <div className="flex gap-2">
                <button onClick={() => setMode('move')} className={`flex-1 py-2 rounded border font-label-lg text-label-lg font-bold ${mode === 'move' ? 'bg-primary text-on-primary border-primary' : 'border-outline-variant text-on-surface-variant'}`}>Move</button>
                <button onClick={() => setMode('copy')} className={`flex-1 py-2 rounded border font-label-lg text-label-lg font-bold ${mode === 'copy' ? 'bg-primary text-on-primary border-primary' : 'border-outline-variant text-on-surface-variant'}`}>Copy</button>
              </div>
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                {mode === 'move' ? 'Moving changes the asset\u2019s category and re-inherits that category\u2019s access.' : 'Copy creates an independent duplicate in the target category.'}
              </p>
              <div><label className="font-label-lg text-label-lg text-on-surface-variant block mb-1">TARGET CATEGORY</label>
                <select value={targetCat} onChange={(e) => { setTargetCat(e.target.value); setTargetDept(''); }} className="w-full px-3 py-2 bg-white border border-outline-variant rounded focus:border-primary outline-none font-body-md">
                  <option value="">— Select —</option>
                  {categories.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
                </select></div>
              <div><label className="font-label-lg text-label-lg text-on-surface-variant block mb-1">TARGET DEPARTMENT (optional)</label>
                <select value={targetDept} onChange={(e) => setTargetDept(e.target.value)} disabled={!targetCategory} className="w-full px-3 py-2 bg-white border border-outline-variant rounded focus:border-primary outline-none font-body-md disabled:opacity-50">
                  <option value="">— None —</option>
                  {targetCategory?.departments.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}
                </select></div>
              <div className="flex justify-end"><button onClick={doMove} className="px-4 py-2 rounded bg-primary text-on-primary font-bold font-label-lg text-label-lg hover:opacity-90">{mode === 'copy' ? 'Copy asset' : 'Move asset'}</button></div>
            </>
          )}

          {tab === 'grants' && (
            <>
              <p className="font-body-sm text-body-sm text-on-surface-variant">Grant specific people access to this document, in addition to role-based rules.</p>
              <div className="flex gap-2 items-end">
                <div className="flex-1"><label className="font-label-lg text-label-lg text-on-surface-variant block mb-1">USER</label>
                  <select value={grantUser} onChange={(e) => setGrantUser(e.target.value)} className="w-full px-3 py-2 bg-white border border-outline-variant rounded focus:border-primary outline-none font-body-md">
                    <option value="">— Select —</option>
                    {users.map((u) => <option key={u._id} value={u._id}>{u.name} ({u.role})</option>)}
                  </select></div>
                <select value={grantKind} onChange={(e) => setGrantKind(e.target.value)} className="px-3 py-2 bg-white border border-outline-variant rounded focus:border-primary outline-none font-body-md">
                  <option value="view">View</option><option value="download">Download</option>
                </select>
                <button onClick={addGrant} className="px-3 py-2 rounded bg-primary text-on-primary font-bold font-label-lg text-label-lg hover:opacity-90">Grant</button>
              </div>
              <div className="border-t border-outline-variant pt-md space-y-2 max-h-40 overflow-y-auto">
                {grants.viewGrants.length === 0 && grants.downloadGrants.length === 0 && <p className="font-body-sm text-body-sm text-on-surface-variant italic">No individual grants yet.</p>}
                {grants.viewGrants.map((u) => (
                  <div key={`v${u._id}`} className="flex items-center justify-between text-body-sm">
                    <span>{u.name} <span className="text-on-surface-variant">· view</span></span>
                    <button onClick={() => revokeGrant(u._id, 'view')} className="text-error hover:underline font-label-md">Revoke</button>
                  </div>
                ))}
                {grants.downloadGrants.map((u) => (
                  <div key={`d${u._id}`} className="flex items-center justify-between text-body-sm">
                    <span>{u.name} <span className="text-tertiary">· download</span></span>
                    <button onClick={() => revokeGrant(u._id, 'download')} className="text-error hover:underline font-label-md">Revoke</button>
                  </div>
                ))}
              </div>
            </>
          )}

          {tab === 'delete' && (
            <div className="text-center py-md">
              <Icon name="warning" size={36} className="text-error" />
              <p className="font-body-lg text-body-lg text-primary font-semibold mt-2">Delete this asset?</p>
              <p className="font-body-sm text-body-sm text-on-surface-variant mb-md">This permanently removes the file and all its versions. This cannot be undone.</p>
              <button onClick={doDelete} className="px-4 py-2 rounded bg-error text-white font-bold font-label-lg text-label-lg hover:opacity-90">Delete permanently</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
