import React, { useEffect, useState, useCallback } from 'react';
import { api, useAuth } from '../auth';
import {
  Icon, Button, SensitivityBadge, FileTypeIcon, StatCard, EmptyState, bytes,
} from '../components/ui';
import SecureViewer from '../components/SecureViewer';
import UploadModal from '../components/UploadModal';
import VersionDrawer from '../components/VersionDrawer';

// Reusable repository view; `category` filters (Technical/Legal/Operational) or null for all.
export default function Repository({ category = null, title = 'Technical Assets' }) {
  const { user } = useAuth();
  const [assets, setAssets] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);     // secure viewer
  const [showUpload, setShowUpload] = useState(false);
  const [versionAsset, setVersionAsset] = useState(null);
  const [msg, setMsg] = useState('');

  const canUpload = ['Admin', 'Engineering', 'Legal', 'Management'].includes(user.role);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, s] = await Promise.all([
        api.get('/assets', { params: category ? { category } : {} }),
        api.get('/stats'),
      ]);
      setAssets(a.data.assets);
      setStats(s.data);
    } catch (err) {
      setMsg(err.response?.data?.error || 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, [category]);

  useEffect(() => { load(); }, [load]);

  const openView = async (filename) => {
    try {
      // 1. Use template literals (${}) to inject the filename into the URL
      // 2. Add responseType: 'blob' so Axios knows it's downloading a file
      const res = await api.get(`/uploads/${filename}`, {
        responseType: 'blob'
      });

      // res.data contains the blob when using Axios
      const url = window.URL.createObjectURL(res.data);
      setSession({ url, filename });

    } catch (err) {
      console.error("Download failed:", err);
      // setMsg('Cannot download file.');
    }
  };

  const requestAccess = async (id) => {
    const reason = window.prompt('Reason for access request:') || '';
    try {
      await api.post('/access-requests', { assetId: id, reason });
      setMsg('Access request submitted.');
      load();
    } catch (err) {
      setMsg(err.response?.data?.error || 'Request failed.');
    }
  };

  return (
    <>
      {/* Stat row */}
      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-md mb-lg">
          <StatCard icon="folder_managed" label="Total Assets" value={stats.totalAssets} />
          <StatCard icon="lock_open" label="Accessible to You" value={stats.accessibleAssets} accent="text-tertiary" />
          <StatCard icon="pending_actions" label="Pending Requests" value={stats.pendingRequests} accent="text-secondary" />
          <StatCard icon="gpp_maybe" label="Critical Events" value={stats.criticalEvents} accent="text-error" />
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-between items-center mb-lg">
        <h2 className="font-headline-md text-headline-md text-primary">{title}</h2>
        <div className="flex gap-sm">
          <Button variant="ghost" icon="filter_list">Filter</Button>
          {canUpload && <Button icon="upload_file" onClick={() => setShowUpload(true)}>Upload Asset</Button>}
        </div>
      </div>

      {msg && (
        <div className="mb-md px-4 py-2 bg-secondary-container/40 border border-secondary-container rounded font-body-sm text-body-sm flex items-center justify-between">
          <span>{msg}</span>
          <button onClick={() => setMsg('')}><Icon name="close" size={16} /></button>
        </div>
      )}

      {/* Repository table */}
      <div className="bg-surface-container-lowest border border-outline-variant rounded-lg shadow-sm overflow-hidden">
        <div className="grid grid-cols-12 gap-gutter px-md py-3 bg-surface-container-low border-b border-outline-variant">
          <div className="col-span-5 font-label-md text-label-md text-on-surface-variant uppercase tracking-widest">Filename</div>
          <div className="col-span-1 font-label-md text-label-md text-on-surface-variant uppercase tracking-widest">Size</div>
          <div className="col-span-2 font-label-md text-label-md text-on-surface-variant uppercase tracking-widest">Sensitivity</div>
          <div className="col-span-2 font-label-md text-label-md text-on-surface-variant uppercase tracking-widest">Access</div>
          <div className="col-span-2 text-right" />
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
                className={`grid grid-cols-12 gap-gutter px-md py-3 items-center group transition-colors hover:bg-surface-container ${idx % 2 ? 'bg-surface-container-low/40' : ''
                  }`}
              >
                <div className="col-span-5 flex items-center gap-3 min-w-0">
                  <FileTypeIcon filename={a.filename} type={a.type} />
                  <span className="font-body-md text-body-md font-semibold text-primary truncate">{a.filename}</span>
                  {a.currentVersion > 1 && (
                    <span className="font-data-mono text-[11px] text-on-surface-variant shrink-0">v{a.currentVersion}</span>
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
                <div className="col-span-2 flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {a.accessible ? (
                    <>
                      <button
                        title="Secure View"
                        onClick={() => openView(a.filename)}
                        className="p-2 rounded hover:bg-surface-container-high text-primary"
                      >
                        <Icon name="visibility" size={20} />
                      </button>
                      <button
                        title="Version History"
                        onClick={() => setVersionAsset(a)}
                        className="p-2 rounded hover:bg-surface-container-high text-secondary"
                      >
                        <Icon name="history" size={20} />
                      </button>
                    </>
                  ) : !a.requestPending ? (
                    <Button variant="secondary" icon="key" onClick={() => requestAccess(a._id)} className="!py-1 !px-3">
                      Request
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <SecureViewer session={session} onClose={() => setSession(null)} />
      {showUpload && (
        <UploadModal
          defaultCategory={category || 'Technical'}
          onClose={() => setShowUpload(false)}
          onUploaded={() => { setShowUpload(false); setMsg('Asset uploaded.'); load(); }}
        />
      )}
      {versionAsset && <VersionDrawer asset={versionAsset} onClose={() => setVersionAsset(null)} />}
    </>
  );
}
