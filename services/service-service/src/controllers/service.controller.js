const serviceService = require('../services/service.service');

const isManagerOrAdmin = (user) => {
  return user && (user.role === 'manager' || user.role === 'admin');
};

// ===== SERVICE OPERATIONS =====
exports.createService = async (req, res) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ message: 'Chỉ quản lý hoặc admin mới được phép' });
  }

  try {
    const newService = await serviceService.createService(req.body);
    res.status(201).json(newService);
  } catch (err) {
    // Handle duplicate name error
    if (err.message.includes('đã tồn tại')) {
      return res.status(400).json({ message: err.message });
    }
    // Handle MongoDB duplicate key error
    if (err.code === 11000) {
      return res.status(400).json({ 
        message: 'Tên dịch vụ đã tồn tại, vui lòng chọn tên khác' 
      });
    }
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
    // Handle duplicate name error
    if (err.message.includes('đã tồn tại')) {
      return res.status(400).json({ message: err.message });
    }
    // Handle MongoDB duplicate key error
    if (err.code === 11000) {
      return res.status(400).json({ 
        message: 'Tên dịch vụ đã tồn tại, vui lòng chọn tên khác' 
      });
    }
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

exports.deleteService = async (req, res) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ message: 'Chỉ quản lý hoặc admin mới được phép' });
  }

  try {
    await serviceService.deleteService(req.params.id);
    res.json({ message: 'Xóa dịch vụ thành công' });
  } catch (err) {
    res.status(400).json({ message: err.message || 'Không thể xóa dịch vụ' });
  }
};

exports.getServiceById = async (req, res) => {
  try {
    const service = await serviceService.getServiceById(req.params.id);
    if (!service) {
      return res.status(404).json({ message: 'Không tìm thấy dịch vụ' });
    }
    res.json(service);
  } catch (err) {
    res.status(500).json({ message: err.message || 'Lỗi server' });
  }
};

// ===== LIST AND SEARCH =====
exports.listServices = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const data = await serviceService.listServices(page, limit);
    res.json(data);
  } catch (err) {
    res.status(500).json({ message: err.message || 'Lỗi server khi lấy danh sách dịch vụ' });
  }
};

exports.searchService = async (req, res) => {
  try {
    const { q = '', page = 1, limit = 10 } = req.query;
    const data = await serviceService.searchService(q, page, limit);
    res.json(data);
  } catch (err) {
    res.status(500).json({ message: err.message || 'Lỗi server khi tìm kiếm dịch vụ' });
  }
};

// ===== SERVICE ADD-ON OPERATIONS =====
exports.addServiceAddOn = async (req, res) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ message: 'Chỉ quản lý hoặc admin mới được phép' });
  }

  try {
    const service = await serviceService.addServiceAddOn(req.params.serviceId, req.body);
    res.status(201).json(service);
  } catch (err) {
    res.status(400).json({ message: err.message || 'Không thể thêm dịch vụ bổ sung' });
  }
};

exports.updateServiceAddOn = async (req, res) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ message: 'Chỉ quản lý hoặc admin mới được phép' });
  }

  try {
    const service = await serviceService.updateServiceAddOn(
      req.params.serviceId, 
      req.params.addOnId, 
      req.body
    );
    res.json(service);
  } catch (err) {
    res.status(400).json({ message: err.message || 'Không thể cập nhật dịch vụ bổ sung' });
  }
};

exports.toggleServiceAddOnStatus = async (req, res) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ message: 'Chỉ quản lý hoặc admin mới được phép' });
  }

  try {
    const service = await serviceService.toggleServiceAddOnStatus(
      req.params.serviceId, 
      req.params.addOnId
    );
    res.json(service);
  } catch (err) {
    res.status(400).json({ message: err.message || 'Không thể thay đổi trạng thái dịch vụ bổ sung' });
  }
};

exports.deleteServiceAddOn = async (req, res) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ message: 'Chỉ quản lý hoặc admin mới được phép' });
  }

  try {
    const service = await serviceService.deleteServiceAddOn(
      req.params.serviceId, 
      req.params.addOnId
    );
    res.json({ message: 'Xóa dịch vụ bổ sung thành công', service });
  } catch (err) {
    res.status(400).json({ message: err.message || 'Không thể xóa dịch vụ bổ sung' });
  }
};

exports.getServiceAddOnById = async (req, res) => {
  try {
    const { service, addOn } = await serviceService.getServiceAddOnById(
      req.params.serviceId, 
      req.params.addOnId
    );
    res.json({ service: service.name, addOn });
  } catch (err) {
    res.status(404).json({ message: err.message || 'Không tìm thấy dịch vụ bổ sung' });
  }
};
