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
  const [filter, setFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/audit', { params: filter ? { severity: filter } : {} });
      setLogs(data.logs);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <div className="flex justify-between items-center mb-lg">
        <h2 className="font-headline-md text-headline-md text-primary">System Audit Logs</h2>
        <div className="flex items-center gap-2">
          <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-widest">Severity</span>
          {['', 'info', 'warn', 'critical'].map((s) => (
            <button
              key={s || 'all'}
              onClick={() => setFilter(s)}
              className={`px-3 py-1 rounded text-label-lg font-bold border transition-all ${
                filter === s ? 'bg-primary text-on-primary border-primary' : 'border-outline-variant text-on-surface-variant hover:border-primary'
              }`}
            >
              {s ? s.toUpperCase() : 'ALL'}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-inverse-surface rounded-lg border border-outline-variant overflow-hidden shadow-sm">
        <div className="flex items-center gap-2 px-lg py-2 border-b border-white/10 bg-black/30">
          <Icon name="terminal" className="text-tertiary-fixed-dim" size={18} />
          <span className="font-data-mono text-[12px] text-white/70">edms://audit — immutable append-only ledger</span>
          <span className="ml-auto flex items-center gap-1 text-tertiary-fixed-dim font-label-md text-label-md">
            <Icon name="lock" size={14} fill={1} /> WORM
          </span>
        </div>

        <div className="max-h-[65vh] overflow-y-auto font-data-mono text-[12.5px] leading-relaxed">
          {loading ? (
            <div className="p-lg text-white/50">Loading ledger…</div>
          ) : logs.length === 0 ? (
            <div className="p-lg"><EmptyState icon="receipt_long" title="No log entries" /></div>
          ) : (
            logs.map((l) => (
              <div key={l._id} className="flex items-start gap-3 px-lg py-1.5 hover:bg-white/5 border-b border-white/5">
                <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${sevDot[l.severity]}`} />
                <span className="text-white/40 shrink-0">{new Date(l.timestamp).toISOString().replace('T', ' ').slice(0, 19)}</span>
                <span className={`font-bold shrink-0 w-44 ${sevStyle[l.severity]}`}>{l.action}</span>
                <span className="text-secondary-fixed-dim shrink-0">{l.userId?.email || 'anonymous'}</span>
                <span className="text-white/30 shrink-0">{l.ip}</span>
                <span className="text-white/60 break-all">{l.details}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
