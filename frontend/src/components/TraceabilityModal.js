import React, { useState, useEffect } from 'react';
import { api } from '../auth';
import { Icon, Button } from './ui';

export default function TraceabilityModal({ assetId, onClose }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [tab, setTab] = useState('versions');

    useEffect(() => {
        api.get(`/assets/${assetId}/traceability`)
            .then(res => {
                setData(res.data);
                setLoading(false);
            })
            .catch(err => {
                setError(err.response?.data?.error || 'Failed to load traceability logs.');
                setLoading(false);
            });
    }, [assetId]);

    if (loading) return (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
            <div className="bg-surface-container-lowest rounded-lg p-xl shadow-xl flex flex-col items-center gap-4 text-primary">
                <Icon name="sync" className="animate-spin" size={32} />
                <span className="font-label-lg text-label-lg font-bold uppercase tracking-widest">Decrypting Ledger...</span>
            </div>
        </div>
    );

    if (error) return (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-surface-container-lowest rounded-lg p-xl shadow-xl max-w-sm w-full text-center" onClick={e => e.stopPropagation()}>
                <Icon name="error" className="text-error mx-auto mb-4" size={48} />
                <p className="font-body-md text-body-md text-on-surface mb-6">{error}</p>
                <Button variant="ghost" onClick={onClose}>Close</Button>
            </div>
        </div>
    );

    const { asset, logs } = data;

    const allVersions = [
        { ...asset, isCurrent: true },
        ...(asset.history || []).map(h => ({ ...h, isCurrent: false }))
    ].sort((a, b) => new Date(b.updatedAt || b.uploadedAt) - new Date(a.updatedAt || a.uploadedAt));

    return (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-surface-container-lowest rounded-lg border border-outline-variant shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>

                <div className="flex items-center justify-between px-lg py-4 border-b border-outline-variant shrink-0">
                    <div>
                        <h3 className="font-headline-sm text-headline-sm text-primary flex items-center gap-2">
                            <Icon name="policy" /> Traceability Report
                        </h3>
                        <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">
                            Asset: <strong className="text-on-surface">"{asset.filename}"</strong>
                        </p>
                    </div>
                    <button onClick={onClose} className="p-1.5 rounded hover:bg-surface-container-high transition-colors"><Icon name="close" /></button>
                </div>

                <div className="flex bg-surface-container-low px-lg py-2 border-b border-outline-variant shrink-0 gap-2">
                    <button onClick={() => setTab('versions')} className={`px-4 py-2 rounded-md text-sm font-bold transition-all ${tab === 'versions' ? 'bg-white shadow text-primary' : 'text-on-surface-variant hover:text-primary'}`}>
                        Version History ({allVersions.length})
                    </button>
                    <button onClick={() => setTab('logs')} className={`px-4 py-2 rounded-md text-sm font-bold transition-all ${tab === 'logs' ? 'bg-white shadow text-primary' : 'text-on-surface-variant hover:text-primary'}`}>
                        Audit Logs ({logs.length})
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-lg">

                    {tab === 'versions' && (
                        <div className="space-y-4">
                            {allVersions.map((v, i) => (
                                <div key={i} className="flex gap-4 p-4 rounded-lg border border-outline-variant bg-surface relative">
                                    {v.isCurrent && (
                                        <span className="absolute -top-2.5 right-4 bg-tertiary text-on-tertiary px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest shadow-sm">
                                            Current Version
                                        </span>
                                    )}
                                    <div className="shrink-0 flex flex-col items-center justify-center w-12 h-12 rounded bg-surface-container-high text-primary font-bold">
                                        v{allVersions.length - i}
                                    </div>
                                    <div className="flex-1">
                                        <p className="font-label-lg text-label-lg text-on-surface">{v.versionNote || 'No note provided'}</p>
                                        <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">
                                            Committed by <strong className="text-on-surface">{v.uploadedBy?.name || 'Unknown'}</strong> on {new Date(v.updatedAt || v.uploadedAt).toLocaleString()}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {tab === 'logs' && (
                        <div className="divide-y divide-outline-variant font-data-mono text-[13px]">
                            {logs.map(log => (
                                <div key={log._id} className="py-3 flex gap-4 hover:bg-surface-container-low transition-colors px-2 rounded">
                                    <div className="w-40 shrink-0 text-on-surface-variant">
                                        {new Date(log.createdAt || log.timestamp).toLocaleString(undefined, { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                    </div>
                                    <div className={`w-40 shrink-0 font-bold ${log.severity === 'CRITICAL' ? 'text-error' : log.severity === 'WARN' ? 'text-secondary' : 'text-tertiary'}`}>
                                        {log.action}
                                    </div>
                                    {/* FIXED: Reading from userId instead of actor */}
                                    <div className="w-48 shrink-0 text-on-surface font-semibold truncate">
                                        {log.userId?.name || log.userId?.email || 'System'}
                                    </div>
                                    <div className="flex-1 text-on-surface-variant truncate" title={log.details}>
                                        {log.details.replace(`asset=${asset._id}`, '').trim()}
                                    </div>
                                </div>
                            ))}
                            {logs.length === 0 && (
                                <div className="text-center py-8 text-on-surface-variant">No access logs recorded for this asset yet.</div>
                            )}
                        </div>
                    )}

                </div>

                <div className="px-lg py-3 border-t border-outline-variant bg-surface-container-lowest flex justify-end">
                    <Button variant="ghost" onClick={onClose}>Close Report</Button>
                </div>

            </div>
        </div>
    );
}