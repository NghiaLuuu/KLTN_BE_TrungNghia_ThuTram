const serviceService = require('../services/service.service');

const isManagerOrAdmin = (user) => {
  return user && (user.role === 'manager' || user.role === 'admin');
};

exports.createService = async (req, res) => {
  console.log('[DEBUG] req.user:', req.user);
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ message: 'Permission denied: manager or admin only' });
  }

  try {
    const newService = await serviceService.createService(req.body);
    res.status(201).json(newService);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.updateService = async (req, res) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ message: 'Permission denied: manager or admin only' });
  }

  try {
    const updated = await serviceService.updateService(req.params.id, req.body);
    console.log('Update Data:', req.body);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.toggleStatus = async (req, res) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ message: 'Permission denied: manager or admin only' });
  }

  try {
    const toggled = await serviceService.toggleStatus(req.params.id);
    res.json(toggled);
  } catch (err) {
    res.status(404).json({ message: err.message });
  }
};

exports.listServices = async (req, res) => {
  try {
    const services = await serviceService.listServices();
    res.json(services);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.searchService = async (req, res) => {
  try {
    const services = await serviceService.searchService(req.query.q || '');
    res.json(services);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
