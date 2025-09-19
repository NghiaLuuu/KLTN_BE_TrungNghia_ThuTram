const express = require('express');
const router = express.Router();
const clinicController = require('../controllers/clinic.controller');
const authMiddleware = require('../middlewares/auth.middleware');

// Public
router.get('/public/info', clinicController.getPublicClinicInfo);

// Init once
router.post('/init', authMiddleware, clinicController.initClinic);

// Get / Update Singleton
router.get('/', clinicController.getClinic);
router.put('/', authMiddleware, clinicController.updateClinic);
router.patch('/is-active', authMiddleware, clinicController.toggleIsActive);

// WORK SHIFT MANAGEMENT
router.get('/work-shifts', authMiddleware, clinicController.getWorkShifts);
router.put('/work-shifts', authMiddleware, clinicController.updateWorkShifts);


module.exports = router;
