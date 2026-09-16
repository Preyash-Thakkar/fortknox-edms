const nodemailer = require('nodemailer');

let mailer = null;
if (process.env.SMTP_HOST) {
    mailer = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
}

async function sendEmail(to, subject, text) {
    if (!to) return;
    if (!mailer) {
        console.log(`[EMAIL:console] To: ${to} | ${subject}\n${text}\n`);
        return;
    }
    try {
        await mailer.sendMail({ from: process.env.SMTP_FROM || 'edms@local', to, subject, text });
    } catch (err) {
        console.error('[EMAIL] send failed:', err.message);
    }
}

module.exports = { sendEmail };