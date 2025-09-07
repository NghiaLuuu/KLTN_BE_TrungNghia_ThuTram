// repositories/appointment.repository.js
const Appointment = require('../models/appointment.model');

exports.create = (data) => Appointment.create(data);

exports.findById = (id) => Appointment.findById(id); // bỏ populate

exports.updateById = (id, update) =>
  Appointment.findByIdAndUpdate(id, update, { new: true });

exports.search = (filter) => Appointment.find(filter); // bỏ populate

exports.findBySlot = (scheduleId, slotId) =>
  Appointment.findOne({ scheduleId, slotId });
