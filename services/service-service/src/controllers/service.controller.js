const serviceService = require('../services/service.service');
const Service = require('../models/service.model');

const isManagerOrAdmin = (user) => {
  if (!user) return false;
  const userRoles = user.roles || (user.role ? [user.role] : []); // Support both roles array and legacy role
  return userRoles.includes('manager') || userRoles.includes('admin');
};

// ===== SERVICE OPERATIONS =====
exports.createService = async (req, res) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ message: 'Chỉ quản lý hoặc admin mới được phép' });
  }

  try {
    // Parse body data (if multipart/form-data, need to parse JSON fields)
    let serviceData = { ...req.body };
    
    // Parse serviceAddOns if it's a string (from form-data)
    if (typeof serviceData.serviceAddOns === 'string') {
      try {
        serviceData.serviceAddOns = JSON.parse(serviceData.serviceAddOns);
      } catch (e) {
        return res.status(400).json({ message: 'serviceAddOns phải là JSON hợp lệ' });
      }
    }
    
    // Parse allowedRoomTypes if it's a string (from form-data)
    if (typeof serviceData.allowedRoomTypes === 'string') {
      try {
        serviceData.allowedRoomTypes = JSON.parse(serviceData.allowedRoomTypes);
      } catch (e) {
        return res.status(400).json({ message: 'allowedRoomTypes phải là JSON hợp lệ' });
      }
    }
    
    // Extract image files (req.files is array from multer)
    const imageFiles = req.files || [];
    
    const newService = await serviceService.createService(serviceData, imageFiles);
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
      return res.status(404).json({ success: false, message: 'Không tìm thấy dịch vụ' });
    }
    res.json({ success: true, data: service });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Lỗi server' });
  }
};

// ===== LIST AND SEARCH =====
exports.listServices = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const result = await serviceService.listServices(page, limit);
    // Return services array directly in data field for consistency
    res.json({ 
      success: true, 
      data: result.services,
      pagination: {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Lỗi server khi lấy danh sách dịch vụ' });
  }
};

exports.searchService = async (req, res) => {
  try {
    const { q = '', page = 1, limit = 10 } = req.query;
    const result = await serviceService.searchService(q, page, limit);
    // Return services array directly in data field for consistency
    res.json({ 
      success: true, 
      data: result.services,
      pagination: {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Lỗi server khi tìm kiếm dịch vụ' });
  }
};

// ===== SERVICE ADD-ON OPERATIONS =====
exports.addServiceAddOn = async (req, res) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ message: 'Chỉ quản lý hoặc admin mới được phép' });
  }

  try {
    // Extract image file from multer (if provided)
    const imageFile = req.file || null;
    
    // Parse body data (if multipart/form-data, body fields are strings)
    const addOnData = { ...req.body };
    if (addOnData.price) addOnData.price = Number(addOnData.price);
    
    const service = await serviceService.addServiceAddOn(
      req.params.serviceId, 
      addOnData, 
      imageFile
    );
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
    console.log('🔵 [Controller] updateServiceAddOn called');
    console.log('🔵 [Controller] serviceId:', req.params.serviceId, 'addOnId:', req.params.addOnId);
    console.log('🔵 [Controller] req.file:', req.file ? `${req.file.originalname} (${req.file.size} bytes)` : 'null');
    console.log('🔵 [Controller] req.body:', req.body);
    
    // Extract image file from multer (if provided)
    const imageFile = req.file || null;
    
    // Parse body data (if multipart/form-data, body fields are strings)
    const updateData = { ...req.body };
    if (updateData.price) updateData.price = Number(updateData.price);
    
    console.log('🔵 [Controller] Calling service.updateServiceAddOn with imageFile:', imageFile ? 'YES' : 'NO');
    
    const service = await serviceService.updateServiceAddOn(
      req.params.serviceId, 
      req.params.addOnId, 
      updateData,
      imageFile
    );
    
    console.log('✅ [Controller] Update successful');
    res.json(service);
  } catch (err) {
    console.error('❌ [Controller] Error:', err);
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

// ===== SERVICE USAGE TRACKING =====
/**
 * Check if services have been used
 * POST /api/services/check-usage
 * Body: { serviceIds: ['id1', 'id2'] }
 */
exports.checkServiceUsage = async (req, res) => {
  try {
    const { serviceIds } = req.body;
    
    if (!serviceIds || !Array.isArray(serviceIds) || serviceIds.length === 0) {
      return res.status(400).json({ message: 'serviceIds is required and must be an array' });
    }
    
    const result = await serviceService.checkServiceUsage(serviceIds);
    res.json(result);
  } catch (err) {
    res.status(400).json({ message: err.message || 'Error checking service usage' });
  }
};

/**
 * Mark services as used (update hasBeenUsed to true)
 * POST /api/services/mark-as-used
 * Body: { serviceIds: ['id1', 'id2'] }
 */
exports.markServicesAsUsed = async (req, res) => {
  try {
    const { serviceIds, reservationId, paymentId } = req.body;
    
    if (!serviceIds || !Array.isArray(serviceIds) || serviceIds.length === 0) {
      return res.status(400).json({ message: 'serviceIds is required and must be an array' });
    }
    
    const result = await serviceService.markServicesAsUsed(serviceIds, reservationId, paymentId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ message: err.message || 'Error marking services as used' });
  }
};

// Get room types enum
exports.getRoomTypes = async (req, res) => {
  try {
    res.json({
      success: true,
      data: Service.ROOM_TYPES
    });
  } catch (err) {
    res.status(500).json({ 
      success: false,
      message: `Lỗi khi lấy room types: ${err.message}` 
    });
  }
};

// ===== PRICE SCHEDULE OPERATIONS =====

/**
 * Add a price schedule to a ServiceAddOn
 * POST /api/services/:serviceId/addons/:addOnId/price-schedules
 */
exports.addPriceSchedule = async (req, res) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ message: 'Chỉ quản lý hoặc admin mới được phép' });
  }

  try {
    const service = await serviceService.addPriceSchedule(
      req.params.serviceId,
      req.params.addOnId,
      req.body
    );
    res.status(201).json(service);
  } catch (err) {
    res.status(400).json({ message: err.message || 'Không thể thêm lịch giá' });
  }
};

