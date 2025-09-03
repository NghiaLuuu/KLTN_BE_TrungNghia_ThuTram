// services/service.service.js
const serviceRepo = require('../repositories/service.repository');
const redis = require('../utils/redis.client');

const SERVICE_CACHE_KEY = 'services_cache';

async function initServiceCache() {
  const services = await serviceRepo.listServices();
  await redis.set(SERVICE_CACHE_KEY, JSON.stringify(services));
  console.log(`✅ Đã tải bộ nhớ đệm dịch vụ: ${services.length} dịch vụ`);
}

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

// ✅ Danh sách có phân trang
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

// ✅ Tìm kiếm có phân trang
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

async function refreshServiceCache() {
  const services = await serviceRepo.listServices();
  await redis.set(SERVICE_CACHE_KEY, JSON.stringify(services));
  console.log(`♻ Đã làm mới bộ nhớ đệm dịch vụ: ${services.length} dịch vụ`);
}

// Load cache ban đầu khi service khởi động
initServiceCache().catch(err => console.error('❌ Không thể tải bộ nhớ đệm dịch vụ:', err));
