const mongoose = require('mongoose');
const { REQUEST_KINDS } = require('../constants');

const accessRequestSchema = new mongoose.Schema({
    asset: { type: mongoose.Schema.Types.ObjectId, ref: 'Asset', required: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    targetDepartment: { type: String, required: true }, // E.g., 'Electronics' to route to that dept head
    kind: { type: String, enum: REQUEST_KINDS, required: true }, // 'view', 'download', 'edit', 'delete'
    reason: { type: String, default: '' },
    status: { type: String, enum: ['Pending', 'Approved', 'Denied'], default: 'Pending' },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    decidedAt: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model('AccessRequest', accessRequestSchema);