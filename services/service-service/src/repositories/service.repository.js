const Service = require('../models/service.model');

// ===== SERVICE OPERATIONS =====
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

exports.deleteService = async (serviceId) => {
  return await Service.findByIdAndDelete(serviceId);
};

exports.findById = async (serviceId) => {
  return await Service.findById(serviceId);
};

exports.findByName = async (name) => {
  return await Service.findOne({ name: name.trim() });
};

// ===== LIST AND SEARCH =====
exports.listServices = async (skip = 0, limit = 10) => {
  return await Service.find()
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);
};

exports.countServices = async () => {
  return await Service.countDocuments();
};

exports.searchService = async (keyword, skip = 0, limit = 10) => {
  return await Service.find({
    $or: [
      { name: { $regex: keyword, $options: 'i' } },
      { description: { $regex: keyword, $options: 'i' } }
    ]
  })
    .skip(skip)
    .limit(limit);
};

exports.countSearchService = async (keyword) => {
  return await Service.countDocuments({
    $or: [
      { name: { $regex: keyword, $options: 'i' } },
      { description: { $regex: keyword, $options: 'i' } }
    ]
  });
};

// ===== SERVICE ADD-ON OPERATIONS =====
exports.addServiceAddOn = async (serviceId, addOnData) => {
  const service = await Service.findById(serviceId);
  if (!service) throw new Error('Service not found');
  
  service.serviceAddOns.push(addOnData);
  return await service.save();
};

exports.updateServiceAddOn = async (serviceId, addOnId, updateData) => {
  const service = await Service.findById(serviceId);
  if (!service) throw new Error('Service not found');
  
  const addOn = service.serviceAddOns.id(addOnId);
  if (!addOn) throw new Error('ServiceAddOn not found');
  
  Object.assign(addOn, updateData);
  return await service.save();
};

exports.toggleServiceAddOnStatus = async (serviceId, addOnId) => {
  const service = await Service.findById(serviceId);
  if (!service) throw new Error('Service not found');
  
  const addOn = service.serviceAddOns.id(addOnId);
  if (!addOn) throw new Error('ServiceAddOn not found');
  
  addOn.isActive = !addOn.isActive;
  return await service.save();
};

exports.deleteServiceAddOn = async (serviceId, addOnId) => {
  return await Service.findByIdAndUpdate(
    serviceId,
    { $pull: { serviceAddOns: { _id: addOnId } } },
    { new: true, runValidators: true }
  );
};

exports.findServiceAddOnById = async (serviceId, addOnId) => {
  const service = await Service.findById(serviceId);
  if (!service) throw new Error('Service not found');
  
  const addOn = service.serviceAddOns.id(addOnId);
  if (!addOn) throw new Error('ServiceAddOn not found');
  
  return { service, addOn };
};

// 🔄 Update hasBeenUsed when service/serviceAddOn is used in appointment
exports.markServiceAsUsed = async (serviceId) => {
  return await Service.findByIdAndUpdate(
    serviceId,
    { hasBeenUsed: true },
    { new: true }
  );
};

/**
 * Mark multiple services as used
 * @param {Array} serviceIds - Array of service IDs
 * @returns {Object} Update result
 */
exports.markServicesAsUsed = async (serviceIds) => {
  return await Service.updateMany(
    { _id: { $in: serviceIds } },
    { $set: { hasBeenUsed: true } }
  );
};

exports.markServiceAddOnAsUsed = async (serviceId, addOnId) => {
  return await Service.findOneAndUpdate(
    { 
      _id: serviceId,
      'serviceAddOns._id': addOnId 
    },
    { 
      $set: {
        'serviceAddOns.$.hasBeenUsed': true,
        hasBeenUsed: true // mark parent service as used too
      }
    },
    { new: true }
  );
};

