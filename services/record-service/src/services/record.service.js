const recordRepo = require("../repositories/record.repository");
const redis = require('../utils/redis.client');
const { publishToQueue } = require('../utils/rabbitmq.client');

const CACHE_TTL = 300; // 5 minutes

class RecordService {
  async createRecord(data) {
    console.log("📥 Creating record with data:", data);

    const {
      appointmentId,
      patientId,
      patientInfo,
      bookedBy,
      dentistId,
      preferredDentistId,
      serviceId,
      serviceName,
      dentistName,
      type,
      notes,
      createdBy,
      roomId,
      roomName,
      diagnosis,
      indications,
      priority = 'normal'
    } = data;

    // Validate required fields
    if (!serviceId) {
      throw new Error("Service ID là bắt buộc");
    }

    if (!type || !['exam', 'treatment'].includes(type)) {
      throw new Error("Type phải là 'exam' hoặc 'treatment'");
    }

    // Determine patient information
    let finalPatientId = null;
    let finalPatientInfo = null;

    if (patientInfo) {
      const { name, phone, birthYear } = patientInfo;
      if (!name || !phone || !birthYear) {
        throw new Error("patientInfo không hợp lệ (thiếu name, phone hoặc birthYear)");
      }
      finalPatientInfo = patientInfo;
    } else if (bookedBy) {
      finalPatientId = bookedBy;
    } else if (patientId) {
      finalPatientId = patientId;
    } else {
      throw new Error("Cần có patientId hoặc patientInfo");
    }

    // Determine dentist
    const finalDentistId = dentistId || preferredDentistId;
    if (!finalDentistId) {
      throw new Error("dentistId không được để trống");
    }

    // Create record data
    const recordData = {
      appointmentId: appointmentId || null,
      patientId: finalPatientId,
      patientInfo: finalPatientInfo,
      dentistId: finalDentistId,
      dentistName: dentistName || 'Unknown Dentist',
      serviceId,
      serviceName: serviceName || 'Unknown Service',
      type,
      notes: notes || "",
      createdBy: createdBy || finalDentistId,
      roomId,
      roomName,
      diagnosis,
      indications: indications || [],
      priority
    };

    const record = await recordRepo.create(recordData);
    
    // Clear relevant caches
    try {
      await redis.del(`records:dentist:${finalDentistId}`);
      if (finalPatientId) {
        await redis.del(`records:patient:${finalPatientId}`);
      }
      await redis.del('records:pending');
    } catch (error) {
      console.warn('Failed to clear record cache:', error.message);
    }

    console.log("✅ Record created:", record);
    return record;
  }

  async getRecordById(id) {
    if (!id) {
      throw new Error('Record ID is required');
    }

    const record = await recordRepo.findById(id);
    if (!record) {
      throw new Error('Không tìm thấy hồ sơ');
    }

    return record;
  }

  async getRecordByCode(recordCode) {
    if (!recordCode) {
      throw new Error('Record code is required');
    }

    const record = await recordRepo.findByRecordCode(recordCode);
    if (!record) {
      throw new Error('Không tìm thấy hồ sơ với mã này');
    }

    return record;
  }

  async getAllRecords(filters = {}) {
    const cacheKey = `records:list:${JSON.stringify(filters)}`;
    
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (error) {
      console.warn('Cache get failed:', error.message);
    }

    const records = await recordRepo.findAll(filters);
    
    try {
      await redis.setEx(cacheKey, CACHE_TTL, JSON.stringify(records));
    } catch (error) {
      console.warn('Cache set failed:', error.message);
    }

    return records;
  }

  async updateRecord(id, updateData, modifiedBy) {
    if (!id) {
      throw new Error('Record ID is required');
    }

    const existingRecord = await recordRepo.findById(id);
    if (!existingRecord) {
      throw new Error('Không tìm thấy hồ sơ');
    }

    const updatedRecord = await recordRepo.update(id, {
      ...updateData,
      modifiedBy
    });

    // Clear relevant caches
    try {
      await redis.del(`records:list:*`);
      await redis.del(`records:dentist:${existingRecord.dentistId}`);
      if (existingRecord.patientId) {
        await redis.del(`records:patient:${existingRecord.patientId}`);
      }
    } catch (error) {
      console.warn('Failed to clear record cache:', error.message);
    }

    return updatedRecord;
  }

