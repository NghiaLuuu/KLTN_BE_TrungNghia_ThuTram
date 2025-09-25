const medicineRepo = require("../repositories/medicine.repository");
const redis = require('../utils/redis.client');

const CACHE_TTL = 300; // 5 minutes

class MedicineService {
  async addMedicine(data) {
    // Validate required fields
    if (!data.name || !data.dosage) {
      throw new Error('Tên thuốc và liều dùng là bắt buộc');
    }

    // Check for duplicate name
    const existing = await medicineRepo.findAll({ name: data.name });
    if (existing.length > 0) {
      throw new Error('Tên thuốc đã tồn tại');
    }

    const medicine = await medicineRepo.create(data);
    
    // Clear cache
    try {
      await redis.del('medicines:all');
      await redis.del('medicines:active');
    } catch (error) {
      console.warn('Failed to clear medicine cache:', error.message);
    }

    return medicine;
  }

  async listMedicines(filters = {}) {
    const cacheKey = `medicines:${JSON.stringify(filters)}`;
    
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (error) {
      console.warn('Cache get failed:', error.message);
    }

    const medicines = await medicineRepo.findAll(filters);
    
    try {
      await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(medicines));
    } catch (error) {
      console.warn('Cache set failed:', error.message);
    }

    return medicines;
  }

  async getMedicineById(id) {
    if (!id) {
      throw new Error('Medicine ID is required');
    }

    const medicine = await medicineRepo.findById(id);
    if (!medicine) {
      throw new Error('Không tìm thấy thuốc');
    }

    return medicine;
  }

  async updateMedicine(id, data) {
    if (!id) {
      throw new Error('Medicine ID is required');
    }

    // Check if medicine exists
    const existing = await medicineRepo.findById(id);
    if (!existing) {
      throw new Error('Không tìm thấy thuốc');
    }

    // Check for duplicate name (excluding current medicine)
    if (data.name && data.name !== existing.name) {
      const duplicates = await medicineRepo.findAll({ name: data.name });
      if (duplicates.length > 0) {
        throw new Error('Tên thuốc đã tồn tại');
      }
    }

    const medicine = await medicineRepo.update(id, data);
    
    // Clear cache
    try {
      await redis.del('medicines:*');
    } catch (error) {
      console.warn('Failed to clear medicine cache:', error.message);
    }

    return medicine;
  }

  async toggleMedicineStatus(id) {
    if (!id) {
      throw new Error('Medicine ID is required');
    }

    const medicine = await medicineRepo.toggleStatus(id);
    
    // Clear cache
    try {
      await redis.del('medicines:*');
    } catch (error) {
      console.warn('Failed to clear medicine cache:', error.message);
    }

    return medicine;
  }

  async deleteMedicine(id) {
    if (!id) {
      throw new Error('Medicine ID is required');
    }

    const medicine = await medicineRepo.delete(id);
    
    // Clear cache
    try {
      await redis.del('medicines:*');
    } catch (error) {
      console.warn('Failed to clear medicine cache:', error.message);
    }

    return { message: 'Thuốc đã được xóa thành công' };
  }

  async searchMedicine(query, options = {}) {
    if (!query || query.trim() === '') {
      return [];
    }

    const { page = 1, limit = 20 } = options;
    const skip = (page - 1) * limit;

    return await medicineRepo.findAll({ 
      search: query.trim(),
      isActive: true,
      skip,
      limit
    });
  }
}

module.exports = new MedicineService();
