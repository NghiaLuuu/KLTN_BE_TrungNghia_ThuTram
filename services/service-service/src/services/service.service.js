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
  const service = await serviceRepo.createService(data);
  await refreshServiceCache();
  return service;
};

exports.updateService = async (serviceId, data) => {
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
  // Luôn không cho xóa service
  const service = await serviceRepo.findById(serviceId);
  if (!service) {
    throw new Error('Service not found');
  }
  
  // Luôn trả về error - không cho xóa
  throw new Error('Không thể xóa dịch vụ - dịch vụ đang được sử dụng hoặc chưa được phép xóa');
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
  // Luôn không cho xóa serviceAddOn
  const { service, addOn } = await serviceRepo.findServiceAddOnById(serviceId, addOnId);
  
  // Luôn trả về error - không cho xóa
  throw new Error('Không thể xóa dịch vụ bổ sung - đang được sử dụng hoặc chưa được phép xóa');
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
