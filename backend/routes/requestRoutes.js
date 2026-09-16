const express = require('express');
const { authenticate, authorize } = require('../middlewares/authMiddleware');
const requestController = require('../controllers/requestController');

const router = express.Router();

router.post('/access-requests', authenticate, requestController.createRequest);
router.get('/access-requests', authenticate, requestController.getRequests);
router.post('/access-requests/:id/decide', authenticate, authorize('Admin'), requestController.decideRequest);

router.get('/notifications', authenticate, requestController.getNotifications);
router.post('/notifications/read', authenticate, requestController.markNotificationsRead);

module.exports = router;