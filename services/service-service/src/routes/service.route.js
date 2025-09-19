const express = require('express');
const router = express.Router();
const serviceController = require('../controllers/service.controller');
const authMiddleware = require('../middlewares/auth.middleware');

// ===== SERVICE ROUTES =====
// Protected routes (require admin/manager)
router.post('/', authMiddleware, serviceController.createService);
router.put('/:id', authMiddleware, serviceController.updateService);
router.patch('/:id/toggle', authMiddleware, serviceController.toggleStatus);
router.delete('/:id', authMiddleware, serviceController.deleteService);

// Public routes
router.get('/', serviceController.listServices);
router.get('/search', serviceController.searchService);
router.get('/:id', serviceController.getServiceById);

// ===== SERVICE ADD-ON ROUTES =====
// Protected routes (require admin/manager)
router.post('/:serviceId/addons', authMiddleware, serviceController.addServiceAddOn);
router.put('/:serviceId/addons/:addOnId', authMiddleware, serviceController.updateServiceAddOn);
router.patch('/:serviceId/addons/:addOnId/toggle', authMiddleware, serviceController.toggleServiceAddOnStatus);
router.delete('/:serviceId/addons/:addOnId', authMiddleware, serviceController.deleteServiceAddOn);

// Public routes
router.get('/:serviceId/addons/:addOnId', serviceController.getServiceAddOnById);

module.exports = router;
