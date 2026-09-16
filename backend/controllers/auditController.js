const AuditLog = require('../models/AuditLog');

exports.getAuditLogs = async (req, res) => {
    try {
        const { severity, action } = req.query;
        const q = {};
        if (severity) q.severity = severity;
        if (action) q.action = new RegExp(action, 'i');
        const logs = await AuditLog.find(q).sort({ timestamp: -1 }).limit(300).populate('userId', 'name email role').lean();
        res.json({ logs });
    } catch (err) {
        console.error('[AUDIT]', err.message);
        res.status(500).json({ error: 'Could not fetch audit logs.' });
    }
};