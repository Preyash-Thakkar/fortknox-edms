import React, { useState } from 'react';
import { api } from '../auth';
import { Icon, Button } from './ui';

const SENS = ['Public', 'Internal', 'Confidential', 'Strictly Confidential'];
const ACCEPT = '.pdf,.doc,.docx,.jpg,.jpeg,.png,.gbr,.ger,.gerber,.gbl,.gtl,.gbs,.gts,.gbo,.gto,.drl,.xln,.dwg,.dxf,.step,.stp,.iges,.igs,.brd,.sch';

// Upload into a specific category. Access is inherited from that category.
// Single mode: one file + display name + keywords. Bulk mode: many files at once.
export default function UploadModal({ category, bulk = false, onClose, onUploaded }) {
  const [file, setFile] = useState(null);
  const [files, setFiles] = useState([]);            // bulk
  const [displayName, setDisplayName] = useState('');
  const [keywords, setKeywords] = useState('');
  const [sensitivity, setSensitivity] = useState('Internal');
  const [departmentId, setDepartmentId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [skipped, setSkipped] = useState([]);

  const departments = category?.departments || [];

  const submitSingle = async () => {
    if (!file) return setErr('Select a file first.');
    setBusy(true); setErr('');
    const form = new FormData();
    form.append('file', file);
    form.append('filename', displayName.trim() || file.name);
    form.append('keywords', keywords.trim());
    form.append('sensitivity', sensitivity);
    form.append('categoryId', category._id);
    if (departmentId) form.append('departmentId', departmentId);
    form.append('note', note);
    try {
      await api.post('/assets/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      onUploaded();
    } catch (e) {
      setErr(e.response?.data?.error || 'Upload failed.');
    } finally { setBusy(false); }
  };

  const submitBulk = async () => {
    if (!files.length) return setErr('Select one or more files first.');
    setBusy(true); setErr(''); setSkipped([]);
    const form = new FormData();
    files.forEach((f) => form.append('files', f));
    form.append('sensitivity', sensitivity);
    form.append('categoryId', category._id);
    if (departmentId) form.append('departmentId', departmentId);
    try {
      const { data } = await api.post('/assets/bulk-upload', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      if (data.skipped?.length) {
        // Some files were rejected (type/scan). Show which, but keep the rest.
        setSkipped(data.skipped);
        setErr(`${data.created} uploaded, ${data.skipped.length} skipped.`);
        setFiles([]);
      } else {
        onUploaded();
      }
    } catch (e) {
      setErr(e.response?.data?.error || 'Bulk upload failed.');
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-gutter" onClick={onClose}>
      <div className="bg-surface-container-lowest rounded-lg border border-outline-variant shadow-sharp w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-lg py-3 border-b border-outline-variant">
          <h3 className="font-headline-sm text-headline-sm text-primary flex items-center gap-2">
            <Icon name={bulk ? 'library_add' : 'upload_file'} /> {bulk ? 'Bulk upload to' : 'Upload to'} {category?.name}
          </h3>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-surface-container-high"><Icon name="close" /></button>
        </div>

        <div className="p-lg space-y-md">
          {/* Dropzone */}
          <label className="block border-2 border-dashed border-outline-variant rounded-lg p-lg text-center cursor-pointer hover:bg-surface-container-low transition-colors">
            <input
              type="file"
              accept={ACCEPT}
              multiple={bulk}
              className="hidden"
              onChange={(e) => {
                if (bulk) setFiles(Array.from(e.target.files));
                else { setFile(e.target.files[0]); if (!displayName && e.target.files[0]) setDisplayName(e.target.files[0].name); }
              }}
            />
            <Icon name="cloud_upload" size={32} className="text-secondary" />
            <p className="font-body-md text-body-md mt-2">
              {bulk
                ? (files.length ? <span className="font-semibold text-primary">{files.length} file(s) selected</span> : 'Click to select multiple files')
                : (file ? <span className="font-semibold text-primary">{file.name}</span> : 'Click to select a file')}
            </p>
            <p className="font-label-md text-label-md text-on-surface-variant mt-1">PDF · Word · JPEG/PNG · Gerber · CAD · max 50 MB each</p>
          </label>

          {/* Bulk file list */}
          {bulk && files.length > 0 && (
            <div className="max-h-32 overflow-y-auto border border-outline-variant rounded p-2 space-y-1">
              {files.map((f, i) => (
                <div key={i} className="flex items-center justify-between font-body-sm text-body-sm">
                  <span className="truncate">{f.name}</span>
                  <button onClick={() => setFiles(files.filter((_, j) => j !== i))} className="text-on-surface-variant hover:text-error"><Icon name="close" size={14} /></button>
                </div>
              ))}
            </div>
          )}

          {/* Single-file-only fields */}
          {!bulk && (
            <>
              <div>
                <label className="font-label-lg text-label-lg text-on-surface-variant block mb-1">DISPLAY NAME (shown on the portal)</label>
                <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="e.g. Mainboard Rev C Layout"
                  className="w-full px-3 py-2 bg-white border border-outline-variant rounded focus:border-primary outline-none font-body-md" />
              </div>
              <div>
                <label className="font-label-lg text-label-lg text-on-surface-variant block mb-1">KEYWORDS (for search, comma-separated)</label>
                <input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="e.g. chassis, revC, mainboard"
                  className="w-full px-3 py-2 bg-white border border-outline-variant rounded focus:border-primary outline-none font-body-md" />
              </div>
            </>
          )}

          <div className="grid grid-cols-2 gap-md">
            <div>
              <label className="font-label-lg text-label-lg text-on-surface-variant block mb-1">DEPARTMENT</label>
              <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-outline-variant rounded focus:border-primary outline-none font-body-md">
                <option value="">— None —</option>
                {departments.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label className="font-label-lg text-label-lg text-on-surface-variant block mb-1">SENSITIVITY</label>
              <select value={sensitivity} onChange={(e) => setSensitivity(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-outline-variant rounded focus:border-primary outline-none font-body-md">
                {SENS.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div className="flex items-start gap-2 bg-secondary-container/40 rounded px-3 py-2">
            <Icon name="info" size={18} className="text-on-secondary-container mt-0.5" />
            <span className="font-body-sm text-body-sm text-on-secondary-container">
              Access is inherited from the <strong>{category?.name}</strong> category — viewable by:{' '}
              <strong>{(category?.allowedRoles || []).join(', ') || 'Admin only'}</strong>; downloadable by:{' '}
              <strong>{(category?.downloadRoles || []).join(', ') || 'Admin only'}</strong>.
            </span>
          </div>

          {!bulk && (
            <div>
              <label className="font-label-lg text-label-lg text-on-surface-variant block mb-1">VERSION NOTE</label>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Initial version"
                className="w-full px-3 py-2 bg-white border border-outline-variant rounded focus:border-primary outline-none font-body-md" />
            </div>
          )}

          {err && <div className="text-error font-body-sm text-body-sm bg-error-container px-3 py-2 rounded">{err}</div>}
          {skipped.length > 0 && (
            <div className="text-body-sm bg-surface-container-low rounded px-3 py-2">
              <p className="font-semibold text-on-surface-variant mb-1">Skipped files:</p>
              {skipped.map((s, i) => <p key={i} className="text-on-surface-variant">• {s.name} — {s.reason}</p>)}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-sm px-lg py-3 border-t border-outline-variant">
          <Button variant="ghost" onClick={onClose}>{skipped.length ? 'Close' : 'Cancel'}</Button>
          <Button icon="lock" onClick={bulk ? submitBulk : submitSingle} disabled={busy}>
            {busy ? 'Uploading…' : bulk ? `Upload ${files.length || ''} file(s)` : 'Upload Securely'}
          </Button>
        </div>
      </div>
    </div>
  );
}
