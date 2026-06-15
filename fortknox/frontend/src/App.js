import React from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import Shell from './components/Shell';
import Login from './pages/Login';
import Repository from './pages/Repository';
import Requests from './pages/Requests';
import Audit from './pages/Audit';
import Settings from './pages/Settings';

// Guard: requires a valid session; optionally restricts to certain roles.
function Protected({ children, roles }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/assets" replace />;
  return children;
}

function Page({ breadcrumb, children }) {
  return <Shell breadcrumb={breadcrumb}>{children}</Shell>;
}

function Router() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/assets" replace /> : <Login />} />

      <Route
        path="/assets"
        element={<Protected><Page breadcrumb="Technical Assets"><Repository category="Technical" title="Technical Assets" /></Page></Protected>}
      />
      <Route
        path="/legal"
        element={
          <Protected roles={['Admin', 'Legal', 'Management']}>
            <Page breadcrumb="Legal & Compliance"><Repository category="Legal" title="Legal & Compliance" /></Page>
          </Protected>
        }
      />
      <Route
        path="/operational"
        element={
          <Protected roles={['Admin', 'Management', 'Engineering']}>
            <Page breadcrumb="Operational Data"><Repository category="Operational" title="Operational Data Hub" /></Page>
          </Protected>
        }
      />
      <Route
        path="/requests"
        element={<Protected><Page breadcrumb="Access Requests"><Requests /></Page></Protected>}
      />
      <Route
        path="/audit"
        element={<Protected roles={['Admin']}><Page breadcrumb="System Logs"><Audit /></Page></Protected>}
      />
      <Route
        path="/settings"
        element={<Protected roles={['Admin']}><Page breadcrumb="Security Settings"><Settings /></Page></Protected>}
      />

      <Route path="*" element={<Navigate to={user ? '/assets' : '/login'} replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Router />
    </AuthProvider>
  );
}
