const mongoose = require('mongoose');

const accessRequestSchema = new mongoose.Schema({
    asset: { type: mongoose.Schema.Types.ObjectId, ref: 'Asset', required: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: ['view', 'download'], default: 'view' },
    reason: { type: String, default: '' },
    status: { type: String, enum: ['Pending', 'Approved', 'Denied'], default: 'Pending' },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    decidedAt: { type: Date },
}, { timestamps: true });

accessRequestSchema.index({ requestedBy: 1, status: 1 });
accessRequestSchema.index({ status: 1, createdAt: -1 });
accessRequestSchema.index({ asset: 1 });

module.exports = mongoose.model('AccessRequest', accessRequestSchema);