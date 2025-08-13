// services/service.service.js
const serviceRepo = require('../repositories/service.repository');
const redis = require('../utils/redis.client');

const SERVICE_CACHE_KEY = 'services_cache';

async function initServiceCache() {
  const services = await serviceRepo.listServices();
  await redis.set(SERVICE_CACHE_KEY, JSON.stringify(services));
  console.log(`✅ Service cache loaded: ${services.length} services`);
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

exports.listServices = async () => {
  let cached = await redis.get(SERVICE_CACHE_KEY);
  if (cached) return JSON.parse(cached);

  const services = await serviceRepo.listServices();
  await redis.set(SERVICE_CACHE_KEY, JSON.stringify(services));
  return services;
};

exports.searchService = async (keyword) => {
  const services = await this.listServices(); // lấy từ cache
  return services.filter(service =>
    service.name.toLowerCase().includes(keyword.toLowerCase()) ||
    service.code.toLowerCase().includes(keyword.toLowerCase())
  );
};

async function refreshServiceCache() {
  const services = await serviceRepo.listServices();
  await redis.set(SERVICE_CACHE_KEY, JSON.stringify(services));
  console.log(`♻ Service cache refreshed: ${services.length} services`);
}

// Load cache ban đầu khi service khởi động
initServiceCache().catch(err => console.error('❌ Failed to load service cache:', err));
