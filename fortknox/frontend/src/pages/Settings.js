import React, { useEffect, useState } from 'react';
import { api } from '../auth';
import { Icon, RoleBadge } from '../components/ui';

const ROLE_CAPS = {
  Admin: ['Full repository access', 'Approve/deny access requests', 'View audit ledger', 'Manage users'],
  Engineering: ['CAD/PCB technical assets', 'Upload & version assets', 'Request restricted access'],
  Legal: ['Patent & compliance docs', 'Upload legal assets', 'Request restricted access'],
  Management: ['Operational reports', 'Cross-department visibility', 'Request restricted access'],
};

export default function Settings() {
  const [users, setUsers] = useState([]);

  useEffect(() => {
    api.get('/users').then(({ data }) => setUsers(data.users)).catch(() => {});
  }, []);

  return (
    <>
      <h2 className="font-headline-md text-headline-md text-primary mb-lg">Access Control & Security Settings</h2>

      {/* Role matrix */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-md mb-xl">
        {Object.entries(ROLE_CAPS).map(([role, caps]) => (
          <div key={role} className="bg-surface-container-lowest border border-outline-variant rounded-lg p-lg">
            <div className="flex items-center gap-2 mb-md">
              <Icon name="badge" className="text-secondary" fill={1} />
              <span className="font-headline-sm text-headline-sm text-primary">{role}</span>
            </div>
            <ul className="space-y-2">
              {caps.map((c) => (
                <li key={c} className="flex items-start gap-2 font-body-sm text-body-sm text-on-surface-variant">
                  <Icon name="check" size={16} className="text-on-tertiary-container mt-0.5 shrink-0" />
                  {c}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Users */}
      <div className="bg-surface-container-lowest border border-outline-variant rounded-lg shadow-sm overflow-hidden">
        <div className="px-lg py-3 border-b border-outline-variant flex items-center gap-2">
          <Icon name="group" className="text-secondary" />
          <h3 className="font-headline-sm text-headline-sm text-primary">Operators</h3>
        </div>
        <div className="grid grid-cols-12 gap-gutter px-md py-3 bg-surface-container-low border-b border-outline-variant">
          <div className="col-span-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-widest">Name</div>
          <div className="col-span-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-widest">Email</div>
          <div className="col-span-2 font-label-md text-label-md text-on-surface-variant uppercase tracking-widest">Role</div>
          <div className="col-span-2 font-label-md text-label-md text-on-surface-variant uppercase tracking-widest">Title</div>
        </div>
        <div className="divide-y divide-outline-variant">
          {users.map((u) => (
            <div key={u._id} className="grid grid-cols-12 gap-gutter px-md py-3 items-center">
              <div className="col-span-4 flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-secondary-container flex items-center justify-center text-on-secondary-container font-bold text-sm">
                  {u.name?.charAt(0)}
                </div>
                <span className="font-body-md text-body-md font-semibold text-primary">{u.name}</span>
              </div>
              <div className="col-span-4 font-data-mono text-data-mono text-on-surface-variant truncate">{u.email}</div>
              <div className="col-span-2"><RoleBadge role={u.role} /></div>
              <div className="col-span-2 font-body-sm text-body-sm text-on-surface-variant truncate">{u.title}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