/**
 * Update a price schedule
 * PUT /api/services/:serviceId/addons/:addOnId/price-schedules/:scheduleId
 */
exports.updatePriceSchedule = async (req, res) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ message: 'Chỉ quản lý hoặc admin mới được phép' });
  }

  try {
    const service = await serviceService.updatePriceSchedule(
      req.params.serviceId,
      req.params.addOnId,
      req.params.scheduleId,
      req.body
    );
    res.json(service);
  } catch (err) {
    res.status(400).json({ message: err.message || 'Không thể cập nhật lịch giá' });
  }
};

/**
 * Delete a price schedule
 * DELETE /api/services/:serviceId/addons/:addOnId/price-schedules/:scheduleId
 */
exports.deletePriceSchedule = async (req, res) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ message: 'Chỉ quản lý hoặc admin mới được phép' });
  }

  try {
    await serviceService.deletePriceSchedule(
      req.params.serviceId,
      req.params.addOnId,
      req.params.scheduleId
    );
    res.json({ message: 'Đã xóa lịch giá thành công' });
  } catch (err) {
    res.status(400).json({ message: err.message || 'Không thể xóa lịch giá' });
  }
};

/**
 * Toggle price schedule active status
 * PATCH /api/services/:serviceId/addons/:addOnId/price-schedules/:scheduleId/toggle
 */
exports.togglePriceScheduleStatus = async (req, res) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ message: 'Chỉ quản lý hoặc admin mới được phép' });
  }

  try {
    const service = await serviceService.togglePriceScheduleStatus(
      req.params.serviceId,
      req.params.addOnId,
      req.params.scheduleId
    );
    res.json(service);
  } catch (err) {
    res.status(400).json({ message: err.message || 'Không thể thay đổi trạng thái lịch giá' });
  }
};

/**
 * Update temporary price for Service
 * PUT /api/services/:serviceId/temporary-price
 */
exports.updateTemporaryPrice = async (req, res) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ message: 'Chỉ quản lý hoặc admin mới được phép' });
  }

  try {
    const service = await serviceService.updateTemporaryPrice(
      req.params.serviceId,
      req.body
    );
    res.json(service);
  } catch (err) {
    res.status(400).json({ message: err.message || 'Không thể cập nhật giá tạm thời' });
  }
};

/**
 * Remove temporary price from Service
 * DELETE /api/services/:serviceId/temporary-price
 */
exports.removeTemporaryPrice = async (req, res) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ message: 'Chỉ quản lý hoặc admin mới được phép' });
  }

  try {
    await serviceService.removeTemporaryPrice(req.params.serviceId);
    res.json({ message: 'Đã xóa giá tạm thời thành công' });
  } catch (err) {
    res.status(400).json({ message: err.message || 'Không thể xóa giá tạm thời' });
  }
};
