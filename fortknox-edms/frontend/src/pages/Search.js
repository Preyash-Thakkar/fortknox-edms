import React, { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../auth';
import { Icon, SensitivityBadge, FileTypeIcon, EmptyState, bytes } from '../components/ui';
import SecureViewer from '../components/SecureViewer';

// Global search across all categories the server lets this user query.
export default function Search() {
  const [params] = useSearchParams();
  const q = params.get('q') || '';
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/assets', { params: { q } });
      setAssets(data.assets);
    } catch {
      setMsg('Search failed.');
    } finally {
      setLoading(false);
    }
  }, [q]);

  useEffect(() => { load(); }, [load]);

  const openView = async (id) => {
    try { const { data } = await api.get(`/assets/${id}/view`); setSession(data); }
    catch (err) { setMsg(err.response?.data?.error || 'Cannot open secure view.'); }
  };
  const downloadAsset = async (id, filename) => {
    try {
      const res = await api.get(`/assets/${id}/raw`, { params: { download: 1 }, responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a'); a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (err) { setMsg(err.response?.status === 403 ? 'Not permitted to download.' : 'Download failed.'); }
  };

  return (
    <>
      <h2 className="font-headline-md text-headline-md text-primary mb-1">Search results</h2>
      <p className="font-body-md text-body-md text-on-surface-variant mb-lg">
        {q ? <>Showing matches for &ldquo;<span className="font-semibold">{q}</span>&rdquo;</> : 'Type a query in the search box above.'}
      </p>

      {msg && <div className="mb-md px-4 py-2 bg-secondary-container/40 border border-secondary-container rounded font-body-sm text-body-sm">{msg}</div>}

      <div className="bg-surface-container-lowest border border-outline-variant rounded-lg shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-xl text-center text-on-surface-variant font-body-md">Searching…</div>
        ) : assets.length === 0 ? (
          <EmptyState icon="search_off" title="No matches" subtitle="Try a different name or keyword." />
        ) : (
          <div className="divide-y divide-outline-variant">
            {assets.map((a) => (
              <div key={a._id} className="grid grid-cols-12 gap-gutter px-md py-3 items-center group hover:bg-surface-container">
                <div className="col-span-5 flex items-center gap-3 min-w-0">
                  <FileTypeIcon filename={a.filename} type={a.type} />
                  <div className="min-w-0">
                    <p className="font-body-md text-body-md font-semibold text-primary truncate">{a.filename}</p>
                    <p className="font-label-md text-label-md text-on-surface-variant truncate">
                      {a.category?.name}{a.department ? ` › ${a.department.name}` : ''}{a.keywords ? ` · ${a.keywords}` : ''}
                    </p>
                  </div>
                </div>
                <div className="col-span-2 font-data-mono text-data-mono text-on-surface-variant">{bytes(a.size)}</div>
                <div className="col-span-2"><SensitivityBadge level={a.sensitivity} /></div>
                <div className="col-span-2">
                  {a.accessible
                    ? <span className="flex items-center gap-1.5 text-on-tertiary-container font-label-md text-label-md"><Icon name="check_circle" size={16} fill={1} /> Accessible</span>
                    : <span className="flex items-center gap-1.5 text-error font-label-md text-label-md"><Icon name="lock" size={16} fill={1} /> Restricted</span>}
                </div>
                <div className="col-span-1 flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {a.accessible && (
                    <>
                      <button title="Secure View" onClick={() => openView(a._id)} className="p-2 rounded hover:bg-surface-container-high text-primary"><Icon name="visibility" size={20} /></button>
                      {a.canDownload && <button title="Download" onClick={() => downloadAsset(a._id, a.filename)} className="p-2 rounded hover:bg-surface-container-high text-tertiary"><Icon name="download" size={20} /></button>}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <SecureViewer session={session} onClose={() => setSession(null)} />
    </>
  );
}
