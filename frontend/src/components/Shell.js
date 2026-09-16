import React, { useState, useEffect, useCallback } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { api, useAuth } from '../auth';
import { useCategories } from '../useCategories';
import { Icon } from './ui';
import ProfileModal from './ProfileModal';

// Static items that always appear.
const NAV_STATIC = [
  { to: '/requests', icon: 'pending_actions', label: 'Access Requests', roles: ['Admin', 'Engineering', 'Legal', 'Management'] },
];
const NAV_BOTTOM = [
  { to: '/settings', icon: 'verified_user', label: 'Security Settings', roles: ['Admin'] },
  { to: '/audit', icon: 'terminal', label: 'System Logs', roles: ['Admin'] },
];

// Pick an icon based on the category name (falls back to a folder).
function iconForCategory(name) {
  const n = name.toLowerCase();
  if (n.includes('tech')) return 'precision_manufacturing';
  if (n.includes('legal')) return 'gavel';
  if (n.includes('oper')) return 'analytics';
  if (n.includes('financ')) return 'payments';
  if (n.includes('hr') || n.includes('people')) return 'groups';
  return 'folder';
}

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
  const { categories } = useCategories();
  const navigate = useNavigate();
  const can = (roles) => roles.includes(user.role);

  const [search, setSearch] = useState('');
  const [notifs, setNotifs] = useState([]);
  const [unread, setUnread] = useState(0);
  const [bellOpen, setBellOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const loadNotifs = useCallback(async () => {
    try {
      const { data } = await api.get('/notifications');
      setNotifs(data.notifications || []);
      setUnread(data.unread || 0);
    } catch { /* ignore */ }
  }, []);

  // Poll notifications periodically + on mount.
  useEffect(() => {
    loadNotifs();
    const id = setInterval(loadNotifs, 20000);
    return () => clearInterval(id);
  }, [loadNotifs]);

  const openBell = async () => {
    const next = !bellOpen;
    setBellOpen(next);
    if (next && unread > 0) {
      try { await api.post('/notifications/read'); setUnread(0); } catch { /* ignore */ }
    }
  };

  const submitSearch = () => {
    const q = search.trim();
    if (q) navigate(`/search?q=${encodeURIComponent(q)}`);
  };

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

          <p className="font-label-md text-label-md text-on-primary-container uppercase tracking-widest px-1 mb-2">Repositories</p>
          <nav className="space-y-1 -mx-4">
            {/* Dynamic categories: Admin sees all; others see only accessible ones */}
            {categories
              .filter((c) => c.accessible)
              .map((c) => (
                <NavItem key={c._id} to={`/repository/${c._id}`} icon={iconForCategory(c.name)} label={c.name} />
              ))}
          </nav>

          <p className="font-label-md text-label-md text-on-primary-container uppercase tracking-widest px-1 mt-lg mb-2">Workflow</p>
          <nav className="space-y-1 -mx-4">
            {NAV_STATIC.filter((n) => can(n.roles)).map((n) => (
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
          <button onClick={() => setProfileOpen(true)} className="flex items-center gap-md px-1 w-full text-left hover:bg-white/5 rounded py-1 transition-colors" title="My profile & password">
            <div className="w-9 h-9 rounded-full bg-secondary-container flex items-center justify-center text-on-secondary-container font-bold">
              {user.name?.charAt(0) || 'U'}
            </div>
            <div className="overflow-hidden">
              <p className="font-label-lg text-label-lg font-bold text-white truncate">{user.name}</p>
              <p className="font-label-md text-label-md text-on-primary-container truncate">{user.title || user.role}</p>
            </div>
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 bg-background">
        <header className="h-16 bg-surface border-b border-outline-variant flex items-center justify-between px-gutter shrink-0 z-10">
          <div className="flex items-center gap-xl flex-1">
            {/* Working search box: search by file name or keyword */}
            <div className="relative w-full max-w-md">
              <Icon name="search" size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-outline" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitSearch()}
                placeholder="Search files by name or keyword…"
                className="w-full pl-10 pr-3 py-2 bg-surface-container-low border border-outline-variant rounded-lg focus:border-primary outline-none font-body-md"
              />
            </div>
          </div>
          <div className="flex items-center gap-md">
            <div className="hidden md:flex items-center gap-sm pr-md border-r border-outline-variant">
              <span className="flex items-center gap-1 text-on-tertiary-container text-label-md font-bold uppercase tracking-wide">
                <Icon name="lock" size={16} fill={1} /> Encrypted
              </span>
            </div>

            {/* Notification bell */}
            <div className="relative">
              <button onClick={openBell} className="relative p-2 rounded-lg hover:bg-surface-container-high transition-colors" title="Notifications">
                <Icon name="notifications" size={22} className="text-on-surface-variant" />
                {unread > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 bg-error text-white text-[11px] font-bold rounded-full flex items-center justify-center">
                    {unread > 9 ? '9+' : unread}
                  </span>
                )}
              </button>
              {bellOpen && (
                <div className="absolute right-0 mt-2 w-80 bg-surface border border-outline-variant rounded-lg shadow-lg overflow-hidden z-20">
                  <div className="px-md py-2 border-b border-outline-variant flex items-center justify-between">
                    <span className="font-label-lg text-label-lg font-bold text-primary">Notifications</span>
                    <button onClick={() => setBellOpen(false)}><Icon name="close" size={16} /></button>
                  </div>
                  <div className="max-h-80 overflow-y-auto divide-y divide-outline-variant">
                    {notifs.length === 0 ? (
                      <p className="px-md py-6 text-center text-on-surface-variant font-body-sm text-body-sm">No notifications yet.</p>
                    ) : notifs.map((n) => (
                      <div key={n._id} className={`px-md py-3 ${n.read ? '' : 'bg-secondary-container/20'}`}>
                        <p className="font-body-sm text-body-sm text-on-surface">{n.text}</p>
                        <p className="font-label-md text-label-md text-on-surface-variant mt-1">{new Date(n.createdAt).toLocaleString()}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={doLogout}
              className="font-label-lg text-label-lg bg-primary text-on-primary px-4 py-2 rounded-lg font-bold hover:opacity-90 transition-opacity flex items-center gap-2"
            >
              <Icon name="logout" size={18} /> Logout
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

      {profileOpen && <ProfileModal user={user} onClose={() => setProfileOpen(false)} />}
    </div>
  );
}
