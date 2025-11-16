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
        { category: { $regex: filters.search, $options: 'i' } }
      ];
    }
    
    // Get total count
    const total = await Medicine.countDocuments(query);
    
    // Build query with pagination
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const skip = filters.skip || (page - 1) * limit;
    
    const data = await Medicine.find(query)
      .sort({ name: 1 })
      .skip(skip)
      .limit(limit);
    
    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    };
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
