const recordRepo = require("../repositories/record.repository");
const { publishToQueue } = require('../utils/rabbitmq.client');

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

    // Kiểm tra các trường bắt buộc
    if (!serviceId) {
      throw new Error("Service ID là bắt buộc");
    }

    if (!type || !['exam', 'treatment'].includes(type)) {
      throw new Error("Type phải là 'exam' hoặc 'treatment'");
    }

    // Xác định thông tin bệnh nhân
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

    // Xác định nha sĩ
    const finalDentistId = dentistId || preferredDentistId;
    if (!finalDentistId) {
      throw new Error("dentistId không được để trống");
    }

    // Tạo dữ liệu hồ sơ
    const recordData = {
      appointmentId: appointmentId || null,
      patientId: finalPatientId,
      patientInfo: finalPatientInfo,
      dentistId: finalDentistId,
      dentistName: dentistName || 'Unknown Dentist',
      serviceId,
      serviceName: serviceName || 'Unknown Service',
      serviceAddOnId: data.serviceAddOnId || null, // 🔥 SỬa: Bao gồm serviceAddOnId
      serviceAddOnName: data.serviceAddOnName || null, // 🔥 SỬa: Bao gồm serviceAddOnName
      serviceAddOnPrice: data.serviceAddOnPrice || 0, // 🔥 SỬa: Bao gồm serviceAddOnPrice (quan trọng cho hóa đơn!)
      servicePrice: data.servicePrice || 0, // Giá gốc
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

    // ✅ Đánh dấu dịch vụ chính là đã sử dụng khi tạo hồ sơ
    if (serviceId) {
      try {
        await publishToQueue('service_queue', {
          event: 'service.mark_as_used',
          data: {
            services: [{
              serviceId: serviceId,
              serviceAddOnId: data.serviceAddOnId || null
            }],
            recordId: record._id.toString(),
            reason: 'record_created'
          }
        });
        console.log(`✅ Published service.mark_as_used for new record ${record.recordCode}`);
      } catch (queueError) {
        console.warn('⚠️ Could not publish service mark_as_used event:', queueError.message);
        // Không throw - hồ sơ đã được tạo
      }
    }

    console.log("✅ Record created:", record);
    return record;
  }

  async getRecordById(id) {
    if (!id) {
      throw new Error('Record ID là bắt buộc');
    }

    const record = await recordRepo.findById(id);
    if (!record) {
      throw new Error('Không tìm thấy hồ sơ');
    }

    return record;
  }

  async getRecordByCode(recordCode) {
    if (!recordCode) {
      throw new Error('Mã hồ sơ là bắt buộc');
    }

    const record = await recordRepo.findByRecordCode(recordCode);
    if (!record) {
      throw new Error('Không tìm thấy hồ sơ với mã này');
    }

    return record;
  }

  async getAllRecords(filters = {}) {
    const records = await recordRepo.findAll(filters);
    return records;
  }

  async updateRecord(id, updateData, modifiedBy) {
    if (!id) {
      throw new Error('Record ID là bắt buộc');
    }

    const existingRecord = await recordRepo.findById(id);
    if (!existingRecord) {
      throw new Error('Không tìm thấy hồ sơ');
    }

    // ✅ Thu thập tất cả dịch vụ cần được đánh dấu đã sử dụng
    const servicesToMark = [];

    // 🔹 Kiểm tra nếu dịch vụ chính hoặc serviceAddOn thay đổi
    const oldServiceId = existingRecord.serviceId?.toString();
    const oldServiceAddOnId = existingRecord.serviceAddOnId?.toString();
    const newServiceId = updateData.serviceId?.toString();
    const newServiceAddOnId = updateData.serviceAddOnId?.toString();

    // Trường hợp 1: Service ID thay đổi → đánh dấu dịch vụ mới (với addon nếu được cung cấp)
    if (newServiceId && newServiceId !== oldServiceId) {
      servicesToMark.push({
        serviceId: newServiceId,
        serviceAddOnId: newServiceAddOnId || null
      });
    }
    // Trường hợp 2: Service ID giữ nguyên (hoặc không được gửi), nhưng addon thay đổi → đánh dấu dịch vụ với addon mới
    // Lưu ý: FE có thể không gửi serviceId khi chỉ thay đổi addon, nên sử dụng serviceId hiện tại
    else if (newServiceAddOnId && newServiceAddOnId !== oldServiceAddOnId) {
      const serviceIdToMark = newServiceId || oldServiceId; // Sử dụng mới hoặc dự phòng cũ
      if (serviceIdToMark) {
        servicesToMark.push({
          serviceId: serviceIdToMark,
          serviceAddOnId: newServiceAddOnId
        });
      }
    }

    // 🔹 Kiểm tra các chỉ định điều trị mới
    if (updateData.treatmentIndications && Array.isArray(updateData.treatmentIndications)) {
      const existingIndicationIds = new Set(
        (existingRecord.treatmentIndications || [])
          .filter(ind => ind.serviceId) // ✅ Lọc bỏ các phần tử không có serviceId
          .map(ind => 
            ind.serviceId.toString() + '_' + (ind.serviceAddOnId?.toString() || '')
          )
      );

      updateData.treatmentIndications.forEach(indication => {
        if (!indication.serviceId) return; // ✅ Bỏ qua nếu không có serviceId
        
        const indicationKey = indication.serviceId.toString() + '_' + (indication.serviceAddOnId?.toString() || '');
        if (!existingIndicationIds.has(indicationKey)) {
          servicesToMark.push({
            serviceId: indication.serviceId,
            serviceAddOnId: indication.serviceAddOnId || null
          });
        }
      });
    }

    // 🔹 Kiểm tra các dịch vụ bổ sung mới
    if (updateData.additionalServices && Array.isArray(updateData.additionalServices)) {
      const existingAdditionalIds = new Set(
        (existingRecord.additionalServices || [])
          .filter(svc => svc.serviceId) // ✅ Lọc bỏ các phần tử không có serviceId
          .map(svc => 
            svc.serviceId.toString() + '_' + (svc.serviceAddOnId?.toString() || '')
          )
      );

      updateData.additionalServices.forEach(svc => {
        if (!svc.serviceId) return; // ✅ Bỏ qua nếu không có serviceId
        
        const svcKey = svc.serviceId.toString() + '_' + (svc.serviceAddOnId?.toString() || '');
        if (!existingAdditionalIds.has(svcKey)) {
          servicesToMark.push({
            serviceId: svc.serviceId,
            serviceAddOnId: svc.serviceAddOnId || null
          });
        }
      });
    }

    // ✅ Đánh dấu tất cả dịch vụ đã thu thập là đã sử dụng
    if (servicesToMark.length > 0) {
      try {
        await publishToQueue('service_queue', {
          event: 'service.mark_as_used',
          data: {
            services: servicesToMark,
            recordId: id,
            reason: 'record_updated'
          }
        });
        console.log(`✅ Published service.mark_as_used for ${servicesToMark.length} services in record ${existingRecord.recordCode}`);
      } catch (queueError) {
        console.warn('⚠️ Could not publish service mark_as_used event:', queueError.message);
        // Không throw - cho phép cập nhật tiếp tục
      }
    }

    // ✅ Tin tưởng totalCost từ FE - KHÔNG tính lại
    // FE có toàn bộ ngữ cảnh về tất cả thay đổi (addon dịch vụ, số lượng, dịch vụ bổ sung)
    // và tính toán totalCost chính xác trước khi gửi lên BE

    const updatedRecord = await recordRepo.update(id, {
      ...updateData,
      modifiedBy
    });

    // 🔥 Nếu hồ sơ đã hoàn thành, phát lại sự kiện để cập nhật hóa đơn
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
            bookingChannel: 'offline', // Mặc định cho các hồ sơ
            type: updatedRecord.type,
            treatmentIndications: updatedRecord.treatmentIndications || [],
            additionalServices: updatedRecord.additionalServices || [], // ⭐ Các dịch vụ bổ sung
            prescription: updatedRecord.prescription || null,
            totalCost: updatedRecord.totalCost || 0,
            completedAt: updatedRecord.completedAt,
            modifiedBy: modifiedBy ? modifiedBy.toString() : null
          }
        });
        console.log(`✅ Republished record.completed event after update for record ${updatedRecord.recordCode}`);
      } catch (publishError) {
        console.error('❌ Failed to republish record.completed event:', publishError);
        // Không throw - cập nhật đã thành công
      }
    }

    return updatedRecord;
  }

  async updateRecordStatus(id, status, modifiedBy) {
    if (!id) {
      throw new Error('Record ID là bắt buộc');
    }

    if (!['pending', 'in-progress', 'completed', 'cancelled'].includes(status)) {
      throw new Error('Trạng thái không hợp lệ');
    }

    // Lấy hồ sơ trước để kiểm tra appointmentId
    const existingRecord = await recordRepo.findById(id);
    if (!existingRecord) {
      throw new Error('Không tìm thấy hồ sơ');
    }

    // Cập nhật trạng thái hồ sơ
    const record = await recordRepo.updateStatus(id, status, modifiedBy);

    // 🔥 Phát sự kiện và cập nhật cuộc hẹn dựa trên trạng thái
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
        
        // Phát sự kiện record.in-progress
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
        
        // Phát sự kiện record.completed
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
            type: record.type, // 'exam' hoặc 'treatment'
            treatmentIndications: record.treatmentIndications || [], // Các addon dịch vụ đã sử dụng
            additionalServices: record.additionalServices || [], // ⭐ Các dịch vụ bổ sung đã sử dụng trong điều trị
            prescription: record.prescription || null,
            totalCost: record.totalCost || 0,
            completedAt: record.completedAt,
            modifiedBy: modifiedBy ? modifiedBy.toString() : null
          }
        });
        console.log(`✅✅✅ Published record.completed event for record ${record.recordCode}. Total cost: ${record.totalCost}đ (including ${record.additionalServices?.length || 0} additional services)`);
        
        // 🆕 Phát sự kiện payment.create đến payment-service
        const publishTimestamp = new Date().toISOString();
        console.log(`\n💰💰💰 [${publishTimestamp}] [Record Service] About to publish payment.create event`);
        console.log(`📝 Record: ${record.recordCode} (${record._id.toString()})`);
        
        // Tính trừ tiền cọc (nếu từ đặt lịch online)
        let depositDeducted = 0;
        if (record.appointmentId) {
          // Chúng ta sẽ để payment-service lấy tiền cọc từ appointment-service
          // Hiện tại, chỉ cần truyền appointmentId
        }
        
        await publishToQueue('payment_event_queue', {
          event: 'payment.create',
          data: {
            recordId: record._id.toString(),
            recordCode: record.recordCode,
            appointmentId: record.appointmentId ? record.appointmentId.toString() : null,
            patientId: record.patientId ? record.patientId.toString() : null,
            patientInfo: record.patientInfo,
            // Chi tiết dịch vụ chính
            serviceName: record.serviceName,
            serviceAddOnName: record.serviceAddOnName || null,
            serviceAddOnUnit: record.serviceAddOnUnit || null,
            serviceAddOnPrice: record.serviceAddOnPrice || 0,
            quantity: record.quantity || 1,
            // Các dịch vụ bổ sung với đầy đủ chi tiết
            additionalServices: (record.additionalServices || []).map(svc => ({
              serviceId: svc.serviceId,
              serviceName: svc.serviceName,
              serviceAddOnName: svc.serviceAddOnName || null,
              serviceAddOnUnit: svc.serviceAddOnUnit || null,
              price: svc.price,
              quantity: svc.quantity,
              totalPrice: svc.totalPrice
            })),
            // Chi tiết chi phí
            originalAmount: record.totalCost || 0,
            depositDeducted: depositDeducted, // Sẽ được payment-service tính
            finalAmount: (record.totalCost || 0) - depositDeducted,
            // Metadata - Dữ liệu mô tả
            createdBy: modifiedBy ? modifiedBy.toString() : null
          }
        });
        console.log(`✅✅✅ Published payment.create event for record ${record.recordCode} to payment_event_queue`);
        
        if (!record.appointmentId) {
          console.warn(`⚠️⚠️⚠️ Record ${record.recordCode} has NO appointmentId - appointment will NOT be updated!`);
        }
      }
    } catch (publishError) {
      console.error('❌❌❌ Failed to publish record status event:', publishError);
      console.error('Error stack:', publishError.stack);
      // Không throw - cập nhật trạng thái đã thành công
    }

    return record;
  }

  async deleteRecord(id) {
    if (!id) {
      throw new Error('Record ID là bắt buộc');
    }

    const record = await recordRepo.delete(id);

    return { message: 'Hồ sơ đã được xóa thành công' };
  }

  async getRecordsByPatient(patientId, limit = 10) {
    if (!patientId) {
      throw new Error('Patient ID là bắt buộc');
    }

    const records = await recordRepo.findByPatient(patientId, limit);
    return records;
  }

  async getRecordsByDentist(dentistId, startDate, endDate) {
    if (!dentistId) {
      throw new Error('Dentist ID là bắt buộc');
    }

    const records = await recordRepo.findByDentist(dentistId, startDate, endDate);
    return records;
  }

  async getPendingRecords() {
    const records = await recordRepo.findPending();
    return records;
  }

  async addPrescription(id, prescription, prescribedBy) {
    if (!id) {
      throw new Error('Record ID là bắt buộc');
    }

    // ✅ Không cần kiểm tra - chấp nhận dữ liệu trống hoặc không đầy đủ
    // Nếu đơn thuốc trống hoặc không có thuốc, vẫn cập nhật

    const record = await recordRepo.addPrescription(id, prescription, prescribedBy);

    return record;
  }

  async updateTreatmentIndication(id, indicationId, used, notes, modifiedBy) {
    if (!id || !indicationId) {
      throw new Error('Record ID và indication ID là bắt buộc');
    }

    const record = await recordRepo.updateTreatmentIndication(id, indicationId, used, notes, modifiedBy);

    return record;
  }

  async getStatistics(startDate, endDate) {
    const stats = await recordRepo.getStatistics(startDate, endDate);
    return stats;
  }

  async completeRecord(id, modifiedBy) {
    // ✅ Kiểm tra hồ sơ trước khi hoàn thành
    const record = await recordRepo.findById(id);
    
    if (!record) {
      throw new Error('Không tìm thấy hồ sơ');
    }

    // console.log('🔍 [completeRecord] Record data:', {
    //   _id: record._id,
    //   recordCode: record.recordCode,
    //   appointmentId: record.appointmentId,
    //   status: record.status,
    //   totalCost: record.totalCost
    // });

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
      // Có thể không cần kiểm tra treatmentIndications vì đây chỉ là chỉ định
    }

    // ✅ QUAN TRỌNG: Phải có totalCost (giá dịch vụ)
    if (!record.totalCost || record.totalCost <= 0) {
      errors.push('Chưa có giá dịch vụ (totalCost). Vui lòng cập nhật giá trước khi hoàn thành');
    }

    if (errors.length > 0) {
      throw new Error(`Không thể hoàn thành hồ sơ:\n- ${errors.join('\n- ')}`);
    }

    // ✅ Đánh dấu tất cả dịch vụ trong hồ sơ là đã sử dụng trước khi hoàn thành
    const servicesToMark = [];

    // Dịch vụ chính
    if (record.serviceId) {
      servicesToMark.push({
        serviceId: record.serviceId.toString(),
        serviceAddOnId: record.serviceAddOnId ? record.serviceAddOnId.toString() : null
      });
    }

    // Chỉ định điều trị
    if (record.treatmentIndications && record.treatmentIndications.length > 0) {
      record.treatmentIndications.forEach(indication => {
        if (indication.serviceId) {
          servicesToMark.push({
            serviceId: indication.serviceId.toString(),
            serviceAddOnId: indication.serviceAddOnId ? indication.serviceAddOnId.toString() : null
          });
        }
      });
    }

    // Dịch vụ bổ sung
    if (record.additionalServices && record.additionalServices.length > 0) {
      record.additionalServices.forEach(svc => {
        if (svc.serviceId) {
          servicesToMark.push({
            serviceId: svc.serviceId.toString(),
            serviceAddOnId: svc.serviceAddOnId ? svc.serviceAddOnId.toString() : null
          });
        }
      });
    }

    // Phát sự kiện để đánh dấu tất cả dịch vụ là đã sử dụng
    if (servicesToMark.length > 0) {
      try {
        await publishToQueue('service_queue', {
          event: 'service.mark_as_used',
          data: {
            services: servicesToMark,
            recordId: record._id.toString(),
            reason: 'record_completed'
          }
        });
        console.log(`✅ Published service.mark_as_used for ${servicesToMark.length} services in completed record ${record.recordCode}`);
      } catch (queueError) {
        console.warn('⚠️ Could not publish service mark_as_used event:', queueError.message);
        // Không throw - cho phép hoàn thành tiếp tục
      }
    }

    // ✅ Nếu kiểm tra đạt, tiến hành hoàn thành
    // console.log('✅ [completeRecord] Kiểm tra thành công, cập nhật trạng thái thành completed...');
    const completedRecord = await this.updateRecordStatus(id, 'completed', modifiedBy);
    // console.log('✅ [completeRecord] Record completed successfully:', completedRecord.recordCode);
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
      throw new Error('Record ID là bắt buộc');
    }

    return await recordRepo.markAsUsed(id);
  }

  // ✅ Lấy các dịch vụ chưa sử dụng từ hồ sơ khám để chọn khi đặt lịch
  async getUnusedServices(patientId) {
    if (!patientId) {
      throw new Error('Patient ID là bắt buộc');
    }

    // Tìm các hồ sơ khám có chỉ định điều trị (không quan tâm hasBeenUsed)
    // Vì chúng ta chỉ quan tâm đến trạng thái indication.used riêng lẻ
    const records = await recordRepo.findAll({
      patientId,
      type: 'exam'
    });

    // Trích xuất các chỉ định điều trị chưa sử dụng duy nhất (serviceAddOn)
    const servicesMap = new Map();
    
    records.forEach(record => {
      if (record.treatmentIndications && record.treatmentIndications.length > 0) {
        record.treatmentIndications.forEach(indication => {
          if (!indication.used && indication.serviceId) {
            // 🆕 Tạo key duy nhất bao gồm serviceAddOnId để xử lý nhiều addon cho cùng một dịch vụ
            const key = indication.serviceAddOnId 
              ? `${indication.serviceId.toString()}_${indication.serviceAddOnId.toString()}`
              : indication.serviceId.toString();
              
            if (!servicesMap.has(key)) {
              servicesMap.set(key, {
                serviceId: indication.serviceId,
                serviceName: indication.serviceName,
                serviceAddOnId: indication.serviceAddOnId || null,
                serviceAddOnName: indication.serviceAddOnName || null,
                serviceAddOnPrice: indication.serviceAddOnPrice || null,
                serviceAddOnUnit: indication.serviceAddOnUnit || null,
                serviceAddOnDuration: indication.serviceAddOnDuration || null,
                recordId: record._id,
                recordCode: record.recordCode,
                dentistName: record.dentistName,
                createdDate: record.createdAt,
                notes: indication.notes || ''
              });
            }
          }
        });
      }
    });

    return Array.from(servicesMap.values());
  }

  // 🆕 Lấy chỉ định điều trị cho bệnh nhân và dịch vụ (với chi tiết serviceAddOn)
  async getTreatmentIndications(patientId, serviceId) {
    if (!patientId || !serviceId) {
      throw new Error('Patient ID và Service ID là bắt buộc');
    }

    // Tìm các hồ sơ khám có chỉ định điều trị cho dịch vụ chỉ định
    const records = await recordRepo.findAll({
      patientId,
      type: 'exam'
    });

    const indications = [];
    
    records.forEach(record => {
      if (record.treatmentIndications && record.treatmentIndications.length > 0) {
        record.treatmentIndications.forEach(indication => {
          // Khớp theo serviceId và chưa sử dụng
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

  // ⭐ Thêm dịch vụ bổ sung vào hồ sơ
  async addAdditionalService(recordId, serviceData, addedBy) {
    if (!recordId || !serviceData) {
      throw new Error('Record ID và thông tin dịch vụ là bắt buộc');
    }

    const record = await recordRepo.findById(recordId);
    if (!record) {
      throw new Error('Không tìm thấy hồ sơ');
    }

    if (record.status === 'completed') {
      throw new Error('Không thể thêm dịch vụ cho hồ sơ đã hoàn thành');
    }

    // Kiểm tra dữ liệu dịch vụ
    const { serviceId, serviceName, serviceType, serviceAddOnId, serviceAddOnName, serviceAddOnUnit, price, quantity = 1, notes } = serviceData;
    
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
      serviceAddOnUnit: serviceAddOnUnit || null,
      price,
      quantity,
      totalPrice,
      notes: notes || '',
      addedBy,
      addedAt: new Date()
    };

    // Thêm vào mảng additionalServices
    if (!record.additionalServices) {
      record.additionalServices = [];
    }
    record.additionalServices.push(newService);

    // ✅ Đánh dấu dịch vụ là đã sử dụng
    if (serviceId) {
      try {
        await publishToQueue('service_queue', {
          event: 'service.mark_as_used',
          data: {
            services: [{
              serviceId,
              serviceAddOnId: serviceAddOnId || null
            }],
            recordId: recordId,
            reason: 'additional_service_added'
          }
        });
        console.log(`✅ Published service.mark_as_used for additional service ${serviceName} in record ${record.recordCode}`);
      } catch (queueError) {
        console.warn('⚠️ Could not publish service mark_as_used event:', queueError.message);
        // Không throw - cho phép thêm dịch vụ tiếp tục
      }
    }

    // ⚠️ KHÔNG tính lại totalCost ở đây
    // FE sẽ gửi đúng totalCost qua updateRecord API
    // Hàm này chỉ thêm dịch vụ vào mảng

    await record.save();

    console.log(`✅ Added service ${serviceName} to record ${record.recordCode}`);
    
    return record;
  }

  // ⭐ Xóa dịch vụ bổ sung khỏi hồ sơ
  async removeAdditionalService(recordId, serviceItemId, removedBy) {
    if (!recordId || !serviceItemId) {
      throw new Error('Record ID và ID mục dịch vụ là bắt buộc');
    }

    const record = await recordRepo.findById(recordId);
    if (!record) {
      throw new Error('Không tìm thấy hồ sơ');
    }

    if (record.status === 'completed') {
      throw new Error('Không thể xóa dịch vụ khỏi hồ sơ đã hoàn thành');
    }

    // Tìm và xóa dịch vụ
    const serviceIndex = record.additionalServices.findIndex(
      svc => svc._id.toString() === serviceItemId
    );

    if (serviceIndex === -1) {
      throw new Error('Không tìm thấy dịch vụ trong hồ sơ');
    }

    const removedService = record.additionalServices[serviceIndex];
    record.additionalServices.splice(serviceIndex, 1);

    // ⚠️ KHÔNG tính lại totalCost ở đây
    // FE sẽ gửi đúng totalCost qua updateRecord API
    // Hàm này chỉ xóa dịch vụ khỏi mảng

    record.lastModifiedBy = removedBy;
    await record.save();

    console.log(`✅ Removed service ${removedService.serviceName} from record ${record.recordCode}`);
    
    return record;
  }

  // ⭐ Cập nhật số lượng/ghi chú dịch vụ bổ sung
  async updateAdditionalService(recordId, serviceItemId, updateData, updatedBy) {
    if (!recordId || !serviceItemId) {
      throw new Error('Record ID và ID mục dịch vụ là bắt buộc');
    }

    const record = await recordRepo.findById(recordId);
    if (!record) {
      throw new Error('Không tìm thấy hồ sơ');
    }

    if (record.status === 'completed') {
      throw new Error('Không thể cập nhật dịch vụ cho hồ sơ đã hoàn thành');
    }

    // Tìm dịch vụ
    const service = record.additionalServices.find(
      svc => svc._id.toString() === serviceItemId
    );

    if (!service) {
      throw new Error('Không tìm thấy dịch vụ trong hồ sơ');
    }

    // Cập nhật số lượng nếu được cung cấp
    if (updateData.quantity !== undefined) {
      if (updateData.quantity < 1) {
        throw new Error('Số lượng phải lớn hơn 0');
      }
      service.quantity = updateData.quantity;
      service.totalPrice = service.price * service.quantity;
    }

    // Cập nhật ghi chú nếu được cung cấp
    if (updateData.notes !== undefined) {
      service.notes = updateData.notes;
    }

    // ⚠️ KHÔNG tính lại totalCost ở đây
    // FE sẽ gửi đúng totalCost qua updateRecord API
    // Hàm này chỉ cập nhật chi tiết dịch vụ

    record.lastModifiedBy = updatedBy;
    await record.save();

    console.log(`✅ Updated service ${service.serviceName} in record ${record.recordCode}`);
    
    return record;
  }

  /**
   * Lấy thông tin thanh toán cho hồ sơ (xem trước khi hoàn thành)
   * Lấy dữ liệu cuộc hẹn và hóa đơn để tính tiền cọc
   */
  async getPaymentInfo(recordId) {
    try {
      // console.log(`🔍 [getPaymentInfo] Starting for record: ${recordId}`);
      
      // 1. Lấy chi tiết hồ sơ
      const record = await recordRepo.findById(recordId);
      if (!record) {
        throw new Error('Không tìm thấy hồ sơ');
      }

      // console.log(`📋 [getPaymentInfo] Record found:`, {
      //   recordCode: record.recordCode,
      //   appointmentId: record.appointmentId,
      //   totalCost: record.totalCost
      // });

      // 2. Khởi tạo thông tin thanh toán
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

      // 3. Nếu không có cuộc hẹn, trả về ngay
      if (!record.appointmentId) {
        // console.log(`ℹ️ [getPaymentInfo] No appointment linked - no deposit`);
        return paymentInfo;
      }

      // 4. Lấy chi tiết cuộc hẹn
      try {
        const axios = require('axios');
        const APPOINTMENT_SERVICE_URL = process.env.APPOINTMENT_SERVICE_URL || 'http://localhost:3006';
        
        // console.log(`📞 [getPaymentInfo] Calling appointment-service: ${APPOINTMENT_SERVICE_URL}/api/appointments/by-ids`);
        
        const appointmentResponse = await axios.get(`${APPOINTMENT_SERVICE_URL}/api/appointments/by-ids`, {
          params: { ids: record.appointmentId }
        });

        if (appointmentResponse.data.success && appointmentResponse.data.data && appointmentResponse.data.data.length > 0) {
          const appointment = appointmentResponse.data.data[0];
          const invoiceId = appointment.invoiceId;

          // console.log(`✅ [getPaymentInfo] Appointment found:`, {
          //   appointmentId: record.appointmentId,
          //   invoiceId: invoiceId
          // });

          // 5. Nếu cuộc hẹn có invoiceId, lấy chi tiết hóa đơn
          if (invoiceId) {
            // ✅ Có hóa đơn → Đặt lịch online có tiền cọc
            paymentInfo.bookingChannel = 'online';
            
            try {
              const INVOICE_SERVICE_URL = process.env.INVOICE_SERVICE_URL || 'http://localhost:3008';
              
              // console.log(`📞 [getPaymentInfo] Calling invoice-service: ${INVOICE_SERVICE_URL}/api/invoices/internal/${invoiceId}`);
              
              const invoiceResponse = await axios.get(`${INVOICE_SERVICE_URL}/api/invoices/internal/${invoiceId}`);

              if (invoiceResponse.data.success && invoiceResponse.data.data) {
                const invoice = invoiceResponse.data.data;
                paymentInfo.depositAmount = invoice.paymentSummary?.totalPaid || 0;
                paymentInfo.invoiceNumber = invoice.invoiceNumber || null;
                paymentInfo.finalAmount = Math.max(0, paymentInfo.totalCost - paymentInfo.depositAmount);
                paymentInfo.hasDeposit = paymentInfo.depositAmount > 0;

                // console.log(`✅ [getPaymentInfo] Invoice found (Online booking):`, {
                //   invoiceNumber: paymentInfo.invoiceNumber,
                //   depositAmount: paymentInfo.depositAmount,
                //   finalAmount: paymentInfo.finalAmount,
                //   bookingChannel: 'online'
                // });
              }
            } catch (invoiceError) {
              console.error('⚠️ [getPaymentInfo] Failed to fetch invoice:', invoiceError.message);
              // Tiếp tục mà không có thông tin hóa đơn
            }
          } else {
            // ✅ Không có hóa đơn → Đặt lịch offline (walk-in hoặc đặt qua điện thoại không cọc)
            paymentInfo.bookingChannel = 'offline';
            // console.log(`ℹ️ [getPaymentInfo] Appointment has no invoice - Offline booking`);
          }
        }
      } catch (appointmentError) {
        console.error('⚠️ [getPaymentInfo] Failed to fetch appointment:', appointmentError.message);
        // Tiếp tục mà không có thông tin cuộc hẹn
      }

      // console.log(`🎯 [getPaymentInfo] Final payment info:`, paymentInfo);
      return paymentInfo;
      
    } catch (error) {
      console.error('❌ [getPaymentInfo] Error:', error);
      throw error;
    }
  }

  // 🆕 Lấy bệnh nhân có chỉ định chưa sử dụng cho nha sĩ cụ thể
  async getPatientsWithUnusedIndications(dentistId) {
    if (!dentistId) {
      throw new Error('Dentist ID là bắt buộc');
    }

    // Tìm các hồ sơ khám của nha sĩ này có chỉ định chưa sử dụng
    const records = await recordRepo.findAll({
      dentistId,
      type: 'exam'
    });

    console.log(`🔍 [getPatientsWithUnusedIndications] Found ${records.length} exam records for dentist ${dentistId}`);

    // Trích xuất các bệnh nhân duy nhất có chỉ định chưa sử dụng
    const patientsMap = new Map();
    
    records.forEach(record => {
      // ⭐ Bỏ qua nếu patientId là null hoặc undefined
      if (!record.patientId) {
        console.warn('⚠️ Record has no patientId:', record._id);
        return;
      }
      
      if (record.treatmentIndications && record.treatmentIndications.length > 0) {
        const hasUnusedIndication = record.treatmentIndications.some(ind => !ind.used);
        
        if (hasUnusedIndication) {
          const patientId = record.patientId.toString();
          
          // 🐛 Debug log
          const patientName = record.patientInfo?.name || record.patientName || 'Unknown Patient';
          console.log('📋 Record:', {
            recordId: record._id,
            patientId: record.patientId,
            patientInfoName: record.patientInfo?.name,
            recordPatientName: record.patientName,
            finalPatientName: patientName,
            hasPatientName: !!patientName
          });
          
          if (!patientsMap.has(patientId)) {
            patientsMap.set(patientId, {
              _id: record.patientId, // ⭐ Thêm _id để frontend dễ xử lý
              patientId: record.patientId,
              fullName: patientName, // ⭐ Dùng patientInfo.name hoặc dự phòng
              patientName: patientName, // ⭐ Dùng patientInfo.name hoặc dự phòng
              recordId: record._id,
              recordCode: record.recordCode,
              createdAt: record.createdAt,
              unusedIndicationsCount: record.treatmentIndications.filter(ind => !ind.used).length,
              // ⭐ Lưu ý: phone, email sẽ được populate từ frontend nếu cần
              // hoặc có thể gọi auth-service để lấy thông tin đầy đủ (tốn performance)
            });
          }
        }
      }
    });

    const result = Array.from(patientsMap.values());
    console.log(`✅ [getPatientsWithUnusedIndications] Returning ${result.length} patients:`, result);
    return result;
  }
}

module.exports = new RecordService();
