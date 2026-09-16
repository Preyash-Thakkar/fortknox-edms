const mongoose = require('mongoose');
const { ROLES, DEPARTMENTS } = require('../constants');

const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    role: { type: String, enum: ROLES, required: true },
    department: { type: String, enum: DEPARTMENTS, default: 'Electronics' },
    title: { type: String, default: '' },
    active: { type: Boolean, default: true },
    mustChangePassword: { type: Boolean, default: false },
    headOfDepartments: [{ type: String, enum: DEPARTMENTS }], // Departments this user manages if role is Department Head / Management
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);