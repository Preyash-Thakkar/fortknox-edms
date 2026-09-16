import React, { useEffect, useState } from 'react';
import { api } from '../auth';
import { Icon, bytes } from './ui';

export default function VersionDrawer({ asset, onClose }) {
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get(`/assets/${asset._id}/versions`)
      .then(({ data }) => setVersions(data.versions))
      .catch(() => setVersions([]))
      .finally(() => setLoading(false));
  }, [asset._id]);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex justify-end" onClick={onClose}>
      <div
        className="w-full max-w-md h-full bg-surface-container-lowest border-l border-outline-variant shadow-sharp flex flex-col animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-lg py-3 border-b border-outline-variant">
          <div className="min-w-0">
            <h3 className="font-headline-sm text-headline-sm text-primary flex items-center gap-2">
              <Icon name="history" /> Version History
            </h3>
            <p className="font-body-sm text-body-sm text-on-surface-variant truncate">{asset.filename}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-surface-container-high"><Icon name="close" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-lg">
          {loading ? (
            <p className="text-on-surface-variant font-body-md">Loading…</p>
          ) : (
            <ol className="relative border-l-2 border-outline-variant ml-2 space-y-lg">
              {versions.map((v) => (
                <li key={v.version} className="ml-lg relative">
                  <span className="absolute -left-[31px] top-0 w-4 h-4 rounded-full bg-primary border-4 border-surface-container-lowest" />
                  <div className="flex items-center justify-between">
                    <span className="font-body-md text-body-md font-bold text-primary">Version {v.version}</span>
                    <span className="font-data-mono text-[11px] text-on-surface-variant">{bytes(v.size)}</span>
                  </div>
                  <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">{v.note}</p>
                  <p className="font-label-md text-label-md text-on-surface-variant mt-1">
                    {v.uploadedBy?.name || 'Unknown'} · {new Date(v.uploadedAt).toLocaleString()}
                  </p>
                  <p className="font-data-mono text-[10px] text-on-surface-variant mt-1 break-all bg-surface-container px-2 py-1 rounded">
                    sha256: {v.hash}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
