import React, { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { api, useAuth } from '../auth';
import { useCategories } from '../useCategories';
import {
  Icon, Button, SensitivityBadge, FileTypeIcon, StatCard, EmptyState, bytes,
} from '../components/ui';
import SecureViewer from '../components/SecureViewer';
import UploadModal from '../components/UploadModal';
import VersionDrawer from '../components/VersionDrawer';
import AssetAdminModal from '../components/AssetAdminModal';

export default function Repository() {
  const { categoryId } = useParams();
  const { user } = useAuth();
  const { categories, refresh: refreshCategories } = useCategories();
  const [assets, setAssets] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [showUpload, setShowUpload] = useState(false);
  const [versionAsset, setVersionAsset] = useState(null);
  const [adminAsset, setAdminAsset] = useState(null);
  const [bulkMode, setBulkMode] = useState(false);
  const [msg, setMsg] = useState('');
  const [deptFilter, setDeptFilter] = useState('');     // '' = all departments
  const [showFilter, setShowFilter] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const PAGE_SIZE = 25;

  const category = categories.find((c) => c._id === categoryId);
  const departments = category?.departments || [];
  const canUpload = user.role === 'Admin' || (category && category.allowedRoles.includes(user.role));

  const load = useCallback(async () => {
    if (!categoryId) return;
    setLoading(true);
    try {
      const params = { category: categoryId, page, limit: PAGE_SIZE };
      if (deptFilter) params.department = deptFilter;
      const [a, s] = await Promise.all([
        api.get('/assets', { params }),
        api.get('/stats'),
      ]);
      setAssets(a.data.assets);
      setTotalPages(a.data.totalPages || 1);
      setTotal(a.data.total || a.data.assets.length);
      setStats(s.data);
    } catch (err) {
      setMsg(err.response?.data?.error || 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, [categoryId, deptFilter, page]);

  useEffect(() => { load(); }, [load]);
  // Reset to page 1 when the category or department filter changes.
  useEffect(() => { setPage(1); }, [categoryId, deptFilter]);
  // Reset the department filter when switching categories.
  useEffect(() => { setDeptFilter(''); }, [categoryId]);

  const openView = async (id) => {
    try {
      const { data } = await api.get(`/assets/${id}/view`);
      setSession(data);
    } catch (err) {
      setMsg(err.response?.data?.error || 'Cannot open secure view.');
    }
  };

  // Direct download from the table (only shown when the user's role may download).
  const downloadAsset = async (id, filename) => {
    try {
      const res = await api.get(`/assets/${id}/raw`, { params: { download: 1 }, responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (err) {
      setMsg(err.response?.status === 403 ? 'You are not permitted to download this file.' : 'Download failed.');
    }
  };

  const requestAccess = async (id) => {
    const reason = window.prompt('Reason for access request:') || '';
    if (reason === null) return;
    const wantDownload = window.confirm('Request DOWNLOAD access? Click Cancel for view-only access.');
    try {
      await api.post('/access-requests', { assetId: id, reason, kind: wantDownload ? 'download' : 'view' });
      setMsg('Access request submitted.');
      load();
    } catch (err) {
      setMsg(err.response?.data?.error || 'Request failed.');
    }
  };

  const title = category ? category.name : 'Repository';

  return (
    <>
      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-md mb-lg">
          <StatCard icon="folder_managed" label="Total Assets" value={stats.totalAssets} />
          <StatCard icon="lock_open" label="Accessible to You" value={stats.accessibleAssets} accent="text-tertiary" />
          <StatCard icon="pending_actions" label="Pending Requests" value={stats.pendingRequests} accent="text-secondary" />
          <StatCard icon="gpp_maybe" label="Critical Events" value={stats.criticalEvents} accent="text-error" />
        </div>
      )}

      <div className="flex justify-between items-center mb-lg">
        <h2 className="font-headline-md text-headline-md text-primary">{title}</h2>
        <div className="flex gap-sm">
          <Button
            variant={deptFilter ? 'primary' : 'ghost'}
            icon="filter_list"
            onClick={() => setShowFilter((v) => !v)}
          >
            {deptFilter ? `Dept: ${departments.find((d) => d._id === deptFilter)?.name || 'Filter'}` : 'Filter'}
          </Button>
          {canUpload && <Button icon="upload_file" onClick={() => { setBulkMode(false); setShowUpload(true); }}>Upload Asset</Button>}
          {canUpload && <Button variant="secondary" icon="library_add" onClick={() => { setBulkMode(true); setShowUpload(true); }}>Bulk Upload</Button>}
        </div>
      </div>

      {/* Filter panel — filters the list by department within this category */}
      {showFilter && (
        <div className="bg-surface-container-lowest border border-outline-variant rounded-lg p-md mb-lg flex items-center gap-md flex-wrap">
          <span className="font-label-lg text-label-lg text-on-surface-variant uppercase tracking-widest">Department</span>
          <button
            onClick={() => setDeptFilter('')}
            className={`px-3 py-1.5 rounded text-label-lg font-bold border transition-all ${
              deptFilter === '' ? 'bg-primary text-on-primary border-primary' : 'border-outline-variant text-on-surface-variant hover:border-primary'
            }`}
          >
            All
          </button>
          {departments.map((d) => (
            <button
              key={d._id}
              onClick={() => setDeptFilter(d._id)}
              className={`px-3 py-1.5 rounded text-label-lg font-bold border transition-all ${
                deptFilter === d._id ? 'bg-primary text-on-primary border-primary' : 'border-outline-variant text-on-surface-variant hover:border-primary'
              }`}
            >
              {d.name}
            </button>
          ))}
          {departments.length === 0 && (
            <span className="font-body-sm text-body-sm text-on-surface-variant italic">No departments defined for this category yet.</span>
          )}
        </div>
      )}

      {msg && (
        <div className="mb-md px-4 py-2 bg-secondary-container/40 border border-secondary-container rounded font-body-sm text-body-sm flex items-center justify-between">
          <span>{msg}</span>
          <button onClick={() => setMsg('')}><Icon name="close" size={16} /></button>
        </div>
      )}

      <div className="bg-surface-container-lowest border border-outline-variant rounded-lg shadow-sm overflow-hidden">
        <div className="grid grid-cols-12 gap-gutter px-md py-3 bg-surface-container-low border-b border-outline-variant">
          <div className="col-span-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-widest">Filename</div>
          <div className="col-span-2 font-label-md text-label-md text-on-surface-variant uppercase tracking-widest">Department</div>
          <div className="col-span-1 font-label-md text-label-md text-on-surface-variant uppercase tracking-widest">Size</div>
          <div className="col-span-2 font-label-md text-label-md text-on-surface-variant uppercase tracking-widest">Sensitivity</div>
          <div className="col-span-2 font-label-md text-label-md text-on-surface-variant uppercase tracking-widest">Access</div>
          <div className="col-span-1 text-right" />
        </div>

        {loading ? (
          <div className="p-xl text-center text-on-surface-variant font-body-md">Loading secure repository…</div>
        ) : assets.length === 0 ? (
          <EmptyState icon="folder_off" title="No assets here yet" subtitle="Uploaded assets will appear in this repository." />
        ) : (
          <div className="divide-y divide-outline-variant">
            {assets.map((a, idx) => (
              <div
                key={a._id}
                className={`grid grid-cols-12 gap-gutter px-md py-3 items-center group transition-colors hover:bg-surface-container ${
                  idx % 2 ? 'bg-surface-container-low/40' : ''
                }`}
              >
                <div className="col-span-4 flex items-center gap-3 min-w-0">
                  <FileTypeIcon filename={a.filename} type={a.type} />
                  <span className="font-body-md text-body-md font-semibold text-primary truncate">{a.filename}</span>
                  {a.currentVersion > 1 && (
                    <span className="font-data-mono text-[11px] text-on-surface-variant shrink-0">v{a.currentVersion}</span>
                  )}
                </div>
                <div className="col-span-2">
                  {a.department ? (
                    <span className="px-2 py-0.5 rounded-sm bg-surface-container-high text-on-surface-variant text-[11px] font-semibold">{a.department.name}</span>
                  ) : (
                    <span className="text-on-surface-variant text-[12px]">—</span>
                  )}
                </div>
                <div className="col-span-1 font-data-mono text-data-mono text-on-surface-variant">{bytes(a.size)}</div>
                <div className="col-span-2"><SensitivityBadge level={a.sensitivity} /></div>
                <div className="col-span-2">
                  {a.accessible ? (
                    <span className="flex items-center gap-1.5 text-on-tertiary-container font-label-md text-label-md">
                      <Icon name="check_circle" size={16} fill={1} /> Accessible
                    </span>
                  ) : a.requestPending ? (
                    <span className="flex items-center gap-1.5 text-secondary font-label-md text-label-md">
                      <Icon name="hourglass_top" size={16} /> Requested
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-error font-label-md text-label-md">
                      <Icon name="lock" size={16} fill={1} /> Restricted
                    </span>
                  )}
                </div>
                <div className="col-span-1 flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {a.accessible && (
                    <button title="Secure View" onClick={() => openView(a._id)} className="p-2 rounded hover:bg-surface-container-high text-primary">
                      <Icon name="visibility" size={20} />
                    </button>
                  )}
                  {a.accessible && a.canDownload && (
                    <button title="Download" onClick={() => downloadAsset(a._id, a.filename)} className="p-2 rounded hover:bg-surface-container-high text-tertiary">
                      <Icon name="download" size={20} />
                    </button>
                  )}
                  {a.accessible && (
                    <button title="Version History" onClick={() => setVersionAsset(a)} className="p-2 rounded hover:bg-surface-container-high text-secondary">
                      <Icon name="history" size={20} />
                    </button>
                  )}
                  {!a.accessible && !a.requestPending && (
                    <Button variant="secondary" icon="key" onClick={() => requestAccess(a._id)} className="!py-1 !px-3">Request</Button>
                  )}
                  {user.role === 'Admin' && (
                    <button title="Manage (admin)" onClick={() => setAdminAsset(a)} className="p-2 rounded hover:bg-surface-container-high text-on-surface-variant">
                      <Icon name="settings" size={20} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {!loading && total > 0 && (
        <div className="flex items-center justify-between mt-md">
          <span className="font-body-sm text-body-sm text-on-surface-variant">
            Page {page} of {totalPages} · {total} asset{total === 1 ? '' : 's'}
          </span>
          <div className="flex gap-sm">
            <Button variant="ghost" icon="chevron_left" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</Button>
            <Button variant="ghost" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next</Button>
          </div>
        </div>
      )}

      <SecureViewer session={session} onClose={() => setSession(null)} />
      {showUpload && category && (
        <UploadModal
          category={category}
          bulk={bulkMode}
          onClose={() => setShowUpload(false)}
          onUploaded={() => { setShowUpload(false); setMsg(bulkMode ? 'Files uploaded.' : 'Asset uploaded.'); load(); refreshCategories(); }}
        />
      )}
      {versionAsset && <VersionDrawer asset={versionAsset} onClose={() => setVersionAsset(null)} />}
      {adminAsset && (
        <AssetAdminModal
          asset={adminAsset}
          categories={categories}
          onClose={() => setAdminAsset(null)}
          onChanged={() => { load(); }}
        />
      )}
    </>
  );
}
