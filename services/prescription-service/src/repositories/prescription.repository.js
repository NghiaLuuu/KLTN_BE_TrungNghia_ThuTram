const Prescription = require("../models/prescription.model");

class PrescriptionRepository {
  async create(data) {
    return await Prescription.create(data);
  }

  async findById(id) {
    return await Prescription.findById(id)
      .populate("patientId doctorId treatmentId medicines.medicineId");
  }

  async findAll(filter = {}) {
    return await Prescription.find(filter)
      .populate("patientId doctorId treatmentId medicines.medicineId");
  }

  async update(id, data) {
    return await Prescription.findByIdAndUpdate(id, data, { new: true })
      .populate("patientId doctorId treatmentId medicines.medicineId");
  }
}

module.exports = new PrescriptionRepository();
