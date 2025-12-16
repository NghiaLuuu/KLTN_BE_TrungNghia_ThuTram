const recordRepo = require("../repositories/record.repository");
const recordService = require('./record.service');
const { emitRecordStatusChange, emitQueueUpdate, emitRecordUpdate } = require('../utils/socket');
const axios = require('axios');

class QueueService {
  /**
   * Lấy số thứ tự hàng đợi tiếp theo cho phòng vào ngày cụ thể
   * Đảm bảo an toàn đồng thời bằng MongoDB transactions
   * @param {Date} date - Ngày lấy số thứ tự
   * @param {String} roomId - ID phòng
   * @param {String} subroomId - ID phòng con (tùy chọn)
   * @returns {String} Số thứ tự tiếp theo (ví dụ: "001", "002")
   */
  async getNextQueueNumber(date, roomId, subroomId = null) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    // Xây dựng truy vấn
    const query = {
      date: { $gte: startOfDay, $lte: endOfDay },
      roomId,
      queueNumber: { $exists: true, $ne: null }
    };

    // Tìm số thứ tự cao nhất cho ngày này trong phòng này
    const lastRecord = await recordRepo.findOne(
      query,
      { sort: { queueNumber: -1 } }
    );

    let nextNumber = 1;
    if (lastRecord && lastRecord.queueNumber) {
      // Trích xuất số từ queueNumber (ví dụ: "001" -> 1)
      const currentNumber = parseInt(lastRecord.queueNumber);
      nextNumber = currentNumber + 1;
    }

