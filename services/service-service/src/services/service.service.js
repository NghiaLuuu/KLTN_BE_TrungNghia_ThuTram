// services/service.service.js
const serviceRepo = require('../repositories/service.repository');
const redis = require('../utils/redis.client');
const { uploadToS3, deleteFromS3 } = require('./s3.service');

const SERVICE_CACHE_KEY = 'services_cache';

async function initServiceCache() {
  // Lấy TẤT CẢ dịch vụ (không giới hạn) để cache
  const services = await serviceRepo.listServices(0, 0); // skip=0, limit=0 = lấy tất cả
  await redis.set(SERVICE_CACHE_KEY, JSON.stringify(services), { EX: 3600 }); // 1h TTL
  console.log(`✅ Đã tải bộ nhớ đệm dịch vụ: ${services.length} dịch vụ (TTL: 1h)`);
}

// ===== SERVICE OPERATIONS =====
exports.createService = async (data, imageFiles = []) => {
  // Kiểm tra tên trùng lặp trước khi tạo
  const existingService = await serviceRepo.findByName(data.name);
  if (existingService) {
    throw new Error(`Dịch vụ với tên "${data.name}" đã tồn tại`);
  }
  
  // Upload ảnh cho các serviceAddOns nếu có
  if (imageFiles.length > 0 && data.serviceAddOns && data.serviceAddOns.length > 0) {
    // imageFiles[i] tương ứng với serviceAddOns[i]
    for (let i = 0; i < data.serviceAddOns.length && i < imageFiles.length; i++) {
      const imageFile = imageFiles[i];
      if (imageFile && imageFile.buffer) {
        try {
          const imageUrl = await uploadToS3(
            imageFile.buffer,
            imageFile.originalname,
            imageFile.mimetype,
            'avatars'
          );
          data.serviceAddOns[i].imageUrl = imageUrl;
        } catch (error) {
          console.error(`❌ Error uploading image for add-on ${i}:`, error);
          // Continue without image for this add-on
        }
      }
    }
  }
  
  const service = await serviceRepo.createService(data);
  await refreshServiceCache();
  return service;
};

exports.updateService = async (serviceId, data) => {
  // Kiểm tra tên trùng lặp nếu đang update name
  if (data.name) {
    const existingService = await serviceRepo.findByName(data.name);
    if (existingService && existingService._id.toString() !== serviceId) {
      throw new Error(`Dịch vụ với tên "${data.name}" đã tồn tại`);
    }
  }
  
  const updated = await serviceRepo.updateService(serviceId, data);
  await refreshServiceCache();
  return updated;
};

exports.toggleStatus = async (serviceId) => {
  const toggled = await serviceRepo.toggleStatus(serviceId);
  await refreshServiceCache();
  return toggled;
};

exports.deleteService = async (serviceId) => {
  const service = await serviceRepo.findById(serviceId);
  if (!service) {
    throw new Error('Service not found');
  }
  
  // 🔹 Kiểm tra service đã được sử dụng chưa
  if (service.hasBeenUsed) {
    throw new Error('Không thể xóa dịch vụ đã được sử dụng trong hệ thống');
  }

  // 🔹 Kiểm tra serviceAddOns đã được sử dụng chưa
  const usedAddOns = service.serviceAddOns.filter(addOn => addOn.hasBeenUsed);
  if (usedAddOns.length > 0) {
    const usedNames = usedAddOns.map(addOn => addOn.name).join(', ');
    throw new Error(`Không thể xóa dịch vụ vì các dịch vụ bổ sung đã được sử dụng: ${usedNames}`);
  }
  
  await serviceRepo.deleteService(serviceId);
  await refreshServiceCache();
  return { message: "Đã xóa dịch vụ thành công" };
};

exports.getServiceById = async (serviceId) => {
  const service = await serviceRepo.findById(serviceId);
  if (!service) return null;
  
  // 🆕 Add effective prices for all serviceAddOns
  const serviceObj = service.toObject();
  serviceObj.hasActiveTemporaryPrice = service.hasActiveTemporaryPrice();
  serviceObj.serviceAddOns = service.getAddOnsWithEffectivePrices();
  
  return serviceObj;
};

