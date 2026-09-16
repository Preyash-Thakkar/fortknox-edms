const AuditLog = require('../models/AuditLog');

async function logAudit({ action, userId = null, ip = '', details = '', severity = 'info' }) {
    try {
        await AuditLog.create({ action, userId, ip, details, severity, timestamp: new Date() });
    } catch (err) {
        console.error('[AUDIT] write failed:', err.message);
    }
}

function clientIp(req) {
    return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
}

module.exports = { logAudit, clientIp };