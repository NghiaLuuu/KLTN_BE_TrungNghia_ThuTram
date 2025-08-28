const slotService = require('../services/slot.service');

exports.assignStaff = async (req, res) => {
  try {
    const result = await slotService.assignStaffToSlots(req.body);
    res.status(200).json({
      message: 'Staff assigned successfully',
      data: result
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// GET /slots
exports.getSlots = async (req, res) => {
  try {
    const slots = await slotService.getSlots(req.query); // nhận filter từ query
    res.json(slots);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// GET /slots/:id
exports.getSlotById = async (req, res) => {
  try {
    const slot = await slotService.getSlotById(req.params.id);
    res.json(slot);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
};