// ===== LIST AND SEARCH =====
exports.listServices = async (page = 1, limit = 10) => {
  const skip = (page - 1) * limit;
  const [services, total] = await Promise.all([
    serviceRepo.listServices(skip, limit),
    serviceRepo.countServices()
  ]);

  // 🆕 Add effective prices for all services
  const servicesWithPrices = services.map(service => {
    const serviceObj = service.toObject();
    serviceObj.hasActiveTemporaryPrice = service.hasActiveTemporaryPrice();
    serviceObj.serviceAddOns = service.getAddOnsWithEffectivePrices();
    return serviceObj;
  });

  return {
    total,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(total / limit),
    services: servicesWithPrices
  };
};

exports.searchService = async (keyword, page = 1, limit = 10) => {
  const skip = (page - 1) * limit;
  const [services, total] = await Promise.all([
    serviceRepo.searchService(keyword, skip, limit),
    serviceRepo.countSearchService(keyword)
  ]);

  // 🆕 Add effective prices for all services
  const servicesWithPrices = services.map(service => {
    const serviceObj = service.toObject();
    serviceObj.hasActiveTemporaryPrice = service.hasActiveTemporaryPrice();
    serviceObj.serviceAddOns = service.getAddOnsWithEffectivePrices();
    return serviceObj;
  });

  return {
    total,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(total / limit),
    services: servicesWithPrices
  };
};

// ===== SERVICE ADD-ON OPERATIONS =====
exports.addServiceAddOn = async (serviceId, addOnData, imageFile = null) => {
  // Upload image to S3 if provided
  if (imageFile) {
    try {
      const imageUrl = await uploadToS3(
        imageFile.buffer,
        imageFile.originalname,
        imageFile.mimetype,
        'avatars' // Sử dụng chung folder avatars
      );
      addOnData.imageUrl = imageUrl;
    } catch (error) {
      console.error('❌ Error uploading image to S3:', error);
      throw new Error('Không thể upload ảnh lên S3');
    }
  }
  
  const service = await serviceRepo.addServiceAddOn(serviceId, addOnData);
  await refreshServiceCache();
  return service;
};

exports.updateServiceAddOn = async (serviceId, addOnId, updateData, imageFile = null) => {
  console.log('🔵 [Service] updateServiceAddOn called');
  console.log('🔵 [Service] serviceId:', serviceId, 'addOnId:', addOnId);
  console.log('🔵 [Service] imageFile:', imageFile ? `${imageFile.originalname} (${imageFile.size} bytes)` : 'null');
  console.log('🔵 [Service] updateData:', updateData);
  
  // Upload new image if provided
  if (imageFile) {
    console.log('✅ [Service] Image file detected, uploading to S3...');
    try {
      // Get old image URL to delete later
      const { service, addOn } = await serviceRepo.findServiceAddOnById(serviceId, addOnId);
      const oldImageUrl = addOn.imageUrl;
      console.log('🔵 [Service] Old image URL:', oldImageUrl || 'none');
      
      // Upload new image
      console.log('🔵 [Service] Uploading to S3...');
      const imageUrl = await uploadToS3(
        imageFile.buffer,
        imageFile.originalname,
        imageFile.mimetype,
        'avatars'
      );
      console.log('✅ [Service] Uploaded to S3:', imageUrl);
      updateData.imageUrl = imageUrl;
      
      // Delete old image from S3 if exists
      if (oldImageUrl) {
        console.log('🔵 [Service] Deleting old image from S3...');
        await deleteFromS3(oldImageUrl);
        console.log('✅ [Service] Old image deleted');
      }
    } catch (error) {
      console.error('❌ [Service] Error uploading image to S3:', error);
      throw new Error('Không thể upload ảnh lên S3');
    }
  } else {
    console.log('⚠️ [Service] No image file provided, skipping upload');
  }
  
  console.log('🔵 [Service] Updating addon in database...');
  const service = await serviceRepo.updateServiceAddOn(serviceId, addOnId, updateData);
  console.log('✅ [Service] Addon updated in database');
  
  await refreshServiceCache();
  console.log('✅ [Service] Cache refreshed');
  
  return service;
};

exports.toggleServiceAddOnStatus = async (serviceId, addOnId) => {
  const service = await serviceRepo.toggleServiceAddOnStatus(serviceId, addOnId);
  await refreshServiceCache();
  return service;
};

