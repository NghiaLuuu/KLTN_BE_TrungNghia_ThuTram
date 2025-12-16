const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/payment.controller');
const cashPaymentController = require('../controllers/cashPayment.controller');
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
const stripeController = require('../controllers/stripe.controller');

// ============ CÁC ROUTE CÔNG KHAI (Không cần xác thực) ============
// URL trả về của Cổng thanh toán VNPay
router.get('/return/vnpay', 
  paymentController.vnpayReturn
);

// URL trả về của Cổng thanh toán Stripe (theo kiểu VNPay)
router.get('/return/stripe',
  stripeController.handleCallback
);

// Xử lý thanh toán Visa (Chỉ bệnh nhân - xác thực tùy chọn)
router.post('/visa/process',
  paymentController.processVisaPayment
);

// Tạo thanh toán tạm thời cho đặt khám (Gọi nội bộ giữa các service)
router.post('/temporary', 
  paymentController.createTemporaryPayment
);

// Tạo URL thanh toán VNPay (Gọi từ trang chọn thanh toán frontend)
router.post('/vnpay/create-url',
  paymentController.createVNPayUrl
);

// ============ CÁC ROUTE CẦN XÁC THỰC ============
router.use(authMiddleware);

// ============ CÁC ROUTE TẠO THANH TOÁN ============
// Tạo thanh toán chung (Tất cả người dùng đã xác thực)
router.post('/', 
  createPaymentValidation,
  validationMiddleware.validate,
  paymentController.createPayment
);

// Tạo thanh toán tiền mặt (Chỉ nhân viên)
router.post('/cash', 
  roleMiddleware(['admin', 'manager', 'dentist', 'receptionist']),
  createCashPaymentValidation,
  validationMiddleware.validate,
  paymentController.createCashPayment
);

// Tạo hoàn tiền (Chỉ Admin/Manager)
router.post('/:originalPaymentId/refund', 
  roleMiddleware(['admin', 'manager']),
  createRefundValidation,
  validationMiddleware.validate,
  paymentController.createRefundPayment
);

// Tạo URL VNPay cho thanh toán hiện có (Chỉ nhân viên)
router.post('/:id/vnpay-url',
  roleMiddleware(['admin', 'manager', 'dentist', 'receptionist']),
  paymentController.createVNPayUrlForPayment
);

// Tạo URL Stripe cho thanh toán hiện có (Chỉ nhân viên)
router.post('/:id/stripe-url',
  roleMiddleware(['admin', 'manager', 'dentist', 'receptionist']),
  paymentController.createStripeUrlForPayment
);

// ============ CÁC ROUTE LẤY THANH TOÁN ============
// Lấy thanh toán theo ID
router.get('/id/:id', 
  getPaymentByIdValidation,
  validationMiddleware.validate,
  paymentController.getPaymentById
);

// Lấy thanh toán theo mã
router.get('/code/:code', 
  getPaymentByCodeValidation,
  validationMiddleware.validate,
  paymentController.getPaymentByCode
);

// Lấy thanh toán của bệnh nhân (Bệnh nhân chỉ xem của mình, nhân viên xem tất cả)
router.get('/patient/:patientId', 
  getPatientPaymentsValidation,
  validationMiddleware.validate,
  paymentController.getPatientPayments
);

// Lấy thanh toán theo lịch hẹn
router.get('/appointment/:appointmentId', 
  paymentController.getAppointmentPayments
);

// Lấy thanh toán theo hóa đơn
router.get('/invoice/:invoiceId', 
  paymentController.getInvoicePayments
);

// Lấy thanh toán theo recordId (tự động tạo nếu chưa có)
router.get('/record/:recordId', 
  roleMiddleware(['admin', 'manager', 'dentist', 'receptionist']),
  paymentController.getPaymentByRecordId
);

// Route cũ - giữ lại để tương thích ngược
router.get('/by-record/:recordId', 
  roleMiddleware(['admin', 'manager', 'dentist', 'receptionist']),
  paymentController.getPaymentByRecordId
);

