import React, { useState, useEffect, useCallback } from 'react';
import { api, useAuth } from '../auth';
import Shell from '../components/Shell';
import { Icon, Button } from '../components/ui';
import UserModal from '../components/UserModal';
import ConfirmModal from '../components/ConfirmModal';

export default function Users() {
    const { user: currentUser } = useAuth();
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [modalUser, setModalUser] = useState(null);
    const [showModal, setShowModal] = useState(false);
    const [deleteConfirm, setDeleteConfirm] = useState(null);
    const [pageError, setPageError] = useState('');
    const [tab, setTab] = useState('active'); // 'active' or 'inactive'

    const loadUsers = useCallback(async () => {
        setLoading(true);
        try {
            const { data } = await api.get('/users');
            const usersArray = Array.isArray(data) ? data : (data.users || []);
            setUsers(usersArray);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadUsers(); }, [loadUsers]);

    const handleDelete = async () => {
        if (!deleteConfirm) return;
        setPageError('');
        try {
            await api.delete(`/users/${deleteConfirm}`);
            setDeleteConfirm(null);
            loadUsers();
        } catch (err) {
            setPageError(err.response?.data?.error || 'Failed to revoke operator.');
            setDeleteConfirm(null);
        }
    };

    const handleRestore = async (id) => {
        setPageError('');
        try {
            await api.patch(`/users/${id}/restore`);
            loadUsers();
        } catch (err) {
            setPageError(err.response?.data?.error || 'Failed to restore operator.');
        }
    };

    // Strictly isolate the arrays based on the active flag
    const activeUsers = users.filter(u => u.active !== false);
    const inactiveUsers = users.filter(u => u.active === false);
    const displayUsers = tab === 'active' ? activeUsers : inactiveUsers;

    return (
        <Shell breadcrumb="User Management">
            <div className="flex justify-between items-center mb-lg">
                <div className="flex items-center gap-4">
                    <h2 className="font-headline-md text-headline-md text-primary">WDTS Operators</h2>

                    <div className="flex bg-surface-container-low p-1 rounded-lg border border-outline-variant">
                        <button
                            onClick={() => setTab('active')}
                            className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all ${tab === 'active' ? 'bg-white shadow text-primary' : 'text-on-surface-variant hover:text-primary'}`}
                        >
                            Active ({activeUsers.length})
                        </button>
                        <button
                            onClick={() => setTab('inactive')}
                            className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all ${tab === 'inactive' ? 'bg-white shadow text-error' : 'text-on-surface-variant hover:text-error'}`}
                        >
                            Revoked ({inactiveUsers.length})
                        </button>
                    </div>
                </div>

                <Button icon="person_add" onClick={() => { setModalUser(null); setShowModal(true); setPageError(''); }}>
                    Provision Operator
                </Button>
            </div>

            {pageError && (
                <div className="mb-md px-4 py-3 bg-error-container text-error font-body-sm text-body-sm rounded flex items-center justify-between">
                    <span>{pageError}</span>
                    <button onClick={() => setPageError('')}><Icon name="close" size={16} /></button>
                </div>
            )}

            <div className="bg-surface-container-lowest border border-outline-variant rounded-lg shadow-sm overflow-hidden">
                <div className="grid grid-cols-12 gap-gutter px-md py-3 bg-surface-container-low border-b border-outline-variant">
                    <div className="col-span-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-widest">Name / Email</div>
                    <div className="col-span-3 font-label-md text-label-md text-on-surface-variant uppercase tracking-widest">Role</div>
                    <div className="col-span-3 font-label-md text-label-md text-on-surface-variant uppercase tracking-widest">Department</div>
                    <div className="col-span-2 text-right"></div>
                </div>

                {loading ? (
                    <div className="p-xl text-center text-on-surface-variant">Loading operators...</div>
                ) : (
                    <div className="divide-y divide-outline-variant">
                        {displayUsers.map((u, idx) => (
                            <div key={u._id} className={`grid grid-cols-12 gap-gutter px-md py-3 items-center hover:bg-surface-container ${idx % 2 ? 'bg-surface-container-low/40' : ''}`}>

                                <div className="col-span-4">
                                    <div className="flex items-center gap-2">
                                        <p className={`font-body-md text-body-md font-semibold ${u.active !== false ? 'text-primary' : 'text-on-surface-variant line-through opacity-70'}`}>
                                            {u.name}
                                        </p>
                                        {u.active === false && (
                                            <span className="px-1.5 py-0.5 bg-error-container text-error text-[10px] font-bold uppercase tracking-wider rounded-sm">
                                                Revoked
                                            </span>
                                        )}
                                    </div>
                                    <p className="font-body-sm text-body-sm text-on-surface-variant truncate" title={u.email}>
                                        {u.email.replace(/^deleted_\d+_/, '')}
                                    </p>
                                </div>

                                <div className={`col-span-3 font-body-md text-body-md ${u.active !== false ? 'text-on-surface' : 'text-on-surface-variant opacity-70'}`}>
                                    {u.role}
                                </div>

                                <div className="col-span-3 font-body-md text-body-md text-on-surface">
                                    {u.department ? (
                                        <span className={`px-2 py-0.5 rounded-sm text-[12px] font-semibold ${u.active !== false ? 'bg-surface-container-high text-on-surface-variant' : 'bg-surface-container text-on-surface-variant opacity-50'}`}>
                                            {u.department}
                                        </span>
                                    ) : '—'}
                                </div>

                                <div className="col-span-2 flex justify-end gap-1">
                                    {u.active !== false ? (
                                        <>
                                            <button onClick={() => { setModalUser(u); setShowModal(true); setPageError(''); }} className="p-2 rounded hover:bg-surface-container-high text-primary transition-colors" title="Edit">
                                                <Icon name="edit" size={20} />
                                            </button>
                                            {currentUser._id !== u._id && (
                                                <button onClick={() => setDeleteConfirm(u._id)} className="p-2 rounded hover:bg-surface-container-high text-error transition-colors" title="Revoke">
                                                    <Icon name="delete" size={20} />
                                                </button>
                                            )}
                                        </>
                                    ) : (
                                        <button
                                            onClick={() => handleRestore(u._id)}
                                            className="px-3 py-1 bg-green-50 text-green-700 hover:bg-green-100 border border-green-200 rounded text-xs font-bold uppercase tracking-wider transition-colors flex items-center gap-1"
                                        >
                                            <Icon name="restore" size={14} /> Restore
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}

                        {displayUsers.length === 0 && (
                            <div className="p-8 text-center text-on-surface-variant text-sm font-medium">
                                No {tab} operators found.
                            </div>
                        )}
                    </div>
                )}
            </div>

            {showModal && (
                <UserModal
                    userToEdit={modalUser}
                    onClose={() => setShowModal(false)}
                    onSaved={() => { setShowModal(false); loadUsers(); }}
                />
            )}

            {deleteConfirm && (
                <ConfirmModal
                    title="Revoke Operator?"
                    message="Are you sure you want to permanently revoke this user? Their uploaded assets will remain intact, but they will lose all system access."
                    confirmText="Yes, Revoke"
                    cancelText="Cancel"
                    isDanger={true}
                    onConfirm={handleDelete}
                    onCancel={() => setDeleteConfirm(null)}
                />
            )}
        </Shell>
    );
}