const Record = require('../models/record.model');
const { publishToQueue } = require('./rabbitmq.client');

/**
 * Handle appointment_checked-in event
 * Auto-create record when appointment is checked in
 */
async function handleAppointmentCheckedIn(eventData) {
  try {
    const { data } = eventData;
    
    console.log(`🔄 [handleAppointmentCheckedIn] Processing appointment ${data.appointmentCode}`);
    
    // Check if record already exists for this appointment
    const existingRecord = await Record.findOne({ appointmentId: data.appointmentId });
    if (existingRecord) {
      console.log(`⚠️ [handleAppointmentCheckedIn] Record already exists for appointment ${data.appointmentCode}: ${existingRecord.recordCode}`);
      return;
    }
    
    // Prepare record data
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
      totalCost: (data.servicePrice || 0) + (data.serviceAddOnPrice || 0), // ✅ Calculate initial totalCost from service + addon
      createdBy: data.createdBy || data.dentistId // Use createdBy from appointment or fallback to dentistId
    };
    
    console.log('🔍 [DEBUG] Creating record with patientId:', data.patientId);
    
    // If missing patient info and have patientId, fetch from user-service
    if (!recordData.patientInfo && recordData.patientId) {
      try {
        // Publish request to get patient info from user-service
        await publishToQueue('user_request_queue', {
          event: 'get_patient_info',
          data: {
            patientId: recordData.patientId,
            requestedBy: 'record-service',
            requestId: `${data.appointmentId}_patient_info`
          }
        });
        console.log(`📤 [handleAppointmentCheckedIn] Requested patient info for ${data.patientId}`);
        
        // For now, create record without full patient info
        // It will be updated when response comes back
        recordData.patientInfo = {
          name: 'Updating...',
          phone: '0000000000',
          birthYear: new Date().getFullYear() - 30
        };
      } catch (error) {
        console.error('❌ Failed to request patient info:', error);
        // Continue with minimal patient info
      }
    }
    
    // Create record
    const record = new Record(recordData);
    await record.save();
    
    console.log(`✅ [handleAppointmentCheckedIn] Record created: ${record.recordCode} for appointment ${data.appointmentCode}`);
    
    // 🔥 EMIT SOCKET: Notify queue dashboard about new record
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
    
    // Publish record_created event (for other services if needed)
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
 * Handle get_patient_info_response event (from user-service)
 * Update record with full patient info
 */
async function handlePatientInfoResponse(eventData) {
  try {
    const { data } = eventData;
    const { requestId, patientInfo } = data;
    
    // Extract appointmentId from requestId
    const appointmentId = requestId.split('_patient_info')[0];
    
    // Find record by appointmentId and update patient info
    const record = await Record.findOne({ appointmentId });
    if (!record) {
      console.log(`⚠️ [handlePatientInfoResponse] Record not found for appointment ${appointmentId}`);
      return;
    }
    
    // Update patient info
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
 * ⭐ Handle record.mark_as_used event (from payment-service)
 * Mark exam record as used when patient books treatment based on that exam
 */
async function handleMarkRecordAsUsed(eventData) {
  try {
    const { data } = eventData;
    const { recordId, reservationId, paymentId, appointmentData } = data;
    
    console.log(`🔄 [handleMarkRecordAsUsed] Processing record ${recordId} for reservation ${reservationId}`);
    
    // Find the exam record
    const record = await Record.findById(recordId);
    if (!record) {
      console.log(`⚠️ [handleMarkRecordAsUsed] Record not found: ${recordId}`);
      return;
    }
    
    // Verify it's an exam record
    if (record.type !== 'exam') {
      console.log(`⚠️ [handleMarkRecordAsUsed] Record ${record.recordCode} is not an exam record (type: ${record.type})`);
      return;
    }
    
    // Mark as used
    record.hasBeenUsed = true;
    
    // Add note about which service it was used for
    const usageNote = `Đã sử dụng để đặt lịch điều trị: ${appointmentData.serviceName || 'Unknown'} (Payment: ${paymentId})`;
    record.notes = record.notes 
      ? `${record.notes}\n${usageNote}` 
      : usageNote;
    
    await record.save();
    
    console.log(`✅ [handleMarkRecordAsUsed] Marked record ${record.recordCode} as used for treatment booking`);
    
  } catch (error) {
    console.error('❌ [handleMarkRecordAsUsed] Error:', error);
    // Don't throw - this is non-critical, payment already succeeded
  }
}

/**
 * 🆕 Handle appointment.service_booked event (from appointment-service)
 * Mark treatmentIndications[x].used = true when patient books that indicated service
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
    
    // Find all exam records for this patient that have treatmentIndications
    const examRecords = await Record.find({
      patientId: patientId,
      type: 'exam',
      status: 'completed',
      'treatmentIndications.0': { $exists: true } // Has at least one indication
    }).sort({ createdAt: -1 }); // Newest first
    
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
    
    // Loop through records to find matching indication
    for (const record of examRecords) {
      for (const indication of record.treatmentIndications) {
        // Check if this indication matches the booked service
        const serviceMatch = indication.serviceId?.toString() === serviceId.toString();
        
        // Handle serviceAddOnId comparison (can be String or ObjectId)
        let addOnMatch = true; // Default to match if no addon specified
        if (serviceAddOnId && indication.serviceAddOnId) {
          // Both exist - compare as strings
          addOnMatch = indication.serviceAddOnId.toString() === serviceAddOnId.toString();
        } else if (serviceAddOnId && !indication.serviceAddOnId) {
          // Appointment has addon but indication doesn't - no match
          addOnMatch = false;
        } else if (!serviceAddOnId && indication.serviceAddOnId) {
          // Indication has addon but appointment doesn't - no match
          addOnMatch = false;
        }
        // else both are null/undefined - match = true
        
        if (serviceMatch && addOnMatch && !indication.used) {
          // Mark as used
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
          break; // Only mark the first matching indication
        }
      }
      
      if (updated) break; // Stop searching other records
    }
    
    if (!updated) {
      console.log(`⚠️ [handleAppointmentServiceBooked] No matching unused indication found for serviceId=${serviceId}, serviceAddOnId=${serviceAddOnId}`);
    }
    
  } catch (error) {
    console.error('❌ [handleAppointmentServiceBooked] Error:', error);
    // Don't throw - this is non-critical, appointment already created
  }
}

module.exports = {
  handleAppointmentCheckedIn,
  handlePatientInfoResponse,
  handleMarkRecordAsUsed,
  handleAppointmentServiceBooked
};
