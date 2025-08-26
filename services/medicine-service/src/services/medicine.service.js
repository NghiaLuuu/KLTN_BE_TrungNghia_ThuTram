const medicineRepo = require("../repositories/medicine.repository");

class MedicineService {
  async addMedicine(data) {
    return await medicineRepo.create(data);
  }

  async listMedicines() {
    return await medicineRepo.findAll();
  }

  async searchMedicine(query) {
    return await medicineRepo.findAll({ name: new RegExp(query, "i") });
  }

  async updateMedicine(id, data) {
    return await medicineRepo.update(id, data);
  }


}

module.exports = new MedicineService();
