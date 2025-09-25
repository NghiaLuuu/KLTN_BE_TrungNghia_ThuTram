// services/service.service.js
const serviceRepo = require('../repositories/service.repository');
const redis = require('../utils/redis.client');

const SERVICE_CACHE_KEY = 'services_cache';

async function initServiceCache() {
  const services = await serviceRepo.listServices();
  await redis.set(SERVICE_CACHE_KEY, JSON.stringify(services));
  console.log(`✅ Đã tải bộ nhớ đệm dịch vụ: ${services.length} dịch vụ`);
}

// ===== SERVICE OPERATIONS =====
exports.createService = async (data) => {
  // Kiểm tra tên trùng lặp trước khi tạo
  const existingService = await serviceRepo.findByName(data.name);
  if (existingService) {
    throw new Error(`Dịch vụ với tên "${data.name}" đã tồn tại`);
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
exports.addServiceAddOn = async (serviceId, addOnData) => {
  const service = await serviceRepo.addServiceAddOn(serviceId, addOnData);
  await refreshServiceCache();
  return service;
};

exports.updateServiceAddOn = async (serviceId, addOnId, updateData) => {
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
  
  await serviceRepo.deleteServiceAddOn(serviceId, addOnId);
  await refreshServiceCache();
  return { message: "Đã xóa dịch vụ bổ sung thành công" };
};

exports.getServiceAddOnById = async (serviceId, addOnId) => {
  return await serviceRepo.findServiceAddOnById(serviceId, addOnId);
};

async function refreshServiceCache() {
  const services = await serviceRepo.listServices();
  await redis.set(SERVICE_CACHE_KEY, JSON.stringify(services));
  console.log(`♻ Đã làm mới bộ nhớ đệm dịch vụ: ${services.length} dịch vụ`);
}

// Load cache ban đầu khi service khởi động
initServiceCache().catch(err => console.error('❌ Không thể tải bộ nhớ đệm dịch vụ:', err));
