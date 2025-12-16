const Record = require('../models/record.model');
const { publishToQueue } = require('./rabbitmq.client');

/**
 * Xử lý sự kiện appointment_checked-in
 * Tự động tạo hồ sơ khi cuộc hẹn được check-in
 */
async function handleAppointmentCheckedIn(eventData) {
  try {
    const { data } = eventData;
    
    console.log(`🔄 [handleAppointmentCheckedIn] Processing appointment ${data.appointmentCode}`);
    
    // Kiểm tra xem hồ sơ đã tồn tại cho cuộc hẹn này chưa
    const existingRecord = await Record.findOne({ appointmentId: data.appointmentId });
    if (existingRecord) {
      console.log(`⚠️ [handleAppointmentCheckedIn] Record already exists for appointment ${data.appointmentCode}: ${existingRecord.recordCode}`);
      return;
    }
    
    // Chuẩn bị dữ liệu hồ sơ
    const recordData = {
      appointmentId: data.appointmentId,
      patientId: data.patientId || null,
      patientInfo: data.patientInfo || null,
      date: data.appointmentDate || new Date(),
      serviceId: data.serviceId,
      serviceName: data.serviceName,
      serviceAddOnId: data.serviceAddOnId || null,
      serviceAddOnName: data.serviceAddOnName || null,
      servicePrice: data.servicePrice || 0,
      serviceAddOnPrice: data.serviceAddOnPrice || 0,
      bookingChannel: data.bookingChannel || 'offline',
      type: data.serviceType || 'exam', // 'exam' or 'treatment'
      dentistId: data.dentistId,
      dentistName: data.dentistName,
      roomId: data.roomId || null,
      roomName: data.roomName || null,
      subroomId: data.subroomId || null,
      subroomName: data.subroomName || null,
      status: 'pending', // ✅ Record chờ khám cho tới khi Nha sĩ bắt đầu
      priority: 'normal',
      totalCost: (data.servicePrice || 0) + (data.serviceAddOnPrice || 0), // ✅ Tính totalCost ban đầu từ dịch vụ + addon
      createdBy: data.createdBy || data.dentistId // Sử dụng createdBy từ cuộc hẹn hoặc dự phòng về dentistId
    };
    
    console.log('🔍 [DEBUG] Creating record with patientId:', data.patientId);
    
    // Nếu thiếu thông tin bệnh nhân và có patientId, lấy từ user-service
    if (!recordData.patientInfo && recordData.patientId) {
      try {
        // Gửi yêu cầu lấy thông tin bệnh nhân từ user-service
        await publishToQueue('user_request_queue', {
          event: 'get_patient_info',
          data: {
            patientId: recordData.patientId,
            requestedBy: 'record-service',
            requestId: `${data.appointmentId}_patient_info`
          }
        });
        console.log(`📤 [handleAppointmentCheckedIn] Requested patient info for ${data.patientId}`);
        
        // Hiện tại, tạo hồ sơ mà không có đầy đủ thông tin bệnh nhân
        // Sẽ được cập nhật khi nhận được phản hồi
        recordData.patientInfo = {
          name: 'Updating...',
          phone: '0000000000',
          birthYear: new Date().getFullYear() - 30
        };
      } catch (error) {
        console.error('❌ Failed to request patient info:', error);
        // Tiếp tục với thông tin bệnh nhân tối thiểu
      }
    }
    
    // Tạo hồ sơ
    const record = new Record(recordData);
    await record.save();
    
    console.log(`✅ [handleAppointmentCheckedIn] Record created: ${record.recordCode} for appointment ${data.appointmentCode}`);
    
    // 🔥 PHÁT SOCKET: Thông báo dashboard hàng đợi về hồ sơ mới
    try {
      const { emitRecordUpdate, emitQueueUpdate } = require('./socket');
      const date = new Date(record.date).toISOString().split('T')[0];
      
      if (record.roomId) {
        emitRecordUpdate(record, `${record.patientInfo?.name || 'Bệnh nhân'} đã check-in`);
        emitQueueUpdate(record.roomId.toString(), date, `Bệnh nhân mới check-in: ${record.recordCode}`);
        console.log(`📡 [handleAppointmentCheckedIn] Emitted socket events for new record ${record.recordCode}`);
      }
    } catch (socketError) {
      console.warn('⚠️ Socket emit failed:', socketError.message);
    }
    
    // Phát sự kiện record_created (cho các dịch vụ khác nếu cần)
    try {
      await publishToQueue('record_created_queue', {
        event: 'record_created',
        data: {
          recordId: record._id.toString(),
          recordCode: record.recordCode,
          appointmentId: data.appointmentId,
          patientId: recordData.patientId,
          dentistId: recordData.dentistId,
          type: recordData.type,
          createdAt: record.createdAt
        }
      });
    } catch (publishError) {
      console.error('❌ Failed to publish record_created event:', publishError);
    }
    
  } catch (error) {
    console.error('❌ [handleAppointmentCheckedIn] Error:', error);
    throw error;
  }
}

