// services/service.service.js
const serviceRepo = require('../repositories/service.repository');
const redis = require('../utils/redis.client');
const { uploadToS3, deleteFromS3 } = require('./s3.service');

const SERVICE_CACHE_KEY = 'services_cache';

async function initServiceCache() {
  const services = await serviceRepo.listServices();
  await redis.set(SERVICE_CACHE_KEY, JSON.stringify(services));
  console.log(`✅ Đã tải bộ nhớ đệm dịch vụ: ${services.length} dịch vụ`);
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
  return await serviceRepo.findById(serviceId);
};

// ===== LIST AND SEARCH =====
exports.listServices = async (page = 1, limit = 10) => {
  const skip = (page - 1) * limit;
  const [services, total] = await Promise.all([
    serviceRepo.listServices(skip, limit),
    serviceRepo.countServices()
  ]);

  return {
    total,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(total / limit),
    services
  };
};

exports.searchService = async (keyword, page = 1, limit = 10) => {
  const skip = (page - 1) * limit;
  const [services, total] = await Promise.all([
    serviceRepo.searchService(keyword, skip, limit),
    serviceRepo.countSearchService(keyword)
  ]);

  return {
    total,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(total / limit),
    services
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
  // Upload new image if provided
  if (imageFile) {
    try {
      // Get old image URL to delete later
      const { service, addOn } = await serviceRepo.findServiceAddOnById(serviceId, addOnId);
      const oldImageUrl = addOn.imageUrl;
      
      // Upload new image
      const imageUrl = await uploadToS3(
        imageFile.buffer,
        imageFile.originalname,
        imageFile.mimetype,
        'avatars'
      );
      updateData.imageUrl = imageUrl;
      
      // Delete old image from S3 if exists
      if (oldImageUrl) {
        await deleteFromS3(oldImageUrl);
      }
    } catch (error) {
      console.error('❌ Error uploading image to S3:', error);
      throw new Error('Không thể upload ảnh lên S3');
    }
  }
  
  const service = await serviceRepo.updateServiceAddOn(serviceId, addOnId, updateData);
  await refreshServiceCache();
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
  const cachedData = await redis.get(SERVICE_CACHE_KEY);
  let services = [];
  
  if (cachedData) {
    services = JSON.parse(cachedData);
  } else {
    services = await serviceRepo.listServices();
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

async function refreshServiceCache() {
  const services = await serviceRepo.listServices();
  await redis.set(SERVICE_CACHE_KEY, JSON.stringify(services));
  console.log(`♻ Đã làm mới bộ nhớ đệm dịch vụ: ${services.length} dịch vụ`);
}

// Load cache ban đầu khi service khởi động
initServiceCache().catch(err => console.error('❌ Không thể tải bộ nhớ đệm dịch vụ:', err));
