const mongoose = require('mongoose');

// Extracted from server.js
const ROLES = ['Admin', 'Engineering', 'Legal', 'Management'];

const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    role: { type: String, enum: ROLES, required: true },
    title: { type: String, default: '' },
    active: { type: Boolean, default: true },
    mustChangePassword: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);