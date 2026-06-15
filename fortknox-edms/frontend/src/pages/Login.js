import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, useAuth } from '../auth';
import { Icon } from '../components/ui';

// Single-step login (email + password; MFA removed). If the account is flagged
// mustChangePassword, we switch to a forced change-password screen before entry.
export default function Login() {
  const { login, setUser } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState('login'); // 'login' | 'change'
  const [email, setEmail] = useState('admin@edms.local');
  const [password, setPassword] = useState('Admin@123');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submitLogin = async () => {
    setError(''); setLoading(true);
    try {
      const { data } = await api.post('/auth/login', { email, password });
      if (data.user.mustChangePassword) {
        // Don't enter yet — force a password change first. Session cookie is set.
        setUser(null);
        setMode('change');
      } else {
        login(data.user);
        navigate('/');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  };

  const submitChange = async () => {
    setError('');
    if (newPassword.length < 8) return setError('New password must be at least 8 characters.');
    if (newPassword !== confirm) return setError('Passwords do not match.');
    setLoading(true);
    try {
      // First-login change: no current password required by the server.
      await api.post('/auth/change-password', { newPassword });
      const { data } = await api.get('/me');
      login(data.user);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not change password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-pattern min-h-screen flex items-center justify-center p-gutter">
      <div className="w-full max-w-[440px] animate-fade-in">
        <div className="text-center mb-xl">
          <div className="inline-flex items-center justify-center p-md bg-primary-container rounded-lg mb-md">
            <Icon name="shield" className="text-white" size={32} fill={1} />
          </div>
          <h1 className="font-headline-md text-headline-md text-white tracking-tight">EDMS Secure Access</h1>
          <p className="font-body-md text-body-md text-white/60 mt-1">Enterprise Document Management System</p>
        </div>

        <div className="bg-surface rounded-lg border border-outline-variant shadow-lg overflow-hidden">
          <div className="bg-surface-container-low px-lg py-sm border-b border-outline-variant flex justify-between items-center">
            <div className="flex items-center gap-2">
              <Icon name="verified_user" className="text-on-tertiary-container" size={18} />
              <span className="font-label-lg text-label-lg text-on-surface-variant uppercase tracking-widest">Security Level: High</span>
            </div>
          </div>

          <div className="p-lg min-h-[340px]">
            {mode === 'login' ? (
              <div className="animate-fade-in">
                <div className="mb-lg">
                  <h2 className="font-headline-sm text-headline-sm text-primary mb-1">Authentication</h2>
                  <p className="font-body-md text-body-md text-on-surface-variant">Provide your secure credentials.</p>
                </div>
                <div className="space-y-md">
                  <div className="space-y-1">
                    <label className="font-label-lg text-label-lg text-on-surface-variant block">OPERATOR IDENTIFIER</label>
                    <div className="relative">
                      <Icon name="person" className="absolute left-3 top-1/2 -translate-y-1/2 text-outline" />
                      <input className="w-full pl-10 pr-md py-2.5 bg-white border border-outline-variant rounded-lg focus:border-primary font-body-md outline-none"
                        value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Enter email" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="font-label-lg text-label-lg text-on-surface-variant block">SECURE PASSPHRASE</label>
                    <div className="relative">
                      <Icon name="lock" className="absolute left-3 top-1/2 -translate-y-1/2 text-outline" />
                      <input type="password" className="w-full pl-10 pr-md py-2.5 bg-white border border-outline-variant rounded-lg focus:border-primary font-body-md outline-none"
                        value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submitLogin()} placeholder="••••••••" />
                    </div>
                  </div>
                  {error && <div className="text-error font-body-sm text-body-sm bg-error-container px-3 py-2 rounded">{error}</div>}
                  <button onClick={submitLogin} disabled={loading}
                    className="w-full bg-primary text-white py-2.5 font-label-lg text-label-lg rounded hover:bg-black/80 transition-all flex items-center justify-center gap-2 disabled:opacity-70">
                    {loading ? 'VERIFYING…' : 'SECURE LOGIN'} <Icon name="login" size={18} />
                  </button>
                </div>
              </div>
            ) : (
              <div className="animate-fade-in">
                <div className="mb-lg">
                  <h2 className="font-headline-sm text-headline-sm text-primary mb-1">Set a New Password</h2>
                  <p className="font-body-md text-body-md text-on-surface-variant">For security, please choose a new password before continuing.</p>
                </div>
                <div className="space-y-md">
                  <div className="space-y-1">
                    <label className="font-label-lg text-label-lg text-on-surface-variant block">NEW PASSWORD</label>
                    <input type="password" className="w-full px-md py-2.5 bg-white border border-outline-variant rounded-lg focus:border-primary font-body-md outline-none"
                      value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="At least 8 characters" />
                  </div>
                  <div className="space-y-1">
                    <label className="font-label-lg text-label-lg text-on-surface-variant block">CONFIRM PASSWORD</label>
                    <input type="password" className="w-full px-md py-2.5 bg-white border border-outline-variant rounded-lg focus:border-primary font-body-md outline-none"
                      value={confirm} onChange={(e) => setConfirm(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submitChange()} placeholder="Re-enter new password" />
                  </div>
                  {error && <div className="text-error font-body-sm text-body-sm bg-error-container px-3 py-2 rounded">{error}</div>}
                  <button onClick={submitChange} disabled={loading}
                    className="w-full bg-primary text-white py-2.5 font-label-lg text-label-lg rounded hover:bg-black/80 transition-all flex items-center justify-center gap-2 disabled:opacity-70">
                    {loading ? 'SAVING…' : 'SET PASSWORD & CONTINUE'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        <p className="text-center text-white/40 font-body-sm text-body-sm mt-lg">
          Demo: admin@edms.local / Admin@123
        </p>
      </div>
    </div>
  );
}