exports.deleteServiceAddOn = async (serviceId, addOnId) => {
  const { service, addOn } = await serviceRepo.findServiceAddOnById(serviceId, addOnId);
  
  // 🔹 Kiểm tra serviceAddOn đã được sử dụng chưa
  if (addOn.hasBeenUsed) {
    throw new Error('Không thể xóa dịch vụ bổ sung đã được sử dụng trong hệ thống');
  }

  // 🔹 Kiểm tra không được xóa hết serviceAddOns (phải có ít nhất 1)
  if (service.serviceAddOns.length <= 1) {
    throw new Error('Không thể xóa dịch vụ bổ sung cuối cùng. Service phải có ít nhất 1 dịch vụ bổ sung');
  }
  
  // 🔹 Delete image from S3 if exists
  if (addOn.imageUrl) {
    await deleteFromS3(addOn.imageUrl);
  }
  
  await serviceRepo.deleteServiceAddOn(serviceId, addOnId);
  await refreshServiceCache();
  return { message: "Đã xóa dịch vụ bổ sung thành công" };
};

exports.updateAllAddonsDuration = async (serviceId, durationMinutes) => {
  const service = await serviceRepo.getServiceById(serviceId);
  
  if (!service) {
    throw new Error('Không tìm thấy dịch vụ');
  }

  // 🔹 Cập nhật thời gian cho tất cả add-ons
  const updatedService = await serviceRepo.updateAllAddonsDuration(serviceId, durationMinutes);
  
  // 🔹 Refresh cache
  await refreshServiceCache();
  
  return updatedService;
};

exports.getServiceAddOnById = async (serviceId, addOnId) => {
  return await serviceRepo.findServiceAddOnById(serviceId, addOnId);
};

// ===== SERVICE USAGE TRACKING =====
/**
 * Check if services have been used
 * @param {Array} serviceIds - Array of service IDs
 * @returns {Object} { servicesNeedUpdate: [...], allMarked: boolean }
 */
exports.checkServiceUsage = async (serviceIds) => {
  // Get from cache first
  let cachedData = await redis.get(SERVICE_CACHE_KEY);
  let services = [];
  
  if (cachedData) {
    services = JSON.parse(cachedData);
  } else {
    // 🔄 AUTO-REBUILD: Cache miss, load from DB and rebuild cache
    console.warn('⚠️ SERVICE_CACHE_KEY empty - rebuilding...');
    services = await serviceRepo.listServices();
    try {
      await redis.set(SERVICE_CACHE_KEY, JSON.stringify(services), { EX: 3600 });
      console.log(`✅ Rebuilt SERVICE_CACHE_KEY: ${services.length} services`);
    } catch (cacheErr) {
      console.error('❌ Failed to rebuild SERVICE_CACHE_KEY:', cacheErr.message);
    }
  }
  
  // Filter services that need to be marked as used
  const servicesNeedUpdate = serviceIds.filter(id => {
    const service = services.find(s => s._id.toString() === id.toString());
    return service && !service.hasBeenUsed;
  });
  
  return {
    notUsed: servicesNeedUpdate,  // Alias for consistency
    servicesNeedUpdate,  // Keep old name for backward compatibility
    allUsed: servicesNeedUpdate.length === 0,
    allMarked: servicesNeedUpdate.length === 0,
    total: serviceIds.length,
    alreadyUsed: serviceIds.length - servicesNeedUpdate.length,
    alreadyMarked: serviceIds.length - servicesNeedUpdate.length
  };
};

/**
 * Mark services as used (update hasBeenUsed to true)
 * @param {Array} serviceIds - Array of service IDs
 * @param {String} reservationId - Reservation ID for tracking
 * @param {String} paymentId - Payment ID for tracking
 */
exports.markServicesAsUsed = async (serviceIds, reservationId, paymentId) => {
  const result = await serviceRepo.markServicesAsUsed(serviceIds);
  
  // Refresh cache after update
  await refreshServiceCache();
  
  console.log(`✅ Marked ${result.modifiedCount} services as used (Reservation: ${reservationId})`);
  
  return {
    success: true,
    modifiedCount: result.modifiedCount,
    serviceIds,
    reservationId,
    paymentId
  };
};

// ===== PRICE SCHEDULE OPERATIONS =====

/**
 * Add a price schedule to a ServiceAddOn
 */
