const serviceRepo = require('../repositories/service.repository');

exports.createService = async (data) => {
  return await serviceRepo.createService(data);
};

exports.updateService = async (serviceId, data) => {
  return await serviceRepo.updateService(serviceId, data);
};



exports.toggleStatus = async (id) => {
  return await serviceRepo.toggleStatus(id);
};

exports.listServices = async () => {
  return await serviceRepo.listServices();
};

exports.searchService = async (keyword) => {
  return await serviceRepo.searchService(keyword);
};
