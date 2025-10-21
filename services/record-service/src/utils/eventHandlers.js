const Record = require('../models/record.model');
const { publishToQueue } = require('./rabbitmq.client');

/**
 * Handle appointment_checked_in event
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
      date: data.checkedInAt || new Date(),
      serviceId: data.serviceId,
      serviceName: data.serviceName,
      type: data.serviceType, // 'exam' or 'treatment'
      dentistId: data.dentistId,
      dentistName: data.dentistName,
      roomId: data.roomId || null,
      roomName: data.roomName || null,
      status: 'pending', // Initial status when created from check-in
      priority: 'normal',
      createdBy: data.checkedInBy
    };
    
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

module.exports = {
  handleAppointmentCheckedIn,
  handlePatientInfoResponse
};
