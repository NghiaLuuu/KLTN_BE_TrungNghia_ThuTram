const medicineService = require("../services/medicine.service");

// Helper function to check permissions
const isManagerOrAdmin = (user) => {
  if (!user) return false;
  const userRoles = user.roles || (user.role ? [user.role] : []); // Support both roles array and legacy role
  return userRoles.includes('manager') || userRoles.includes('admin');
};

class MedicineController {
  async create(req, res) {
    try {
      if (!isManagerOrAdmin(req.user)) {
        return res.status(403).json({ 
          success: false,
          message: "Từ chối quyền: chỉ quản lý hoặc quản trị viên mới được phép tạo thuốc" 
        });
      }

      const medicine = await medicineService.addMedicine(req.body);
      res.status(201).json({
        success: true,
        message: 'Thuốc đã được tạo thành công',
        data: medicine
      });
    } catch (error) {
      res.status(400).json({ 
        success: false,
        message: error.message 
      });
    }
  }

  async list(req, res) {
    try {
      const filters = {
        isActive: req.query.isActive !== undefined ? req.query.isActive === 'true' : undefined,
        category: req.query.category,
        search: req.query.search,
        page: parseInt(req.query.page) || 1,
        limit: parseInt(req.query.limit) || 20
      };

      // Remove undefined values
      Object.keys(filters).forEach(key => 
        filters[key] === undefined && delete filters[key]
      );

      const medicines = await medicineService.listMedicines(filters);
      res.json({
        success: true,
        data: medicines,
        total: medicines.length
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
      const medicine = await medicineService.getMedicineById(req.params.id);
      res.json({
        success: true,
        data: medicine
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
      if (!isManagerOrAdmin(req.user)) {
        return res.status(403).json({ 
          success: false,
          message: "Từ chối quyền: chỉ quản lý hoặc quản trị viên mới được phép cập nhật thuốc" 
        });
      }

      const medicine = await medicineService.updateMedicine(req.params.id, req.body);
      res.json({
        success: true,
        message: 'Thuốc đã được cập nhật thành công',
        data: medicine
      });
    } catch (error) {
      res.status(400).json({ 
        success: false,
        message: error.message 
      });
    }
  }

  async toggleStatus(req, res) {
    try {
      if (!isManagerOrAdmin(req.user)) {
        return res.status(403).json({ 
          success: false,
          message: "Từ chối quyền: chỉ quản lý hoặc quản trị viên mới được phép thay đổi trạng thái thuốc" 
        });
      }

      const medicine = await medicineService.toggleMedicineStatus(req.params.id);
      res.json({
        success: true,
        message: `Thuốc đã được ${medicine.isActive ? 'kích hoạt' : 'vô hiệu hóa'} thành công`,
        data: medicine
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
          message: "Từ chối quyền: chỉ quản lý hoặc quản trị viên mới được phép xóa thuốc" 
        });
      }

      const result = await medicineService.deleteMedicine(req.params.id);
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

  async search(req, res) {
    try {
      const { q, page = 1, limit = 20 } = req.query;
      const medicines = await medicineService.searchMedicine(q || "", { page: parseInt(page), limit: parseInt(limit) });
      res.json({
        success: true,
        data: medicines,
        total: medicines.length
      });
    } catch (error) {
      res.status(500).json({ 
        success: false,
        message: error.message 
      });
    }
  }
}

module.exports = new MedicineController();
