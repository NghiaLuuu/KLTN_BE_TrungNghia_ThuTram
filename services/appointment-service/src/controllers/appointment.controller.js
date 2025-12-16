const appointmentService = require('../services/appointment.service');
const queueService = require('../services/queue.service');

class AppointmentController {
  
  /**
   * Lấy danh sách slot khả dụng theo nha sĩ, ngày và thời lượng dịch vụ
   */
  async getAvailableSlots(req, res) {
    try {
      const { dentistId, date, serviceDuration } = req.query;
      
      // Validation middleware đã kiểm tra các tham số bắt buộc
      const result = await appointmentService.getAvailableSlotGroups(
        dentistId, date, parseInt(serviceDuration)
      );
      
      res.json({ success: true, data: result });
      
    } catch (error) {
      console.error('Lỗi getAvailableSlots:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }
  
  /**
   * Đặt giữ slot tạm thời trong 3 phút để thanh toán
   */
  async reserve(req, res) {
    try {
      const result = await appointmentService.reserveAppointment(req.body, req.user);
      
      res.status(201).json({
        success: true,
        message: 'Đặt giữ slot thành công. Vui lòng thanh toán trong vòng 15 phút.',
        data: result
      });
      
    } catch (error) {
      console.error('Lỗi reserve:', error);
      res.status(400).json({ success: false, message: error.message });
    }
  }
  
  /**
   * Lấy lịch hẹn theo mã phiếu khám
   */
  async getByCode(req, res) {
    try {
      const appointment = await appointmentService.getByCode(req.params.appointmentCode);
      res.json({ success: true, data: appointment });
      
    } catch (error) {
      console.error('Lỗi getByCode:', error);
      res.status(404).json({ success: false, message: error.message });
    }
  }
  
  /**
   * Lấy danh sách lịch hẹn theo ID bệnh nhân
   */
  async getByPatient(req, res) {
    try {
      const filters = {
        status: req.query.status,
        dateFrom: req.query.dateFrom,
        dateTo: req.query.dateTo
      };
      
      const appointments = await appointmentService.getByPatient(req.params.patientId, filters);
      res.json({ success: true, data: appointments });
      
    } catch (error) {
      console.error('Lỗi getByPatient:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }
  
  // ⭐ Lấy danh sách lịch hẹn của bệnh nhân đang đăng nhập
  async getMyAppointments(req, res) {
    try {
      const patientId = req.user?.userId || req.user?._id;
      
      if (!patientId) {
        return res.status(401).json({ success: false, message: 'Chưa đăng nhập' });
      }
      
      const filters = {
        status: req.query.status,
        dateFrom: req.query.dateFrom,
        dateTo: req.query.dateTo
      };
      
      console.log('🔍 [DEBUG] getMyAppointments - patientId:', patientId);
      
      const appointments = await appointmentService.getByPatient(patientId, filters);
      
      console.log('🔍 [DEBUG] getMyAppointments - Tìm thấy:', appointments.length);
      
      res.json({ success: true, data: appointments });
      
    } catch (error) {
      console.error('Lỗi getMyAppointments:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }
  
  /**
   * Lấy danh sách lịch hẹn theo ID nha sĩ
   */
  async getByDentist(req, res) {
    try {
      const filters = {
        status: req.query.status,
        date: req.query.date
      };
      
      const appointments = await appointmentService.getByDentist(req.params.dentistId, filters);
      res.json({ success: true, data: appointments });
      
    } catch (error) {
      console.error('Lỗi getByDentist:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }
  
  /**
   * Check-in bệnh nhân khi đến phòng khám
   */
  async checkIn(req, res) {
    try {
      const userId = req.user?.userId || req.user?._id;
      const appointment = await appointmentService.checkIn(req.params.id, userId);
      res.json({ success: true, message: 'Check-in thành công', data: appointment });
      
    } catch (error) {
      console.error('Lỗi checkIn:', error);
      res.status(400).json({ success: false, message: error.message });
    }
  }
  
  /**
   * Hoàn thành lịch hẹn sau khi khám xong
   */
  async complete(req, res) {
    try {
      const userId = req.user?.userId || req.user?._id;
      const appointmentId = req.params.id;
      
      // Hoàn thành lịch hẹn hiện tại
      const appointment = await appointmentService.complete(
        appointmentId, userId, req.body
      );
      
      // 🔥 Tự động kích hoạt bệnh nhân tiếp theo trong hàng đợi
      try {
        const nextPatient = await queueService.activateNextPatient(appointmentId);
        
        if (nextPatient) {
          console.log(`✅ [Complete] Đã kích hoạt bệnh nhân tiếp theo: ${nextPatient.appointmentCode}`);
        }
      } catch (queueError) {
        // Không làm thất bại việc hoàn thành nếu kích hoạt hàng đợi thất bại
        console.error('⚠️ [Complete] Kích hoạt hàng đợi thất bại:', queueError);
      }
      
      res.json({ success: true, message: 'Hoàn thành lịch hẹn thành công', data: appointment });
      
    } catch (error) {
      console.error('Lỗi complete:', error);
      res.status(400).json({ success: false, message: error.message });
    }
  }
  
  /**
   * Hủy lịch hẹn với lý do
   */
  async cancel(req, res) {
    try {
      const userId = req.user?.userId || req.user?._id;
      const appointment = await appointmentService.cancel(
        req.params.id, userId, req.body.reason
      );
      res.json({ success: true, message: 'Hủy lịch hẹn thành công', data: appointment });
      
    } catch (error) {
      console.error('Lỗi cancel:', error);
      res.status(400).json({ success: false, message: error.message });
    }
  }

  // 🆕 Hủy lịch hẹn - nội bộ (không cần xác thực, cho schedule-service)
  async cancelInternal(req, res) {
    try {
      const { cancelledBy, cancellationReason } = req.body;
      const appointment = await appointmentService.cancel(
        req.params.id, 
        cancelledBy || 'system', 
        cancellationReason || 'Slot bị vô hiệu hóa bởi hệ thống'
      );
      res.json({ 
        success: true, 
        message: 'Hủy lịch hẹn thành công (nội bộ)', 
        data: appointment 
      });
      
    } catch (error) {
      console.error('Lỗi cancelInternal:', error);
      res.status(400).json({ success: false, message: error.message });
    }
  }
  
  /**
   * Tạo lịch hẹn offline (đặt tại quầy)
   */
  async createOffline(req, res) {
    try {
      console.log('📝 createOffline nhận body:', JSON.stringify(req.body, null, 2));
      console.log('👤 patientInfo:', req.body.patientInfo);
      console.log('🔐 req.user:', req.user);
      
      // Sử dụng req.user nếu có, ngược lại dùng createdBy từ body
      const currentUser = req.user || { 
        _id: req.body.createdBy, 
        role: 'staff' 
      };
      
      const appointment = await appointmentService.createAppointmentDirectly(req.body, currentUser);
      
      res.status(201).json({
        success: true,
        message: 'Tạo lịch hẹn offline thành công',
        data: appointment
      });
      
    } catch (error) {
      console.error('Lỗi createOffline:', error);
      res.status(400).json({ success: false, message: error.message });
    }
  }

  /**
   * Lấy tất cả lịch hẹn với bộ lọc và phân quyền theo vai trò
   */
  async getAllAppointments(req, res) {
    try {
      const filters = {
        status: req.query.status,
        dentistId: req.query.dentistId,
        startDate: req.query.startDate,
        endDate: req.query.endDate,
        page: parseInt(req.query.page) || 1,
        limit: parseInt(req.query.limit) || 50
      };

      // 🔒 Lọc theo activeRole (vai trò được chọn khi đăng nhập)
      const activeRole = req.user?.activeRole || req.user?.role; // Sử dụng activeRole nếu có
      const userRoles = req.user?.roles || [req.user?.role]; // Tất cả vai trò để kiểm tra admin/manager
      const userId = req.user?.userId || req.user?._id;

      console.log('🔍 [APPOINTMENT DEBUG] activeRole:', activeRole);
      console.log('🔍 [APPOINTMENT DEBUG] userRoles:', userRoles);

      // ✅ Lọc dựa trên VAI TRÒ ĐANG HOẠT ĐỘNG (vai trò chọn khi đăng nhập)
      if (activeRole === 'dentist') {
        // Đăng nhập với vai trò nha sĩ - chỉ xem lịch hẹn của mình
        filters.dentistId = userId;
        console.log('🔒 [LỌC NHA SĨ] dentistId:', userId);
      } else if (activeRole === 'nurse') {
        // Đăng nhập với vai trò y tá - chỉ xem lịch hẹn của mình
        filters.nurseId = userId;
        console.log('🔒 [LỌC Y TÁ] nurseId:', userId);
      } else if (activeRole === 'admin' || activeRole === 'manager') {
        // Đăng nhập với vai trò admin/manager - xem tất cả lịch hẹn
        console.log('🔓 [KHÔNG LỌC] User đăng nhập với vai trò admin/manager');
      } else {
        console.log('🔓 [KHÔNG LỌC] Vai trò:', activeRole);
      }
      // Lễ tân xem tất cả
      
      const result = await appointmentService.getAllAppointments(filters);
      res.json({ 
        success: true, 
        data: result
      });
      
    } catch (error) {
      console.error('Lỗi getAllAppointments:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  /**
   * Lấy danh sách lịch hẹn theo nhân viên và ngày
   */
  async getByStaff(req, res) {
    try {
      const { staffId } = req.params;
      const { date } = req.query;
      
      if (!date) {
        return res.status(400).json({ 
          success: false, 
          message: 'Tham số date là bắt buộc (định dạng: yyyy-MM-dd)' 
        });
      }
      
      const appointments = await appointmentService.getByStaff(staffId, date);
      res.json({ 
        success: true, 
        data: appointments 
      });
      
    } catch (error) {
      console.error('Lỗi getByStaff:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  // 🆕 LẤY LỊCH HẸN THEO DANH SÁCH IDS (cho schedule-service)
  async getByIds(req, res) {
    try {
      const { ids } = req.query;
      
      if (!ids) {
        return res.status(400).json({ 
          success: false, 
          message: 'Tham số ids là bắt buộc (phân cách bằng dấu phẩy)' 
        });
      }
      
      const appointmentIds = ids.split(',').map(id => id.trim()).filter(Boolean);
      
      if (appointmentIds.length === 0) {
        return res.json({ success: true, data: [] });
      }
      
      const appointments = await appointmentService.getAppointmentsByIds(appointmentIds);
      res.json({ 
        success: true, 
        data: appointments,
        count: appointments.length
      });
      
    } catch (error) {
      console.error('Lỗi getByIds:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  /**
   * ✅ Yêu cầu hủy phiếu (chỉ dành cho bệnh nhân đặt online)
   * Bệnh nhân có thể yêu cầu hủy nếu lịch hẹn còn >= 1 ngày
   */
  async requestCancellation(req, res) {
    try {
      const { appointmentId } = req.params;
      const { reason } = req.body;
      const patientId = req.user?.userId || req.user?._id;

      if (!patientId) {
        return res.status(401).json({ 
          success: false, 
          message: 'Chưa đăng nhập' 
        });
      }

      const result = await appointmentService.requestCancellation(
        appointmentId,
        patientId,
        reason
      );

      res.json({
        success: true,
        message: 'Yêu cầu hủy phiếu khám đã được gửi. Vui lòng chờ xác nhận từ phòng khám.',
        data: result
      });
    } catch (error) {
      console.error('Lỗi requestCancellation:', error);
      res.status(400).json({ 
        success: false, 
        message: error.message 
      });
    }
  }

  /**
   * ✅ Admin/Manager/Lễ tân hủy lịch hẹn
   * Không giới hạn thời gian
   */
  async adminCancelAppointment(req, res) {
    try {
      const { appointmentId } = req.params;
      const { reason } = req.body;
      const staffId = req.user?.userId || req.user?._id;
      const staffRole = req.user?.activeRole || req.user?.role; // ✅ Fix: Đọc activeRole từ JWT token

      console.log('🔍 [adminCancelAppointment] Nhận request:', {
        appointmentId,
        staffId,
        staffRole,
        reason: reason?.substring(0, 50)
      });

      if (!staffId || !staffRole) {
        console.error('❌ [adminCancelAppointment] Thiếu thông tin xác thực:', { staffId, staffRole, user: req.user });
        return res.status(401).json({ 
          success: false, 
          message: 'Chưa đăng nhập' 
        });
      }

      const result = await appointmentService.adminCancelAppointment(
        appointmentId,
        staffId,
        staffRole,
        reason,
        {
          userId: staffId,
          name: req.user?.fullName || req.user?.name,
          role: staffRole
        }
      );

      console.log('✅ [adminCancelAppointment] Thành công');
      res.json({
        success: true,
        message: 'Phiếu khám đã được hủy thành công',
        data: result
      });
    } catch (error) {
      console.error('❌ [adminCancelAppointment] lỗi:', error);
      res.status(400).json({ 
        success: false, 
        message: error.message 
      });
    }
  }

  /**
   * 🆕 Hủy lịch hẹn do slot bị tắt (API nội bộ - không cần xác thực)
   * KHÔNG xóa appointmentId trong slots - cho phép khôi phục khi slots được bật lại
   */
  async slotCancelAppointment(req, res) {
    try {
      const { appointmentId } = req.params;
      const { reason } = req.body;

      console.log('🔍 [slotCancelAppointment] Nhận request:', {
        appointmentId,
        reason: reason?.substring(0, 50)
      });

      const result = await appointmentService.slotCancelAppointment(appointmentId, reason);

      console.log('✅ [slotCancelAppointment] Thành công');
      res.json({
        success: true,
        message: 'Phiếu khám đã được hủy do slot bị tắt',
        data: result
      });
    } catch (error) {
      console.error('❌ [slotCancelAppointment] lỗi:', error);
      res.status(400).json({ 
        success: false, 
        message: error.message 
      });
    }
  }

  /**
   * 🆕 Khôi phục lịch hẹn khi slot được bật lại (API nội bộ - không cần xác thực)
   */
  async slotRestoreAppointment(req, res) {
    try {
      const { appointmentId } = req.params;
      const { reason } = req.body;

      console.log('🔍 [slotRestoreAppointment] Nhận request:', {
        appointmentId,
        reason: reason?.substring(0, 50)
      });

      const result = await appointmentService.slotRestoreAppointment(appointmentId, reason);

      console.log('✅ [slotRestoreAppointment] Thành công');
      res.json({
        success: true,
        message: 'Phiếu khám đã được khôi phục',
        data: result
      });
    } catch (error) {
      console.error('❌ [slotRestoreAppointment] lỗi:', error);
      res.status(400).json({ 
        success: false, 
        message: error.message 
      });
    }
  }

  /**
   * ✅ Admin/Manager/Lễ tân từ chối yêu cầu hủy
   * Đổi status từ 'pending-cancellation' về 'confirmed'
   */
  async rejectCancellation(req, res) {
    try {
      const { appointmentId } = req.params;
      const { reason } = req.body;
      const staffId = req.user?.userId || req.user?._id;
      const staffRole = req.user?.activeRole || req.user?.role;

      console.log('🔍 [rejectCancellation] Nhận request:', {
        appointmentId,
        staffId,
        staffRole,
        reason: reason?.substring(0, 50)
      });

      if (!staffId || !staffRole) {
        console.error('❌ [rejectCancellation] Thiếu thông tin xác thực:', { staffId, staffRole, user: req.user });
        return res.status(401).json({ 
          success: false, 
          message: 'Chưa đăng nhập' 
        });
      }

      const result = await appointmentService.rejectCancellation(
        appointmentId,
        staffId,
        staffRole,
        reason
      );

      console.log('✅ [rejectCancellation] Thành công');
      res.json({
        success: true,
        message: 'Đã từ chối yêu cầu hủy phiếu, trạng thái phiếu khám về lại "Đã xác nhận"',
        data: result
      });
    } catch (error) {
      console.error('❌ [rejectCancellation] lỗi:', error);
      res.status(400).json({ 
        success: false, 
        message: error.message 
      });
    }
  }

  /**
   * ✅ Lấy thống kê kênh đặt hẹn (Online vs Offline)
   */
  async getBookingChannelStats(req, res) {
    try {
      const { startDate, endDate, groupBy = 'day' } = req.query;

      if (!startDate || !endDate) {
        return res.status(400).json({
          success: false,
          message: 'startDate và endDate là bắt buộc'
        });
      }

      const { parseDateRange } = require('../utils/dateUtils');
      const { startDate: start, endDate: end } = parseDateRange(startDate, endDate);

      const stats = await appointmentService.getBookingChannelStats(
        start,
        end,
        groupBy
      );

      res.json({
        success: true,
        message: 'Lấy thống kê kênh đặt hẹn thành công',
        data: stats
      });
    } catch (error) {
      console.error('Lỗi getBookingChannelStats:', error);
      res.status(500).json({ 
        success: false, 
        message: error.message || 'Lỗi khi lấy thống kê kênh đặt hẹn'
      });
    }
  }
}

module.exports = new AppointmentController();