// ============ CÁC ROUTE DANH SÁCH & TÌM KIẾĆM ============
// Danh sách thanh toán với bộ lọc (Chỉ nhân viên)
router.get('/', 
  roleMiddleware(['admin', 'manager', 'dentist', 'receptionist']),
  listPaymentsValidation,
  validationMiddleware.validate,
  paymentController.listPayments
);

// Tìm kiếm thanh toán (Chỉ nhân viên)
router.get('/search', 
  roleMiddleware(['admin', 'manager', 'dentist', 'receptionist']),
  searchPaymentsValidation,
  validationMiddleware.validate,
  paymentController.searchPayments
);

// Lấy thanh toán đang chờ (Chỉ nhân viên)
router.get('/status/pending', 
  roleMiddleware(['admin', 'manager', 'receptionist']),
  paymentController.getPendingPayments
);

// Lấy thanh toán đang xử lý (Chỉ nhân viên)
router.get('/status/processing', 
  roleMiddleware(['admin', 'manager', 'receptionist']),
  paymentController.getProcessingPayments
);

// Lấy thanh toán thất bại (Chỉ nhân viên)
router.get('/status/failed', 
  roleMiddleware(['admin', 'manager', 'receptionist']),
  paymentController.getFailedPayments
);

// Lấy thanh toán hôm nay (Chỉ nhân viên)
router.get('/today', 
  roleMiddleware(['admin', 'manager', 'dentist', 'receptionist']),
  paymentController.getTodayPayments
);

// ============ CÁC ROUTE CẬP NHẬT THANH TOÁN ============
// Cập nhật thanh toán (Chỉ nhân viên)
router.put('/:id', 
  roleMiddleware(['admin', 'manager', 'receptionist']),
  updatePaymentValidation,
  validationMiddleware.validate,
  paymentController.updatePayment
);

// Xác nhận thanh toán (Chỉ nhân viên)
router.post('/:id/confirm', 
  roleMiddleware(['admin', 'manager', 'receptionist']),
  getPaymentByIdValidation,
  validationMiddleware.validate,
  paymentController.confirmPayment
);

// Xác nhận thanh toán tiền mặt (Chỉ nhân viên) - MỚI
router.post('/:id/confirm-cash',
  roleMiddleware(['admin', 'manager', 'dentist', 'receptionist']),
  paymentController.confirmCashPayment
);

// Xác nhận thanh toán thủ công (Chỉ nhân viên)
router.post('/:id/manual-confirm', 
  roleMiddleware(['admin', 'manager', 'receptionist']),
  getPaymentByIdValidation,
  validationMiddleware.validate,
  paymentController.manualConfirmPayment
);

// Hủy thanh toán (Chỉ nhân viên)
router.post('/:id/cancel', 
  roleMiddleware(['admin', 'manager']),
  cancelPaymentValidation,
  validationMiddleware.validate,
  paymentController.cancelPayment
);

// Xác minh thanh toán (Chỉ Admin/Manager)
router.post('/:id/verify', 
  roleMiddleware(['admin', 'manager']),
  getPaymentByIdValidation,
  validationMiddleware.validate,
  paymentController.verifyPayment
);

// ============ CÁC ROUTE THỐNG KÊ ============
// Thống kê thanh toán (Chỉ Admin/Manager)
router.get('/stats/payments', 
  roleMiddleware(['admin', 'manager']),
  getStatisticsValidation,
  validationMiddleware.validate,
  paymentController.getPaymentStatistics
);

// Thống kê doanh thu (Chỉ Admin/Manager)
router.get('/stats/revenue', 
  roleMiddleware(['admin', 'manager']),
  getStatisticsValidation,
  validationMiddleware.validate,
  paymentController.getRevenueStatistics
);

// Thống kê hoàn tiền (Chỉ Admin/Manager)
router.get('/stats/refunds', 
  roleMiddleware(['admin', 'manager']),
  getStatisticsValidation,
  validationMiddleware.validate,
  paymentController.getRefundStatistics
);

// ============ CÁC ROUTE RPC ============
// Xác nhận thanh toán RPC (Gọi nội bộ giữa các service)
router.post('/:id/confirm-rpc', 
  getPaymentByIdValidation,
  validationMiddleware.validate,
  paymentController.confirmPaymentRPC
);

module.exports = router;
