import React from 'react';
import { Icon } from './ui';

export default function ConfirmModal({ title, message, onConfirm, onCancel, confirmText = 'Confirm', cancelText = 'Cancel', isDanger = false }) {
    return (
        <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                <div className={`p-4 border-b ${isDanger ? 'bg-red-50' : 'bg-gray-50'}`}>
                    <h3 className={`font-bold flex items-center gap-2 ${isDanger ? 'text-red-700' : 'text-gray-800'}`}>
                        <Icon name={isDanger ? 'warning' : 'help_outline'} /> {title}
                    </h3>
                </div>
                <div className="p-4 text-sm text-gray-600">
                    {message}
                </div>
                <div className="p-4 bg-gray-50 flex justify-end gap-2 border-t">
                    <button onClick={onCancel} className="px-4 py-2 rounded border bg-white text-gray-600 hover:bg-gray-100 text-sm font-semibold transition-colors">
                        {cancelText}
                    </button>
                    <button
                        onClick={onConfirm}
                        className={`px-4 py-2 rounded text-white text-sm font-semibold transition-colors ${isDanger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}
                    >
                        {confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
}