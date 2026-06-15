import axios from 'axios';
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

const API = process.env.REACT_APP_API_URL || 'https://lmsdevelopment.wehear.in/';

// Shared axios instance. Token injected via interceptor.
export const api = axios.create({ baseURL: API });

api.interceptors.request.use((config) => {
  const t = localStorage.getItem('fk_token');
  if (t) config.headers.Authorization = `Bearer ${t}`;
  return config;
});

// ---- Auth context ---------------------------------------------------------
const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(localStorage.getItem('fk_token'));
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem('fk_user');
    return raw ? JSON.parse(raw) : null;
  });

  const logout = useCallback(() => {
    localStorage.removeItem('fk_token');
    localStorage.removeItem('fk_user');
    setToken(null);
    setUser(null);
  }, []);

  // Auto-logout on 401
  useEffect(() => {
    const id = api.interceptors.response.use(
      (r) => r,
      (err) => {
        if (err.response?.status === 401 && localStorage.getItem('fk_token')) logout();
        return Promise.reject(err);
      }
    );
    return () => api.interceptors.response.eject(id);
  }, [logout]);

  const login = (tkn, usr) => {
    localStorage.setItem('fk_token', tkn);
    localStorage.setItem('fk_user', JSON.stringify(usr));
    setToken(tkn);
    setUser(usr);
  };

  return <AuthCtx.Provider value={{ token, user, login, logout }}>{children}</AuthCtx.Provider>;
}
