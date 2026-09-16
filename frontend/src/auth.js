import axios from 'axios';
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

// const API = 'https://lmsdevelopment.wehear.in'
const API = '  http://localhost:8007';

// Shared axios instance. credentials:true sends the httpOnly auth cookie.
// No token is stored in JS/localStorage anymore (mitigates XSS token theft).
export const api = axios.create({ baseURL: API, withCredentials: true });

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // On load, ask the server who we are (cookie-based). If 401, not logged in.
  const refreshMe = useCallback(async () => {
    try {
      const { data } = await api.get('/me');
      setUser(data.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refreshMe(); }, [refreshMe]);

  const logout = useCallback(async () => {
    try { await api.post('/auth/logout'); } catch { /* ignore */ }
    setUser(null);
  }, []);

  // Auto-clear on 401 from any call (expired/invalid session).
  useEffect(() => {
    const id = api.interceptors.response.use(
      (r) => r,
      (err) => {
        if (err.response?.status === 401) setUser(null);
        return Promise.reject(err);
      }
    );
    return () => api.interceptors.response.eject(id);
  }, []);

  // login() and setUser exposed so Login/ChangePassword can update state.
  const login = (usr) => setUser(usr);

  return (
    <AuthCtx.Provider value={{ user, loading, login, logout, setUser, refreshMe }}>
      {children}
    </AuthCtx.Provider>
  );
}
