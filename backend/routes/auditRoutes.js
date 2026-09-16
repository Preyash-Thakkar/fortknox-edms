const express = require('express');
const { authenticate, authorize } = require('../middlewares/authMiddleware');
const auditController = require('../controllers/auditController');

const router = express.Router();

router.get('/audit', authenticate, authorize('Admin'), auditController.getAuditLogs);

module.exports = router;