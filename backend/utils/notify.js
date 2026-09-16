const Notification = require('../models/Notification');
const User = require('../models/User');
const { sendEmail } = require('./mailer');

async function notify(userId, text, link = '') {
    try {
        await Notification.create({ user: userId, text, link });
        const u = await User.findById(userId).select('email').lean();
        if (u?.email) await sendEmail(u.email, 'Fort Knox EDMS notification', text);
    } catch (err) { console.error('[NOTIFY]', err.message); }
}

module.exports = { notify };