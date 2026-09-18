const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_only_secret_change_me';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '8h';
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';

function authenticate(req, res, next) {
    const token = req.cookies?.whcr_token || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);
    if (!token) return res.status(401).json({ error: 'Not authenticated.' });
    try {
        const payload = jwt.verify(token, JWT_SECRET);
        req.user = { id: payload.id, role: payload.role, email: payload.email, name: payload.name };
        next();
    } catch {
        return res.status(401).json({ error: 'Invalid or expired session.' });
    }
}

function authorize(...allowed) {
    return (req, res, next) => {
        if (!req.user) return res.status(401).json({ error: 'Not authenticated.' });
        if (req.user.role === 'Admin' || allowed.includes(req.user.role)) return next();
        return res.status(403).json({ error: 'Forbidden: insufficient role privileges.' });
    };
}

function setAuthCookie(res, user) {
    const token = jwt.sign({ id: user._id, role: user.role, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
    res.cookie('whcr_token', token, { httpOnly: true, secure: COOKIE_SECURE, sameSite: 'lax', maxAge: 8 * 60 * 60 * 1000 });
}

module.exports = { authenticate, authorize, setAuthCookie };