const express = require('express');
const router = express.Router();
const scheduleController = require('../controllers/schedule.controller');
const authMiddleware = require('../middlewares/auth.middleware');

// ❌ KHÔNG DÙNG NỮA: Tạo lịch theo quý (đã bỏ comment)
// router.post('/quarter', authMiddleware, scheduleController.generateQuarterSchedule);
// router.get('/quarters/available', scheduleController.getAvailableQuarters);
// router.get('/room/:roomId/quarters/status', scheduleController.checkQuartersStatus);
// router.get('/quarter/status', scheduleController.getQuarterStatus);

// 🆕 Tạo lịch thủ công cho phòng cụ thể với lựa chọn ca (THEO THÁNG)
router.post('/room/generate', authMiddleware, scheduleController.generateRoomSchedule);

// 🆕 BULK OPERATIONS - Tạo lịch cho nhiều phòng cùng lúc
router.get('/rooms/bulk-shifts', scheduleController.getBulkRoomSchedulesInfo);
router.post('/rooms/bulk-generate', authMiddleware, scheduleController.generateBulkRoomSchedules);

// 🆕 Lấy xem trước ngày nghỉ khi tạo lịch
router.get('/holiday-preview', scheduleController.getHolidayPreview);

// 🆕 Lấy lịch phòng với thông tin ca (cho UI tạo lịch) - PHẢI ĐẶT TRƯỚC /room/:roomId
router.get('/room/:roomId/shifts', scheduleController.getRoomSchedulesWithShifts);

// 🆕 Cập nhật lịch (lịch phản ứng - chỉ admin)
router.put('/:scheduleId', authMiddleware, scheduleController.updateSchedule);

// 🆕 Thêm các ca còn thiếu vào lịch hiện có (chỉ admin)
router.post('/add-missing-shifts', authMiddleware, scheduleController.addMissingShifts);

// 🆕 Lấy tóm tắt lịch theo phòng (để phân công nhân viên) - PHẢI ĐẶT TRƯỚC /room/:roomId
router.get('/room/:roomId/summary', scheduleController.getScheduleSummaryByRoom);

// Lấy lịch theo phòng và khoảng thời gian - PHẢI ĐẶT SAU các path cụ thể
router.get('/room/:roomId', scheduleController.getSchedulesByRoom);

// Lấy lịch theo khoảng thời gian (tất cả phòng)
router.get('/', scheduleController.getSchedulesByDateRange);

// Chuyển đổi trạng thái active/inactive của lịch (quản lý/admin)
router.patch('/:id/active', authMiddleware, scheduleController.toggleScheduleActive);

// 🆕 Lấy danh sách phòng với tóm tắt lịch (để danh sách phân công nhân viên)
router.get('/rooms-summary', scheduleController.getRoomsWithScheduleSummary);

// 🆕 Lấy slots theo ca cho xem lịch (theo tháng)
router.get('/slots/shift-calendar', scheduleController.getSlotsByShiftCalendar);

// 🆕 APIs PHÂN CÔNG NHÂN VIÊN
// Lấy phòng để phân công nhân viên (với tóm tắt ca)
router.get('/staff-assignment/rooms', scheduleController.getRoomsForStaffAssignment);

// Lấy lịch ca để phân công (click vào ca)
router.get('/staff-assignment/shift-calendar', scheduleController.getShiftCalendarForAssignment);

// Lấy slots cho ngày cụ thể (click vào ngày)
router.get('/staff-assignment/slots/day', scheduleController.getSlotsByDayAndShift);

// Phân công nhân viên cho một slot (quản lý/admin)
router.patch('/staff-assignment/slots/:slotId/assign', authMiddleware, scheduleController.assignStaffToSlot);

// Phân công nhân viên cho nhiều slots cùng lúc (quản lý/admin)
router.post('/staff-assignment/slots/bulk-assign', authMiddleware, scheduleController.bulkAssignStaff);

// 🆕 MỚI: APIs cho Phân công và Thay thế Nhân viên Thống nhất
// Lấy ca lịch phòng (ca đã có lịch)
router.get('/room-shifts', scheduleController.getRoomScheduleShifts);

// Lấy khả năng của nhân viên với kiểm tra xung đột
router.get('/staff-availability', scheduleController.getStaffAvailabilityForShift);

// Lấy lịch nhân viên (lịch làm việc của nhân viên)
router.get('/staff-schedule', scheduleController.getStaffSchedule);

// ⚡ TỐI ƯU: Kiểm tra xung đột cho các slots đã chọn (cách tiếp cận mới)
router.post('/check-conflicts', scheduleController.checkConflictsForSlots);

// Lấy nhân viên thay thế khả dụng (với kiểm tra xung đột)
router.post('/replacement-staff', scheduleController.getAvailableReplacementStaff);

// Thay thế nhân viên (quản lý/admin)
router.post('/replace-staff', authMiddleware, scheduleController.replaceStaff);

// 🆕 Nhiệm vụ 2.3: Tạo lịch override trong ngày nghỉ
router.post('/override-holiday', authMiddleware, scheduleController.createScheduleOverrideHoliday);

// 🆕 Tạo override ngày nghỉ hàng loạt cho nhiều lịch (phòng có buồng con)
router.post('/batch-override-holiday', authMiddleware, scheduleController.createBatchScheduleOverrideHoliday);

// 🆕 Lấy các ca khả dụng cho override ngày nghỉ (kiểm tra ca nào có thể tạo)
router.post('/get-available-override-shifts', scheduleController.getAvailableOverrideShifts);

// 🆕 Nhiệm vụ 2.4: Validate incomplete schedule
router.get('/validate-incomplete', scheduleController.validateIncompleteSchedule);

// 🆕 Validate ngày nghỉ từ holidaySnapshot của schedule cụ thể
router.get('/validate-holiday-from-schedule', scheduleController.validateHolidayFromSchedule);

// 🆕 Bulk disable schedule cho nhiều ngày/ca/buồng
router.post('/bulk-disable', authMiddleware, scheduleController.bulkDisableSchedule);

// 🆕 Tắt/bật lịch cho nhiều ngày - toàn bộ room và subroom
router.post('/bulk-toggle-dates', authMiddleware, scheduleController.bulkToggleScheduleDates);

// 🆕 Tạo lịch cho ngày nghỉ - toàn bộ room và subroom
router.post('/override-holiday-all-rooms', authMiddleware, scheduleController.createOverrideHolidayForAllRooms);

// 🆕 Enable các ca và buồng bị tắt
router.post('/enable-shifts-subrooms', authMiddleware, scheduleController.enableShiftsAndSubRooms);

module.exports = router;
