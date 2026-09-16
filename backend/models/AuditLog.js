const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
    action: { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    ip: { type: String },
    timestamp: { type: Date, default: Date.now },
    severity: { type: String, enum: ['info', 'warn', 'critical'], default: 'info' },
    details: { type: String },
}, { timestamps: false });

// Indexes extracted from server.js
auditLogSchema.index({ timestamp: -1 });
auditLogSchema.index({ severity: 1, timestamp: -1 });
auditLogSchema.index({ userId: 1, timestamp: -1 });

// Security: Block all updates and deletes to make logs immutable
const blockMutation = (next) => next(new Error('AuditLog records are immutable.'));
['findOneAndUpdate', 'updateOne', 'updateMany', 'deleteOne', 'deleteMany', 'findOneAndDelete', 'remove'].forEach((op) => {
    auditLogSchema.pre(op, blockMutation);
});

auditLogSchema.pre('save', function (next) {
    if (!this.isNew) return next(new Error('AuditLog records are immutable.'));
    next();
});

module.exports = mongoose.model('AuditLog', auditLogSchema);