  async updateRecordStatus(id, status, modifiedBy) {
    if (!id) {
      throw new Error('Record ID is required');
    }

    if (!['pending', 'in_progress', 'completed', 'cancelled'].includes(status)) {
      throw new Error('Trạng thái không hợp lệ');
    }

    // Get record first to check appointmentId
    const existingRecord = await recordRepo.findById(id);
    if (!existingRecord) {
      throw new Error('Không tìm thấy hồ sơ');
    }

    // Update record status
    const record = await recordRepo.updateStatus(id, status, modifiedBy);
    
    // Clear caches
    try {
      await redis.del(`records:*`);
    } catch (error) {
      console.warn('Failed to clear record cache:', error.message);
    }

    // 🔥 Publish events and update appointment based on status
    try {
      if (status === 'in_progress') {
        // Emit record.in-progress event
        await publishToQueue('appointment_queue', {
          event: 'record.in-progress',
          data: {
            recordId: record._id.toString(),
            recordCode: record.recordCode,
            appointmentId: record.appointmentId ? record.appointmentId.toString() : null,
            patientId: record.patientId ? record.patientId.toString() : null,
            dentistId: record.dentistId.toString(),
            startedAt: record.startedAt,
            modifiedBy: modifiedBy ? modifiedBy.toString() : null
          }
        });
        console.log(`✅ Published record.in-progress event for record ${record.recordCode}`);
      } else if (status === 'completed') {
        // Emit record.completed event
        await publishToQueue('appointment_queue', {
          event: 'record.completed',
          data: {
            recordId: record._id.toString(),
            recordCode: record.recordCode,
            appointmentId: record.appointmentId ? record.appointmentId.toString() : null,
            patientId: record.patientId ? record.patientId.toString() : null,
            patientInfo: record.patientInfo,
            dentistId: record.dentistId.toString(),
            serviceId: record.serviceId.toString(),
            serviceName: record.serviceName,
            type: record.type, // 'exam' or 'treatment'
            treatmentIndications: record.treatmentIndications || [], // Service addons used
            prescription: record.prescription || null,
            totalCost: record.totalCost || 0,
            completedAt: record.completedAt,
            modifiedBy: modifiedBy ? modifiedBy.toString() : null
          }
        });
        console.log(`✅ Published record.completed event for record ${record.recordCode}`);
      }
    } catch (publishError) {
      console.error('❌ Failed to publish record status event:', publishError);
      // Don't throw - status update already successful
    }

    return record;
  }

  async deleteRecord(id) {
    if (!id) {
      throw new Error('Record ID is required');
    }

    const record = await recordRepo.delete(id);
    
    // Clear caches
    try {
      await redis.del(`records:*`);
    } catch (error) {
      console.warn('Failed to clear record cache:', error.message);
    }

    return { message: 'Hồ sơ đã được xóa thành công' };
  }

  async getRecordsByPatient(patientId, limit = 10) {
    if (!patientId) {
      throw new Error('Patient ID is required');
    }

    const cacheKey = `records:patient:${patientId}:${limit}`;
    
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (error) {
      console.warn('Cache get failed:', error.message);
    }

    const records = await recordRepo.findByPatient(patientId, limit);
    
    try {
      await redis.setEx(cacheKey, CACHE_TTL, JSON.stringify(records));
    } catch (error) {
      console.warn('Cache set failed:', error.message);
    }

    return records;
  }

  async getRecordsByDentist(dentistId, startDate, endDate) {
    if (!dentistId) {
      throw new Error('Dentist ID is required');
    }

    const cacheKey = `records:dentist:${dentistId}:${startDate}:${endDate}`;
    
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (error) {
      console.warn('Cache get failed:', error.message);
    }

    const records = await recordRepo.findByDentist(dentistId, startDate, endDate);
    
    try {
      await redis.setEx(cacheKey, CACHE_TTL, JSON.stringify(records));
    } catch (error) {
      console.warn('Cache set failed:', error.message);
    }

    return records;
  }

  async getPendingRecords() {
    const cacheKey = 'records:pending';
    
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (error) {
      console.warn('Cache get failed:', error.message);
    }

    const records = await recordRepo.findPending();
    
    try {
      await redis.setEx(cacheKey, CACHE_TTL / 2, JSON.stringify(records)); // Shorter cache for pending
    } catch (error) {
      console.warn('Cache set failed:', error.message);
    }

    return records;
  }

