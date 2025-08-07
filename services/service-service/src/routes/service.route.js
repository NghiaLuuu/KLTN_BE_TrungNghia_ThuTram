const express = require('express');
const router = express.Router();
const serviceController = require('../controllers/service.controller');
const authMiddleware = require('../middlewares/auth.middleware');

// ✅ Các route yêu cầu xác thực và phân quyền
router.post('/', authMiddleware, serviceController.createService);
router.put('/:id', authMiddleware, serviceController.updateService);
router.patch('/:id/toggle', authMiddleware, serviceController.toggleStatus);

// ✅ Các route công khai
router.get('/', serviceController.listServices);
router.get('/search', serviceController.searchService);

module.exports = router;
