import React, { useState } from 'react';
import { api } from '../auth';
import { Icon } from './ui';

// Self-service password change, available to every signed-in user.
export default function ProfileModal({ user, onClose }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr(''); setMsg('');
    if (next.length < 8) return setErr('New password must be at least 8 characters.');
    if (next !== confirm) return setErr('Passwords do not match.');
    setBusy(true);
    try {
      await api.post('/auth/change-password', { currentPassword: current, newPassword: next });
      setMsg('Password updated successfully.');
      setCurrent(''); setNext(''); setConfirm('');
    } catch (e) {
      setErr(e.response?.data?.error || 'Could not change password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-gutter" onClick={onClose}>
      <div className="bg-surface-container-lowest rounded-lg border border-outline-variant shadow-sharp w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-lg py-3 border-b border-outline-variant">
          <h3 className="font-headline-sm text-headline-sm text-primary flex items-center gap-2"><Icon name="account_circle" /> My Profile</h3>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-surface-container-high"><Icon name="close" /></button>
        </div>
        <div className="p-lg space-y-md">
          <div className="bg-surface-container-low rounded p-md">
            <p className="font-body-md text-body-md text-primary font-semibold">{user.name}</p>
            <p className="font-body-sm text-body-sm text-on-surface-variant">{user.email}</p>
            <p className="font-label-md text-label-md text-on-surface-variant mt-1 uppercase tracking-wide">{user.title || user.role}</p>
          </div>

          <h4 className="font-body-lg font-semibold text-primary">Change password</h4>
          <div className="space-y-1">
            <label className="font-label-lg text-label-lg text-on-surface-variant block">CURRENT PASSWORD</label>
            <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-outline-variant rounded focus:border-primary outline-none font-body-md" />
          </div>
          <div className="space-y-1">
            <label className="font-label-lg text-label-lg text-on-surface-variant block">NEW PASSWORD</label>
            <input type="password" value={next} onChange={(e) => setNext(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-outline-variant rounded focus:border-primary outline-none font-body-md" />
          </div>
          <div className="space-y-1">
            <label className="font-label-lg text-label-lg text-on-surface-variant block">CONFIRM NEW PASSWORD</label>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-outline-variant rounded focus:border-primary outline-none font-body-md" />
          </div>
          {err && <div className="text-error font-body-sm text-body-sm bg-error-container px-3 py-2 rounded">{err}</div>}
          {msg && <div className="text-on-tertiary-container font-body-sm text-body-sm bg-secondary-container/40 px-3 py-2 rounded">{msg}</div>}
        </div>
        <div className="flex justify-end gap-sm px-lg py-3 border-t border-outline-variant">
          <button onClick={onClose} className="px-4 py-2 rounded font-label-lg text-label-lg text-on-surface-variant hover:bg-surface-container-high">Close</button>
          <button onClick={submit} disabled={busy} className="px-4 py-2 rounded font-label-lg text-label-lg bg-primary text-on-primary font-bold hover:opacity-90 disabled:opacity-70">{busy ? 'Saving…' : 'Update Password'}</button>
        </div>
      </div>
    </div>
  );
}
