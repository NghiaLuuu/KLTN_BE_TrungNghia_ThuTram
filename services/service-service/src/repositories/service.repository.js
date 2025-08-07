const Service = require('../models/service.model');

exports.createService = async (data) => {
  const service = new Service(data);
  return await service.save();
};


exports.updateService = async (serviceId, updateData) => {
  return await Service.findByIdAndUpdate(
    serviceId,
    updateData,
    { new: true, runValidators: true }
  );
};

exports.toggleStatus = async (id) => {
  const service = await Service.findById(id);
  if (!service) throw new Error('Service not found');
  service.isActive = !service.isActive;
  return await service.save();
};

exports.listServices = async () => {
  return await Service.find();
};

exports.searchService = async (keyword) => {
  return await Service.find({
    $or: [
      { name: new RegExp(keyword, 'i') },
      { code: new RegExp(keyword, 'i') },
    ],
  });
};
