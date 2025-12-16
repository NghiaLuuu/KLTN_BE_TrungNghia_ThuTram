const recordService = require("../services/record.service");

// Hàm hỗ trợ kiểm tra quyền
const isDentistOrAbove = (user) => {
  if (!user) return false;
  const userRoles = user.roles || (user.role ? [user.role] : []); // Hỗ trợ cả mảng roles và role cũ
  return ['dentist', 'manager', 'admin'].some(role => userRoles.includes(role));
};

const isManagerOrAdmin = (user) => {
  if (!user) return false;
  const userRoles = user.roles || (user.role ? [user.role] : []); // Hỗ trợ cả mảng roles và role cũ
  return userRoles.includes('manager') || userRoles.includes('admin');
};

class RecordController {
  async create(req, res) {
    try {
      if (!isDentistOrAbove(req.user)) {
        return res.status(403).json({ 
          success: false,
          message: "Từ chối quyền: chỉ nha sĩ, quản lý hoặc quản trị viên mới được phép tạo hồ sơ" 
        });
      }

      const recordData = {
        ...req.body,
        createdBy: req.user.id
      };

      const record = await recordService.createRecord(recordData);
      res.status(201).json({
        success: true,
        message: 'Hồ sơ đã được tạo thành công',
        data: record
      });
    } catch (error) {
      res.status(400).json({ 
        success: false,
        message: error.message 
      });
    }
  }

  async getAll(req, res) {
    try {
      const filters = {
        patientId: req.query.patientId,
        dentistId: req.query.dentistId,
        status: req.query.status,
        type: req.query.type,
        dateFrom: req.query.dateFrom,
        dateTo: req.query.dateTo,
        search: req.query.search
      };

      // 🔒 Lọc theo activeRole (vai trò được chọn khi đăng nhập)
      const activeRole = req.user?.activeRole || req.user?.role; // Sử dụng activeRole nếu có
      const userRoles = req.user?.roles || [req.user?.role]; // Tất cả vai trò để kiểm tra admin/manager
      const userId = req.user?.userId || req.user?._id;

      // Debug logs commented out for cleaner output
      // console.log('🔍 [DEBUG] req.user:', JSON.stringify(req.user, null, 2));

      // ✅ Lọc dựa trên VAI TRÒ HOẠT ĐỘNG (vai trò được chọn khi đăng nhập)
      if (activeRole === 'dentist') {
        // Đăng nhập với tư cách nha sĩ - chỉ xem hồ sơ của mình
        filters.dentistId = userId;
        console.log('🔒 [DENTIST FILTER] Applied - dentistId:', userId);
      } else if (activeRole === 'nurse') {
        // Đăng nhập với tư cách y tá - xem hồ sơ từ các cuộc hẹn của họ
        filters.nurseId = userId;
        console.log('🔒 [NURSE FILTER] Applied - nurseId:', userId);
      } else if (activeRole === 'admin' || activeRole === 'manager') {
        // Đăng nhập với tư cách admin/manager - xem tất cả hồ sơ
        console.log('🔓 [KHONG LOC] User đăng nhập với tư cách admin/manager');
      } else {
        console.log('🔓 [KHONG LOC] Vai trò:', activeRole);
      }

      // Xóa các giá trị undefined
      Object.keys(filters).forEach(key => 
        filters[key] === undefined && delete filters[key]
      );

      // console.log('🔍 [DEBUG] Final filters:', JSON.stringify(filters, null, 2));

      const records = await recordService.getAllRecords(filters);
      
      // console.log('📊 [DEBUG] Records found:', records.length);
      
      res.json({
        success: true,
        data: records,
        total: records.length
      });
    } catch (error) {
      console.error('❌ [ERROR] getAll:', error);
      res.status(500).json({ 
        success: false,
        message: error.message 
      });
    }
  }

  async getById(req, res) {
    try {
      const record = await recordService.getRecordById(req.params.id);
      res.json({
        success: true,
        data: record
      });
    } catch (error) {
      res.status(404).json({ 
        success: false,
        message: error.message 
      });
    }
  }

  async getByCode(req, res) {
    try {
      const record = await recordService.getRecordByCode(req.params.code);
      res.json({
        success: true,
        data: record
      });
    } catch (error) {
      res.status(404).json({ 
        success: false,
        message: error.message 
      });
    }
  }

  async update(req, res) {
    try {
      if (!isDentistOrAbove(req.user)) {
        return res.status(403).json({ 
          success: false,
          message: "Từ chối quyền: chỉ nha sĩ, quản lý hoặc quản trị viên mới được phép cập nhật hồ sơ" 
        });
      }

      const record = await recordService.updateRecord(req.params.id, req.body, req.user.id);
      res.json({
        success: true,
        message: 'Hồ sơ đã được cập nhật thành công',
        data: record
      });
    } catch (error) {
      res.status(400).json({ 
        success: false,
        message: error.message 
      });
    }
  }

