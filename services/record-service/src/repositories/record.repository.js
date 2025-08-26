const Record = require("../models/record.model");

exports.create = (data) => Record.create(data);
exports.findById = (id) =>
  Record.findById(id).populate("patientId dentistId serviceId prescription.medicines.medicineId");
exports.update = (id, data) =>
  Record.findByIdAndUpdate(id, data, { new: true });
exports.search = (filter) =>
  Record.find(filter).populate("patientId dentistId serviceId prescription.medicines.medicineId");
