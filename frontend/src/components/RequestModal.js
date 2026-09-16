import React, { useState } from 'react';
import { api } from '../auth';
import { Icon } from './ui';

export default function RequestModal({ asset, onClose, onSuccess }) {
    const [kind, setKind] = useState('view');
    const [reason, setReason] = useState('');
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setErr('');
        try {
            await api.post('/access-requests', {
                assetId: asset._id,
                kind,
                reason,
            });
            alert('Access request submitted successfully to the Department Head.');
            if (onSuccess) onSuccess();
            onClose();
        } catch (error) {
            setErr(error.response?.data?.error || 'Failed to submit request.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                        <Icon name="key" /> Request Access: {asset.filename}
                    </h3>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-700"><Icon name="close" /></button>
                </div>

                {err && <div className="bg-red-100 text-red-700 p-3 rounded text-sm mb-4">{err}</div>}

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-gray-600 uppercase mb-1">Access Type</label>
                        <select value={kind} onChange={(e) => setKind(e.target.value)} className="w-full border rounded p-2 text-sm bg-gray-50">
                            <option value="view">View Only Access</option>
                            <option value="download">Download Access</option>
                            <option value="edit">Edit Access</option>
                        </select>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-gray-600 uppercase mb-1">Reason for Request</label>
                        <textarea
                            rows="3"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder="Please specify why you need access..."
                            className="w-full border rounded p-2 text-sm"
                            required
                        ></textarea>
                    </div>

                    <div className="flex justify-end gap-2 pt-2">
                        <button type="button" onClick={onClose} className="px-4 py-2 rounded border text-gray-600 hover:bg-gray-100 text-sm font-semibold">
                            Cancel
                        </button>
                        <button type="submit" disabled={loading} className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 text-sm font-semibold">
                            {loading ? 'Submitting...' : 'Submit Request'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}