exports.addPriceSchedule = async (serviceId, addOnId, scheduleData) => {
  const service = await serviceRepo.findById(serviceId);
  if (!service) {
    throw new Error('Không tìm thấy dịch vụ');
  }

  const addOn = service.serviceAddOns.id(addOnId);
  if (!addOn) {
    throw new Error('Không tìm thấy dịch vụ bổ sung');
  }

  // Validate date range
  if (new Date(scheduleData.endDate) <= new Date(scheduleData.startDate)) {
    throw new Error('Ngày kết thúc phải sau ngày bắt đầu');
  }

  // 🆕 Validate start date must be after today
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const startDate = new Date(scheduleData.startDate);
  startDate.setHours(0, 0, 0, 0);
  
  if (startDate <= today) {
    throw new Error('Ngày bắt đầu phải sau ngày hiện tại ít nhất 1 ngày');
  }

  // 🆕 Check for overlapping date ranges with existing priceSchedules
  const newStart = new Date(scheduleData.startDate);
  const newEnd = new Date(scheduleData.endDate);

  for (const existingSchedule of addOn.priceSchedules) {
    const existingStart = new Date(existingSchedule.startDate);
    const existingEnd = new Date(existingSchedule.endDate);

    // Check if ranges overlap
    // Overlap occurs if: newStart <= existingEnd AND newEnd >= existingStart
    if (newStart <= existingEnd && newEnd >= existingStart) {
      throw new Error(
        `Phạm vi ngày bị trùng với lịch giá khác (${existingStart.toLocaleDateString('vi-VN')} - ${existingEnd.toLocaleDateString('vi-VN')}). ` +
        `Vui lòng chọn ngày khác.`
      );
    }
  }

  // Add the schedule
  addOn.priceSchedules.push(scheduleData);
  await service.save();
  await refreshServiceCache();
  
  return service;
};

/**
 * Update a price schedule
 */
exports.updatePriceSchedule = async (serviceId, addOnId, scheduleId, updateData) => {
  const service = await serviceRepo.findById(serviceId);
  if (!service) {
    throw new Error('Không tìm thấy dịch vụ');
  }

  const addOn = service.serviceAddOns.id(addOnId);
  if (!addOn) {
    throw new Error('Không tìm thấy dịch vụ bổ sung');
  }

  const schedule = addOn.priceSchedules.id(scheduleId);
  if (!schedule) {
    throw new Error('Không tìm thấy lịch giá');
  }

  // ✅ Validate: Không cho phép update lịch giá đã kết thúc (quá khứ)
  const now = new Date();
  const currentEndDate = new Date(schedule.endDate);
  currentEndDate.setHours(23, 59, 59, 999); // Set to end of day
  
  if (now > currentEndDate) {
    throw new Error('Không thể chỉnh sửa lịch giá đã kết thúc');
  }

  // Update fields
  if (updateData.price !== undefined) schedule.price = updateData.price;
  if (updateData.startDate !== undefined) schedule.startDate = updateData.startDate;
  if (updateData.endDate !== undefined) schedule.endDate = updateData.endDate;
  if (updateData.isActive !== undefined) schedule.isActive = updateData.isActive;
  if (updateData.note !== undefined) schedule.note = updateData.note;

  // Validate date range if dates were updated
  if (schedule.endDate <= schedule.startDate) {
    throw new Error('Ngày kết thúc phải sau ngày bắt đầu');
  }

  // 🆕 Check for overlapping date ranges with OTHER priceSchedules (exclude current one)
  const newStart = new Date(schedule.startDate);
  const newEnd = new Date(schedule.endDate);

  for (const existingSchedule of addOn.priceSchedules) {
    // Skip the schedule being updated
    if (existingSchedule._id.toString() === scheduleId) continue;

    const existingStart = new Date(existingSchedule.startDate);
    const existingEnd = new Date(existingSchedule.endDate);

    // Check if ranges overlap
    if (newStart <= existingEnd && newEnd >= existingStart) {
      throw new Error(
        `Phạm vi ngày bị trùng với lịch giá khác (${existingStart.toLocaleDateString('vi-VN')} - ${existingEnd.toLocaleDateString('vi-VN')}). ` +
        `Vui lòng chọn ngày khác.`
      );
    }
  }

  await service.save();
  await refreshServiceCache();
  
  return service;
};

/**
 * Delete a price schedule
 */
