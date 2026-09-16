const express = require('express');
const { authenticate, authorize } = require('../middlewares/authMiddleware');
const userController = require('../controllers/userController');

const router = express.Router();

router.get('/users', authenticate, authorize('Admin'), userController.getUsers);
router.post('/users', authenticate, authorize('Admin'), userController.createUser);
router.patch('/users/:id/role', authenticate, authorize('Admin'), userController.updateUserRole);
router.patch('/users/:id/active', authenticate, authorize('Admin'), userController.updateUserStatus);
router.post('/users/:id/reset-password', authenticate, authorize('Admin'), userController.resetPassword);
router.patch('/users/:id', authenticate, authorize('Admin'), userController.updateUser);
router.delete('/users/:id', authenticate, authorize('Admin'), userController.deleteUser);

module.exports = router;