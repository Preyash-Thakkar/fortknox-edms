const mongoose = require('mongoose');

const ROLES = ['Admin', 'Engineering', 'Legal', 'Management'];

const categorySchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true, trim: true },
    allowedRoles: [{ type: String, enum: ROLES }],
    downloadRoles: [{ type: String, enum: ROLES }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = mongoose.model('Category', categorySchema);