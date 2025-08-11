const slotService = require('../services/slot.service');

const isManagerOrAdmin = (user) => {
  return user && (user.role === 'manager' || user.role === 'admin');
};

// Create slot
exports.createSlot = async (req, res) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ message: 'Permission denied: manager or admin only' });
  }

  try {
    const slot = await slotService.createSlot(req.body);
    res.status(201).json({
      success: true,
      message: 'Slot created successfully',
      data: slot
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Set duration
exports.setDuration = async (req, res, next) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ message: 'Permission denied: manager or admin only' });
  }

  try {
    const { id } = req.params;
    const { duration } = req.body;
    const result = await slotService.setDuration(id, duration);
    if (!result) return res.status(404).json({ success: false, message: 'Slot not found' });
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

// Update status
exports.updateStatus = async (req, res, next) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ message: 'Permission denied: manager or admin only' });
  }

  try {
    const { id } = req.params;
    const { status } = req.body;
    const result = await slotService.updateStatus(id, status);
    if (!result) return res.status(404).json({ success: false, message: 'Slot not found' });
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

// Update info
exports.updateInfo = async (req, res, next) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ message: 'Permission denied: manager or admin only' });
  }

  try {
    const { id } = req.params;
    const data = req.body;
    const result = await slotService.updateInfo(id, data);
    if (!result) return res.status(404).json({ success: false, message: 'Slot not found' });
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

// Get all slots (optionally by query params)
exports.getSlots = async (req, res, next) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthorized' });

  try {
    // Có thể thêm filter từ req.query nếu cần, ví dụ theo scheduleId
    const filter = {};
    if (req.query.scheduleId) {
      filter.scheduleId = req.query.scheduleId;
    }
    const slots = await slotService.getSlots(filter);
    res.json({ success: true, data: slots });
  } catch (error) {
    next(error);
  }
};

// Get slot by id
exports.getSlotById = async (req, res, next) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthorized' });

  try {
    const { id } = req.params;
    const slot = await slotService.getSlotById(id);
    if (!slot) return res.status(404).json({ success: false, message: 'Slot not found' });
    res.json({ success: true, data: slot });
  } catch (error) {
    next(error);
  }
};

// Delete slot
exports.deleteSlot = async (req, res, next) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ message: 'Permission denied: manager or admin only' });
  }

  try {
    const { id } = req.params;
    const result = await slotService.deleteSlot(id);
    if (!result) return res.status(404).json({ success: false, message: 'Slot not found or already deleted' });
    res.json({ success: true, message: 'Slot deleted successfully' });
  } catch (error) {
    next(error);
  }
};
