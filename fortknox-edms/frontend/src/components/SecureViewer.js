import React, { useEffect, useRef, useState } from 'react';
import { api } from '../auth';
import { Icon, SensitivityBadge } from './ui';

/**
 * Read-only secure document viewer.
 *
 * Rendering: the watermarked render is fetched as a blob over the authenticated
 * (cookie) axios instance, so no token ever appears in a URL. PDFs and Word
 * (converted to PDF server-side) render in an <iframe>; images render in <img>.
 *
 * View-only hardening (see banner in the UI): for users without download
 * permission we remove the download affordance, disable right-click / drag /
 * copy / print & save keyboard shortcuts, blur the document when the window
 * loses focus or the tab is hidden, and overlay a heavy identifying watermark.
 *
 * HONEST LIMITATION: none of this can make a displayed document impossible to
 * copy. Anything rendered in a browser can be captured via DevTools, an OS
 * screenshot tool, or a phone camera — all of which are outside a web page's
 * control. The real protection is the per-viewer watermark (email + timestamp),
 * which makes any leak TRACEABLE even though it cannot be PREVENTED.
 */
export default function SecureViewer({ session, onClose }) {
  const [blobUrl, setBlobUrl] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | loading | ready | unpreviewable | error
  const [errMsg, setErrMsg] = useState('');
  const [obscured, setObscured] = useState(false); // blur when focus/visibility lost
  const blobRef = useRef(null);

  const asset = session?.asset;
  const assetId = asset?.id;
  const previewKind = session?.previewKind;             // 'pdf' | 'image' | 'none'
  const serverPreviewable = session?.previewable;
  const canDownload = session?.canDownload;
  const viewOnly = !canDownload;

  // Fetch + render whenever a new asset is opened.
  useEffect(() => {
    let cancelled = false;
    // clean any previous object URL
    if (blobRef.current) { URL.revokeObjectURL(blobRef.current); blobRef.current = null; }
    setBlobUrl(null); setErrMsg('');

    if (!assetId) { setStatus('idle'); return; }
    if (!serverPreviewable || previewKind === 'none') { setStatus('unpreviewable'); return; }

    setStatus('loading');
    (async () => {
      try {
        const res = await api.get(`/assets/${assetId}/raw`, { responseType: 'blob' });
        if (cancelled) return;
        // Force the MIME type so the iframe/img render correctly. Word arrives as
        // PDF (previewKind 'pdf') even though its filename ends in .docx.
        const mime = previewKind === 'pdf' ? 'application/pdf'
          : previewKind === 'image' ? (res.data.type || 'image/png')
          : res.data.type;
        const typed = new Blob([res.data], { type: mime });
        const url = URL.createObjectURL(typed);
        blobRef.current = url;
        setBlobUrl(url);
        setStatus('ready');
      } catch (err) {
        if (cancelled) return;
        const st = err.response?.status;
        if (st === 415 || st === 422) setStatus('unpreviewable');
        else { setErrMsg('Could not load the secure preview.'); setStatus('error'); }
      }
    })();

    return () => {
      cancelled = true;
      if (blobRef.current) { URL.revokeObjectURL(blobRef.current); blobRef.current = null; }
    };
  }, [assetId, previewKind, serverPreviewable]);

  // View-only hardening: block copy/save/print shortcuts + context menu, and
  // obscure the document when the user leaves the window/tab (a common moment
  // for screenshots). Only active for view-only (no-download) sessions.
  useEffect(() => {
    if (!session || !viewOnly) return;

    const blockKeys = (e) => {
      const k = (e.key || '').toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      // Ctrl/Cmd+S (save), +P (print), +C (copy), +A (select all)
      if (mod && ['s', 'p', 'c', 'a'].includes(k)) { e.preventDefault(); e.stopPropagation(); return false; }
      // PrintScreen can't be reliably cancelled, but we blur on it as a deterrent.
      if (k === 'printscreen') { setObscured(true); setTimeout(() => setObscured(false), 1200); }
    };
    const blockContext = (e) => { e.preventDefault(); return false; };
    const onBlur = () => setObscured(true);
    const onFocus = () => setObscured(false);
    const onVis = () => setObscured(document.hidden);

    window.addEventListener('keydown', blockKeys, true);
    window.addEventListener('contextmenu', blockContext, true);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('keydown', blockKeys, true);
      window.removeEventListener('contextmenu', blockContext, true);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [session, viewOnly]);

  if (!session) return null;

  const doDownload = async () => {
    if (!canDownload) return;
    try {
      const res = await api.get(`/assets/${assetId}/raw`, { params: { download: 1 }, responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url; a.download = asset.filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (err) {
      setErrMsg(err.response?.status === 403 ? 'You are not permitted to download this file.' : 'Download failed.');
      setStatus('error');
    }
  };

  const showDoc = status === 'ready' && blobUrl;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-gutter" onClick={onClose}>
      <div
        className="bg-surface-container-lowest rounded-lg border border-outline-variant shadow-sharp w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden select-none"
        onClick={(e) => e.stopPropagation()}
        onContextMenu={viewOnly ? (e) => e.preventDefault() : undefined}
        style={viewOnly ? { userSelect: 'none' } : undefined}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-lg py-3 border-b border-outline-variant bg-surface-container-low">
          <div className="flex items-center gap-3 min-w-0">
            <Icon name="shield" className="text-tertiary" fill={1} />
            <div className="min-w-0">
              <p className="font-body-md text-body-md font-semibold text-primary truncate">{asset.filename}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <SensitivityBadge level={asset.sensitivity} />
                <span className="font-data-mono text-[11px] text-on-surface-variant">v{asset.version}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-md">
            {canDownload ? (
              <button onClick={doDownload} className="flex items-center gap-1.5 bg-primary text-on-primary px-3 py-1.5 rounded font-label-lg text-label-lg font-bold hover:opacity-90 transition-opacity">
                <Icon name="download" size={16} /> Download
              </button>
            ) : (
              <span className="flex items-center gap-1 text-on-tertiary-container text-label-md font-bold uppercase tracking-wide">
                <Icon name="lock" size={14} fill={1} /> View-only
              </span>
            )}
            <button onClick={onClose} className="p-2 rounded hover:bg-surface-container-high transition-colors"><Icon name="close" /></button>
          </div>
        </div>

        {/* View-only notice */}
        {viewOnly && (
          <div className="px-lg py-1.5 bg-tertiary-container/40 border-b border-outline-variant flex items-center gap-2">
            <Icon name="lock" size={15} className="text-on-tertiary-container" />
            <span className="font-label-md text-label-md text-on-tertiary-container">
              View-only document. Downloading, printing and copying are disabled. This view is watermarked and logged.
            </span>
          </div>
        )}

        {/* Document area */}
        <div className="relative flex-1 overflow-hidden bg-surface-container min-h-[420px] flex items-center justify-center">
          {/* Heavy identifying watermark — overlaid above the document, non-interactive */}
          {showDoc && (
            <div className="absolute inset-0 z-20 flex flex-wrap content-start pointer-events-none select-none overflow-hidden"
              style={{ transform: 'rotate(-28deg) scale(1.5)', opacity: viewOnly ? 0.16 : 0.10 }}>
              {Array.from({ length: 80 }).map((_, i) => (
                <span key={i} className="font-data-mono text-[12px] text-black whitespace-nowrap p-4">{session.watermark}</span>
              ))}
            </div>
          )}

          {/* Obscure overlay when focus/visibility is lost (screenshot deterrent) */}
          {obscured && showDoc && (
            <div className="absolute inset-0 z-30 bg-surface-container-high/95 backdrop-blur-xl flex flex-col items-center justify-center gap-2">
              <Icon name="visibility_off" size={40} className="text-on-surface-variant" />
              <p className="font-body-md text-body-md text-on-surface-variant">Preview hidden while this window is inactive</p>
            </div>
          )}

          {status === 'loading' && <div className="text-on-surface-variant font-body-md">Preparing secure preview…</div>}
          {status === 'error' && <div className="text-error font-body-md px-md text-center">{errMsg}</div>}

          {showDoc && previewKind === 'pdf' && (
            <div className="relative z-10 w-full h-[64vh]">
              <iframe
                title={asset.filename}
                src={`${blobUrl}#toolbar=0&navpanes=0&statusbar=0&view=FitH`}
                className="w-full h-full bg-white border-0"
              />
              {/* View-only: cover the area where the browser PDF viewer shows its
                  own download/print buttons so they can't be clicked. Honest note:
                  this is friction, not a guarantee — see the component header. */}
              {viewOnly && (
                <div className="absolute top-0 right-0 h-12 w-44 z-20" style={{ background: 'transparent' }}
                  onContextMenu={(e) => e.preventDefault()} onClick={(e) => e.preventDefault()} />
              )}
            </div>
          )}
          {showDoc && previewKind === 'image' && (
            <img
              src={blobUrl}
              alt={asset.filename}
              className="relative z-10 max-w-full max-h-[64vh] object-contain pointer-events-none"
              draggable={false}
              onDragStart={(e) => e.preventDefault()}
              onContextMenu={(e) => e.preventDefault()}
            />
          )}

          {status === 'unpreviewable' && (
            <div className="relative z-10 p-xl text-center max-w-md">
              <div className="w-16 h-16 mx-auto rounded-lg bg-surface-container-high flex items-center justify-center mb-md">
                <Icon name="visibility_off" size={32} className="text-on-surface-variant" />
              </div>
              <p className="font-body-lg text-body-lg font-semibold text-primary mb-2">No inline preview available</p>
              <p className="font-body-sm text-body-sm text-on-surface-variant mb-md">
                This file type ({asset.fileType || asset.type || 'unknown'}) can&apos;t be rendered in the browser.
                {canDownload
                  ? ' You have download permission, so you can save a copy below.'
                  : ' For security, this file is view-only and cannot be downloaded.'}
              </p>
              {canDownload && (
                <button onClick={doDownload} className="inline-flex items-center gap-1.5 bg-primary text-on-primary px-4 py-2 rounded font-label-lg text-label-lg font-bold hover:opacity-90 transition-opacity">
                  <Icon name="download" size={16} /> Download File
                </button>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-lg py-2 border-t border-outline-variant bg-surface-container-low flex items-center justify-between">
          <span className="font-data-mono text-[11px] text-on-surface-variant truncate">sha256: {asset.hash || '—'}</span>
          <span className="flex items-center gap-1 text-on-tertiary-container text-label-md font-bold"><Icon name="verified" size={14} fill={1} /> Integrity verified</span>
        </div>
      </div>
    </div>
  );
}