  async updateStatus(req, res) {
    try {
      if (!isDentistOrAbove(req.user)) {
        return res.status(403).json({ 
          success: false,
          message: "Từ chối quyền: chỉ nha sĩ, quản lý hoặc quản trị viên mới được phép cập nhật trạng thái" 
        });
      }

      const { status } = req.body;
      const record = await recordService.updateRecordStatus(req.params.id, status, req.user.id);
      res.json({
        success: true,
        message: 'Trạng thái hồ sơ đã được cập nhật thành công',
        data: record
      });
    } catch (error) {
      res.status(400).json({ 
        success: false,
        message: error.message 
      });
    }
  }

  async delete(req, res) {
    try {
      if (!isManagerOrAdmin(req.user)) {
        return res.status(403).json({ 
          success: false,
          message: "Từ chối quyền: chỉ quản lý hoặc quản trị viên mới được phép xóa hồ sơ" 
        });
      }

      const result = await recordService.deleteRecord(req.params.id);
      res.json({
        success: true,
        message: result.message
      });
    } catch (error) {
      res.status(400).json({ 
        success: false,
        message: error.message 
      });
    }
  }

  async getByPatient(req, res) {
    try {
      const { patientId } = req.params;
      const limit = parseInt(req.query.limit) || 10;
      
      // console.log('🔍 [DEBUG] getByPatient - patientId:', patientId, 'limit:', limit);
      
      const records = await recordService.getRecordsByPatient(patientId, limit);
      
      // console.log('🔍 [DEBUG] getByPatient - Found records:', records.length);
      
      res.json({
        success: true,
        data: records,
        total: records.length
      });
    } catch (error) {
      console.error('❌ [getByPatient] Error:', error);
      res.status(400).json({ 
        success: false,
        message: error.message 
      });
    }
  }

  async getByDentist(req, res) {
    try {
      const { dentistId } = req.params;
      const { startDate, endDate } = req.query;
      
      const records = await recordService.getRecordsByDentist(dentistId, startDate, endDate);
      res.json({
        success: true,
        data: records,
        total: records.length
      });
    } catch (error) {
      res.status(400).json({ 
        success: false,
        message: error.message 
      });
    }
  }

  async getPending(req, res) {
    try {
      const records = await recordService.getPendingRecords();
      res.json({
        success: true,
        data: records,
        total: records.length
      });
    } catch (error) {
      res.status(500).json({ 
        success: false,
        message: error.message 
      });
    }
  }

  async addPrescription(req, res) {
    try {
      if (!isDentistOrAbove(req.user)) {
        return res.status(403).json({ 
          success: false,
          message: "Từ chối quyền: chỉ nha sĩ, quản lý hoặc quản trị viên mới được phép kê đơn thuốc" 
        });
      }

      const { prescription } = req.body;
      const record = await recordService.addPrescription(req.params.id, prescription, req.user.id);
      res.json({
        success: true,
        message: 'Đơn thuốc đã được thêm thành công',
        data: record
      });
    } catch (error) {
      res.status(400).json({ 
        success: false,
        message: error.message 
      });
    }
  }

  async updateTreatmentIndication(req, res) {
    try {
      if (!isDentistOrAbove(req.user)) {
        return res.status(403).json({ 
          success: false,
          message: "Từ chối quyền: chỉ nha sĩ, quản lý hoặc quản trị viên mới được phép cập nhật chỉ định điều trị" 
        });
      }

      const { indicationId } = req.params;
      const { used, notes } = req.body;
      
      const record = await recordService.updateTreatmentIndication(
        req.params.id, 
        indicationId, 
        used, 
        notes, 
        req.user.id
      );
      
      res.json({
        success: true,
        message: 'Chỉ định điều trị đã được cập nhật thành công',
        data: record
      });
    } catch (error) {
      res.status(400).json({ 
        success: false,
        message: error.message 
      });
    }
  }

  async complete(req, res) {
    try {
      if (!isDentistOrAbove(req.user)) {
        return res.status(403).json({ 
          success: false,
          message: "Từ chối quyền: chỉ nha sĩ, quản lý hoặc quản trị viên mới được phép hoàn thành hồ sơ" 
        });
      }

      const record = await recordService.completeRecord(req.params.id, req.user.id);
      res.json({
        success: true,
        message: 'Hồ sơ đã được hoàn thành',
        data: record
      });
    } catch (error) {
      res.status(400).json({ 
        success: false,
        message: error.message 
      });
    }
  }

  async search(req, res) {
    try {
      const { q } = req.query;
      const records = await recordService.searchRecords(q || "");
      res.json({
        success: true,
        data: records,
        total: records.length
      });
    } catch (error) {
      res.status(500).json({ 
        success: false,
        message: error.message 
      });
    }
  }

  async getStatistics(req, res) {
    try {
      const { startDate, endDate } = req.query;
      const stats = await recordService.getStatistics(startDate, endDate);
      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      res.status(500).json({ 
        success: false,
        message: error.message 
      });
    }
  }

