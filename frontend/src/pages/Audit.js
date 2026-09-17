import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../auth';
import { Icon, EmptyState } from '../components/ui';

const sevStyle = {
  info: 'text-on-tertiary-container',
  warn: 'text-amber-600',
  critical: 'text-error',
};
const sevDot = {
  info: 'bg-on-tertiary-container',
  warn: 'bg-amber-500',
  critical: 'bg-error',
};

export default function Audit() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('ALL');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/audit');
      // FIXED: Safely extract the logs array from the backend response
      const logsArray = Array.isArray(data) ? data : (data.logs || []);
      setLogs(logsArray);
    } catch (err) {
      setError('Failed to load audit logs.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Filter logic based on the active tab
  const filteredLogs = logs.filter(l => {
    if (activeTab === 'ALL') return true;

    // Groupings based on action substrings
    const action = l.action || '';
    if (activeTab === 'AUTH') return ['LOGIN', 'LOGIN_FAILED', 'LOGOUT'].includes(action);
    if (activeTab === 'DOCS') return action.includes('VIEW') || action.includes('DOWNLOAD') || action.includes('UPLOAD') || action.includes('EDIT') || action.includes('VERSION');
    if (activeTab === 'REQUESTS') return action.includes('REQUEST');
    if (activeTab === 'SYSTEM') return action.includes('USER') || action.includes('CATEGORY') || action.includes('REPO');

    return true;
  });

  return (
    <>
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-lg gap-4">
        <h2 className="font-headline-md text-headline-md text-primary">System Audit Logs</h2>

        {/* TAB NAVIGATION */}
        <div className="flex bg-surface-container-low p-1 rounded-lg border border-outline-variant overflow-x-auto">
          {['ALL', 'AUTH', 'DOCS', 'REQUESTS', 'SYSTEM'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all whitespace-nowrap ${activeTab === tab ? 'bg-primary text-on-primary shadow' : 'text-on-surface-variant hover:text-primary'}`}
            >
              {tab === 'DOCS' ? 'DOCUMENTS' : tab === 'AUTH' ? 'AUTHENTICATION' : tab}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-md px-4 py-2 bg-error-container text-error rounded font-body-sm text-body-sm">
          {error}
        </div>
      )}

      <div className="bg-inverse-surface rounded-lg border border-outline-variant overflow-hidden shadow-sm">
        <div className="flex items-center gap-2 px-lg py-2 border-b border-white/10 bg-black/30">
          <Icon name="terminal" className="text-tertiary-fixed-dim" size={18} />
          <span className="font-data-mono text-[12px] text-white/70">edms://audit — immutable append-only ledger</span>
          <div className="ml-auto flex items-center gap-4">
            <button onClick={load} className="text-white/50 hover:text-white transition-colors flex items-center gap-1 text-[12px] font-bold uppercase">
              <Icon name="sync" size={14} /> Refresh
            </button>
            <span className="flex items-center gap-1 text-tertiary-fixed-dim font-label-md text-label-md">
              <Icon name="lock" size={14} fill={1} /> WORM
            </span>
          </div>
        </div>

        <div className="max-h-[65vh] overflow-y-auto font-data-mono text-[12.5px] leading-relaxed">
          {loading ? (
            <div className="p-lg text-white/50 flex items-center gap-2">
              <Icon name="sync" className="animate-spin" size={16} /> Decrypting ledger...
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="p-lg"><EmptyState icon="receipt_long" title={`No ${activeTab} log entries`} /></div>
          ) : (
            filteredLogs.map((l) => {
              // Extract human-readable name, falling back to email or anonymous
              const operatorName = l.userId?.name || l.userId?.email || 'anonymous';
              const sevStyleClass = sevStyle[l.severity] || 'text-white/70';
              const sevDotClass = sevDot[l.severity] || 'bg-white/50';

              return (
                <div key={l._id} className="flex items-start gap-3 px-lg py-1.5 hover:bg-white/5 border-b border-white/5 transition-colors">
                  <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${sevDotClass}`} />
                  <span className="text-white/40 shrink-0 w-36">
                    {new Date(l.timestamp || l.createdAt).toISOString().replace('T', ' ').slice(0, 19)}
                  </span>
                  <span className={`font-bold shrink-0 w-44 ${sevStyleClass}`}>{l.action}</span>

                  {/* Human-Readable Operator Name */}
                  <span className="text-secondary-fixed-dim shrink-0 w-48 truncate font-semibold" title={operatorName}>
                    {operatorName}
                  </span>

                  <span className="text-white/30 shrink-0 w-24 truncate">{l.ip}</span>
                  <span className="text-white/70 break-all flex-1">{l.details}</span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}