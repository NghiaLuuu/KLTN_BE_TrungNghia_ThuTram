// repositories/appointment.repository.js
const Appointment = require('../models/appointment.model');

exports.create = (data) => Appointment.create(data);

exports.findById = (id) => Appointment.findById(id)
  .populate('patientId', 'fullName phone')
  .populate('serviceId', 'name type duration price')
  .populate('preferredDentistId', 'fullName')
  .populate('scheduleId')
  .populate('slotId');

exports.updateById = (id, update) =>
  Appointment.findByIdAndUpdate(id, update, { new: true });

exports.search = (filter) => Appointment.find(filter)
  .populate('patientId', 'fullName phone')
  .populate('serviceId', 'name type')
  .populate('preferredDentistId', 'fullName')
  .populate('scheduleId')
  .populate('slotId');

exports.findBySlot = (scheduleId, slotId) =>
  Appointment.findOne({ scheduleId, slotId });
