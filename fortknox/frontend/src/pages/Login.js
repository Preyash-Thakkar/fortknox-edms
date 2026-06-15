import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, useAuth } from '../auth';
import { Icon } from '../components/ui';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState('admin@edms.local');
  const [password, setPassword] = useState('Admin@123');
  const [mfaToken, setMfaToken] = useState(null);
  const [digits, setDigits] = useState(['', '', '', '', '', '']);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const refs = useRef([]);

  const submitPassword = async () => {
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', { email, password });
      setMfaToken(data.mfaToken);
      setStep(2);
      setTimeout(() => refs.current[0]?.focus(), 100);
    } catch (err) {
      setError(err.response?.data?.error || 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  };

  const setDigit = (i, v) => {
    if (!/^\d?$/.test(v)) return;
    const next = [...digits];
    next[i] = v;
    setDigits(next);
    if (v && i < 5) refs.current[i + 1]?.focus();
  };

  const onKey = (i, e) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) refs.current[i - 1]?.focus();
  };

  const submitMfa = async () => {
    setError('');
    setLoading(true);
    try {
      const code = digits.join('');
      const { data } = await api.post('/auth/mfa', { mfaToken, code });
      login(data.token, data.user);
      navigate('/assets');
    } catch (err) {
      setError(err.response?.data?.error || 'MFA verification failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-pattern min-h-screen flex items-center justify-center p-gutter">
      <div className="w-full max-w-[440px] animate-fade-in">
        {/* Brand */}
        <div className="text-center mb-xl">
          <div className="inline-flex items-center justify-center p-md bg-primary-container rounded-lg mb-md">
            <Icon name="shield" className="text-white" size={32} fill={1} />
          </div>
          <h1 className="font-headline-md text-headline-md text-white tracking-tight">EDMS Secure Access</h1>
          <p className="font-body-md text-body-md text-white/60 mt-1">Enterprise Document Management System</p>
        </div>

        <div className="bg-surface rounded-lg border border-outline-variant shadow-lg overflow-hidden">
          {/* Security level indicator */}
          <div className="bg-surface-container-low px-lg py-sm border-b border-outline-variant flex justify-between items-center">
            <div className="flex items-center gap-2">
              <Icon name="verified_user" className="text-on-tertiary-container" size={18} />
              <span className="font-label-lg text-label-lg text-on-surface-variant uppercase tracking-widest">
                Security Level: High
              </span>
            </div>
            <div className="flex gap-1">
              <div className="w-4 h-1 bg-on-tertiary-container rounded-full" />
              <div className="w-4 h-1 bg-on-tertiary-container rounded-full" />
              <div className={`w-4 h-1 rounded-full transition-colors ${step === 2 ? 'bg-on-tertiary-container' : 'bg-outline-variant'}`} />
            </div>
          </div>

          <div className="p-lg min-h-[380px]">
            {step === 1 && (
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
                      <input
                        className="w-full pl-10 pr-md py-2.5 bg-white border border-outline-variant rounded-lg focus:ring-0 focus:border-primary font-body-md outline-none transition-all"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="Enter email"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="font-label-lg text-label-lg text-on-surface-variant block">SECURE PASSPHRASE</label>
                    <div className="relative">
                      <Icon name="lock" className="absolute left-3 top-1/2 -translate-y-1/2 text-outline" />
                      <input
                        type="password"
                        className="w-full pl-10 pr-md py-2.5 bg-white border border-outline-variant rounded-lg focus:ring-0 focus:border-primary font-body-md outline-none transition-all"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && submitPassword()}
                        placeholder="••••••••"
                      />
                    </div>
                  </div>

                  {error && <div className="text-error font-body-sm text-body-sm bg-error-container px-3 py-2 rounded">{error}</div>}

                  <button
                    onClick={submitPassword}
                    disabled={loading}
                    className="w-full bg-primary text-white py-2.5 font-label-lg text-label-lg rounded hover:bg-black/80 transition-all flex items-center justify-center gap-2 disabled:opacity-70"
                  >
                    {loading ? 'VERIFYING…' : 'PROCEED TO MFA'}
                    <Icon name="arrow_forward" size={18} />
                  </button>
                </div>

                <div className="mt-xl pt-lg border-t border-outline-variant">
                  <p className="font-label-md text-label-md text-on-surface-variant text-center leading-relaxed">
                    Demo accounts (password as shown, MFA code <span className="font-data-mono">000000</span>):<br />
                    admin@edms.local / Admin@123 · eng@edms.local / Eng@123<br />
                    legal@edms.local / Legal@123 · mgmt@edms.local / Mgmt@123
                  </p>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="animate-fade-in">
                <div className="mb-lg">
                  <h2 className="font-headline-sm text-headline-sm text-primary mb-1">Second Factor</h2>
                  <p className="font-body-md text-body-md text-on-surface-variant">
                    Input the 6-digit code from your security device.
                  </p>
                </div>
                <div className="flex justify-between gap-2 mb-lg">
                  {digits.map((d, i) => (
                    <input
                      key={i}
                      ref={(el) => (refs.current[i] = el)}
                      value={d}
                      onChange={(e) => setDigit(i, e.target.value)}
                      onKeyDown={(e) => onKey(i, e)}
                      maxLength={1}
                      className="w-12 h-14 text-center text-headline-sm font-data-mono bg-surface-container border border-outline-variant rounded focus:border-primary focus:ring-2 focus:ring-secondary-container outline-none transition-all"
                    />
                  ))}
                </div>

                <div className="flex items-center gap-3 p-md bg-secondary-container/40 rounded border border-secondary-container mb-lg">
                  <Icon name="contactless" className="text-on-secondary-container" />
                  <div className="flex-1">
                    <p className="font-label-lg text-label-lg text-on-secondary-container">FIDO2 HARDWARE KEY</p>
                    <p className="text-[10px] text-on-secondary-container/70">Insert or tap security key for faster entry</p>
                  </div>
                </div>

                {error && <div className="text-error font-body-sm text-body-sm bg-error-container px-3 py-2 rounded mb-md">{error}</div>}

                <div className="space-y-md">
                  <button
                    onClick={submitMfa}
                    disabled={loading}
                    className="w-full bg-primary text-white py-2.5 font-label-lg text-label-lg rounded hover:opacity-90 transition-opacity flex items-center justify-center gap-2 disabled:opacity-70"
                  >
                    {loading ? 'VERIFYING…' : 'VERIFY ACCESS'}
                    <Icon name="check_circle" size={18} fill={1} />
                  </button>
                  <button
                    onClick={() => { setStep(1); setDigits(['', '', '', '', '', '']); setError(''); }}
                    className="w-full text-secondary py-2.5 font-label-lg text-label-lg rounded border border-outline-variant hover:bg-surface-container-low transition-colors"
                  >
                    CANCEL AND RETURN
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <p className="text-center text-white/40 font-label-md text-label-md mt-lg uppercase tracking-widest">
          All access attempts are logged and monitored
        </p>
      </div>
    </div>
  );
}