  // ✅ Lấy các dịch vụ chưa sử dụng từ hồ sơ khám (để chọn dịch vụ khi đặt lịch)
  async getUnusedServices(req, res) {
    try {
      const { patientId } = req.params;
      const services = await recordService.getUnusedServices(patientId);
      res.json({
        success: true,
        data: services,
        total: services.length
      });
    } catch (error) {
      res.status(500).json({ 
        success: false,
        message: error.message 
      });
    }
  }

  // 🆕 Lấy chỉ định điều trị cho bệnh nhân và dịch vụ
  async getTreatmentIndications(req, res) {
    try {
      const { patientId } = req.params;
      const { serviceId } = req.query;
      
      if (!serviceId) {
        return res.status(400).json({
          success: false,
          message: 'serviceId là bắt buộc'
        });
      }

      const indications = await recordService.getTreatmentIndications(patientId, serviceId);
      res.json({
        success: true,
        data: indications,
        total: indications.length
      });
    } catch (error) {
      res.status(500).json({ 
        success: false,
        message: error.message 
      });
    }
  }

  // ⭐ Thêm dịch vụ bổ sung vào hồ sơ
  async addAdditionalService(req, res) {
    try {
      if (!isDentistOrAbove(req.user)) {
        return res.status(403).json({ 
          success: false,
          message: "Từ chối quyền: chỉ nha sĩ, quản lý hoặc quản trị viên mới được phép thêm dịch vụ" 
        });
      }

      const { id } = req.params;
      const serviceData = req.body;
      const addedBy = req.user.id;

      const record = await recordService.addAdditionalService(id, serviceData, addedBy);
      
      res.json({
        success: true,
        message: 'Đã thêm dịch vụ vào hồ sơ',
        data: record
      });
    } catch (error) {
      res.status(400).json({ 
        success: false,
        message: error.message 
      });
    }
  }

  // ⭐ Xóa dịch vụ bổ sung khỏi hồ sơ
  async removeAdditionalService(req, res) {
    try {
      if (!isDentistOrAbove(req.user)) {
        return res.status(403).json({ 
          success: false,
          message: "Từ chối quyền: chỉ nha sĩ, quản lý hoặc quản trị viên mới được phép xóa dịch vụ" 
        });
      }

      const { id, serviceItemId } = req.params;
      const removedBy = req.user.id;

      const record = await recordService.removeAdditionalService(id, serviceItemId, removedBy);
      
      res.json({
        success: true,
        message: 'Đã xóa dịch vụ khỏi hồ sơ',
        data: record
      });
    } catch (error) {
      res.status(400).json({ 
        success: false,
        message: error.message 
      });
    }
  }

  // ⭐ Cập nhật dịch vụ bổ sung (số lượng/ghi chú)
  async updateAdditionalService(req, res) {
    try {
      if (!isDentistOrAbove(req.user)) {
        return res.status(403).json({ 
          success: false,
          message: "Từ chối quyền: chỉ nha sĩ, quản lý hoặc quản trị viên mới được phép cập nhật dịch vụ" 
        });
      }

      const { id, serviceItemId } = req.params;
      const updateData = req.body;
      const updatedBy = req.user.id;

      const record = await recordService.updateAdditionalService(id, serviceItemId, updateData, updatedBy);
      
      res.json({
        success: true,
        message: 'Đã cập nhật dịch vụ',
        data: record
      });
    } catch (error) {
      res.status(400).json({ 
        success: false,
        message: error.message 
      });
    }
  }

  /**
   * Lấy thông tin thanh toán cho hồ sơ (xem trước khi hoàn thành)
   * Lấy dữ liệu cuộc hẹn và hóa đơn để tính tiền cọc
   */
  async getPaymentInfo(req, res) {
    try {
      const { id } = req.params; // ✅ Đã đổi từ recordId thành id
      // console.log(`🔍 [getPaymentInfo] Fetching payment info for record: ${id}`);

      const paymentInfo = await recordService.getPaymentInfo(id);
      
      res.json({
        success: true,
        message: 'Lấy thông tin thanh toán thành công',
        data: paymentInfo
      });
    } catch (error) {
      console.error('❌ [getPaymentInfo] Error:', error);
      res.status(400).json({ 
        success: false,
        message: error.message 
      });
    }
  }

  /**
   * 🆕 Lấy bệnh nhân có chỉ định chưa sử dụng cho một nha sĩ cụ thể
   * Dùng cho cuộc hẹn walk-in - nha sĩ chỉ có thể xem bệnh nhân của mình
   */
  async getPatientsWithUnusedIndications(req, res) {
    try {
      const { dentistId } = req.params;
      console.log(`🔍 [getPatientsWithUnusedIndications] Fetching patients for dentist: ${dentistId}`);

      const patients = await recordService.getPatientsWithUnusedIndications(dentistId);
      
      res.json({
        success: true,
        message: 'Lấy danh sách bệnh nhân thành công',
        data: patients
      });
    } catch (error) {
      console.error('❌ [getPatientsWithUnusedIndications] Error:', error);
      res.status(400).json({ 
        success: false,
        message: error.message 
      });
    }
  }
}

module.exports = new RecordController();
