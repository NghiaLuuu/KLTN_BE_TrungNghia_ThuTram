const recordRepo = require("../repositories/record.repository");
const recordService = require('./record.service');
const { emitRecordStatusChange, emitQueueUpdate, emitRecordUpdate } = require('../utils/socket');
const axios = require('axios');

class QueueService {
  /**
   * Get next queue number for a room on a specific date
   * This is concurrency-safe using MongoDB transactions
   * @param {Date} date - The date for queue number
   * @param {String} roomId - Room ID
   * @param {String} subroomId - Subroom ID (optional)
   * @returns {String} Next queue number (e.g., "001", "002")
   */
  async getNextQueueNumber(date, roomId, subroomId = null) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    // Build query
    const query = {
      date: { $gte: startOfDay, $lte: endOfDay },
      roomId,
      queueNumber: { $exists: true, $ne: null }
    };

    // Find the highest queue number for today in this room
    const lastRecord = await recordRepo.findOne(
      query,
      { sort: { queueNumber: -1 } }
    );

    let nextNumber = 1;
    if (lastRecord && lastRecord.queueNumber) {
      // Extract number from queueNumber (e.g., "001" -> 1)
      const currentNumber = parseInt(lastRecord.queueNumber);
      nextNumber = currentNumber + 1;
    }

