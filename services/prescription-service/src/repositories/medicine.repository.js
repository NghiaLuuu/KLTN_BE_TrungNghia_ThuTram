const Medicine = require("../models/medicine.model");

class MedicineRepository {
  async create(data) {
    return await Medicine.create(data);
  }

  async findById(id) {
    return await Medicine.findById(id);
  }

  async findAll(filter = {}) {
    return await Medicine.find(filter);
  }

  async update(id, data) {
    return await Medicine.findByIdAndUpdate(id, data, { new: true });
  }


}

module.exports = new MedicineRepository();