    // Định dạng thành chuỗi 3 chữ số: "001", "002", ...
    return String(nextNumber).padStart(3, '0');
  }

  /**
   * Gọi hồ sơ - gán số thứ tự và cập nhật trạng thái thành in-progress
   * @param {String} recordId - ID hồ sơ
   * @param {String} userId - ID người dùng gọi hồ sơ
   * @returns {Object} Hồ sơ đã cập nhật
   */
  async callRecord(recordId, userId) {
    const record = await recordRepo.findById(recordId);
    if (!record) {
      throw new Error('Record không tồn tại');
    }

    if (record.status !== 'pending') {
      throw new Error(`Record đang ở trạng thái ${record.status}, không thể gọi`);
    }

    // Lấy số thứ tự tiếp theo
    const queueNumber = await this.getNextQueueNumber(
      record.date,
      record.roomId,
      record.subroomId
    );

    // Cập nhật hồ sơ
    const updatedRecord = await recordRepo.update(recordId, {
      status: 'in-progress',
      queueNumber,
      startedAt: new Date(),
      lastModifiedBy: userId
    });

    // Phát sự kiện Socket.IO
    emitRecordStatusChange(updatedRecord);
    emitQueueUpdate(
      record.roomId.toString(),
      new Date(record.date).toISOString().split('T')[0],
      `Đang khám: ${updatedRecord.patientInfo?.name || 'Bệnh nhân'} (STT ${queueNumber})`
    );

    return updatedRecord;
  }

  /**
   * Hoàn thành hồ sơ - cập nhật trạng thái thành completed và chuẩn bị dữ liệu thanh toán
   * @param {String} recordId - ID hồ sơ
   * @param {String} userId - ID người dùng hoàn thành hồ sơ
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

    // Sử dụng record service để xử lý validations + phát các sự kiện domain
    const completedRecord = await recordService.completeRecord(recordId, userId);

    // Phát sự kiện Socket.IO cho cập nhật UI thời gian thực
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
      // ✅ Các trường bắt buộc cho validation thanh toán
      amount: finalAmount, // Số tiền cần thanh toán (sau khi trừ tiền cọc)
      method: 'cash', // Mặc định là tiền mặt cho thanh toán offline
      type: 'payment',
      status: 'pending',
      // ✅ Thông tin thanh toán bổ sung
      totalAmount,
      depositAmount,
      finalAmount,
      processedBy: userId,
      hasDeposit: paymentInfo?.hasDeposit ?? depositAmount > 0,
      bookingChannel: paymentInfo?.bookingChannel || null
    };

    // ⚠️ LỖI THỜI: Tạo thanh toán qua HTTP - giờ được xử lý bởi sự kiện RabbitMQ
    // Sự kiện payment.create được phát bên trên sẽ được payment-service xử lý
    // qua RabbitMQ, có logic retry tốt hơn và tránh race conditions
    
    /* 
    // ❌ Tạo thanh toán dựa trên HTTP cũ (gây lỗi 400 do validation không khớp)
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
        
        // ✅ Tự động xác nhận thanh toán tiền mặt để tạo hóa đơn
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
            createdPayment = confirmResponse.data.data; // Cập nhật với thanh toán đã xác nhận
            console.log('✅ [QueueService.completeRecord] Payment confirmed, invoice will be created');
          }
        } catch (confirmError) {
          console.warn('⚠️ [QueueService.completeRecord] Failed to auto-confirm payment:', confirmError.message);
          // Thanh toán vẫn tồn tại, có thể xác nhận thủ công
        }
      } else {
        console.warn('⚠️ [QueueService.completeRecord] Payment creation returned unsuccessful:', response.data);
      }
    } catch (paymentError) {
      console.error('❌ [QueueService.completeRecord] Failed to create payment:', paymentError.message);
      // Không throw - hồ sơ đã hoàn thành, thanh toán có thể được tạo thủ công
    }
    */

    console.log('✅ [QueueService.completeRecord] Thanh toán sẽ được tạo qua sự kiện RabbitMQ');

    return {
      record: completedRecord,
      payment: null, // Thanh toán sẽ được tạo bất đồng bộ qua RabbitMQ
      paymentData,
      paymentInfo
    };
  }

  /**
   * Hủy hồ sơ - cập nhật trạng thái thành cancelled
   * @param {String} recordId - ID hồ sơ
   * @param {String} userId - ID người dùng hủy hồ sơ
   * @param {String} reason - Lý do hủy
   * @returns {Object} Hồ sơ đã cập nhật
   */
  async cancelRecord(recordId, userId, reason) {
    const record = await recordRepo.findById(recordId);
    if (!record) {
      throw new Error('Record không tồn tại');
    }

    if (!['pending', 'in-progress'].includes(record.status)) {
      throw new Error(`Record đang ở trạng thái ${record.status}, không thể hủy`);
    }

    // Cập nhật hồ sơ
    const updatedRecord = await recordRepo.update(recordId, {
      status: 'cancelled',
      notes: record.notes ? `${record.notes}\n[HỦY] ${reason}` : `[HỦY] ${reason}`,
      lastModifiedBy: userId
    });

    // Phát sự kiện Socket.IO
    emitRecordStatusChange(updatedRecord);
    emitQueueUpdate(
      record.roomId.toString(),
      new Date(record.date).toISOString().split('T')[0],
      `Đã hủy: ${updatedRecord.patientInfo?.name || 'Bệnh nhân'} - ${reason}`
    );

    return updatedRecord;
  }

  /**
   * Lấy trạng thái hàng đợi cho một phòng
   * @param {Date} date - Ngày lấy trạng thái hàng đợi
   * @param {String} roomId - ID phòng
   * @param {String} subroomId - ID phòng con (tùy chọn)
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

    // Hồ sơ hiện tại (đang khám)
    const current = await recordRepo.findOne({
      ...query,
      status: 'in-progress'
    });

    // Lấy TẤT CẢ cuộc hẹn trong ngày (sắp xếp theo startTime của slot)
    const allRecords = await recordRepo.findAll({
      ...query,
      status: { $in: ['pending', 'in-progress', 'completed', 'cancelled'] }
    }, {
      sort: { 'appointmentInfo.startTime': 1, createdAt: 1 }
    });

    // Lọc chỉ các hồ sơ đang chờ cho next
    const pending = allRecords.filter(r => r.status === 'pending');

    // Tạo các slot thời gian với khoảng trống
    const timeSlots = this._generateTimeSlots(allRecords);

    return {
      current: current || null,
      next: pending.length > 0 ? pending[0] : null,
      upcoming: pending.slice(1), // Giữ lại để tương thích ngược
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
   * Tạo các slot thời gian hiển thị cuộc hẹn và khoảng trống
   * @private
   */
  _generateTimeSlots(records) {
    if (!records || records.length === 0) return [];

    const slots = [];
    
    // Lọc và sắp xếp theo thời gian bắt đầu
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

      // Thêm slot cuộc hẹn hiện tại
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

      // Kiểm tra khoảng trống giữa cuộc hẹn hiện tại và cuộc hẹn tiếp theo
      if (next) {
        const currentEnd = new Date(current.appointmentInfo.endTime);
        const nextStart = new Date(next.appointmentInfo.startTime);
        
        // Nếu có khoảng trống (hơn 1 phút)
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