/**
 * Xử lý sự kiện get_patient_info_response (từ user-service)
 * Cập nhật hồ sơ với đầy đủ thông tin bệnh nhân
 */
async function handlePatientInfoResponse(eventData) {
  try {
    const { data } = eventData;
    const { requestId, patientInfo } = data;
    
    // Trích xuất appointmentId từ requestId
    const appointmentId = requestId.split('_patient_info')[0];
    
    // Tìm hồ sơ theo appointmentId và cập nhật thông tin bệnh nhân
    const record = await Record.findOne({ appointmentId });
    if (!record) {
      console.log(`⚠️ [handlePatientInfoResponse] Record not found for appointment ${appointmentId}`);
      return;
    }
    
    // Cập nhật thông tin bệnh nhân
    record.patientInfo = {
      name: patientInfo.fullName || patientInfo.name,
      phone: patientInfo.phoneNumber || patientInfo.phone,
      birthYear: patientInfo.birthYear || new Date().getFullYear() - 30,
      gender: patientInfo.gender || 'other',
      address: patientInfo.address || ''
    };
    
    await record.save();
    
    console.log(`✅ [handlePatientInfoResponse] Updated patient info for record ${record.recordCode}`);
    
  } catch (error) {
    console.error('❌ [handlePatientInfoResponse] Error:', error);
    throw error;
  }
}

/**
 * ⭐ Xử lý sự kiện record.mark_as_used (từ payment-service)
 * Đánh dấu hồ sơ khám là đã sử dụng khi bệnh nhân đặt lịch điều trị dựa trên kết quả khám đó
 */
async function handleMarkRecordAsUsed(eventData) {
  try {
    const { data } = eventData;
    const { recordId, reservationId, paymentId, appointmentData } = data;
    
    console.log(`🔄 [handleMarkRecordAsUsed] Processing record ${recordId} for reservation ${reservationId}`);
    
    // Tìm hồ sơ khám
    const record = await Record.findById(recordId);
    if (!record) {
      console.log(`⚠️ [handleMarkRecordAsUsed] Record not found: ${recordId}`);
      return;
    }
    
    // Xác minh đây là hồ sơ khám
    if (record.type !== 'exam') {
      console.log(`⚠️ [handleMarkRecordAsUsed] Record ${record.recordCode} is not an exam record (type: ${record.type})`);
      return;
    }
    
    // Đánh dấu là đã sử dụng
    record.hasBeenUsed = true;
    
    // Thêm ghi chú về dịch vụ đã sử dụng
    const usageNote = `Đã sử dụng để đặt lịch điều trị: ${appointmentData.serviceName || 'Unknown'} (Payment: ${paymentId})`;
    record.notes = record.notes 
      ? `${record.notes}\n${usageNote}` 
      : usageNote;
    
    await record.save();
    
    console.log(`✅ [handleMarkRecordAsUsed] Marked record ${record.recordCode} as used for treatment booking`);
    
  } catch (error) {
    console.error('❌ [handleMarkRecordAsUsed] Error:', error);
    // Không throw - đây không quan trọng, thanh toán đã thành công
  }
}

/**
 * 🆕 Xử lý sự kiện appointment.service_booked (từ appointment-service)
 * Đánh dấu treatmentIndications[x].used = true khi bệnh nhân đặt lịch dịch vụ đã chỉ định
 */
