const express = require('express');
const router = express.Router();

// Import controller
const recordController = require('../controllers/record.controller');
const queueController = require('../controllers/queue.controller');

// Import middleware
const { authenticate, authorize } = require('../middlewares/auth.middleware');
const { validate } = require('../middlewares/validate.middleware');

// Import validations
const {
  createRecordValidation,
  updateRecordValidation,
  recordIdValidation,
  queueRecordIdValidation,
  recordCodeValidation,
  updateStatusValidation,
  addPrescriptionValidation,
  updateTreatmentIndicationValidation,
  listRecordsValidation,
  searchRecordsValidation,
  patientIdValidation,
  dentistIdValidation,
  statisticsValidation
} = require('../validations/record.validation');

// Các Routes

// ========== Routes Quản Lý Hàng Đợi ==========
// Lấy số hàng đợi tiếp theo cho một phòng
router.get('/queue/next-number',
  authenticate,
  authorize(['dentist', 'admin', 'manager', 'staff', 'receptionist']),
  queueController.getNextQueueNumber
);

// Lấy trạng thái hàng đợi cho một phòng
router.get('/queue/status',
  authenticate,
  authorize(['dentist', 'admin', 'manager', 'staff', 'receptionist']),
  queueController.getQueueStatus
);

// Gọi một hồ sơ (gán số hàng đợi và bắt đầu)
router.post('/:recordId/call',
  authenticate,
  authorize(['dentist', 'admin', 'manager', 'staff', 'receptionist']),
  queueRecordIdValidation,
  validate,
  queueController.callRecord
);

// Hoàn thành một hồ sơ
router.post('/:recordId/complete',
  authenticate,
  authorize(['dentist', 'admin', 'manager']),
  queueRecordIdValidation,
  validate,
  queueController.completeRecord
);

// Lấy thông tin thanh toán cho hồ sơ (xem trước khi hoàn thành)
router.get('/:id/payment-info',
  authenticate,
  authorize(['dentist', 'admin', 'manager', 'nurse', 'receptionist']),
  recordIdValidation,
  validate,
  recordController.getPaymentInfo
);

// Hủy một hồ sơ
router.post('/:recordId/cancel',
  authenticate,
  authorize(['dentist', 'admin', 'manager', 'staff', 'receptionist']),
  queueRecordIdValidation,
  validate,
  queueController.cancelRecord
);

// ========== Routes Quản Lý Hồ Sơ ==========
// Liệt kê tất cả hồ sơ với bộ lọc
router.get('/', 
  authenticate,
  listRecordsValidation,
  validate,
  recordController.getAll
);

// Tìm kiếm hồ sơ
router.get('/search',
  authenticate,
  searchRecordsValidation,
  validate,
  recordController.search
);

// Lấy thống kê
router.get('/statistics',
  authenticate,
  authorize(['admin', 'manager']),
  statisticsValidation,
  validate,
  recordController.getStatistics
);

// Lấy hồ sơ theo bệnh nhân
router.get('/patient/:patientId',
  authenticate,
  patientIdValidation,
  validate,
  recordController.getByPatient
);

// ✅ Lấy các dịch vụ chưa sử dụng từ hồ sơ khám (để chọn dịch vụ khi đặt lịch)
router.get('/patient/:patientId/unused-services',
  authenticate,
  patientIdValidation,
  validate,
  recordController.getUnusedServices
);

// 🆕 Lấy chỉ định điều trị cho bệnh nhân và dịch vụ
router.get('/patient/:patientId/treatment-indications',
  authenticate,
  patientIdValidation,
  validate,
  recordController.getTreatmentIndications
);

// Lấy hồ sơ theo nha sĩ
router.get('/dentist/:dentistId',
  authenticate,
  dentistIdValidation,
  validate,
  recordController.getByDentist
);

// 🆕 Lấy bệnh nhân có chỉ định chưa sử dụng cho nha sĩ (cho walk-in)
router.get('/dentist/:dentistId/patients-with-unused-indications',
  authenticate,
  authorize(['dentist', 'admin', 'manager']),
  dentistIdValidation,
  validate,
  recordController.getPatientsWithUnusedIndications
);

// Lấy hồ sơ đang chờ
router.get('/status/pending',
  authenticate,
  authorize(['dentist', 'admin', 'manager']),
  recordController.getPending
);

// Lấy hồ sơ theo mã
router.get('/code/:code',
  authenticate,
  recordCodeValidation,
  validate,
  recordController.getByCode
);

// Lấy hồ sơ theo ID
router.get('/:id',
  authenticate,
  recordIdValidation,
  validate,
  recordController.getById
);

// Tạo hồ sơ mới
router.post('/',
  authenticate,
  authorize(['dentist', 'admin', 'manager']),
  createRecordValidation,
  validate,
  recordController.create
);

// Cập nhật trạng thái hồ sơ
router.patch('/:id/status',
  authenticate,
  authorize(['dentist', 'admin', 'manager']),
  updateStatusValidation,
  validate,
  recordController.updateStatus
);

// Thêm đơn thuốc vào hồ sơ
router.post('/:id/prescription',
  authenticate,
  authorize(['dentist', 'admin', 'manager']),
  addPrescriptionValidation,
  validate,
  recordController.addPrescription
);

// Cập nhật chỉ định điều trị
router.patch('/:id/indications/:indicationId',
  authenticate,
  authorize(['dentist', 'admin', 'manager']),
  updateTreatmentIndicationValidation,
  validate,
  recordController.updateTreatmentIndication
);

// ⭐ Thêm dịch vụ bổ sung vào hồ sơ
router.post('/:id/additional-services',
  authenticate,
  authorize(['dentist', 'admin', 'manager']),
  recordIdValidation,
  validate,
  recordController.addAdditionalService
);

// ⭐ Xóa dịch vụ bổ sung khỏi hồ sơ
router.delete('/:id/additional-services/:serviceItemId',
  authenticate,
  authorize(['dentist', 'admin', 'manager']),
  recordIdValidation,
  validate,
  recordController.removeAdditionalService
);

// ⭐ Cập nhật dịch vụ bổ sung (số lượng/ghi chú)
router.patch('/:id/additional-services/:serviceItemId',
  authenticate,
  authorize(['dentist', 'admin', 'manager']),
  recordIdValidation,
  validate,
  recordController.updateAdditionalService
);

// Hoàn thành hồ sơ
router.patch('/:id/complete',
  authenticate,
  authorize(['dentist', 'admin', 'manager']),
  recordIdValidation,
  validate,
  recordController.complete
);

// Cập nhật hồ sơ
router.put('/:id',
  authenticate,
  authorize(['dentist', 'admin', 'manager']),
  updateRecordValidation,
  validate,
  recordController.update
);

// Xóa hồ sơ
router.delete('/:id',
  authenticate,
  authorize(['admin', 'manager']),
  recordIdValidation,
  validate,
  recordController.delete
);

module.exports = router;
