import React, { useState } from 'react';
import { api } from '../auth';
import Shell from '../components/Shell';
import { Icon, Button } from '../components/ui';
import ConfirmModal from '../components/ConfirmModal';
import { useCategories } from '../useCategories';

export default function Repositories() {
    const { categories, refresh } = useCategories();
    const [repoName, setRepoName] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [deleteConfirm, setDeleteConfirm] = useState(null);

    const handleCreate = async (e) => {
        e.preventDefault();
        if (!repoName.trim()) return setError('Repository name is required.');
        setLoading(true);
        setError('');
        try {
            await api.post('/categories', { name: repoName.trim() });
            setRepoName('');
            refresh(); // Reload sidebar and list
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to create repository.');
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async () => {
        if (!deleteConfirm) return;
        setError('');
        try {
            await api.delete(`/categories/${deleteConfirm}`);
            setDeleteConfirm(null);
            refresh();
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to archive repository.');
            setDeleteConfirm(null);
        }
    };

    return (
        <Shell breadcrumb="Repository Management">
            <div className="mb-lg max-w-xl">
                <h2 className="font-headline-md text-headline-md text-primary mb-2">WDTS Repositories</h2>
                <p className="font-body-md text-body-md text-on-surface-variant mb-6">
                    Create new strict 1-to-1 repository mappings. Creating a repository automatically provisions its corresponding access department.
                </p>

                {error && (
                    <div className="mb-md px-4 py-3 bg-error-container text-error font-body-sm text-body-sm rounded flex items-center justify-between">
                        <span>{error}</span>
                        <button onClick={() => setError('')}><Icon name="close" size={16} /></button>
                    </div>
                )}

                <form onSubmit={handleCreate} className="flex gap-3 items-end bg-surface-container-lowest p-4 rounded-lg border border-outline-variant shadow-sm mb-xl">
                    <div className="flex-1">
                        <label className="font-label-lg text-label-lg text-on-surface-variant block mb-1">NEW REPOSITORY NAME</label>
                        <input
                            value={repoName}
                            onChange={e => setRepoName(e.target.value)}
                            placeholder="e.g. Quality Assurance"
                            className="w-full px-3 py-2 bg-white border border-outline-variant rounded focus:border-primary outline-none font-body-md"
                        />
                    </div>
                    <Button icon="create_new_folder" type="submit" disabled={loading}>
                        {loading ? 'Creating...' : 'Provision'}
                    </Button>
                </form>

                <div className="bg-surface-container-lowest border border-outline-variant rounded-lg shadow-sm overflow-hidden">
                    <div className="grid grid-cols-12 gap-gutter px-md py-3 bg-surface-container-low border-b border-outline-variant">
                        <div className="col-span-10 font-label-md text-label-md text-on-surface-variant uppercase tracking-widest">Active Repositories</div>
                        <div className="col-span-2 text-right"></div>
                    </div>
                    <div className="divide-y divide-outline-variant">
                        {categories.filter(c => c.active !== false).map((c, idx) => (
                            <div key={c._id} className={`grid grid-cols-12 gap-gutter px-md py-3 items-center hover:bg-surface-container ${idx % 2 ? 'bg-surface-container-low/40' : ''}`}>
                                <div className="col-span-10 font-body-md text-body-md font-semibold text-primary flex items-center gap-2">
                                    <Icon name="folder" size={18} className="text-secondary" /> {c.name}
                                </div>
                                <div className="col-span-2 flex justify-end">
                                    <button onClick={() => setDeleteConfirm(c._id)} className="p-2 rounded hover:bg-surface-container-high text-error transition-colors" title="Archive Repository">
                                        <Icon name="delete" size={20} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {deleteConfirm && (
                <ConfirmModal
                    title="Archive Repository?"
                    message="Are you sure you want to archive this repository? It will be hidden from the sidebar, but existing encrypted documents will remain intact in the database."
                    confirmText="Yes, Archive"
                    cancelText="Cancel"
                    isDanger={true}
                    onConfirm={handleDelete}
                    onCancel={() => setDeleteConfirm(null)}
                />
            )}
        </Shell>
    );
}