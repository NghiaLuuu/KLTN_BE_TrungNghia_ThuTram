const serviceService = require('../services/service.service');

const isManagerOrAdmin = (user) => {
  return user && (user.role === 'manager' || user.role === 'admin');
};

exports.createService = async (req, res) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ message: 'Chỉ quản lý hoặc admin mới được phép' });
  }

  try {
    const newService = await serviceService.createService(req.body);
    res.status(201).json(newService);
  } catch (err) {
    res.status(400).json({ message: err.message || 'Không thể tạo dịch vụ' });
  }
};

exports.updateService = async (req, res) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ message: 'Chỉ quản lý hoặc admin mới được phép' });
  }

  try {
    const updated = await serviceService.updateService(req.params.id, req.body);
    console.log('Dữ liệu cập nhật:', req.body);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ message: err.message || 'Không thể cập nhật dịch vụ' });
  }
};

exports.toggleStatus = async (req, res) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ message: 'Chỉ quản lý hoặc admin mới được phép' });
  }

  try {
    const toggled = await serviceService.toggleStatus(req.params.id);
    res.json(toggled);
  } catch (err) {
    res.status(404).json({ message: err.message || 'Không tìm thấy dịch vụ' });
  }
};

// ✅ Xem danh sách dịch vụ (có phân trang)
exports.listServices = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const data = await serviceService.listServices(page, limit);
    res.json(data);
  } catch (err) {
    res.status(500).json({ message: err.message || 'Lỗi server khi lấy danh sách dịch vụ' });
  }
};

// ✅ Tìm kiếm dịch vụ (có phân trang)
exports.searchService = async (req, res) => {
  try {
    const { q = '', page = 1, limit = 10 } = req.query;
    const data = await serviceService.searchService(q, page, limit);
    res.json(data);
  } catch (err) {
    res.status(500).json({ message: err.message || 'Lỗi server khi tìm kiếm dịch vụ' });
  }
};
