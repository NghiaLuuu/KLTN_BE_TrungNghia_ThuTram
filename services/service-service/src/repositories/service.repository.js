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
  // TODO: Kiểm tra service đã được sử dụng trong appointment/record chưa
  // Hiện tại luôn trả về false - không cho xóa
  throw new Error('Không thể xóa dịch vụ - dịch vụ đang được sử dụng hoặc chưa được phép xóa');
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
  // TODO: Kiểm tra serviceAddOn đã được sử dụng chưa
  // Hiện tại luôn trả về false - không cho xóa
  throw new Error('Không thể xóa dịch vụ bổ sung - đang được sử dụng hoặc chưa được phép xóa');
};

exports.findServiceAddOnById = async (serviceId, addOnId) => {
  const service = await Service.findById(serviceId);
  if (!service) throw new Error('Service not found');
  
  const addOn = service.serviceAddOns.id(addOnId);
  if (!addOn) throw new Error('ServiceAddOn not found');
  
  return { service, addOn };
};

