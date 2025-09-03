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

// ✅ list with pagination
exports.listServices = async (skip = 0, limit = 10) => {
  return await Service.find()
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);
};

exports.countServices = async () => {
  return await Service.countDocuments();
};

// ✅ search by name only (model không có code)
exports.searchService = async (keyword, skip = 0, limit = 10) => {
  return await Service.find({
    name: { $regex: keyword, $options: 'i' }
  })
    .skip(skip)
    .limit(limit);
};

exports.countSearchService = async (keyword) => {
  return await Service.countDocuments({
    name: { $regex: keyword, $options: 'i' }
  });
};