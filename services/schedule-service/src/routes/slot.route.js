const express = require('express');
const router = express.Router();
const slotController = require('../controllers/slot.controller');
const authMiddleware = require('../middlewares/auth.middleware');

// ⭐ Phân công nhân viên cho các slot cụ thể
// Ví dụ body: { slotIds: ['slot1', 'slot2'], roomId, subRoomId?, dentistIds: [], nurseIds: [] }
router.post('/assign-staff', authMiddleware, slotController.assignStaffToSlots);

// ⭐ Thay đổi nhân viên (thay nhân viên cũ bằng nhân viên mới trong các slot cụ thể)
// Ví dụ body: { slotIds: ['slot1', 'slot2'], oldStaffId, newStaffId, role: 'dentist' | 'nurse' }
router.post('/reassign-staff', authMiddleware, slotController.reassignStaffToSlots);

// ⭐ Xóa nhân viên khỏi slots (xóa mảng nha sĩ và/hoặc y tá)
// Ví dụ body: { slotIds: ['slot1', 'slot2'], removeDentists: true, removeNurses: true }
router.post('/remove-staff', authMiddleware, slotController.removeStaffFromSlots);

// Cập nhật nhân viên cho một hoặc nhiều slots
router.patch('/staff', authMiddleware, slotController.updateSlotStaff);

// Lấy slots theo ca và ngày để chọn slot dễ dàng
router.get('/by-shift', slotController.getSlotsByShiftAndDate);

// Lấy lịch phòng với số lượng cuộc hẹn (xem theo ngày/tuần/tháng)
router.get('/room/:roomId/calendar', slotController.getRoomCalendar);

// Lấy lịch nha sĩ với số lượng cuộc hẹn (xem theo ngày/tuần/tháng) hỗ trợ lịch sử
router.get('/dentist/:dentistId/calendar', slotController.getDentistCalendar);

// Lấy lịch y tá với số lượng cuộc hẹn (xem theo ngày/tuần/tháng) hỗ trợ lịch sử
router.get('/nurse/:nurseId/calendar', slotController.getNurseCalendar);

// Lấy các ca làm việc khả dụng
router.get('/available-shifts', slotController.getAvailableShifts);

// 🆕 Lấy chi tiết slot TƯƠNG LAI cho phòng/ngày/ca cụ thể (để phân công nhân viên)
router.get('/room/:roomId/details/future', slotController.getRoomSlotDetailsFuture);

// 🆕 Lấy chi tiết slot TƯƠNG LAI cho nha sĩ/ngày/ca cụ thể (để thay thế nhân viên)
router.get('/dentist/:dentistId/details/future', slotController.getDentistSlotDetailsFuture);

// 🆕 Lấy chi tiết slot TƯƠNG LAI cho y tá/ngày/ca cụ thể (để thay thế nhân viên)
router.get('/nurse/:nurseId/details/future', slotController.getNurseSlotDetailsFuture);

// 🆕 Kiểm tra xem nhân viên có lịch trong tương lai không
router.post('/check-has-schedule', slotController.checkStaffHasSchedule);

// 🆕 APIs ĐẶT LỊCH BỆNH NHÂN
// Lấy nha sĩ có slot trống gần nhất (> thời gian hiện tại + 30 phút)
router.get('/dentists-with-nearest-slot', slotController.getDentistsWithNearestSlot);

// Lấy các ngày làm việc của nha sĩ trong phạm vi maxBookingDays từ hôm nay
router.get('/dentist/:dentistId/working-dates', slotController.getDentistWorkingDates);

// 🆕 Cập nhật hàng loạt slots (để dịch vụ cuộc hẹn cập nhật trạng thái đã đặt)
router.put('/bulk-update', slotController.bulkUpdateSlots);

// 🆕 Lấy các slots bị khóa (cho cronjob dọn dẹp của appointment-service)
router.get('/locked', slotController.getLockedSlots);

// 🆕 Chuyển đổi trạng thái isActive của nhiều slots (cho chọn slot trên lịch)
router.post('/toggle-active', authMiddleware, slotController.toggleSlotsIsActive);

// 🆕 Tắt tất cả slots trong ngày (đóng cửa khẩn cấp - chỉ admin)
router.post('/disable-all-day', authMiddleware, slotController.disableAllDaySlots);

// 🆕 Bật tất cả slots trong ngày (kích hoạt lại - chỉ admin)
router.post('/enable-all-day', authMiddleware, slotController.enableAllDaySlots);

// 🆕 Nhiệm vụ 2.2: Tắt/bật lịch linh hoạt
router.post('/disable', authMiddleware, slotController.disableSlots);
router.post('/enable', authMiddleware, slotController.enableSlots);

// 🆕 Ghi log hủy cuộc hẹn (để theo dõi DayClosure) - gọi nội bộ từ appointment-service
router.post('/log-cancellation', slotController.logAppointmentCancellation);

// 🆕 Lấy slot theo ID (để giao tiếp liên dịch vụ)
// ⚠️ QUAN TRỌNG: Route này PHẢI ở cuối vì nó là pattern bắt tất cả
// Đặt tất cả các routes cụ thể PHÍA TRÊN dòng này
router.get('/:slotId', slotController.getSlotById);

module.exports = router;
