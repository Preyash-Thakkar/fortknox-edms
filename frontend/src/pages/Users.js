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

    const loadUsers = useCallback(async () => {
        setLoading(true);
        try {
            const { data } = await api.get('/users');
            // Fix: Check if data is an array directly, or extract the .users property. Fallback to empty array.
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
            setPageError(err.response?.data?.error || 'Failed to delete operator.');
            setDeleteConfirm(null);
        }
    };

    return (
        <Shell breadcrumb="User Management">
            <div className="flex justify-between items-center mb-lg">
                <h2 className="font-headline-md text-headline-md text-primary">WDTS Operators</h2>
                <Button icon="person_add" onClick={() => { setModalUser(null); setShowModal(true); }}>
                    Provision Operator
                </Button>
            </div>

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
                        {users.map((u, idx) => (
                            <div key={u._id} className={`grid grid-cols-12 gap-gutter px-md py-3 items-center hover:bg-surface-container ${idx % 2 ? 'bg-surface-container-low/40' : ''}`}>

                                {/* Name & Email with Inactive Badge */}
                                <div className="col-span-4">
                                    <div className="flex items-center gap-2">
                                        <p className={`font-body-md text-body-md font-semibold ${u.active !== false ? 'text-primary' : 'text-on-surface-variant line-through opacity-70'}`}>
                                            {u.name}
                                        </p>
                                        {u.active === false && (
                                            <span className="px-1.5 py-0.5 bg-error-container text-error text-[10px] font-bold uppercase tracking-wider rounded-sm">
                                                Inactive
                                            </span>
                                        )}
                                    </div>
                                    <p className="font-body-sm text-body-sm text-on-surface-variant truncate" title={u.email}>{u.email}</p>
                                </div>

                                {/* Role */}
                                <div className={`col-span-3 font-body-md text-body-md ${u.active !== false ? 'text-on-surface' : 'text-on-surface-variant opacity-70'}`}>
                                    {u.role}
                                </div>

                                {/* Department */}
                                <div className="col-span-3 font-body-md text-body-md text-on-surface">
                                    {u.department ? (
                                        <span className={`px-2 py-0.5 rounded-sm text-[12px] font-semibold ${u.active !== false ? 'bg-surface-container-high text-on-surface-variant' : 'bg-surface-container text-on-surface-variant opacity-50'}`}>
                                            {u.department}
                                        </span>
                                    ) : '—'}
                                </div>

                                {/* Actions (Hidden if Inactive) */}
                                <div className="col-span-2 flex justify-end gap-1">
                                    {u.active !== false ? (
                                        <>
                                            <button onClick={() => { setModalUser(u); setShowModal(true); setPageError(''); }} className="p-2 rounded hover:bg-surface-container-high text-primary transition-colors" title="Edit">
                                                <Icon name="edit" size={20} />
                                            </button>
                                            {currentUser._id !== u._id && (
                                                <button onClick={() => setDeleteConfirm(u._id)} className="p-2 rounded hover:bg-surface-container-high text-error transition-colors" title="Delete">
                                                    <Icon name="delete" size={20} />
                                                </button>
                                            )}
                                        </>
                                    ) : (
                                        <span className="text-[11px] text-on-surface-variant uppercase tracking-widest font-semibold pr-2 pt-2 opacity-50">Revoked</span>
                                    )}
                                </div>

                            </div>
                        ))}
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
                    title="Delete Operator?"
                    message="Are you sure you want to permanently delete this user? Their uploaded assets will remain intact, but they will lose all access."
                    confirmText="Yes, Delete"
                    cancelText="Cancel"
                    isDanger={true}
                    onConfirm={handleDelete}
                    onCancel={() => setDeleteConfirm(null)}
                />
            )}
        </Shell>
    );
}