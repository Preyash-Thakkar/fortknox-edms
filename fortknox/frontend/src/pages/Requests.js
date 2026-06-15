import React, { useEffect, useState, useCallback } from 'react';
import { api, useAuth } from '../auth';
import { Icon, SensitivityBadge, RoleBadge, EmptyState } from '../components/ui';

const statusStyle = {
  Pending: 'text-secondary bg-secondary-container/40',
  Approved: 'text-on-tertiary-container bg-emerald-100',
  Denied: 'text-error bg-error-container',
};

export default function Requests() {
  const { user } = useAuth();
  const isAdmin = user.role === 'Admin';
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/access-requests');
      setRequests(data.requests);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const decide = async (id, decision) => {
    await api.post(`/access-requests/${id}/decide`, { decision });
    load();
  };

  return (
    <>
      <h2 className="font-headline-md text-headline-md text-primary mb-lg">
        {isAdmin ? 'Access Request Queue' : 'My Access Requests'}
      </h2>

      <div className="bg-surface-container-lowest border border-outline-variant rounded-lg shadow-sm overflow-hidden">
        <div className="grid grid-cols-12 gap-gutter px-md py-3 bg-surface-container-low border-b border-outline-variant">
          <div className="col-span-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-widest">Asset</div>
          {isAdmin && <div className="col-span-3 font-label-md text-label-md text-on-surface-variant uppercase tracking-widest">Requested By</div>}
          <div className={`${isAdmin ? 'col-span-3' : 'col-span-5'} font-label-md text-label-md text-on-surface-variant uppercase tracking-widest`}>Reason</div>
          <div className="col-span-2 text-right font-label-md text-label-md text-on-surface-variant uppercase tracking-widest">Status</div>
        </div>

        {loading ? (
          <div className="p-xl text-center text-on-surface-variant">Loading…</div>
        ) : requests.length === 0 ? (
          <EmptyState icon="inbox" title="No access requests" subtitle={isAdmin ? 'Incoming requests will appear here.' : 'Request access from any restricted asset.'} />
        ) : (
          <div className="divide-y divide-outline-variant">
            {requests.map((r) => (
              <div key={r._id} className="grid grid-cols-12 gap-gutter px-md py-3 items-center">
                <div className="col-span-4 flex items-center gap-2 min-w-0">
                  <Icon name="description" className="text-secondary shrink-0" />
                  <div className="min-w-0">
                    <p className="font-body-md text-body-md font-semibold text-primary truncate">{r.asset?.filename || '—'}</p>
                    {r.asset?.sensitivity && <SensitivityBadge level={r.asset.sensitivity} />}
                  </div>
                </div>
                {isAdmin && (
                  <div className="col-span-3 min-w-0">
                    <p className="font-body-md text-body-md truncate">{r.requestedBy?.name}</p>
                    <RoleBadge role={r.requestedBy?.role} />
                  </div>
                )}
                <div className={`${isAdmin ? 'col-span-3' : 'col-span-5'} font-body-sm text-body-sm text-on-surface-variant truncate`}>
                  {r.reason || <span className="italic opacity-60">No reason provided</span>}
                </div>
                <div className="col-span-2 flex justify-end items-center gap-2">
                  {isAdmin && r.status === 'Pending' ? (
                    <>
                      <button onClick={() => decide(r._id, 'Approved')} title="Approve" className="p-1.5 rounded text-on-tertiary-container hover:bg-emerald-100">
                        <Icon name="check_circle" fill={1} />
                      </button>
                      <button onClick={() => decide(r._id, 'Denied')} title="Deny" className="p-1.5 rounded text-error hover:bg-error-container">
                        <Icon name="cancel" fill={1} />
                      </button>
                    </>
                  ) : (
                    <span className={`px-2 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-tight ${statusStyle[r.status]}`}>
                      {r.status}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
