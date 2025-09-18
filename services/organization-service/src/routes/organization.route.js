const express = require('express');
const router = express.Router();
const orgController = require('../controllers/organization.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

// PUBLIC
router.get('/public/info', orgController.getPublicOrganizationInfo);

// INIT ONCE
router.post('/init', authMiddleware, orgController.initOrganization);

// GET / UPDATE SINGLETON
router.get('/', orgController.getOrganization);
router.patch('/is-active', authMiddleware, orgController.toggleIsActive);
router.put('/', authMiddleware, orgController.updateOrganization);
router.post('/logo', authMiddleware, upload.single('logo'), orgController.uploadLogo);

// READ CONFIG
router.get('/config/work', authMiddleware, orgController.getWorkConfiguration);
router.get('/config/financial', authMiddleware, orgController.getFinancialConfiguration);
router.get('/config/cancellation', authMiddleware, orgController.getCancellationPolicy);
router.get('/config/staff-allocation', authMiddleware, orgController.getStaffAllocationRules);

// UPDATE CONFIG
router.put('/config/work', authMiddleware, orgController.updateWorkConfiguration);
router.put('/config/financial', authMiddleware, orgController.updateFinancialConfiguration);
router.put('/config/cancellation', authMiddleware, orgController.updateCancellationPolicy);
router.put('/config/staff-allocation', authMiddleware, orgController.updateStaffAllocationRules);

// HOLIDAYS
router.post('/holidays', authMiddleware, orgController.addHoliday);
router.put('/holidays/:holidayId', authMiddleware, orgController.updateHoliday);
router.delete('/holidays/:holidayId', authMiddleware, orgController.removeHoliday);

// SHIFTS
router.put('/shifts/:shiftName', authMiddleware, orgController.updateWorkShift);
router.patch('/shifts/:shiftName/toggle', authMiddleware, orgController.toggleWorkShift);

module.exports = router;
