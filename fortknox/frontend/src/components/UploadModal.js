import React, { useState } from 'react';
import { api } from '../auth';
import { Icon, Button } from './ui';

const ROLES = ['Admin', 'Engineering', 'Legal', 'Management'];
const SENS = ['Public', 'Internal', 'Confidential', 'Strictly Confidential'];
const CATS = ['Technical', 'Legal', 'Operational'];

export default function UploadModal({ onClose, onUploaded, defaultCategory = 'Technical' }) {
  const [file, setFile] = useState(null);
  const [sensitivity, setSensitivity] = useState('Internal');
  const [category, setCategory] = useState(defaultCategory);
  const [roles, setRoles] = useState(['Engineering']);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const toggle = (r) => setRoles((p) => (p.includes(r) ? p.filter((x) => x !== r) : [...p, r]));

  const submit = async () => {
    if (!file) return setErr('Select a file first.');
    if (roles.length === 0) return setErr('Select at least one role.');
    setBusy(true);
    setErr('');
    const form = new FormData();
    form.append('file', file);
    form.append('filename', file.name);
    form.append('sensitivity', sensitivity);
    form.append('category', category);
    form.append('allowedRoles', roles.join(','));
    form.append('note', note);
    try {
      await api.post('/assets/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      onUploaded();
    } catch (e) {
      setErr(e.response?.data?.error || 'Upload failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-gutter" onClick={onClose}>
      <div
        className="bg-surface-container-lowest rounded-lg border border-outline-variant shadow-sharp w-full max-w-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-lg py-3 border-b border-outline-variant">
          <h3 className="font-headline-sm text-headline-sm text-primary flex items-center gap-2">
            <Icon name="upload_file" /> Upload Secure Asset
          </h3>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-surface-container-high"><Icon name="close" /></button>
        </div>

        <div className="p-lg space-y-md">
          {/* Dropzone */}
          <label className="block border-2 border-dashed border-outline-variant rounded-lg p-lg text-center cursor-pointer hover:bg-surface-container-low transition-colors">
            <input type="file" className="hidden" onChange={(e) => setFile(e.target.files[0])} />
            <Icon name="cloud_upload" size={32} className="text-secondary" />
            <p className="font-body-md text-body-md mt-2">
              {file ? <span className="font-semibold text-primary">{file.name}</span> : 'Click to select a file'}
            </p>
            <p className="font-label-md text-label-md text-on-surface-variant mt-1">Encrypted at rest · max 50 MB</p>
          </label>

          <div className="grid grid-cols-2 gap-md">
            <div>
              <label className="font-label-lg text-label-lg text-on-surface-variant block mb-1">CATEGORY</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-outline-variant rounded focus:border-primary outline-none font-body-md"
              >
                {CATS.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="font-label-lg text-label-lg text-on-surface-variant block mb-1">SENSITIVITY</label>
              <select
                value={sensitivity}
                onChange={(e) => setSensitivity(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-outline-variant rounded focus:border-primary outline-none font-body-md"
              >
                {SENS.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="font-label-lg text-label-lg text-on-surface-variant block mb-1">ROLES WITH ACCESS</label>
            <div className="flex flex-wrap gap-2">
              {ROLES.map((r) => (
                <button
                  key={r}
                  onClick={() => toggle(r)}
                  className={`px-3 py-1.5 rounded text-label-lg font-bold border transition-all ${
                    roles.includes(r)
                      ? 'bg-primary text-on-primary border-primary'
                      : 'bg-transparent text-on-surface-variant border-outline-variant hover:border-primary'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="font-label-lg text-label-lg text-on-surface-variant block mb-1">VERSION NOTE</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Initial version"
              className="w-full px-3 py-2 bg-white border border-outline-variant rounded focus:border-primary outline-none font-body-md"
            />
          </div>

          {err && <div className="text-error font-body-sm text-body-sm bg-error-container px-3 py-2 rounded">{err}</div>}
        </div>

        <div className="flex justify-end gap-sm px-lg py-3 border-t border-outline-variant">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button icon="lock" onClick={submit} disabled={busy}>{busy ? 'Uploading…' : 'Upload Securely'}</Button>
        </div>
      </div>
    </div>
  );
}