  async addPrescription(id, prescription, prescribedBy) {
    if (!id) {
      throw new Error('Record ID is required');
    }

    if (!prescription || !prescription.medicines || prescription.medicines.length === 0) {
      throw new Error('Prescription phải có ít nhất một loại thuốc');
    }

    // Validate medicines
    for (const medicine of prescription.medicines) {
      if (!medicine.medicineId || !medicine.medicineName || !medicine.dosage || !medicine.duration || !medicine.quantity) {
        throw new Error('Thông tin thuốc không đầy đủ');
      }
    }

    const record = await recordRepo.addPrescription(id, prescription, prescribedBy);
    
    // Clear caches
    try {
      await redis.del(`records:*`);
    } catch (error) {
      console.warn('Failed to clear record cache:', error.message);
    }

    return record;
  }

  async updateTreatmentIndication(id, indicationId, used, notes, modifiedBy) {
    if (!id || !indicationId) {
      throw new Error('Record ID and indication ID are required');
    }

    const record = await recordRepo.updateTreatmentIndication(id, indicationId, used, notes, modifiedBy);
    
    // Clear caches
    try {
      await redis.del(`records:*`);
    } catch (error) {
      console.warn('Failed to clear record cache:', error.message);
    }

    return record;
  }

  async getStatistics(startDate, endDate) {
    const cacheKey = `records:stats:${startDate}:${endDate}`;
    
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (error) {
      console.warn('Cache get failed:', error.message);
    }

    const stats = await recordRepo.getStatistics(startDate, endDate);
    
    try {
      await redis.setEx(cacheKey, CACHE_TTL * 2, JSON.stringify(stats)); // Longer cache for stats
    } catch (error) {
      console.warn('Cache set failed:', error.message);
    }

    return stats;
  }

  async completeRecord(id, modifiedBy) {
    return await this.updateRecordStatus(id, 'completed', modifiedBy);
  }

  async searchRecords(query) {
    if (!query || query.trim() === '') {
      return [];
    }

    return await recordRepo.findAll({ search: query.trim() });
  }

  async markAsUsed(id) {
    if (!id) {
      throw new Error('Record ID is required');
    }

    return await recordRepo.markAsUsed(id);
  }

  // ✅ Get unused services from exam records for booking selection
  async getUnusedServices(patientId) {
    if (!patientId) {
      throw new Error('Patient ID is required');
    }

    // Find exam records that haven't been used and have treatment indications
    const records = await recordRepo.findAll({
      patientId,
      type: 'exam',
      hasBeenUsed: false
    });

    // Extract unique unused treatment indications (serviceAddOn)
    const servicesMap = new Map();
    
    records.forEach(record => {
      if (record.treatmentIndications && record.treatmentIndications.length > 0) {
        record.treatmentIndications.forEach(indication => {
          if (!indication.used && indication.serviceId) {
            const key = indication.serviceId.toString();
            if (!servicesMap.has(key)) {
              servicesMap.set(key, {
                serviceId: indication.serviceId,
                serviceName: indication.serviceName,
                recordId: record._id,
                recordCode: record.recordCode,
                dentistName: record.dentistName,
                createdAt: record.createdAt,
                notes: indication.notes || ''
              });
            }
          }
        });
      }
    });

    return Array.from(servicesMap.values());
  }

  // 🆕 Get treatment indications for a patient and service (with serviceAddOn details)
  async getTreatmentIndications(patientId, serviceId) {
    if (!patientId || !serviceId) {
      throw new Error('Patient ID and Service ID are required');
    }

    // Find exam records with treatment indications for the specified service
    const records = await recordRepo.findAll({
      patientId,
      type: 'exam'
    });

    const indications = [];
    
    records.forEach(record => {
      if (record.treatmentIndications && record.treatmentIndications.length > 0) {
        record.treatmentIndications.forEach(indication => {
          // Match by serviceId and not used yet
          if (indication.serviceId && 
              indication.serviceId.toString() === serviceId && 
              !indication.used) {
            indications.push({
              indicationId: indication._id,
              serviceId: indication.serviceId,
              serviceName: indication.serviceName,
              serviceAddOnId: indication.serviceAddOnId || null,
              serviceAddOnName: indication.serviceAddOnName || null,
              notes: indication.notes || '',
              recordId: record._id,
              recordCode: record.recordCode,
              dentistName: record.dentistName,
              examDate: record.date,
              createdAt: record.createdAt
            });
          }
        });
      }
    });

    return indications;
  }
}

module.exports = new RecordService();
