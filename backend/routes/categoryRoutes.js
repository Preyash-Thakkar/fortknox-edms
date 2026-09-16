const express = require('express');
const { authenticate, authorize } = require('../middlewares/authMiddleware');
const categoryController = require('../controllers/categoryController');

const router = express.Router();

router.get('/categories', authenticate, categoryController.getCategories);
router.post('/categories', authenticate, authorize('Admin'), categoryController.createCategory);
router.patch('/categories/:id', authenticate, authorize('Admin'), categoryController.updateCategory);
router.delete('/categories/:id', authenticate, authorize('Admin'), categoryController.deleteCategory);

module.exports = router;