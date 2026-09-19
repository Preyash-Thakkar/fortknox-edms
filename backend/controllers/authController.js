const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { logAudit, clientIp } = require('../utils/logger');
const { setAuthCookie } = require('../middlewares/authMiddleware');

const PASSWORD_MIN = 8;

exports.login = async (req, res) => {
    const { email, password } = req.body || {};
    const ip = clientIp(req);
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
    try {
        const user = await User.findOne({ email: email.toLowerCase().trim() });
        if (!user || !(await bcrypt.compare(password, user.password))) {
            await logAudit({ action: 'LOGIN_FAILED', ip, details: `email=${email}`, severity: 'warn' });
            return res.status(401).json({ error: 'Invalid credentials.' });
        }
        if (user.active === false) {
            await logAudit({ action: 'LOGIN_BLOCKED_INACTIVE', userId: user._id, ip, severity: 'warn' });
            return res.status(403).json({ error: 'This account has been deactivated. Contact your administrator.' });
        }
        setAuthCookie(res, user);
        await logAudit({ action: 'LOGIN', userId: user._id, ip, details: `role=${user.role}` });
        res.json({ user: { id: user._id, name: user.name, email: user.email, role: user.role, title: user.title, mustChangePassword: user.mustChangePassword } });
    } catch (err) {
        console.error('[LOGIN]', err.message);
        res.status(500).json({ error: 'Login failed.' });
    }
};

exports.logout = (req, res) => {
    res.clearCookie('whcr_token');
    res.json({ message: 'Logged out.' });
};

exports.getMe = async (req, res) => {
    const user = await User.findById(req.user.id).select('-password').lean();
    if (!user) return res.status(404).json({ error: 'Not found.' });
    res.json({ user });
};

exports.changePassword = async (req, res) => {
    const ip = clientIp(req);
    const { currentPassword, newPassword } = req.body || {};
    if (!newPassword || newPassword.length < PASSWORD_MIN) return res.status(400).json({ error: `New password must be at least ${PASSWORD_MIN} characters.` });
    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ error: 'User not found.' });
        if (!user.mustChangePassword) {
            if (!currentPassword || !(await bcrypt.compare(currentPassword, user.password))) return res.status(401).json({ error: 'Current password is incorrect.' });
        }
        user.password = await bcrypt.hash(newPassword, 12);
        user.mustChangePassword = false;
        await user.save();
        setAuthCookie(res, user);
        await logAudit({ action: 'PASSWORD_CHANGED', userId: user._id, ip });
        res.json({ message: 'Password updated.' });
    } catch (err) {
        console.error('[CHANGE_PW]', err.message);
        res.status(500).json({ error: 'Could not change password.' });
    }
};