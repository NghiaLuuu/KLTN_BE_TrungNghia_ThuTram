const shiftService = require('../services/shift.service');

const isManagerOrAdmin = (user) => {
  return user && (user.role === 'manager' || user.role === 'admin');
};

exports.createShift = async (req, res) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ message: 'Permission denied: manager or admin only' });
  }

  try {
    const newShift = await shiftService.createShift(req.body);
    res.status(201).json(newShift);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.updateShift = async (req, res) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ message: 'Permission denied: manager or admin only' });
  }

  try {
    const updated = await shiftService.updateShift(req.params.id, req.body);
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
    const toggled = await shiftService.toggleStatus(req.params.id);
    res.json(toggled);
  } catch (err) {
    res.status(404).json({ message: err.message });
  }
};

exports.listShifts = async (req, res) => {
  try {
    const shifts = await shiftService.listShifts();
    res.json(shifts);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.searchShift = async (req, res) => {
  try {
    const shifts = await shiftService.searchShift(req.query.q || '');
    res.json(shifts);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
