const slotService = require('../services/slot.service');

// ✅ Gán nhân sự vào slot
exports.assignStaff = async (req, res) => {
  try {
    const result = await slotService.assignStaffToSlots(req.body);
    res.status(200).json({
      message: 'Phân công nhân sự thành công',
      data: result
    });
  } catch (error) {
    res.status(400).json({ message: error.message || 'Không thể phân công nhân sự' });
  }
};

// ✅ Lấy danh sách slot (có phân trang + filter)
exports.getSlots = async (req, res) => {
  try {
    const { page = 1, limit = 10, ...filters } = req.query;

    const data = await slotService.getSlots(filters, page, limit);

    res.json(data);
  } catch (err) {
    res.status(400).json({ message: err.message || 'Không thể lấy danh sách slot' });
  }
};

// ✅ Lấy chi tiết slot theo ID
exports.getSlotById = async (req, res) => {
  try {
    const slot = await slotService.getSlotById(req.params.id);
    if (!slot) {
      return res.status(404).json({ message: 'Không tìm thấy slot' });
    }
    res.json(slot);
  } catch (err) {
    res.status(404).json({ message: err.message || 'Không thể lấy thông tin slot' });
  }
};

exports.assignStaffToOneSlot = async (req, res) => {
  try {
    const slotId = req.params.id;
    const { dentistIds = [], nurseIds = [] } = req.body;

    const updatedSlot = await slotService.assignStaffToOneSlot(slotId, dentistIds, nurseIds);

    res.json({
      message: 'Phân công nhân sự thành công cho slot',
      slot: updatedSlot
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};