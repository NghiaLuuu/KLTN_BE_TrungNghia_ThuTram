const scheduleService = require('../services/schedule.service');

const isManagerOrAdmin = (user) => {
  return user && (user.role === 'manager' || user.role === 'admin');
};

exports.createSchedule = async (req, res) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ message: 'Permission denied: manager or admin only' });
  }
  try {
    const schedule = await scheduleService.createSchedule(req.body);
    res.status(201).json(schedule);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.updateSchedule = async (req, res) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ message: 'Permission denied: manager or admin only' });
  }
  try {
    const schedule = await scheduleService.updateSchedule(req.params.id, req.body);
    res.json(schedule);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.toggleStatus = async (req, res) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ message: 'Permission denied: manager or admin only' });
  }
  try {
    const schedule = await scheduleService.toggleStatus(req.params.id);
    res.json(schedule);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.createSlotsForSubRoom = async (req, res) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ message: 'Permission denied: manager or admin only' });
  }
  try {
    const { scheduleId, subRoomId } = req.params;
    const { shiftIds, slotDuration, startDate, endDate } = req.body;

    const result = await scheduleService.createSlotsForSubRoom(
      scheduleId,
      subRoomId,
      { shiftIds, slotDuration, startDate, endDate }
    );

    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};