async function handleAppointmentServiceBooked(eventData) {
  try {
    const { data } = eventData;
    const { appointmentId, patientId, serviceId, serviceAddOnId, appointmentDate, reason } = data;
    
    console.log(`📥 [handleAppointmentServiceBooked] Received event:`, JSON.stringify({
      appointmentId,
      patientId,
      serviceId,
      serviceAddOnId,
      reason
    }, null, 2));
    
    if (!patientId || !serviceId) {
      console.log(`⚠️ [handleAppointmentServiceBooked] Missing required data: patientId=${patientId}, serviceId=${serviceId}`);
      return;
    }
    
    // Tìm tất cả hồ sơ khám của bệnh nhân này có chỉ định điều trị
    const examRecords = await Record.find({
      patientId: patientId,
      type: 'exam',
      status: 'completed',
      'treatmentIndications.0': { $exists: true } // Có ít nhất một chỉ định
    }).sort({ createdAt: -1 }); // Mới nhất trước
    
    console.log(`🔍 [handleAppointmentServiceBooked] Found ${examRecords.length} exam records with indications for patient ${patientId}`);
    
    if (examRecords.length > 0) {
      console.log(`📋 [handleAppointmentServiceBooked] Records:`, examRecords.map(r => ({
        recordId: r._id,
        recordCode: r.recordCode,
        indicationsCount: r.treatmentIndications.length,
        indications: r.treatmentIndications.map(ind => ({
          indicationId: ind._id,
          serviceId: ind.serviceId?.toString(),
          serviceName: ind.serviceName,
          serviceAddOnId: ind.serviceAddOnId?.toString(),
          serviceAddOnName: ind.serviceAddOnName,
          used: ind.used
        }))
      })));
    }
    
    let updated = false;
    
    // Duyệt qua các hồ sơ để tìm chỉ định khớp
    for (const record of examRecords) {
      for (const indication of record.treatmentIndications) {
        // Kiểm tra xem chỉ định này có khớp với dịch vụ đã đặt không
        const serviceMatch = indication.serviceId?.toString() === serviceId.toString();
        
        // Xử lý so sánh serviceAddOnId (có thể là String hoặc ObjectId)
        let addOnMatch = true; // Mặc định là khớp nếu không chỉ định addon
        if (serviceAddOnId && indication.serviceAddOnId) {
          // Cả hai đều tồn tại - so sánh như chuỗi
          addOnMatch = indication.serviceAddOnId.toString() === serviceAddOnId.toString();
        } else if (serviceAddOnId && !indication.serviceAddOnId) {
          // Cuộc hẹn có addon nhưng chỉ định không có - không khớp
          addOnMatch = false;
        } else if (!serviceAddOnId && indication.serviceAddOnId) {
          // Chỉ định có addon nhưng cuộc hẹn không có - không khớp
          addOnMatch = false;
        }
        // nếu không cả hai đều là null/undefined - match = true
        
        if (serviceMatch && addOnMatch && !indication.used) {
          // Đánh dấu đã sử dụng
          indication.used = true;
          indication.usedAt = new Date();
          indication.usedForAppointmentId = appointmentId;
          indication.usedReason = reason || 'Đã đặt lịch khám/điều trị';
          
          await record.save();
          
          console.log(`✅ [handleAppointmentServiceBooked] Marked indication as used:`, {
            recordId: record._id,
            recordCode: record.recordCode,
            indicationId: indication._id,
            serviceName: indication.serviceName,
            serviceAddOnName: indication.serviceAddOnName
          });
          
          updated = true;
          break; // Chỉ đánh dấu chỉ định khớp đầu tiên
        }
      }
      
      if (updated) break; // Dừng tìm kiếm các hồ sơ khác
    }
    
    if (!updated) {
      console.log(`⚠️ [handleAppointmentServiceBooked] No matching unused indication found for serviceId=${serviceId}, serviceAddOnId=${serviceAddOnId}`);
    }
    
  } catch (error) {
    console.error('❌ [handleAppointmentServiceBooked] Error:', error);
    // Không throw - đây không quan trọng, cuộc hẹn đã được tạo
  }
}

module.exports = {
  handleAppointmentCheckedIn,
  handlePatientInfoResponse,
  handleMarkRecordAsUsed,
  handleAppointmentServiceBooked
};
