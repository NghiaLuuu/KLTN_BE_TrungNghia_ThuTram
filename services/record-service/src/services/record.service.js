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

    // Clear ALL record caches (use pattern matching)
    try {
      await redis.delPattern('records:*');
    } catch (error) {
      console.warn('Failed to clear record cache:', error.message);
    }

    // 🔥 If record is already completed, republish event to update invoice
    if (updatedRecord.status === 'completed') {
      try {
        await publishToQueue('appointment_queue', {
          event: 'record.completed',
          data: {
            recordId: updatedRecord._id.toString(),
            recordCode: updatedRecord.recordCode,
            appointmentId: updatedRecord.appointmentId ? updatedRecord.appointmentId.toString() : null,
            patientId: updatedRecord.patientId ? updatedRecord.patientId.toString() : null,
            patientInfo: updatedRecord.patientInfo,
            dentistId: updatedRecord.dentistId.toString(),
            dentistName: updatedRecord.dentistName,
            roomId: updatedRecord.roomId ? updatedRecord.roomId.toString() : null,
            roomName: updatedRecord.roomName,
            subroomId: updatedRecord.subroomId ? updatedRecord.subroomId.toString() : null,
            subroomName: updatedRecord.subroomName,
            serviceId: updatedRecord.serviceId.toString(),
            serviceName: updatedRecord.serviceName,
            serviceType: updatedRecord.type, // 'exam' or 'treatment'
            bookingChannel: 'offline', // Default for records
            type: updatedRecord.type,
            treatmentIndications: updatedRecord.treatmentIndications || [],
            additionalServices: updatedRecord.additionalServices || [], // ⭐ Additional services
            prescription: updatedRecord.prescription || null,
            totalCost: updatedRecord.totalCost || 0,
            completedAt: updatedRecord.completedAt,
            modifiedBy: modifiedBy ? modifiedBy.toString() : null
          }
        });
        console.log(`✅ Republished record.completed event after update for record ${updatedRecord.recordCode}`);
      } catch (publishError) {
        console.error('❌ Failed to republish record.completed event:', publishError);
        // Don't throw - update already successful
      }
    }

    return updatedRecord;
  }

  async updateRecordStatus(id, status, modifiedBy) {
    if (!id) {
      throw new Error('Record ID is required');
    }

    if (!['pending', 'in-progress', 'completed', 'cancelled'].includes(status)) {
      throw new Error('Trạng thái không hợp lệ');
    }

    // Get record first to check appointmentId
    const existingRecord = await recordRepo.findById(id);
    if (!existingRecord) {
      throw new Error('Không tìm thấy hồ sơ');
    }

    // Update record status
    const record = await recordRepo.updateStatus(id, status, modifiedBy);
    
    // Clear ALL record caches (use pattern matching)
    try {
      await redis.delPattern('records:*');
    } catch (error) {
      console.warn('Failed to clear record cache:', error.message);
    }

    // 🔥 Publish events and update appointment based on status
    try {
      if (status === 'in-progress') {
        console.log('🔥🔥🔥 [Record Service] About to publish record.in-progress event');
        console.log('📋 Event data:', {
          recordId: record._id.toString(),
          recordCode: record.recordCode,
          appointmentId: record.appointmentId ? record.appointmentId.toString() : null,
          patientId: record.patientId ? record.patientId.toString() : null,
          dentistId: record.dentistId.toString(),
          startedAt: record.startedAt
        });
        
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
        console.log(`✅✅✅ Published record.in-progress event for record ${record.recordCode} with appointmentId: ${record.appointmentId}`);
      } else if (status === 'completed') {
        console.log('🔥🔥🔥 [Record Service] About to publish record.completed event');
        console.log('📋 Event data:', {
          recordId: record._id.toString(),
          recordCode: record.recordCode,
          appointmentId: record.appointmentId ? record.appointmentId.toString() : null,
          patientId: record.patientId ? record.patientId.toString() : null,
          totalCost: record.totalCost || 0,
          additionalServicesCount: record.additionalServices?.length || 0
        });
        
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
            additionalServices: record.additionalServices || [], // ⭐ Additional services used during treatment
            prescription: record.prescription || null,
            totalCost: record.totalCost || 0,
            completedAt: record.completedAt,
            modifiedBy: modifiedBy ? modifiedBy.toString() : null
          }
        });
        console.log(`✅✅✅ Published record.completed event for record ${record.recordCode}. Total cost: ${record.totalCost}đ (including ${record.additionalServices?.length || 0} additional services)`);
        
        // 🆕 Publish payment.create event to payment-service
        console.log('💰💰💰 [Record Service] About to publish payment.create event');
        
        // Calculate deposit deduction (if from online booking)
        let depositDeducted = 0;
        if (record.appointmentId) {
          // We'll let payment-service fetch deposit from appointment-service
          // For now, just pass the appointmentId
        }
        
        await publishToQueue('payment_queue', {
          event: 'payment.create',
          data: {
            recordId: record._id.toString(),
            appointmentId: record.appointmentId ? record.appointmentId.toString() : null,
            patientId: record.patientId ? record.patientId.toString() : null,
            patientInfo: record.patientInfo,
            serviceName: record.serviceName,
            serviceAddOnName: record.serviceAddOnName || null,
            originalAmount: record.totalCost || 0,
            depositDeducted: depositDeducted, // Will be calculated by payment-service
            finalAmount: (record.totalCost || 0) - depositDeducted,
            createdBy: modifiedBy ? modifiedBy.toString() : null
          }
        });
        console.log(`✅✅✅ Published payment.create event for record ${record.recordCode} to payment_queue`);
        
        if (!record.appointmentId) {
          console.warn(`⚠️⚠️⚠️ Record ${record.recordCode} has NO appointmentId - appointment will NOT be updated!`);
        }
      }
    } catch (publishError) {
      console.error('❌❌❌ Failed to publish record status event:', publishError);
      console.error('Error stack:', publishError.stack);
      // Don't throw - status update already successful
    }

    return record;
  }

  async deleteRecord(id) {
    if (!id) {
      throw new Error('Record ID is required');
    }

    const record = await recordRepo.delete(id);
    
    // Clear ALL record caches (use pattern matching)
    try {
      await redis.delPattern('records:*');
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
    
    // Clear ALL record caches (use pattern matching)
    try {
      await redis.delPattern('records:*');
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
    
    // Clear ALL record caches (use pattern matching)
    try {
      await redis.delPattern('records:*');
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
    // ✅ Validate record trước khi complete
    const record = await recordRepo.findById(id);
    
    if (!record) {
      throw new Error('Không tìm thấy hồ sơ');
    }

    console.log('🔍 [completeRecord] Record data:', {
      _id: record._id,
      recordCode: record.recordCode,
      appointmentId: record.appointmentId,
      status: record.status,
      totalCost: record.totalCost
    });

    // ✅ Kiểm tra các thông tin bắt buộc để tạo invoice
    const errors = [];

    if (!record.serviceId || !record.serviceName) {
      errors.push('Thiếu thông tin dịch vụ chính');
    }

    if (!record.diagnosis || record.diagnosis.trim() === '') {
      errors.push('Chưa nhập chẩn đoán');
    }

    // Nếu là type='exam' và có treatmentIndications, kiểm tra notes
    if (record.type === 'exam' && record.treatmentIndications && record.treatmentIndications.length > 0) {
      // Có thể không cần validate treatmentIndications vì đây chỉ là chỉ định
    }

    // ✅ QUAN TRỌNG: Phải có totalCost (giá dịch vụ)
    if (!record.totalCost || record.totalCost <= 0) {
      errors.push('Chưa có giá dịch vụ (totalCost). Vui lòng cập nhật giá trước khi hoàn thành');
    }

    if (errors.length > 0) {
      throw new Error(`Không thể hoàn thành hồ sơ:\n- ${errors.join('\n- ')}`);
    }

    // ✅ Nếu validate pass, proceed to complete
    console.log('✅ [completeRecord] Validation passed, updating status to completed...');
    const completedRecord = await this.updateRecordStatus(id, 'completed', modifiedBy);
    console.log('✅ [completeRecord] Record completed successfully:', completedRecord.recordCode);
    return completedRecord;
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

  // ⭐ Add additional service to record
  async addAdditionalService(recordId, serviceData, addedBy) {
    if (!recordId || !serviceData) {
      throw new Error('Record ID and service data are required');
    }

    const record = await recordRepo.findById(recordId);
    if (!record) {
      throw new Error('Không tìm thấy hồ sơ');
    }

    if (record.status === 'completed') {
      throw new Error('Không thể thêm dịch vụ cho hồ sơ đã hoàn thành');
    }

    // Validate service data
    const { serviceId, serviceName, serviceType, serviceAddOnId, serviceAddOnName, price, quantity = 1, notes } = serviceData;
    
    if (!serviceId || !serviceName || !serviceType || !price || price < 0) {
      throw new Error('Thông tin dịch vụ không hợp lệ');
    }

    const totalPrice = price * quantity;

    const newService = {
      serviceId,
      serviceName,
      serviceType,
      serviceAddOnId: serviceAddOnId || null,
      serviceAddOnName: serviceAddOnName || null,
      price,
      quantity,
      totalPrice,
      notes: notes || '',
      addedBy,
      addedAt: new Date()
    };

    // Add to additionalServices array
    if (!record.additionalServices) {
      record.additionalServices = [];
    }
    record.additionalServices.push(newService);

    // Recalculate totalCost
    const baseCost = (record.servicePrice || 0) + (record.serviceAddOnPrice || 0);
    const additionalCost = record.additionalServices.reduce((sum, svc) => sum + svc.totalPrice, 0);
    record.totalCost = baseCost + additionalCost;

    await record.save();

    // Clear ALL record caches (use pattern matching)
    try {
      await redis.delPattern('records:*');
    } catch (error) {
      console.warn('Failed to clear cache:', error.message);
    }

    console.log(`✅ Added service ${serviceName} to record ${record.recordCode}. New total: ${record.totalCost}đ`);
    
    return record;
  }

  // ⭐ Remove additional service from record
  async removeAdditionalService(recordId, serviceItemId, removedBy) {
    if (!recordId || !serviceItemId) {
      throw new Error('Record ID and service item ID are required');
    }

    const record = await recordRepo.findById(recordId);
    if (!record) {
      throw new Error('Không tìm thấy hồ sơ');
    }

    if (record.status === 'completed') {
      throw new Error('Không thể xóa dịch vụ khỏi hồ sơ đã hoàn thành');
    }

    // Find and remove service
    const serviceIndex = record.additionalServices.findIndex(
      svc => svc._id.toString() === serviceItemId
    );

    if (serviceIndex === -1) {
      throw new Error('Không tìm thấy dịch vụ trong hồ sơ');
    }

    const removedService = record.additionalServices[serviceIndex];
    record.additionalServices.splice(serviceIndex, 1);

    // Recalculate totalCost
    const baseCost = (record.servicePrice || 0) + (record.serviceAddOnPrice || 0);
    const additionalCost = record.additionalServices.reduce((sum, svc) => sum + svc.totalPrice, 0);
    record.totalCost = baseCost + additionalCost;

    record.lastModifiedBy = removedBy;
    await record.save();

    // Clear ALL record caches (use pattern matching)
    try {
      await redis.delPattern('records:*');
    } catch (error) {
      console.warn('Failed to clear cache:', error.message);
    }

    console.log(`✅ Removed service ${removedService.serviceName} from record ${record.recordCode}. New total: ${record.totalCost}đ`);
    
    return record;
  }

  // ⭐ Update additional service quantity/notes
  async updateAdditionalService(recordId, serviceItemId, updateData, updatedBy) {
    if (!recordId || !serviceItemId) {
      throw new Error('Record ID and service item ID are required');
    }

    const record = await recordRepo.findById(recordId);
    if (!record) {
      throw new Error('Không tìm thấy hồ sơ');
    }

    if (record.status === 'completed') {
      throw new Error('Không thể cập nhật dịch vụ cho hồ sơ đã hoàn thành');
    }

    // Find service
    const service = record.additionalServices.find(
      svc => svc._id.toString() === serviceItemId
    );

    if (!service) {
      throw new Error('Không tìm thấy dịch vụ trong hồ sơ');
    }

    // Update quantity if provided
    if (updateData.quantity !== undefined) {
      if (updateData.quantity < 1) {
        throw new Error('Số lượng phải lớn hơn 0');
      }
      service.quantity = updateData.quantity;
      service.totalPrice = service.price * service.quantity;
    }

    // Update notes if provided
    if (updateData.notes !== undefined) {
      service.notes = updateData.notes;
    }

    // Recalculate totalCost
    const baseCost = (record.servicePrice || 0) + (record.serviceAddOnPrice || 0);
    const additionalCost = record.additionalServices.reduce((sum, svc) => sum + svc.totalPrice, 0);
    record.totalCost = baseCost + additionalCost;

    record.lastModifiedBy = updatedBy;
    await record.save();

    // Clear cache
    try {
      await redis.delPattern('records:*');
    } catch (error) {
      console.warn('Failed to clear cache:', error.message);
    }

    console.log(`✅ Updated service ${service.serviceName} in record ${record.recordCode}. New total: ${record.totalCost}đ`);
    
    return record;
  }

  /**
   * Get payment info for record (preview before completing)
   * Fetches appointment and invoice data to calculate deposit
   */
  async getPaymentInfo(recordId) {
    try {
      console.log(`🔍 [getPaymentInfo] Starting for record: ${recordId}`);
      
      // 1. Get record details
      const record = await recordRepo.findById(recordId);
      if (!record) {
        throw new Error('Không tìm thấy hồ sơ');
      }

      console.log(`📋 [getPaymentInfo] Record found:`, {
        recordCode: record.recordCode,
        appointmentId: record.appointmentId,
        totalCost: record.totalCost
      });

      // 2. Initialize payment info
      const paymentInfo = {
        recordId: record._id,
        recordCode: record.recordCode,
        totalCost: record.totalCost || 0,
        depositAmount: 0,
        finalAmount: record.totalCost || 0,
        hasDeposit: false,
        bookingChannel: 'offline',
        invoiceNumber: null,
        appointmentId: record.appointmentId || null
      };

      // 3. If no appointment, return immediately
      if (!record.appointmentId) {
        console.log(`ℹ️ [getPaymentInfo] No appointment linked - no deposit`);
        return paymentInfo;
      }

      // 4. Fetch appointment details
      try {
        const axios = require('axios');
        const APPOINTMENT_SERVICE_URL = process.env.APPOINTMENT_SERVICE_URL || 'http://localhost:3006';
        
        console.log(`📞 [getPaymentInfo] Calling appointment-service: ${APPOINTMENT_SERVICE_URL}/api/appointments/by-ids`);
        
        const appointmentResponse = await axios.get(`${APPOINTMENT_SERVICE_URL}/api/appointments/by-ids`, {
          params: { ids: record.appointmentId }
        });

        if (appointmentResponse.data.success && appointmentResponse.data.data && appointmentResponse.data.data.length > 0) {
          const appointment = appointmentResponse.data.data[0];
          const invoiceId = appointment.invoiceId;

          console.log(`✅ [getPaymentInfo] Appointment found:`, {
            appointmentId: record.appointmentId,
            invoiceId: invoiceId
          });

          // 5. If appointment has invoiceId, fetch invoice details
          if (invoiceId) {
            // ✅ Has invoice → Online booking with deposit
            paymentInfo.bookingChannel = 'online';
            
            try {
              const INVOICE_SERVICE_URL = process.env.INVOICE_SERVICE_URL || 'http://localhost:3008';
              
              console.log(`📞 [getPaymentInfo] Calling invoice-service: ${INVOICE_SERVICE_URL}/api/invoices/internal/${invoiceId}`);
              
              const invoiceResponse = await axios.get(`${INVOICE_SERVICE_URL}/api/invoices/internal/${invoiceId}`);

              if (invoiceResponse.data.success && invoiceResponse.data.data) {
                const invoice = invoiceResponse.data.data;
                paymentInfo.depositAmount = invoice.paymentSummary?.totalPaid || 0;
                paymentInfo.invoiceNumber = invoice.invoiceNumber || null;
                paymentInfo.finalAmount = Math.max(0, paymentInfo.totalCost - paymentInfo.depositAmount);
                paymentInfo.hasDeposit = paymentInfo.depositAmount > 0;

                console.log(`✅ [getPaymentInfo] Invoice found (Online booking):`, {
                  invoiceNumber: paymentInfo.invoiceNumber,
                  depositAmount: paymentInfo.depositAmount,
                  finalAmount: paymentInfo.finalAmount,
                  bookingChannel: 'online'
                });
              }
            } catch (invoiceError) {
              console.error('⚠️ [getPaymentInfo] Failed to fetch invoice:', invoiceError.message);
              // Continue without invoice info
            }
          } else {
            // ✅ No invoice → Offline booking (walk-in or phone booking without deposit)
            paymentInfo.bookingChannel = 'offline';
            console.log(`ℹ️ [getPaymentInfo] Appointment has no invoice - Offline booking`);
          }
        }
      } catch (appointmentError) {
        console.error('⚠️ [getPaymentInfo] Failed to fetch appointment:', appointmentError.message);
        // Continue without appointment info
      }

      console.log(`🎯 [getPaymentInfo] Final payment info:`, paymentInfo);
      return paymentInfo;
      
    } catch (error) {
      console.error('❌ [getPaymentInfo] Error:', error);
      throw error;
    }
  }
}

module.exports = new RecordService();
