const mongoose = require('mongoose');

const ROLES = ['Admin', 'Engineering', 'Legal', 'Management'];
const SENSITIVITY = ['Public', 'Internal', 'Confidential', 'Strictly Confidential'];

const versionSchema = new mongoose.Schema({
    version: { type: Number, required: true },
    path: { type: String, required: true },
    size: { type: Number, default: 0 },
    hash: { type: String, default: '' },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    uploadedAt: { type: Date, default: Date.now },
    note: { type: String, default: '' },
}, { _id: false });

const assetSchema = new mongoose.Schema({
    filename: { type: String, required: true },
    keywords: { type: String, default: '' },
    type: { type: String, default: '' },
    fileType: { type: String, default: '' },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
    department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department' },
    sensitivity: { type: String, enum: SENSITIVITY, default: 'Internal' },
    allowedRoles: [{ type: String, enum: ROLES }],
    downloadRoles: [{ type: String, enum: ROLES }],
    userViewGrants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    userDownloadGrants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    currentVersion: { type: Number, default: 1 },
    versions: [versionSchema],
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

// Indexes for hot query paths
assetSchema.index({ category: 1, department: 1, updatedAt: -1 });
assetSchema.index({ updatedAt: -1 });
assetSchema.index({ allowedRoles: 1 });
assetSchema.index({ userViewGrants: 1 });
assetSchema.index({ filename: 'text', keywords: 'text' }, { weights: { filename: 5, keywords: 1 }, name: 'asset_text' });

module.exports = mongoose.model('Asset', assetSchema);