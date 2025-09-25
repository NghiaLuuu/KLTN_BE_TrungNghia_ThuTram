const recordService = require("../services/record.service");

// Helper function to check permissions
const isDentistOrAbove = (user) => {
  return user && ['dentist', 'manager', 'admin'].includes(user.role);
};

const isManagerOrAdmin = (user) => {
  return user && (user.role === 'manager' || user.role === 'admin');
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

      // Remove undefined values
      Object.keys(filters).forEach(key => 
        filters[key] === undefined && delete filters[key]
      );

      const records = await recordService.getAllRecords(filters);
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
      
      const records = await recordService.getRecordsByPatient(patientId, limit);
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
}

module.exports = new RecordController();
