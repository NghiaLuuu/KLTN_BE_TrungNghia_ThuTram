const express = require('express');
const router = express.Router();
const multer = require('multer');
const serviceController = require('../controllers/service.controller');
const authMiddleware = require('../middlewares/auth.middleware');

// Configure multer for memory storage (files stored in buffer)
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    // Only accept image files
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Chỉ chấp nhận file ảnh'), false);
    }
  }
});

// ===== SERVICE ROUTES =====
// Protected routes (require admin/manager)
router.post('/', authMiddleware, upload.array('images', 10), serviceController.createService); // Hỗ trợ upload tối đa 10 ảnh
router.put('/:id', authMiddleware, serviceController.updateService);
router.patch('/:id/toggle', authMiddleware, serviceController.toggleStatus);
router.delete('/:id', authMiddleware, serviceController.deleteService);

// Public routes
router.get('/', serviceController.listServices);
router.get('/search', serviceController.searchService);
router.get('/:id', serviceController.getServiceById);

// ===== SERVICE USAGE TRACKING =====
router.post('/check-usage', serviceController.checkServiceUsage);
router.post('/mark-as-used', serviceController.markServicesAsUsed);

// ===== SERVICE ADD-ON ROUTES =====
// Protected routes (require admin/manager)
router.post('/:serviceId/addons', authMiddleware, upload.single('image'), serviceController.addServiceAddOn);
router.put('/:serviceId/addons/:addOnId', authMiddleware, upload.single('image'), serviceController.updateServiceAddOn);
router.patch('/:serviceId/addons/:addOnId/toggle', authMiddleware, serviceController.toggleServiceAddOnStatus);
router.delete('/:serviceId/addons/:addOnId', authMiddleware, serviceController.deleteServiceAddOn);

// Public routes
router.get('/:serviceId/addons/:addOnId', serviceController.getServiceAddOnById);

module.exports = router;