exports.deletePriceSchedule = async (serviceId, addOnId, scheduleId) => {
  const service = await serviceRepo.findById(serviceId);
  if (!service) {
    throw new Error('Không tìm thấy dịch vụ');
  }

  const addOn = service.serviceAddOns.id(addOnId);
  if (!addOn) {
    throw new Error('Không tìm thấy dịch vụ bổ sung');
  }

  const schedule = addOn.priceSchedules.id(scheduleId);
  if (!schedule) {
    throw new Error('Không tìm thấy lịch giá');
  }

  // ✅ Validate: Không cho phép xóa lịch giá đã kết thúc (quá khứ)
  const now = new Date();
  const endDate = new Date(schedule.endDate);
  endDate.setHours(23, 59, 59, 999); // Set to end of day
  
  if (now > endDate) {
    throw new Error('Không thể xóa lịch giá đã kết thúc');
  }

  // Remove the schedule
  addOn.priceSchedules.pull(scheduleId);
  await service.save();
  await refreshServiceCache();
  
  return { message: 'Đã xóa lịch giá thành công' };
};

/**
 * Toggle price schedule active status
 */
exports.togglePriceScheduleStatus = async (serviceId, addOnId, scheduleId) => {
  const service = await serviceRepo.findById(serviceId);
  if (!service) {
    throw new Error('Không tìm thấy dịch vụ');
  }

  const addOn = service.serviceAddOns.id(addOnId);
  if (!addOn) {
    throw new Error('Không tìm thấy dịch vụ bổ sung');
  }

  const schedule = addOn.priceSchedules.id(scheduleId);
  if (!schedule) {
    throw new Error('Không tìm thấy lịch giá');
  }

  // ✅ Validate: Không cho phép toggle lịch giá đã kết thúc (quá khứ)
  const now = new Date();
  const endDate = new Date(schedule.endDate);
  endDate.setHours(23, 59, 59, 999); // Set to end of day
  
  if (now > endDate) {
    throw new Error('Không thể thay đổi trạng thái lịch giá đã kết thúc');
  }

  schedule.isActive = !schedule.isActive;
  await service.save();
  await refreshServiceCache();
  
  return service;
};

/**
 * Update temporary price for Service
 */
exports.updateTemporaryPrice = async (serviceId, temporaryPriceData) => {
  const service = await serviceRepo.findById(serviceId);
  if (!service) {
    throw new Error('Không tìm thấy dịch vụ');
  }

  // Validate date range if both dates are provided
  if (temporaryPriceData.startDate && temporaryPriceData.endDate) {
    if (new Date(temporaryPriceData.endDate) < new Date(temporaryPriceData.startDate)) {
      throw new Error('Ngày kết thúc phải sau hoặc bằng ngày bắt đầu');
    }
  }

  // Update temporary price fields
  if (temporaryPriceData.temporaryPrice !== undefined) {
    service.temporaryPrice = temporaryPriceData.temporaryPrice;
  }
  if (temporaryPriceData.startDate !== undefined) {
    service.startDate = temporaryPriceData.startDate;
  }
  if (temporaryPriceData.endDate !== undefined) {
    service.endDate = temporaryPriceData.endDate;
  }

  await service.save();
  await refreshServiceCache();
  
  return service;
};

/**
 * Remove temporary price from Service
 */
exports.removeTemporaryPrice = async (serviceId) => {
  const service = await serviceRepo.findById(serviceId);
  if (!service) {
    throw new Error('Không tìm thấy dịch vụ');
  }

  service.temporaryPrice = null;
  service.startDate = null;
  service.endDate = null;
  
  await service.save();
  await refreshServiceCache();
  
  return { message: 'Đã xóa giá tạm thời thành công' };
};

async function refreshServiceCache() {
  // Lấy TẤT CẢ dịch vụ (không giới hạn) để cache
  const services = await serviceRepo.listServices(0, 0); // skip=0, limit=0 = lấy tất cả
  await redis.set(SERVICE_CACHE_KEY, JSON.stringify(services), { EX: 3600 }); // 1h TTL
  console.log(`♻ Đã làm mới bộ nhớ đệm dịch vụ: ${services.length} dịch vụ (TTL: 1h)`);
}

// Export for scheduled warmup
exports.initServiceCache = initServiceCache;

// Load cache ban đầu khi service khởi động
initServiceCache().catch(err => console.error('❌ Không thể tải bộ nhớ đệm dịch vụ:', err));
