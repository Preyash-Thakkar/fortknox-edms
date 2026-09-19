import React, { useState } from 'react';
import { api } from '../auth';
import { Icon, Button } from './ui';

export default function VersionModal({ asset, onClose, onUploaded }) {
    const [file, setFile] = useState(null);
    const [versionNote, setVersionNote] = useState('');
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');

    const submitVersion = async () => {
        if (!file) return setErr('Select the modified file to check in.');
        if (!versionNote.trim()) return setErr('A version note is required for the audit trail.');

        setBusy(true); setErr('');
        const form = new FormData();
        form.append('file', file);
        form.append('filename', file.name);
        form.append('versionNote', versionNote.trim());

        try {
            await api.post(`/assets/${asset._id}/versions`, form, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            onUploaded();
        } catch (e) {
            setErr(e.response?.data?.error || 'Version check-in failed.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-surface-container-lowest rounded-lg border border-outline-variant shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-lg py-3 border-b border-outline-variant">
                    <h3 className="font-headline-sm text-headline-sm text-primary flex items-center gap-2">
                        <Icon name="history" /> Check-In New Version
                    </h3>
                    <button onClick={onClose} className="p-1.5 rounded hover:bg-surface-container-high transition-colors"><Icon name="close" /></button>
                </div>

                <div className="p-lg space-y-md">
                    <p className="font-body-sm text-body-sm text-on-surface-variant">
                        Updating: <strong className="text-on-surface">"{asset.filename}"</strong>
                    </p>

                    <label className="block border-2 border-dashed border-outline-variant rounded-lg p-lg text-center cursor-pointer hover:bg-surface-container-low transition-colors">
                        <input
                            type="file"
                            className="hidden"
                            onChange={(e) => {
                                setFile(e.target.files[0]);
                                setErr('');
                            }}
                        />
                        <Icon name="cloud_upload" size={32} className="text-secondary" />
                        <p className="font-body-md text-body-md mt-2">
                            {file ? <span className="font-semibold text-primary">{file.name}</span> : 'Click to select the modified file'}
                        </p>
                    </label>

                    <div>
                        <label className="font-label-lg text-label-lg text-on-surface-variant block mb-1">VERSION CHANGE NOTE (Required)</label>
                        <input
                            value={versionNote}
                            onChange={(e) => setVersionNote(e.target.value)}
                            placeholder="e.g. Updated schematic tolerances for Rev C"
                            className="w-full px-3 py-2 bg-white border border-outline-variant rounded focus:border-primary outline-none font-body-md"
                        />
                    </div>

                    {err && <div className="text-error font-body-sm text-body-sm bg-error-container px-3 py-2 rounded">{err}</div>}
                </div>

                <div className="flex justify-end gap-sm px-lg py-3 border-t border-outline-variant bg-surface-container-low">
                    <Button variant="ghost" onClick={onClose}>Cancel</Button>
                    <Button icon="publish" onClick={submitVersion} disabled={busy || !file || !versionNote.trim()}>
                        {busy ? 'Checking in...' : 'Check-In File'}
                    </Button>
                </div>
            </div>
        </div>
    );
}