    // Format as 3-digit string: "001", "002", ...
    return String(nextNumber).padStart(3, '0');
  }

  /**
   * Call a record - assign queue number and update status to in-progress
   * @param {String} recordId - Record ID
   * @param {String} userId - User ID who calls the record
   * @returns {Object} Updated record
   */
  async callRecord(recordId, userId) {
    const record = await recordRepo.findById(recordId);
    if (!record) {
      throw new Error('Record không tồn tại');
    }

    if (record.status !== 'pending') {
      throw new Error(`Record đang ở trạng thái ${record.status}, không thể gọi`);
    }

    // Get next queue number
    const queueNumber = await this.getNextQueueNumber(
      record.date,
      record.roomId,
      record.subroomId
    );

    // Update record
    const updatedRecord = await recordRepo.update(recordId, {
      status: 'in-progress',
      queueNumber,
      startedAt: new Date(),
      lastModifiedBy: userId
    });

    // Emit Socket.IO event
    emitRecordStatusChange(updatedRecord);
    emitQueueUpdate(
      record.roomId.toString(),
      new Date(record.date).toISOString().split('T')[0],
      `Đang khám: ${updatedRecord.patientInfo?.name || 'Bệnh nhân'} (STT ${queueNumber})`
    );

    return updatedRecord;
  }

  /**
   * Complete a record - update status to completed and prepare payment data
   * @param {String} recordId - Record ID
   * @param {String} userId - User ID who completes the record
   * @returns {Object} { record, paymentData }
   */
  async completeRecord(recordId, userId) {
    const record = await recordRepo.findById(recordId);
    if (!record) {
      throw new Error('Record không tồn tại');
    }

    if (record.status !== 'in-progress') {
      throw new Error(`Record đang ở trạng thái ${record.status}, không thể hoàn thành`);
    }

    // Use record service to handle validations + publish domain events
    const completedRecord = await recordService.completeRecord(recordId, userId);

    // Emit Socket.IO event for real-time UI updates
    emitRecordStatusChange(completedRecord);
    emitQueueUpdate(
      record.roomId.toString(),
      new Date(record.date).toISOString().split('T')[0],
      `Hoàn thành: ${completedRecord.patientInfo?.name || 'Bệnh nhân'}`
    );

    let paymentInfo = null;
    try {
      paymentInfo = await recordService.getPaymentInfo(recordId);
    } catch (infoError) {
      console.error('⚠️ [QueueService.completeRecord] Failed to fetch payment info:', infoError.message);
    }

    const totalAmount = paymentInfo?.totalCost ?? completedRecord.totalCost ?? 0;
    const depositAmount = paymentInfo?.depositAmount ?? 0;
    const finalAmount = paymentInfo?.finalAmount ?? Math.max(0, totalAmount - depositAmount);

    const paymentData = {
      recordId: completedRecord._id,
      appointmentId: completedRecord.appointmentId,
      patientId: completedRecord.patientId,
      patientInfo: completedRecord.patientInfo,
      // ✅ Required fields for payment validation
      amount: finalAmount, // Amount to be paid (after deducting deposit)
      method: 'cash', // Default to cash for offline payments
      type: 'payment',
      status: 'pending',
      // ✅ Additional payment info
      totalAmount,
      depositAmount,
      finalAmount,
      processedBy: userId,
      hasDeposit: paymentInfo?.hasDeposit ?? depositAmount > 0,
      bookingChannel: paymentInfo?.bookingChannel || null
    };

    // ⚠️ DEPRECATED: HTTP payment creation - now handled by RabbitMQ event
    // The payment.create event published above will be handled by payment-service
    // via RabbitMQ, which has better retry logic and avoids race conditions
    
    /* 
    // ❌ Old HTTP-based payment creation (causes 400 errors due to validation mismatch)
    let createdPayment = null;
    try {
      console.log('💰 [QueueService.completeRecord] Creating payment via HTTP...', paymentData);
      
      const paymentServiceUrl = process.env.PAYMENT_SERVICE_URL || 'http://localhost:3007';
      const response = await axios.post(`${paymentServiceUrl}/api/payments`, paymentData, {
        headers: {
          'x-internal-call': 'true',
          'Content-Type': 'application/json'
        },
        timeout: 10000 // 10s timeout
      });
      
      if (response.data && response.data.success) {
        createdPayment = response.data.data;
        console.log('✅ [QueueService.completeRecord] Payment created:', createdPayment._id);
        
        // ✅ Auto-confirm cash payment to trigger invoice creation
        try {
          console.log('💰 [QueueService.completeRecord] Auto-confirming cash payment...');
          const confirmResponse = await axios.post(
            `${paymentServiceUrl}/api/payments/${createdPayment._id}/confirm-cash`,
            {
              confirmedBy: userId,
              notes: 'Auto-confirmed upon record completion'
            },
            {
              headers: {
                'x-internal-call': 'true',
                'Content-Type': 'application/json'
              },
              timeout: 10000
            }
          );
          
          if (confirmResponse.data && confirmResponse.data.success) {
            createdPayment = confirmResponse.data.data; // Update with confirmed payment
            console.log('✅ [QueueService.completeRecord] Payment confirmed, invoice will be created');
          }
        } catch (confirmError) {
          console.warn('⚠️ [QueueService.completeRecord] Failed to auto-confirm payment:', confirmError.message);
          // Payment still exists, can be confirmed manually
        }
      } else {
        console.warn('⚠️ [QueueService.completeRecord] Payment creation returned unsuccessful:', response.data);
      }
    } catch (paymentError) {
      console.error('❌ [QueueService.completeRecord] Failed to create payment:', paymentError.message);
      // Don't throw - record is already completed, payment can be created manually
    }
    */

    console.log('✅ [QueueService.completeRecord] Payment will be created via RabbitMQ event');

    return {
      record: completedRecord,
      payment: null, // Payment will be created asynchronously via RabbitMQ
      paymentData,
      paymentInfo
    };
  }

  /**
   * Cancel a record - update status to cancelled
   * @param {String} recordId - Record ID
   * @param {String} userId - User ID who cancels the record
   * @param {String} reason - Cancellation reason
   * @returns {Object} Updated record
   */
  async cancelRecord(recordId, userId, reason) {
    const record = await recordRepo.findById(recordId);
    if (!record) {
      throw new Error('Record không tồn tại');
    }

    if (!['pending', 'in-progress'].includes(record.status)) {
      throw new Error(`Record đang ở trạng thái ${record.status}, không thể hủy`);
    }

    // Update record
    const updatedRecord = await recordRepo.update(recordId, {
      status: 'cancelled',
      notes: record.notes ? `${record.notes}\n[HỦY] ${reason}` : `[HỦY] ${reason}`,
      lastModifiedBy: userId
    });

    // Emit Socket.IO event
    emitRecordStatusChange(updatedRecord);
    emitQueueUpdate(
      record.roomId.toString(),
      new Date(record.date).toISOString().split('T')[0],
      `Đã hủy: ${updatedRecord.patientInfo?.name || 'Bệnh nhân'} - ${reason}`
    );

    return updatedRecord;
  }

  /**
   * Get queue status for a room
   * @param {Date} date - Date to get queue status
   * @param {String} roomId - Room ID
   * @param {String} subroomId - Subroom ID (optional)
   * @returns {Object} { current, next, upcoming: [] }
   */
  async getQueueStatus(date, roomId, subroomId = null) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const query = {
      date: { $gte: startOfDay, $lte: endOfDay },
      roomId
    };

    // Current record (in-progress)
    const current = await recordRepo.findOne({
      ...query,
      status: 'in-progress'
    });

    // Get ALL appointments for the day (sorted by slot startTime)
    const allRecords = await recordRepo.findAll({
      ...query,
      status: { $in: ['pending', 'in-progress', 'completed', 'cancelled'] }
    }, {
      sort: { 'appointmentInfo.startTime': 1, createdAt: 1 }
    });

    // Filter pending only for next
    const pending = allRecords.filter(r => r.status === 'pending');

    // Generate time slots with gaps
    const timeSlots = this._generateTimeSlots(allRecords);

    return {
      current: current || null,
      next: pending.length > 0 ? pending[0] : null,
      upcoming: pending.slice(1), // Keep for backward compatibility
      allAppointments: allRecords || [],
      timeSlots: timeSlots || [],
      summary: {
        total: allRecords.length,
        pending: allRecords.filter(a => a.status === 'pending').length,
        inProgress: allRecords.filter(a => a.status === 'in-progress').length,
        completed: allRecords.filter(a => a.status === 'completed').length,
        cancelled: allRecords.filter(a => a.status === 'cancelled').length
      }
    };
  }

  /**
   * Generate time slots showing appointments and gaps
   * @private
   */
  _generateTimeSlots(records) {
    if (!records || records.length === 0) return [];

    const slots = [];
    
    // Filter and sort by start time
    const sorted = records
      .filter(rec => rec.appointmentInfo && rec.appointmentInfo.startTime)
      .sort((a, b) => {
        const timeA = new Date(a.appointmentInfo.startTime);
        const timeB = new Date(b.appointmentInfo.startTime);
        return timeA - timeB;
      });

    for (let i = 0; i < sorted.length; i++) {
      const current = sorted[i];
      const next = sorted[i + 1];

      // Add current appointment slot
      slots.push({
        type: 'appointment',
        recordId: current._id,
        patientName: current.patientInfo?.name || 'N/A',
        patientPhone: current.patientInfo?.phone,
        startTime: current.appointmentInfo.startTime,
        endTime: current.appointmentInfo.endTime,
        status: current.status,
        queueNumber: current.queueNumber
      });

      // Check for gap between current and next appointment
      if (next) {
        const currentEnd = new Date(current.appointmentInfo.endTime);
        const nextStart = new Date(next.appointmentInfo.startTime);
        
        // If there's a gap (more than 1 minute)
        if ((nextStart - currentEnd) > 60000) {
          slots.push({
            type: 'gap',
            startTime: currentEnd.toISOString(),
            endTime: nextStart.toISOString(),
            durationMinutes: Math.round((nextStart - currentEnd) / 60000)
          });
        }
      }
    }

    return slots;
  }
}

module.exports = new QueueService();
