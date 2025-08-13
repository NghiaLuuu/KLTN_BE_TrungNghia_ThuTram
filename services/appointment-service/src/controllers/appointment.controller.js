// controllers/appointment.controller.js
const appointmentService = require('../services/appointment.service');

// Tạo hold
exports.createHold = async (req, res) => {
  try {
    const userIdFromToken = req.user.userId; 
    const data = req.body;

    const result = await appointmentService.createHold(data, userIdFromToken);

    res.status(200).json(result);
  } catch (err) {
    console.error(err);
    res.status(400).json({ message: err.message });
  }
};

exports.confirm = async (req, res) => {
  try {
    const appointment = await appointmentService.confirm(req.params.slotId);
    res.json(appointment);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.cancelHold = async (req, res) => {
  try {
    const result = await appointmentService.cancelHold(req.params.slotId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.update = async (req, res) => {
  try {
    const updated = await appointmentService.update(req.params.id, req.body);
    res.status(200).json(updated);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.checkIn = async (req, res) => {
  try {
    const appointment = await appointmentService.checkIn(req.params.id);
    res.json(appointment);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.complete = async (req, res) => {
  try {
    const appointment = await appointmentService.complete(req.params.id);
    res.json(appointment);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.search = async (req, res) => {
  try {
    const appointments = await appointmentService.search(req.query);
    res.json(appointments);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};
