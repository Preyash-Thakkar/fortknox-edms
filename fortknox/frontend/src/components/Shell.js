import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { Icon } from './ui';

const NAV = [
  { to: '/assets', icon: 'precision_manufacturing', label: 'Technical Assets', roles: ['Admin', 'Engineering', 'Legal', 'Management'] },
  { to: '/legal', icon: 'gavel', label: 'Legal & Compliance', roles: ['Admin', 'Legal', 'Management'] },
  { to: '/operational', icon: 'analytics', label: 'Operational Data', roles: ['Admin', 'Management', 'Engineering'] },
  { to: '/requests', icon: 'pending_actions', label: 'Access Requests', roles: ['Admin', 'Engineering', 'Legal', 'Management'] },
];
const NAV_BOTTOM = [
  { to: '/settings', icon: 'verified_user', label: 'Security Settings', roles: ['Admin'] },
  { to: '/audit', icon: 'terminal', label: 'System Logs', roles: ['Admin'] },
];

function NavItem({ to, icon, label }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex items-center gap-3 px-4 py-2 transition-all duration-150 border-l-4 ${
          isActive
            ? 'border-on-primary bg-white/10 text-white font-semibold'
            : 'border-transparent text-on-primary-container hover:bg-white/5 hover:text-white'
        }`
      }
    >
      <Icon name={icon} size={20} />
      <span className="font-body-md text-body-md">{label}</span>
    </NavLink>
  );
}

export default function Shell({ children, breadcrumb }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const can = (roles) => roles.includes(user.role);

  const doLogout = () => { logout(); navigate('/login'); };

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="h-screen w-64 bg-primary flex flex-col shrink-0">
        <div className="p-lg flex-1 overflow-y-auto">
          <div className="flex items-center gap-base mb-xl">
            <div className="w-9 h-9 bg-white/10 rounded flex items-center justify-center text-white">
              <Icon name="shield" fill={1} />
            </div>
            <div>
              <h1 className="font-headline-sm text-headline-sm font-bold text-white leading-tight">Fort Knox EDMS</h1>
              <p className="font-label-md text-label-md text-on-primary-container uppercase tracking-wider">
                Enterprise Security
              </p>
            </div>
          </div>
          <nav className="space-y-1 -mx-4">
            {NAV.filter((n) => can(n.roles)).map((n) => (
              <NavItem key={n.to} {...n} />
            ))}
          </nav>
        </div>

        <div className="p-lg border-t border-white/10">
          <nav className="space-y-1 -mx-4 mb-lg">
            {NAV_BOTTOM.filter((n) => can(n.roles)).map((n) => (
              <NavItem key={n.to} {...n} />
            ))}
          </nav>
          <div className="flex items-center gap-md px-1">
            <div className="w-9 h-9 rounded-full bg-secondary-container flex items-center justify-center text-on-secondary-container font-bold">
              {user.name?.charAt(0) || 'U'}
            </div>
            <div className="overflow-hidden">
              <p className="font-label-lg text-label-lg font-bold text-white truncate">{user.name}</p>
              <p className="font-label-md text-label-md text-on-primary-container truncate">{user.title || user.role}</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 bg-background">
        <header className="h-16 bg-surface border-b border-outline-variant flex items-center justify-between px-gutter shrink-0 z-10">
          <div className="flex items-center gap-xl flex-1">
            <span className="font-headline-md text-headline-md font-black tracking-tight text-primary hidden md:block">
              EDMS Secure Shell
            </span>
            <div className="max-w-md w-full relative">
              <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
              <input
                className="w-full bg-surface-container border border-outline-variant rounded-lg pl-10 pr-4 py-1.5 font-body-md focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-all"
                placeholder="Search secure repository..."
              />
            </div>
          </div>
          <div className="flex items-center gap-md">
            <div className="flex items-center gap-sm pr-md border-r border-outline-variant">
              <span className="flex items-center gap-1 text-on-tertiary-container text-label-md font-bold uppercase tracking-wide">
                <Icon name="lock" size={16} fill={1} /> Encrypted
              </span>
            </div>
            <button
              onClick={doLogout}
              className="font-label-lg text-label-lg bg-primary text-on-primary px-4 py-2 rounded-lg font-bold hover:opacity-90 transition-opacity flex items-center gap-2"
            >
              <Icon name="logout" size={18} /> Secure Logout
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-gutter w-full">
          <div className="max-w-container-max mx-auto">
            {breadcrumb && (
              <div className="flex items-center gap-2 text-on-surface-variant mb-lg">
                <span className="font-label-lg text-label-lg">Root</span>
                <Icon name="chevron_right" size={16} />
                <span className="font-label-lg text-label-lg text-primary font-bold">{breadcrumb}</span>
              </div>
            )}
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
