const express = require('express');
const router = express.Router();
const appointmentController = require('../controllers/appointment.controller');
const queueController = require('../controllers/queue.controller');
const { authenticate, authorize } = require('../middlewares/auth.middleware');
const { validate } = require('../middlewares/validate.middleware');
const {
  createOfflineAppointmentValidation, // ⭐ Import validation mới
  reserveAppointmentValidation,
  cancelAppointmentValidation,
  completeAppointmentValidation,
  checkInAppointmentValidation,
  appointmentCodeValidation,
  patientAppointmentsValidation,
  dentistAppointmentsValidation,
  availableSlotsValidation
} = require('../validations/reserve.validation');
const {
  rejectCancellationValidation
} = require('../validations/appointment.validation');

// 🆕 Lấy danh sách lịch hẹn theo IDs (cho schedule-service - sử dụng nội bộ)
// ⚠️ PHẢI đặt TRƯỚC route '/' để tránh xung đột đường dẫn
router.get('/by-ids',
  appointmentController.getByIds
);

// 🆕 Hủy lịch hẹn (nội bộ - cho schedule-service khi vô hiệu hóa slots)
router.post('/internal/cancel/:id',
  appointmentController.cancelInternal
);

// Lấy tất cả lịch hẹn (Chỉ Admin/Manager/Lễ tân)
router.get('/', 
  authenticate, 
  authorize(['admin', 'manager', 'receptionist']),
  appointmentController.getAllAppointments
);

// Lấy nhóm slot khả dụng
router.get('/available-slots', 
  authenticate, 
  availableSlotsValidation,
  validate,
  appointmentController.getAvailableSlots
);

// Đặt giữ slot (tạo reservation tạm + thanh toán) - Cho đặt online
router.post('/reserve', 
  authenticate, 
  reserveAppointmentValidation,
  validate,
  appointmentController.reserve
);

// Tạo lịch hẹn trực tiếp (đặt offline) - Chỉ cho nhân viên/admin
router.post('/create-offline', 
  authenticate, 
  authorize(['staff', 'admin', 'manager', 'dentist', 'receptionist']),
  createOfflineAppointmentValidation, // ⭐ Sử dụng validation riêng cho đặt offline
  validate,
  appointmentController.createOffline
);

// Lấy lịch hẹn theo mã phiếu khám
router.get('/code/:appointmentCode', 
  authenticate,
  appointmentCodeValidation,
  validate,
  appointmentController.getByCode
);

// ⭐ Lấy lịch hẹn của tôi (bệnh nhân đang đăng nhập)
router.get('/my-appointments',
  authenticate,
  appointmentController.getMyAppointments
);

// Lấy lịch hẹn theo bệnh nhân
router.get('/patient/:patientId', 
  authenticate,
  patientAppointmentsValidation,
  validate,
  appointmentController.getByPatient
);

// Lấy lịch hẹn theo nha sĩ
router.get('/dentist/:dentistId', 
  authenticate,
  dentistAppointmentsValidation,
  validate,
  appointmentController.getByDentist
);

// Lấy lịch hẹn theo nhân viên (nha sĩ hoặc y tá)
router.get('/by-staff/:staffId',
  authenticate,
  appointmentController.getByStaff
);

// Check-in lịch hẹn
router.post('/:id/check-in', 
  authenticate, 
  authorize(['dentist', 'admin', 'manager', 'staff', 'receptionist']),
  checkInAppointmentValidation,
  validate,
  appointmentController.checkIn
);

// Hoàn thành lịch hẹn
router.post('/:id/complete', 
  authenticate, 
  authorize(['dentist', 'admin', 'manager']),
  completeAppointmentValidation,
  validate,
  appointmentController.complete
);

// Hủy lịch hẹn
router.post('/:id/cancel', 
  authenticate,
  cancelAppointmentValidation,
  validate,
  appointmentController.cancel
);

// ⭐ Yêu cầu hủy phiếu (chỉ cho bệnh nhân đặt online)
router.post('/:appointmentId/request-cancellation',
  authenticate,
  appointmentController.requestCancellation
);

// ⭐ Admin/Manager/Lễ tân hủy lịch hẹn (không giới hạn thời gian)
router.post('/:appointmentId/admin-cancel',
  authenticate,
  authorize(['manager', 'admin', 'receptionist']),
  appointmentController.adminCancelAppointment
);

// 🆕 Hủy lịch hẹn do slot bị tắt (API nội bộ - được gọi bởi schedule-service)
// KHÔNG xóa appointmentId trong slots - cho phép khôi phục khi slots được bật lại
router.post('/:appointmentId/slot-cancel',
  appointmentController.slotCancelAppointment
);

// 🆕 Khôi phục lịch hẹn khi slot được bật lại (API nội bộ - được gọi bởi schedule-service)
router.post('/:appointmentId/slot-restore',
  appointmentController.slotRestoreAppointment
);

// ⭐ Admin/Manager/Lễ tân từ chối yêu cầu hủy
router.post('/:appointmentId/reject-cancellation',
  authenticate,
  authorize(['manager', 'admin', 'receptionist']),
  rejectCancellationValidation,
  validate,
  appointmentController.rejectCancellation
);

// ============================================
// 🔥 ROUTES QUẢN LÝ HÀNG ĐỢI
// ============================================

// Lấy hàng đợi cho tất cả phòng hoặc phòng cụ thể
router.get('/queue',
  authenticate,
  queueController.getQueue
);

// Lấy thống kê hàng đợi
router.get('/queue/stats',
  authenticate,
  authorize(['admin', 'manager', 'dentist', 'staff', 'receptionist', 'nurse']),
  queueController.getQueueStats
);

// ✅ Lấy thống kê kênh đặt hẹn (Online vs Offline)
router.get('/booking-channel-stats',
  authenticate,
  authorize(['admin', 'manager']),
  appointmentController.getBookingChannelStats
);

// Kích hoạt auto-start (cho testing/trigger thủ công)
router.post('/queue/auto-start',
  authenticate,
  authorize(['admin', 'manager']),
  queueController.triggerAutoStart
);

module.exports = router;