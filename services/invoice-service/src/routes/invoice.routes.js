const express = require("express");
const router = express.Router();
const invoiceController = require("../controllers/invoice.controller");
const authMiddleware = require("../middlewares/auth.middleware");
const { validateCreateInvoice, validateUpdateInvoice, validatePaymentData } = require("../validations/invoice.validation");

// ============ PUBLIC ROUTES (for system integration) ============
router.get("/health", invoiceController.healthCheck);

// ============ PROTECTED ROUTES ============
// Apply authentication to all routes below
router.use(authMiddleware.authenticate);

// ============ INVOICE CRUD ROUTES ============
router.post("/", 
  authMiddleware.authorize(['admin', 'manager', 'dentist', 'receptionist']),
  validateCreateInvoice,
  invoiceController.createInvoice
);

// Patient can get their own invoices
router.get("/my-invoices",
  authMiddleware.authorize(['patient']),
  invoiceController.getMyInvoices
);

router.get("/",
  authMiddleware.authorize(['admin', 'manager', 'dentist', 'receptionist']),
  invoiceController.getInvoices
);

router.get("/search",
  authMiddleware.authorize(['admin', 'manager', 'dentist', 'receptionist']),
  invoiceController.searchInvoices
);

router.get("/:id",
  authMiddleware.authorize(['admin', 'manager', 'dentist', 'receptionist', 'patient']),
  invoiceController.getInvoiceById
);

router.put("/:id",
  authMiddleware.authorize(['admin', 'manager', 'dentist', 'receptionist']),
  validateUpdateInvoice,
  invoiceController.updateInvoice
);

// ============ PAYMENT INTEGRATION ROUTES ============
router.post("/payment/success",
  authMiddleware.authorize(['admin', 'manager', 'system']),
  validatePaymentData,
  invoiceController.handlePaymentSuccess
);

router.post("/payment/create-from-payment",
  authMiddleware.authorize(['admin', 'manager', 'system']),
  invoiceController.createInvoiceFromPayment
);

// ============ BUSINESS LOGIC ROUTES ============
router.patch("/:id/finalize",
  authMiddleware.authorize(['admin', 'manager', 'dentist', 'receptionist']),
  invoiceController.finalizeInvoice
);

router.patch("/:id/cancel",
  authMiddleware.authorize(['admin', 'manager']),
  invoiceController.cancelInvoice
);

router.patch("/:id/recalculate",
  authMiddleware.authorize(['admin', 'manager', 'dentist', 'receptionist']),
  invoiceController.recalculateInvoice
);

// ============ INVOICE DETAILS ROUTES ============
router.post("/:invoiceId/details",
  authMiddleware.authorize(['admin', 'manager', 'dentist', 'receptionist']),
  invoiceController.createInvoiceDetail
);

router.get("/:invoiceId/details",
  authMiddleware.authorize(['admin', 'manager', 'dentist', 'receptionist', 'patient']),
  invoiceController.getInvoiceDetails
);

router.put("/details/:detailId",
  authMiddleware.authorize(['admin', 'manager', 'dentist', 'receptionist']),
  invoiceController.updateInvoiceDetail
);

// ============ TREATMENT TRACKING ROUTES ============
router.patch("/details/:detailId/complete-treatment",
  authMiddleware.authorize(['admin', 'manager', 'dentist']),
  invoiceController.markTreatmentCompleted
);

router.patch("/details/:detailId/update-progress",
  authMiddleware.authorize(['admin', 'manager', 'dentist']),
  invoiceController.updateTreatmentProgress
);

// ============ STATISTICS & REPORTING ROUTES ============
router.get("/stats/invoices",
  authMiddleware.authorize(['admin', 'manager']),
  invoiceController.getInvoiceStatistics
);

router.get("/stats/revenue",
  authMiddleware.authorize(['admin', 'manager']),
  invoiceController.getRevenueStatistics
);

router.get("/stats/dashboard",
  authMiddleware.authorize(['admin', 'manager', 'dentist', 'receptionist']),
  invoiceController.getDashboardData
);

router.get("/stats/services",
  authMiddleware.authorize(['admin', 'manager', 'dentist']),
  invoiceController.getServiceStatistics
);

module.exports = router;
