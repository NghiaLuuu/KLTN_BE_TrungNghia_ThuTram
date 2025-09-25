const Medicine = require("../models/medicine.model");

class MedicineRepository {
  async create(data) {
    return await Medicine.create(data);
  }

  async findById(id) {
    return await Medicine.findById(id);
  }

  async findAll(filters = {}) {
    const query = {};
    
    if (filters.isActive !== undefined) {
      query.isActive = filters.isActive;
    }
    
    if (filters.category) {
      query.category = filters.category;
    }
    
    if (filters.search) {
      query.$or = [
        { name: { $regex: filters.search, $options: 'i' } },
        { ingredient: { $regex: filters.search, $options: 'i' } },
        { description: { $regex: filters.search, $options: 'i' } }
      ];
    }
    
    let queryBuilder = Medicine.find(query).sort({ name: 1 });
    
    if (filters.skip) {
      queryBuilder = queryBuilder.skip(filters.skip);
    }
    
    if (filters.limit) {
      queryBuilder = queryBuilder.limit(filters.limit);
    }
    
    return await queryBuilder;
  }

  async update(id, data) {
    return await Medicine.findByIdAndUpdate(id, data, { new: true, runValidators: true });
  }

  async toggleStatus(id) {
    const medicine = await Medicine.findById(id);
    if (!medicine) {
      throw new Error('Medicine not found');
    }
    
    medicine.isActive = !medicine.isActive;
    return await medicine.save();
  }

  async delete(id) {
    const medicine = await Medicine.findById(id);
    if (!medicine) {
      throw new Error('Medicine not found');
    }

    // Check if medicine has been used
    if (medicine.hasBeenUsed) {
      throw new Error('Không thể xóa thuốc đã được sử dụng trong đơn thuốc');
    }

    return await Medicine.findByIdAndDelete(id);
  }


}

module.exports = new MedicineRepository();
