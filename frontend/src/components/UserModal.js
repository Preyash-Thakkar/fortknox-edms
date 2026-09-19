import React, { useState } from 'react';
import { api, useAuth } from '../auth';
import { Icon, Button } from './ui';
import { useCategories } from '../useCategories';

export default function UserModal({ userToEdit, onClose, onSaved }) {
    const { user: currentUser } = useAuth();
    const { categories } = useCategories();

    // Flatten all departments from categories to get a unique list of department names
    const allDepartments = Array.from(new Set(
        categories.flatMap(c => (c.departments || []).map(d => d.name))
    ));

    // Hierarchy Logic
    const isHead = currentUser.role === 'Management';
    const allowedDepts = isHead ? (currentUser.headOfDepartments || []) : allDepartments;
    const allowedRoles = isHead ? ['Engineering'] : ['Admin', 'Management', 'Engineering', 'Legal'];

    const [formData, setFormData] = useState({
        name: userToEdit?.name || '',
        email: userToEdit?.email || '',
        password: '',
        role: userToEdit?.role || (isHead ? 'Engineering' : 'Engineering'),
        department: userToEdit?.department || allowedDepts[0] || '',
        title: userToEdit?.title || '',
    });

    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState('');

    const submit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setErr('');
        try {
            // Frontend validation checks
            if (!userToEdit && !formData.password) return setErr('Password is required for new users.');
            if (formData.password && formData.password !== confirmPassword) return setErr('Passwords do not match.');

            if (userToEdit) {
                await api.patch(`/users/${userToEdit._id}`, formData);
            } else {
                await api.post('/users', formData);
            }
            onSaved();
        } catch (error) {
            setErr(error.response?.data?.error || 'Failed to save user.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-surface-container-lowest rounded-lg border border-outline-variant shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-lg py-3 border-b border-outline-variant">
                    <h3 className="font-headline-sm text-headline-sm text-primary flex items-center gap-2">
                        <Icon name={userToEdit ? 'manage_accounts' : 'person_add'} />
                        {userToEdit ? 'Edit Operator' : 'Provision New Operator'}
                    </h3>
                    <button onClick={onClose} className="p-1.5 rounded hover:bg-surface-container-high transition-colors"><Icon name="close" /></button>
                </div>

                <form onSubmit={submit} className="p-lg space-y-md">
                    {err && <div className="text-error font-body-sm text-body-sm bg-error-container px-3 py-2 rounded">{err}</div>}

                    <div>
                        <label className="font-label-lg text-label-lg text-on-surface-variant block mb-1">FULL NAME</label>
                        <input required value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} className="w-full px-3 py-2 bg-white border border-outline-variant rounded focus:border-primary outline-none font-body-md" />
                    </div>

                    <div>
                        <label className="font-label-lg text-label-lg text-on-surface-variant block mb-1">EMAIL (LOGIN ID)</label>
                        <input required type="email" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} className="w-full px-3 py-2 bg-white border border-outline-variant rounded focus:border-primary outline-none font-body-md" />
                    </div>

                    <div className="grid grid-cols-1 gap-md">
                        <div>
                            <label className="font-label-lg text-label-lg text-on-surface-variant block mb-1">
                                {userToEdit ? 'RESET PASSWORD (leave blank to keep current)' : 'INITIAL PASSWORD'}
                            </label>
                            <div className="relative">
                                <input
                                    type={showPassword ? "text" : "password"}
                                    value={formData.password}
                                    onChange={e => setFormData({ ...formData, password: e.target.value })}
                                    onPaste={e => e.preventDefault()}
                                    className="w-full pl-3 pr-10 py-2 bg-white border border-outline-variant rounded focus:border-primary outline-none font-body-md placeholder:text-on-surface-variant/40"
                                    placeholder="Enter secure password"
                                />
                                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-primary transition-colors">
                                    <Icon name={showPassword ? "visibility_off" : "visibility"} size={18} />
                                </button>
                            </div>
                        </div>

                        {/* Only show Confirm Password if they are typing a password */}
                        {formData.password.length > 0 && (
                            <div>
                                <label className="font-label-lg text-label-lg text-on-surface-variant block mb-1">CONFIRM PASSWORD</label>
                                <div className="relative">
                                    <input
                                        type={showPassword ? "text" : "password"}
                                        value={confirmPassword}
                                        onChange={e => setConfirmPassword(e.target.value)}
                                        onPaste={e => e.preventDefault()}
                                        className="w-full pl-3 pr-10 py-2 bg-white border border-outline-variant rounded focus:border-primary outline-none font-body-md placeholder:text-on-surface-variant/40"
                                        placeholder="Confirm secure password"
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="grid grid-cols-2 gap-md">
                        <div>
                            <label className="font-label-lg text-label-lg text-on-surface-variant block mb-1">ROLE</label>
                            <select value={formData.role} onChange={e => setFormData({ ...formData, role: e.target.value })} className="w-full px-3 py-2 bg-white border border-outline-variant rounded focus:border-primary outline-none font-body-md">
                                {allowedRoles.map(r => <option key={r} value={r}>{r}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="font-label-lg text-label-lg text-on-surface-variant block mb-1">DEPARTMENT</label>
                            <select value={formData.department} onChange={e => setFormData({ ...formData, department: e.target.value })} className="w-full px-3 py-2 bg-white border border-outline-variant rounded focus:border-primary outline-none font-body-md">
                                <option value="">— None —</option>
                                {allowedDepts.map(d => <option key={d} value={d}>{d}</option>)}
                            </select>
                        </div>
                    </div>

                    <div>
                        <label className="font-label-lg text-label-lg text-on-surface-variant block mb-1">JOB TITLE (Optional)</label>
                        <input value={formData.title} onChange={e => setFormData({ ...formData, title: e.target.value })} className="w-full px-3 py-2 bg-white border border-outline-variant rounded focus:border-primary outline-none font-body-md" placeholder="e.g. Frontend Engineer" />
                    </div>

                    <div className="flex justify-end gap-sm pt-2">
                        <Button variant="ghost" onClick={onClose} type="button">Cancel</Button>
                        <Button icon="save" type="submit" disabled={loading}>{loading ? 'Saving...' : 'Save Operator'}</Button>
                    </div>
                </form>
            </div>
        </div>
    );
}