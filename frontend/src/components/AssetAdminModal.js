import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../auth';
import { Icon } from './ui';
import RoleGuard from './RoleGuard';

const SENS = ['Public', 'Internal', 'Confidential', 'Strictly Confidential'];

// New Component: Document Control Workflow
const WorkflowControls = ({ asset, currentUser, onStatusChange }) => {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  const handleStatusChange = async (newStatus) => {
    setLoading(true);
    setMsg('');
    try {
      // Note: Ensure your backend PATCH /assets/:id endpoint accepts 'controlStatus'
      await api.patch(`/assets/${asset._id}`, { controlStatus: newStatus });
      setMsg(`Asset successfully moved to ${newStatus}`);
      if (onStatusChange) onStatusChange(); // Refresh the data globally
    } catch (error) {
      alert(error.response?.data?.error || 'Failed to update status');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-lg">
      <div className="bg-surface-container-low p-md rounded border border-outline-variant">
        <p className="font-label-lg text-label-lg text-on-surface-variant mb-3 uppercase tracking-wider">
          Document Control Workflow
        </p>
        <p className="font-body-md mb-4">
          Current Status: <span className="font-bold text-primary">{asset.controlStatus || 'Draft'}</span>
        </p>

        {msg && <div className="text-primary font-body-sm mb-4">{msg}</div>}

        {/* ROLE GUARD: Only Admins and Management can see these buttons */}
        <RoleGuard user={currentUser} allowedRoles={['Management']}>
          <div className="flex gap-2">
            {(asset.controlStatus === 'Draft' || !asset.controlStatus) && (
              <button onClick={() => handleStatusChange('InReview')} disabled={loading} className="px-4 py-2 rounded bg-yellow-500 text-white font-bold text-sm hover:opacity-90 transition-opacity">
                Submit for Review
              </button>
            )}

            {asset.controlStatus === 'InReview' && (
              <>
                <button onClick={() => handleStatusChange('Approved')} disabled={loading} className="px-4 py-2 rounded bg-green-600 text-white font-bold text-sm hover:opacity-90 transition-opacity">
                  Approve
                </button>
                <button onClick={() => handleStatusChange('Draft')} disabled={loading} className="px-4 py-2 rounded bg-red-500 text-white font-bold text-sm hover:opacity-90 transition-opacity">
                  Reject (Back to Draft)
                </button>
              </>
            )}

            {asset.controlStatus === 'Approved' && (
              <button onClick={() => handleStatusChange('Obsolete')} disabled={loading} className="px-4 py-2 rounded bg-gray-600 text-white font-bold text-sm hover:opacity-90 transition-opacity">
                Mark as Obsolete
              </button>
            )}
          </div>
        </RoleGuard>
      </div>
    </div>
  );
};

// CRITICAL: Ensure you pass `currentUser` into this modal from the parent Repository page
export default function AssetAdminModal({ asset, categories, currentUser, onClose, onChanged }) {
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
  const [grants, setGrants] = useState({
    userView: [], userDownload: [],
    deptView: [], deptDownload: [],
    accessLogs: []
  });

  const [grantTargetType, setGrantTargetType] = useState('user');
  const [grantTargetId, setGrantTargetId] = useState('');
  const [grantKind, setGrantKind] = useState('view');

  const targetCategory = categories.find((c) => c._id === targetCat);

  const allDepartments = categories.flatMap(c =>
    c.departments.map(d => ({ ...d, categoryName: c.name }))
  );

  const loadGrants = useCallback(async () => {
    try {
      const [g, u] = await Promise.all([
        api.get(`/assets/${asset._id}/grants`),
        api.get('/users')
      ]);
      setGrants({
        userView: g.data.userView || [],
        userDownload: g.data.userDownload || [],
        deptView: g.data.deptView || [],
        deptDownload: g.data.deptDownload || [],
        accessLogs: g.data.accessLogs || []
      });
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
    if (!grantTargetId) return flash(`Pick a ${grantTargetType}.`, true);
    try {
      await api.post(`/assets/${asset._id}/grant`, {
        targetId: grantTargetId,
        targetType: grantTargetType,
        kind: grantKind,
        revoke: false
      });
      flash('Access granted successfully.');
      setGrantTargetId('');
      loadGrants();
      onChanged();
    } catch (e) { flash(e.response?.data?.error || 'Grant failed.', true); }
  };

  const revokeGrant = async (targetId, targetType, kind) => {
    if (!window.confirm(`Revoke this access? The duration will be logged.`)) return;
    try {
      await api.post(`/assets/${asset._id}/grant`, { targetId, targetType, kind, revoke: true });
      flash('Access revoked and logged.');
      loadGrants();
      onChanged();
    } catch (e) { flash(e.response?.data?.error || 'Revoke failed.', true); }
  };

  const doDelete = async () => {
    if (!window.confirm(`Permanently delete "${asset.filename}"? This cannot be undone.`)) return;
    try { await api.delete(`/assets/${asset._id}`); onChanged(); onClose(); }
    catch (e) { flash(e.response?.data?.error || 'Delete failed.', true); }
  };

  const TabBtn = ({ id, label, icon }) => (
    <button onClick={() => { setTab(id); setMsg(''); setErr(''); }}
      className={`flex items-center gap-1.5 px-3 py-2 font-label-lg text-label-lg font-bold border-b-2 transition-all whitespace-nowrap ${tab === id ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-primary'}`}>
      <Icon name={icon} size={16} /> {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-gutter" onClick={onClose}>
      <div className="bg-surface-container-lowest rounded-lg border border-outline-variant shadow-sharp w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-lg py-3 border-b border-outline-variant">
          <h3 className="font-headline-sm text-headline-sm text-primary flex items-center gap-2 min-w-0">
            <Icon name="settings" /> <span className="truncate">Manage: {asset.filename}</span>
          </h3>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-surface-container-high"><Icon name="close" /></button>
        </div>

        <div className="flex gap-1 px-lg border-b border-outline-variant overflow-x-auto scrollbar-hide">
          <TabBtn id="edit" label="Edit" icon="edit" />
          <TabBtn id="status" label="Status & Workflow" icon="check_circle" />
          <TabBtn id="move" label="Move / Copy" icon="drive_file_move" />
          <TabBtn id="grants" label="Access & Logs" icon="key" />
          <TabBtn id="delete" label="Delete" icon="delete" />
        </div>

        <div className="p-lg space-y-md min-h-[300px] max-h-[60vh] overflow-y-auto">
          {msg && <div className="text-on-tertiary-container font-body-sm text-body-sm bg-secondary-container/40 px-3 py-2 rounded">{msg}</div>}
          {err && <div className="text-error font-body-sm text-body-sm bg-error-container px-3 py-2 rounded">{err}</div>}

          {/* EDIT TAB */}
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

          {/* WORKFLOW STATUS TAB */}
          {tab === 'status' && (
            <WorkflowControls asset={asset} currentUser={currentUser} onStatusChange={onChanged} />
          )}

          {/* MOVE/COPY TAB */}
          {tab === 'move' && (
            <>
              <div className="flex gap-2">
                <button onClick={() => setMode('move')} className={`flex-1 py-2 rounded border font-label-lg text-label-lg font-bold ${mode === 'move' ? 'bg-primary text-on-primary border-primary' : 'border-outline-variant text-on-surface-variant'}`}>Move</button>
                <button onClick={() => setMode('copy')} className={`flex-1 py-2 rounded border font-label-lg text-label-lg font-bold ${mode === 'copy' ? 'bg-primary text-on-primary border-primary' : 'border-outline-variant text-on-surface-variant'}`}>Copy</button>
              </div>
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

          {/* GRANTS & LOGS TAB */}
          {tab === 'grants' && (
            <div className="space-y-lg">
              <div className="bg-surface-container-low p-md rounded border border-outline-variant">
                <p className="font-label-lg text-label-lg text-on-surface-variant mb-3 uppercase tracking-wider">Issue New Access</p>
                <div className="flex gap-3 mb-3">
                  <label className="flex items-center gap-1 font-body-md text-on-surface">
                    <input type="radio" name="gType" checked={grantTargetType === 'user'} onChange={() => { setGrantTargetType('user'); setGrantTargetId(''); }} /> User
                  </label>
                  <label className="flex items-center gap-1 font-body-md text-on-surface">
                    <input type="radio" name="gType" checked={grantTargetType === 'department'} onChange={() => { setGrantTargetType('department'); setGrantTargetId(''); }} /> Department
                  </label>
                </div>
                <div className="flex gap-2 items-end">
                  <div className="flex-1">
                    <select value={grantTargetId} onChange={(e) => setGrantTargetId(e.target.value)} className="w-full px-3 py-2 bg-white border border-outline-variant rounded focus:border-primary outline-none font-body-md">
                      <option value="">— Select {grantTargetType} —</option>
                      {grantTargetType === 'user'
                        ? users.map((u) => <option key={u._id} value={u._id}>{u.name} ({u.role})</option>)
                        : allDepartments.map((d) => <option key={d._id} value={d._id}>{d.name} ({d.categoryName})</option>)
                      }
                    </select>
                  </div>
                  <select value={grantKind} onChange={(e) => setGrantKind(e.target.value)} className="px-3 py-2 bg-white border border-outline-variant rounded focus:border-primary outline-none font-body-md">
                    <option value="view">View Only</option>
                    <option value="download">Download</option>
                  </select>
                  <button onClick={addGrant} className="px-4 py-2 rounded bg-primary text-on-primary font-bold font-label-lg text-label-lg hover:opacity-90">Grant</button>
                </div>
              </div>

              <div>
                <p className="font-label-lg text-label-lg text-on-surface-variant mb-2 uppercase tracking-wider">Active Permissions</p>
                <div className="space-y-2 border border-outline-variant rounded p-3 bg-surface">
                  {(!grants.userView.length && !grants.userDownload.length && !grants.deptView.length && !grants.deptDownload.length) &&
                    <p className="font-body-sm text-on-surface-variant italic">No explicit grants.</p>}

                  {grants.userView.map((u) => (
                    <div key={`uv-${u._id}`} className="flex items-center justify-between text-body-sm">
                      <span><Icon name="person" size={14} className="inline mr-1 text-on-surface-variant" /> {u.name} <span className="text-on-surface-variant">· view</span></span>
                      <button onClick={() => revokeGrant(u._id, 'user', 'view')} className="text-error hover:underline font-label-md">Revoke & Log</button>
                    </div>
                  ))}
                  {grants.userDownload.map((u) => (
                    <div key={`ud-${u._id}`} className="flex items-center justify-between text-body-sm">
                      <span><Icon name="person" size={14} className="inline mr-1 text-on-surface-variant" /> {u.name} <span className="text-tertiary">· download</span></span>
                      <button onClick={() => revokeGrant(u._id, 'user', 'download')} className="text-error hover:underline font-label-md">Revoke & Log</button>
                    </div>
                  ))}

                  {grants.deptView.map((d) => (
                    <div key={`dv-${d._id}`} className="flex items-center justify-between text-body-sm">
                      <span><Icon name="groups" size={14} className="inline mr-1 text-on-surface-variant" /> {d.name} <span className="text-on-surface-variant">· view</span></span>
                      <button onClick={() => revokeGrant(d._id, 'department', 'view')} className="text-error hover:underline font-label-md">Revoke & Log</button>
                    </div>
                  ))}
                  {grants.deptDownload.map((d) => (
                    <div key={`dd-${d._id}`} className="flex items-center justify-between text-body-sm">
                      <span><Icon name="groups" size={14} className="inline mr-1 text-on-surface-variant" /> {d.name} <span className="text-tertiary">· download</span></span>
                      <button onClick={() => revokeGrant(d._id, 'department', 'download')} className="text-error hover:underline font-label-md">Revoke & Log</button>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="font-label-lg text-label-lg text-on-surface-variant mb-2 uppercase tracking-wider flex items-center gap-1">
                  <Icon name="history" size={16} /> Access History Log
                </p>
                <div className="border border-outline-variant rounded overflow-hidden bg-surface">
                  {grants.accessLogs.length === 0 ? (
                    <p className="p-3 font-body-sm text-on-surface-variant italic">No access has been revoked yet.</p>
                  ) : (
                    <table className="w-full text-left font-body-sm">
                      <thead className="bg-surface-container-low text-on-surface-variant">
                        <tr>
                          <th className="px-3 py-2 font-medium">Entity</th>
                          <th className="px-3 py-2 font-medium">Type</th>
                          <th className="px-3 py-2 font-medium">Held Since</th>
                          <th className="px-3 py-2 font-medium">Duration</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-outline-variant">
                        {grants.accessLogs.map((log, i) => (
                          <tr key={i}>
                            <td className="px-3 py-2 text-primary">{log.targetName}</td>
                            <td className="px-3 py-2">{log.kind}</td>
                            <td className="px-3 py-2 text-on-surface-variant">{new Date(log.grantedAt).toLocaleDateString()}</td>
                            <td className="px-3 py-2 font-data-mono">{log.durationString}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

            </div>
          )}

          {/* DELETE TAB */}
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