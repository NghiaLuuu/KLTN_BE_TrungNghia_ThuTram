const express = require('express');
const router = express.Router();

// Import controller and middlewares
const statisticController = require('../controllers/statistic.controller');
const { authenticate, requireAdminOrManager, requireStaff } = require('../middlewares/auth.middleware');
const {
  validate,
  dashboardValidation,
  dateRangeValidation,
  dentistStatsValidation,
  serviceStatsValidation,
  revenueStatsValidation,
  patientStatsValidation,
  staffStatsValidation,
  clinicUtilizationValidation
} = require('../validations/statistic.validation');

// ============ PUBLIC ROUTES ============
router.get('/health', statisticController.healthCheck);

// ============ AUTHENTICATED ROUTES ============
// Apply authentication to all routes below
router.use(authenticate);

// ============ DASHBOARD & OVERVIEW ============
router.get('/dashboard', 
  requireStaff,
  dashboardValidation,
  validate,
  statisticController.getDashboard
);

// ============ APPOINTMENT STATISTICS ============
router.get('/appointments',
  requireStaff,
  dateRangeValidation,
  validate,
  statisticController.getAppointmentStats
);

// 📊 Appointment Status Statistics (completed, cancelled, no-show)
router.get('/appointment-status',
  requireStaff,
  dateRangeValidation,
  validate,
  statisticController.getAppointmentStatusStats
);

// ============ REVENUE & FINANCIAL STATISTICS ============
router.get('/revenue',
  requireAdminOrManager, // Revenue stats only for admin/manager
  revenueStatsValidation,
  validate,
  statisticController.getRevenueStats
);

// ============ PATIENT STATISTICS ============
router.get('/patients',
  requireStaff,
  patientStatsValidation,
  validate,
  statisticController.getPatientStats
);

// ============ STAFF & DENTIST STATISTICS ============
router.get('/staff',
  requireAdminOrManager, // Staff stats only for admin/manager
  staffStatsValidation,
  validate,
  statisticController.getStaffStats
);

router.get('/dentists',
  requireStaff,
  dentistStatsValidation,
  validate,
  statisticController.getDentistStats
);

// ============ SERVICE STATISTICS ============
router.get('/services',
  requireStaff,
  serviceStatsValidation,
  validate,
  statisticController.getServiceStats
);

// ============ SCHEDULE & ROOM UTILIZATION ============
router.get('/schedule',
  requireStaff,
  dateRangeValidation,
  validate,
  statisticController.getScheduleStats
);

router.get('/clinic-utilization',
  requireAdminOrManager,
  clinicUtilizationValidation,
  validate,
  statisticController.getClinicUtilizationStats
);

// ============ EXPORT & UTILITY FUNCTIONS ============
router.get('/export',
  requireAdminOrManager,
  statisticController.exportStats
);

router.delete('/cache',
  requireAdminOrManager,
  statisticController.clearCache
);

// ============ ERROR HANDLING ============
router.use((err, req, res, next) => {
  console.error('Statistics route error:', err);
  res.status(500).json({
    success: false,
    message: 'Lỗi trong route thống kê',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

module.exports = router;