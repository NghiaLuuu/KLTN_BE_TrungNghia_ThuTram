const prescriptionRepo = require("../repositories/prescription.repository");

class PrescriptionService {
  async createPrescription(data) {
    return await prescriptionRepo.create(data);
  }

  async viewPrescription(id) {
    return await prescriptionRepo.findById(id);
  }

  async searchPrescription(filter) {
    return await prescriptionRepo.findAll(filter);
  }

  async updatePrescription(id, data) {
    return await prescriptionRepo.update(id, data);
  }
}

module.exports = new PrescriptionService();
