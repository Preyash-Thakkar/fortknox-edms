const express = require('express');
const rateLimit = require('express-rate-limit');
const { authenticate } = require('../middlewares/authMiddleware');
const authController = require('../controllers/authController');

const router = express.Router();

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many login attempts. Please wait a few minutes and try again.' }
});

router.post('/auth/login', loginLimiter, authController.login);
router.post('/auth/logout', authController.logout);
router.get('/me', authenticate, authController.getMe);
router.post('/auth/change-password', authenticate, authController.changePassword);

module.exports = router;