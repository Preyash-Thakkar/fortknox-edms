const User = require('../models/User');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { logAudit, clientIp } = require('../utils/logger');
const { sendEmail } = require('../utils/mailer');
const { ROLES } = require('../constants');

function generateTempPassword() {
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ', lower = 'abcdefghijkmnopqrstuvwxyz', digits = '23456789', symbols = '@#$%&*';
    const all = upper + lower + digits + symbols;
    const pick = (s) => s[crypto.randomInt(s.length)];
    let chars = [pick(upper), pick(lower), pick(digits), pick(symbols)];
    while (chars.length < 12) chars.push(pick(all));
    for (let i = chars.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1);[chars[i], chars[j]] = [chars[j], chars[i]]; }
    return chars.join('');
}

exports.getUsers = async (req, res) => {
    const users = await User.find({}).select('-password').sort({ createdAt: 1 }).lean();
    res.json({ users });
};

exports.createUser = async (req, res) => {
    const ip = clientIp(req);
    const { name, email, password, role, title, department } = req.body || {};

    if (!name || !email || !role || !department) {
        return res.status(400).json({ error: 'Name, email, role, and department are required.' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return res.status(400).json({ error: 'Invalid email format.' });

    if (!ROLES.includes(role)) return res.status(400).json({ error: `Invalid role selected.` });

    // Hierarchy Enforcement
    if (req.user.role !== 'Admin') {
        if (req.user.role !== 'Management') {
            return res.status(403).json({ error: 'Only Admins or Department Heads can create new users.' });
        }
        const creator = await User.findById(req.user.id);
        const managedDepts = creator?.headOfDepartments || [];
        if (!managedDepts.includes(department)) {
            return res.status(403).json({ error: 'You can only create users within your managed departments.' });
        }
    }

    try {
        const normalizedEmail = email.toLowerCase().trim();
        if (await User.findOne({ email: normalizedEmail })) return res.status(409).json({ error: 'A user with that email already exists.' });

        const finalPassword = password || generateTempPassword();
        const hash = await bcrypt.hash(finalPassword, 12);

        const user = await User.create({
            name: name.trim(),
            email: normalizedEmail,
            password: hash,
            role,
            department,
            title: title || '',
            active: true,
            mustChangePassword: true
        });

        await logAudit({ action: 'USER_CREATED', userId: req.user.id, ip, details: `created=${user.email} role=${role} dept=${department}`, severity: 'warn' });
        await sendEmail(normalizedEmail, 'Your Fort Knox EDMS account', `An account was created for you.\nEmail: ${normalizedEmail}\nPassword: ${finalPassword}\nDepartment: ${department}\nYou will be asked to change it on first login.`);

        res.status(201).json({ message: 'User created.', user: { id: user._id, name: user.name, email: user.email, role: user.role, department: user.department, title: user.title, active: user.active } });
    } catch (err) {
        console.error('[USER_CREATE]', err.message);
        res.status(500).json({ error: 'Could not create user.' });
    }
};

exports.updateUserRole = async (req, res) => {
    const ip = clientIp(req);
    const { role } = req.body || {};
    if (!ROLES.includes(role)) return res.status(400).json({ error: `Invalid role.` });
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ error: 'User not found.' });
        if (String(user._id) === String(req.user.id) && role !== 'Admin') return res.status(400).json({ error: 'You cannot remove your own Admin role.' });
        const prev = user.role; user.role = role; await user.save();
        await logAudit({ action: 'USER_ROLE_CHANGED', userId: req.user.id, ip, details: `target=${user.email} ${prev} -> ${role}`, severity: 'warn' });
        res.json({ message: 'Role updated.', user: { id: user._id, role: user.role } });
    } catch (err) { console.error('[USER_ROLE]', err.message); res.status(500).json({ error: 'Could not update role.' }); }
};

exports.updateUserStatus = async (req, res) => {
    const ip = clientIp(req);
    const { active } = req.body || {};
    if (typeof active !== 'boolean') return res.status(400).json({ error: 'active must be true or false.' });
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ error: 'User not found.' });
        if (String(user._id) === String(req.user.id) && active === false) return res.status(400).json({ error: 'You cannot deactivate your own account.' });
        user.active = active; await user.save();
        await logAudit({ action: active ? 'USER_REACTIVATED' : 'USER_DEACTIVATED', userId: req.user.id, ip, details: `target=${user.email}`, severity: 'warn' });

        // This is the line that was throwing the syntax error. It is fixed now.
        res.json({ message: active ? 'User reactivated.' : 'User deactivated.', user: { id: user._id, active: user.active } });
    } catch (err) { console.error('[USER_ACTIVE]', err.message); res.status(500).json({ error: 'Could not update user status.' }); }
};

exports.resetPassword = async (req, res) => {
    const ip = clientIp(req);
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ error: 'User not found.' });
        const tempPassword = generateTempPassword();
        user.password = await bcrypt.hash(tempPassword, 12);
        user.mustChangePassword = true;
        await user.save();
        await logAudit({ action: 'USER_PASSWORD_RESET', userId: req.user.id, ip, details: `target=${user.email}`, severity: 'warn' });
        await sendEmail(user.email, 'Your Fort Knox EDMS password was reset', `A new temporary password was set: ${tempPassword}\nYou will be asked to change it on next login.`);
        res.json({ message: 'Password reset.', tempPassword, user: { id: user._id, email: user.email } });
    } catch (err) { console.error('[USER_RESET]', err.message); res.status(500).json({ error: 'Could not reset password.' }); }
};

exports.updateUser = async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ error: 'User not found' });

        if (req.user.role === 'Management' && user.role === 'Admin') {
            return res.status(403).json({ error: 'Cannot modify Admin accounts.' });
        }

        const { name, email, password, role, department, title } = req.body;

        if (name) user.name = name;
        if (email) user.email = email;
        if (role) user.role = role;
        if (department) user.department = department;
        if (title !== undefined) user.title = title;

        if (password) {
            user.password = await bcrypt.hash(password, 12);
        }

        await user.save();
        res.json({ message: 'User updated successfully', user });
    } catch (err) {
        if (err.code === 11000) {
            return res.status(400).json({ error: 'Email already in use.' });
        }
        res.status(400).json({ error: err.message });
    }
};

exports.deleteUser = async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ error: 'User not found' });

        if (req.user.role === 'Management' && user.role === 'Admin') {
            return res.status(403).json({ error: 'Cannot delete Admin accounts.' });
        }

        user.email = `deleted_${Date.now()}_${user.email}`;
        user.deletedAt = new Date();
        user.active = false;

        await user.save();
        res.json({ message: 'User deleted successfully' });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

exports.restoreUser = async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ error: 'User not found' });

        user.email = user.email.replace(/^deleted_\d+_/, '');
        user.active = true;
        user.deletedAt = undefined;

        await user.save();
        res.json({ message: 'Operator restored successfully', user });
    } catch (err) {
        if (err.code === 11000) {
            return res.status(400).json({ error: 'Cannot restore: Another active user is now using this email.' });
        }
        res.status(400).json({ error: err.message });
    }
};