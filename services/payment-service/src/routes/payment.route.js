const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/payment.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const roleMiddleware = require('../middlewares/role.middleware');
const validationMiddleware = require('../middlewares/validation.middleware');
const {
  createPaymentValidation,
  createCashPaymentValidation,
  createRefundValidation,
  updatePaymentValidation,
  cancelPaymentValidation,
  getPaymentByIdValidation,
  getPaymentByCodeValidation,
  getPatientPaymentsValidation,
  listPaymentsValidation,
  searchPaymentsValidation,
  getStatisticsValidation
} = require('../validations/payment.validation');

// ============ PUBLIC ROUTES (No Auth Required) ============
// VNPay Payment Gateway Return URL
router.get('/return/vnpay', 
  paymentController.vnpayReturn
);

// ============ AUTHENTICATED ROUTES ============
router.use(authMiddleware);

// ============ CREATE PAYMENT ROUTES ============
// Create general payment (All authenticated users)
router.post('/', 
  createPaymentValidation,
  validationMiddleware.validate,
  paymentController.createPayment
);

// Create cash payment (Staff only)
router.post('/cash', 
  roleMiddleware(['admin', 'manager', 'dentist', 'receptionist']),
  createCashPaymentValidation,
  validationMiddleware.validate,
  paymentController.createCashPayment
);

// Create refund (Admin/Manager only)
router.post('/:originalPaymentId/refund', 
  roleMiddleware(['admin', 'manager']),
  createRefundValidation,
  validationMiddleware.validate,
  paymentController.createRefundPayment
);

// ============ GET PAYMENT ROUTES ============
// Get payment by ID
router.get('/id/:id', 
  getPaymentByIdValidation,
  validationMiddleware.validate,
  paymentController.getPaymentById
);

// Get payment by code
router.get('/code/:code', 
  getPaymentByCodeValidation,
  validationMiddleware.validate,
  paymentController.getPaymentByCode
);

// Get patient payments (Patients can only see their own, staff can see all)
router.get('/patient/:patientId', 
  getPatientPaymentsValidation,
  validationMiddleware.validate,
  paymentController.getPatientPayments
);

// Get appointment payments
router.get('/appointment/:appointmentId', 
  paymentController.getAppointmentPayments
);

// Get invoice payments
router.get('/invoice/:invoiceId', 
  paymentController.getInvoicePayments
);

// ============ LIST & SEARCH ROUTES ============
// List payments with filters (Staff only)
router.get('/', 
  roleMiddleware(['admin', 'manager', 'dentist', 'receptionist']),
  listPaymentsValidation,
  validationMiddleware.validate,
  paymentController.listPayments
);

// Search payments (Staff only)
router.get('/search', 
  roleMiddleware(['admin', 'manager', 'dentist', 'receptionist']),
  searchPaymentsValidation,
  validationMiddleware.validate,
  paymentController.searchPayments
);

// Get pending payments (Staff only)
router.get('/status/pending', 
  roleMiddleware(['admin', 'manager', 'receptionist']),
  paymentController.getPendingPayments
);

// Get processing payments (Staff only)
router.get('/status/processing', 
  roleMiddleware(['admin', 'manager', 'receptionist']),
  paymentController.getProcessingPayments
);

// Get failed payments (Staff only)
router.get('/status/failed', 
  roleMiddleware(['admin', 'manager', 'receptionist']),
  paymentController.getFailedPayments
);

// Get today's payments (Staff only)
router.get('/today', 
  roleMiddleware(['admin', 'manager', 'dentist', 'receptionist']),
  paymentController.getTodayPayments
);

// ============ UPDATE PAYMENT ROUTES ============
// Update payment (Staff only)
router.put('/:id', 
  roleMiddleware(['admin', 'manager', 'receptionist']),
  updatePaymentValidation,
  validationMiddleware.validate,
  paymentController.updatePayment
);

// Confirm payment (Staff only)
router.post('/:id/confirm', 
  roleMiddleware(['admin', 'manager', 'receptionist']),
  getPaymentByIdValidation,
  validationMiddleware.validate,
  paymentController.confirmPayment
);

// Manual confirm payment (Staff only)
router.post('/:id/manual-confirm', 
  roleMiddleware(['admin', 'manager', 'receptionist']),
  getPaymentByIdValidation,
  validationMiddleware.validate,
  paymentController.manualConfirmPayment
);

// Cancel payment (Staff only)
router.post('/:id/cancel', 
  roleMiddleware(['admin', 'manager']),
  cancelPaymentValidation,
  validationMiddleware.validate,
  paymentController.cancelPayment
);

// Verify payment (Admin/Manager only)
router.post('/:id/verify', 
  roleMiddleware(['admin', 'manager']),
  getPaymentByIdValidation,
  validationMiddleware.validate,
  paymentController.verifyPayment
);

// ============ STATISTICS ROUTES ============
// Payment statistics (Admin/Manager only)
router.get('/stats/payments', 
  roleMiddleware(['admin', 'manager']),
  getStatisticsValidation,
  validationMiddleware.validate,
  paymentController.getPaymentStatistics
);

// Revenue statistics (Admin/Manager only)
router.get('/stats/revenue', 
  roleMiddleware(['admin', 'manager']),
  getStatisticsValidation,
  validationMiddleware.validate,
  paymentController.getRevenueStatistics
);

// Refund statistics (Admin/Manager only)
router.get('/stats/refunds', 
  roleMiddleware(['admin', 'manager']),
  getStatisticsValidation,
  validationMiddleware.validate,
  paymentController.getRefundStatistics
);

// ============ RPC ROUTES ============
// RPC confirm payment (Internal service calls)
router.post('/:id/confirm-rpc', 
  getPaymentByIdValidation,
  validationMiddleware.validate,
  paymentController.confirmPaymentRPC
);

module.exports = router;
