const mongoose = require('mongoose');
const { DEPARTMENTS, SENSITIVITY, CONTROL_STATUS } = require('../constants');

const versionSchema = new mongoose.Schema({
    version: { type: Number, required: true },
    path: { type: String, required: true },
    size: { type: Number, required: true },
    hash: { type: String, required: true },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    note: { type: String, default: 'Auto-version update' },
}, { timestamps: true });

const grantEntrySchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: ['view', 'download', 'edit'], required: true },
    grantedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    grantedAt: { type: Date, default: Date.now },
    revokedAt: { type: Date, default: null },
    durationString: { type: String, default: 'Active' },
    // Live counters during the active grant window
    viewsCount: { type: Number, default: 0 },
    editsCount: { type: Number, default: 0 },
    downloadsCount: { type: Number, default: 0 },
});

const assetSchema = new mongoose.Schema({
    filename: { type: String, required: true, trim: true },
    keywords: { type: String, default: '' },
    type: { type: String, default: 'application/octet-stream' },
    fileType: { type: String, default: '' },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
    department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null },
    departmentName: { type: String, enum: DEPARTMENTS, default: 'Electronics' },
    sensitivity: { type: String, enum: SENSITIVITY, default: 'Internal' },
    controlStatus: { type: String, enum: CONTROL_STATUS, default: 'Draft' },

    allowedRoles: [{ type: String }],
    downloadRoles: [{ type: String }],

    // Embedded Active Grants and immutable Audit Logs for individual access windows
    userViewGrants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    userDownloadGrants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    accessLogs: [grantEntrySchema],

    currentVersion: { type: Number, default: 1 },
    versions: [versionSchema],
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    // Soft Deletion Control (Admin / Owner workflow)
    deletedAt: { type: Date, default: null },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

assetSchema.index({ filename: 'text', keywords: 'text' });

module.exports = mongoose.model('Asset', assetSchema);