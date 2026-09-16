const mongoose = require('mongoose');

const ROLES = ['Admin', 'Engineering', 'Legal', 'Management'];

const departmentSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
    allowedRoles: [{ type: String, enum: ROLES }],   // empty => inherit category
    downloadRoles: [{ type: String, enum: ROLES }],  // empty => inherit category
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

// Ensure department names are unique within their specific category
departmentSchema.index({ name: 1, category: 1 }, { unique: true });

module.exports = mongoose.model('Department', departmentSchema);
