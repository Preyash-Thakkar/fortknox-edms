import React from 'react';
import { Icon, SensitivityBadge } from './ui';

// Mock watermarked secure previewer (from secure_document_previewer mockup).
export default function SecureViewer({ session, onClose }) {
  if (!session) return null;
  const { asset, watermark, message } = session;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-gutter" onClick={onClose}>
      <div
        className="bg-surface-container-lowest rounded-lg border border-outline-variant shadow-sharp w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Viewer toolbar */}
        <div className="flex items-center justify-between px-lg py-3 border-b border-outline-variant bg-surface-container-low">
          <div className="flex items-center gap-3 min-w-0">
            <Icon name="shield" className="text-tertiary" fill={1} />
            <div className="min-w-0">
              <p className="font-body-md text-body-md font-semibold text-primary truncate">{session?.filename}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <SensitivityBadge level={asset?.sensitivity} />
                <span className="font-data-mono text-[11px] text-on-surface-variant">v{asset?.version}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-md">
            <span className="hidden sm:flex items-center gap-1 text-on-tertiary-container text-label-md font-bold uppercase tracking-wide">
              <Icon name="lock" size={14} fill={1} /> Read-only
            </span>
            <button onClick={onClose} className="p-2 rounded hover:bg-surface-container-high transition-colors">
              <Icon name="close" />
            </button>
          </div>
        </div>

        {/* Viewer stage with repeating watermark */}
        <div style={{ overflow: "auto", height: "100%", width: "100%" }} className="relative flex-1 overflow-hidden bg-surface-container min-h-[420px]">
          <div
            className="absolute inset-0 flex flex-wrap content-start pointer-events-none select-none"
            style={{ transform: 'rotate(-28deg) scale(1.4)', opacity: 0.12 }}
          >
            {Array.from({ length: 60 }).map((_, i) => (
              <span key={i} className="font-data-mono text-[11px] text-black whitespace-nowrap p-4">
                {watermark}
              </span>
            ))}
          </div>

          {/* Mock document page */}
          <div style={{ overflow: "auto", height: "100%", width: "100%" }} className="relative z-10 p-xl flex items-center justify-center h-full">
            <div className="bg-white border border-outline-variant rounded shadow-sharp w-full max-w-2xl aspect-[1/1.1] p-xl flex flex-col">
              <div className="flex items-center gap-2 text-secondary mb-lg">
                <Icon name="description" fill={1} />
                <span className="font-label-lg text-label-lg uppercase tracking-widest">Secure Render</span>
              </div>
              <iframe width="100%" height="100%" src={session?.url} alt="Secure preview" className="border border-outline-variant rounded mb-lg" />
              <p className="font-body-sm text-body-sm text-on-surface-variant mt-lg">{message}</p>
            </div>
          </div>
        </div>

        {/* Footer: integrity hash */}
        <div className="px-lg py-2 border-t border-outline-variant bg-surface-container-low flex items-center justify-between">
          <span className="font-data-mono text-[11px] text-on-surface-variant truncate">
            sha256: {asset?.hash || '—'}
          </span>
          <span className="flex items-center gap-1 text-on-tertiary-container text-label-md font-bold">
            <Icon name="verified" size={14} fill={1} /> Integrity verified
          </span>
        </div>
      </div>
    </div>
  );
}
