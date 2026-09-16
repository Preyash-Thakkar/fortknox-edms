import React from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { useCategories } from './useCategories';
import Shell from './components/Shell';
import Login from './pages/Login';
import Repository from './pages/Repository';
import Search from './pages/Search';
import Requests from './pages/Requests';
import Audit from './pages/Audit';
import Settings from './pages/Settings';

// Guard: requires a valid session; optionally restricts to certain roles.
function Protected({ children, roles }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

function Page({ breadcrumb, children }) {
  return <Shell breadcrumb={breadcrumb}>{children}</Shell>;
}

// Landing: send the user to their first accessible category repository.
function Landing() {
  const { categories, loading } = useCategories();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-on-surface-variant font-body-md">
        Loading repositories…
      </div>
    );
  }
  const first = categories.find((c) => c.accessible);
  if (first) return <Navigate to={`/repository/${first._id}`} replace />;
  // No accessible categories — send to Access Requests so they can ask.
  return <Navigate to="/requests" replace />;
}

function Router() {
  const { user, loading } = useAuth();
  // Wait for the cookie-based session check (/me) before routing, so we don't
  // bounce a logged-in user to /login on refresh.
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-on-surface-variant font-body-md">
        Securing session…
      </div>
    );
  }
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />

      <Route path="/" element={<Protected><Landing /></Protected>} />

      <Route
        path="/repository/:categoryId"
        element={<Protected><Page><Repository /></Page></Protected>}
      />
      <Route
        path="/search"
        element={<Protected><Page breadcrumb="Search"><Search /></Page></Protected>}
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

      <Route path="*" element={<Navigate to={user ? '/' : '/login'} replace />} />
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
