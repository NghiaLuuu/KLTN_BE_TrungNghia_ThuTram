const cron = require('node-cron');
const Appointment = require('../models/appointment.model');
const axios = require('axios');
// const Record = require('../models/record.model'); // Nếu cần

/**
 * ❌ ĐÃ XÓA: Cron tự động chuyển trạng thái (thay bằng Socket.IO event khi check-in)
 * Lý do: Hướng sự kiện hiệu quả và realtime hơn
 */

/**
 * ❌ ĐÃ XÓA: Cron tự động hoàn thành (thay bằng Socket.IO event khi bác sĩ hoàn thành)
 * Lý do: Hướng sự kiện hiệu quả và realtime hơn
 */

/**
 * Dọn dẹp slot lock hết hạn (khóa > 3 phút)
 * Chạy mỗi 1 phút để khớp Redis TTL (3 phút)
 */
function startCleanupExpiredLocksCron() {
  cron.schedule('* * * * *', async () => {
    try {
      const now = new Date();
      const threeMinutesAgo = new Date(now.getTime() - 3 * 60 * 1000);

      // console.log('🔍 [Cron] Đang kiểm tra slot lock hết hạn...');

      // Gọi schedule-service để lấy tất cả slot đang bị khóa
      const scheduleServiceUrl = process.env.SCHEDULE_SERVICE_URL || 'http://localhost:3005';
      
      const response = await axios.get(`${scheduleServiceUrl}/api/slot/locked`, {
        timeout: 5000 // Timeout 5 giây
      });

      if (!response.data || !response.data.success || !response.data.slots) {
        console.log('⚠️ [Cron] Không tìm thấy slot bị khóa hoặc API lỗi');
        return;
      }

      const lockedSlots = response.data.slots;

      // Lọc slot hết hạn (khóa > 3 phút trước)
      const expiredSlots = lockedSlots.filter(slot => {
        return slot.lockedAt && new Date(slot.lockedAt) < threeMinutesAgo;
      });

      if (expiredSlots.length === 0) {
        // console.log('✅ [Cron] Không có slot lock hết hạn');
        return;
      }

      console.log(`⚠️ [Cron] Tìm thấy ${expiredSlots.length} slot lock hết hạn`);

      // Mở khóa các slot hết hạn
      const slotIds = expiredSlots.map(slot => slot._id);
      await axios.put(`${scheduleServiceUrl}/api/slot/bulk-update`, {
        slotIds,
        updates: {
          status: 'available',
          lockedAt: null,
          lockedBy: null
        }
      }, {
        timeout: 5000 // Timeout 5 giây
      });

      console.log(`✅ [Cron] Đã mở khóa ${expiredSlots.length} slot hết hạn:`, slotIds);

    } catch (error) {
      if (error.code === 'ECONNREFUSED') {
        console.error('❌ [Cron] Không thể kết nối schedule-service. Service có đang chạy không?');
      } else if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
        console.error('❌ [Cron] Timeout khi kết nối schedule-service');
      } else if (error.response) {
        console.error('❌ [Cron] Lỗi schedule-service:', error.response.status, error.response.data);
      } else {
        console.error('❌ [Cron] Lỗi trong job dọn dẹp slot lock hết hạn:', error.message || error);
        console.error('Stack trace:', error.stack);
      }
    }
  });

  console.log('⏰ Cron job đã khởi động: Dọn dẹp slot lock hết hạn (3 phút, chạy mỗi 1 phút)');
}

/**
 * Gửi email nhắc nhở 1 ngày trước lịch hẹn
 * Chạy mỗi 1 phút (an toàn với compound index)
 */
function startReminderEmailCron() {
  cron.schedule('* * * * *', async () => {
    try {
      const now = new Date();
      const twoDaysLater = new Date(now.getTime() + 48 * 60 * 60 * 1000);
      
      const appointments = await Appointment.find({
        bookedByRole: 'patient',
        patientId: { $ne: null, $exists: true },
        status: { $in: ['confirmed', 'checked-in'] },
        reminderEmailSent: false,
        appointmentDate: {
          $gte: now,
          $lte: twoDaysLater
        }
      }).select('_id appointmentCode patientId patientInfo appointmentDate startTime endTime dentistName serviceName serviceAddOnName roomName subroomName').lean();

      // Lọc lịch hẹn theo thời gian bắt đầu chính xác (appointmentDate + startTime)
      const filteredAppointments = appointments.filter(apt => {
        const [hours, minutes] = apt.startTime.split(':').map(Number);
        
        // ✅ SỬA: appointmentDate lưu dạng UTC (vd: 2025-12-02T17:00:00Z = nửa đêm Việt Nam ngày 3/12)
        // startTime là giờ Việt Nam (vd: "08:00" Việt Nam)
        // Để có giờ UTC chính xác: cộng giờ startTime vào appointmentDate gốc
        const appointmentStartTime = new Date(apt.appointmentDate);
        appointmentStartTime.setUTCHours(appointmentStartTime.getUTCHours() + hours, minutes, 0, 0);
        
        const timeDiff = appointmentStartTime - now;
        const isWithin24Hours = timeDiff > 0 && timeDiff <= 24 * 60 * 60 * 1000;
        
        return isWithin24Hours;
      });
      
      if (filteredAppointments.length === 0) {
        return;
      }

      console.log(`📧 [Reminder] Sending emails for ${filteredAppointments.length} appointments...`);

      const rabbitmqClient = require('./rabbitmq.client');
      
      for (const apt of filteredAppointments) {
        try {
          await rabbitmqClient.publishToQueue('email_notifications', {
            type: 'appointment_reminder',
            patientId: apt.patientId.toString(),
            appointment: {
              appointmentCode: apt.appointmentCode,
              patientName: apt.patientInfo.name,
              patientEmail: apt.patientInfo.email,
              appointmentDate: apt.appointmentDate,
              startTime: apt.startTime,
              endTime: apt.endTime,
              dentistName: apt.dentistName,
              serviceName: apt.serviceName,
              serviceAddOnName: apt.serviceAddOnName,
              roomName: apt.roomName,
              subroomName: apt.subroomName
            }
          });

          await Appointment.updateOne(
            { _id: apt._id },
            { $set: { reminderEmailSent: true } }
          );

          console.log(`✅ [Reminder] Sent: ${apt.appointmentCode} → ${apt.patientInfo.email}`);
        } catch (error) {
          console.error(`❌ [Reminder] Failed ${apt.appointmentCode}:`, error.message);
        }
      }

    } catch (error) {
      console.error('❌ [Reminder] Cron error:', error.message);
    }
  });

  console.log('⏰ Cron gửi email nhắc nhở đã khởi động (mỗi 1 phút)');
}

/**
 * Tự động đánh dấu no-show cho lịch hẹn confirmed đã qua nửa thời gian khám
 * Chạy mỗi 1 phút để đảm bảo chính xác
 * 
 * Ví dụ: Lịch hẹn 08:00-08:15 (15 phút)
 * - Điểm giữa = 08:07:30 (50% của 15 phút = 7.5 phút)
 * - Cron kiểm tra lúc 08:08 → now (08:08) > điểm giữa (08:07:30) → Đánh dấu no-show
 * - Vậy no-show được đánh dấu ở phút 8, không phải phút 7
 */
function startNoShowCron() {
  cron.schedule('* * * * *', async () => {
    try {
      const now = new Date();

      // Tìm lịch hẹn có status 'confirmed'
      // Lọc theo appointmentDate để loại bỏ ngày tương lai (tối ưu hiệu năng)
      const appointments = await Appointment.find({
        status: 'confirmed',
        appointmentDate: { $lte: now } // Chỉ lịch hẹn hôm nay hoặc trước đó
      }).select('_id appointmentCode appointmentDate startTime endTime patientInfo').lean();

      // Lọc lịch hẹn đã qua nửa thời gian khám mà chưa check-in
      const overdueAppointments = [];
      
      for (const apt of appointments) {
        const [startHours, startMinutes] = apt.startTime.split(':').map(Number);
        const [endHours, endMinutes] = apt.endTime.split(':').map(Number);
        
        // ✅ SỬA: appointmentDate lưu dạng UTC (vd: 2025-12-02T17:00:00Z = nửa đêm Việt Nam ngày 3/12)
        // startTime/endTime là giờ Việt Nam (vd: "08:00", "09:00" Việt Nam)
        // Để có giờ UTC chính xác: cộng số giờ vào appointmentDate UTC
        // Ví dụ: 2025-12-02T17:00:00Z + 8 giờ = 2025-12-03T01:00:00Z (08:00 Việt Nam)
        const appointmentStartTime = new Date(apt.appointmentDate);
        appointmentStartTime.setUTCHours(appointmentStartTime.getUTCHours() + startHours, startMinutes, 0, 0);
        
        const appointmentEndTime = new Date(apt.appointmentDate);
        appointmentEndTime.setUTCHours(appointmentEndTime.getUTCHours() + endHours, endMinutes, 0, 0);
        
        // Tính thời điểm giữa: (startTime + endTime) / 2
        const midPointTime = new Date((appointmentStartTime.getTime() + appointmentEndTime.getTime()) / 2);
        
        // Kiểm tra nếu thời gian hiện tại > điểm giữa (đã qua nửa thời gian khám)
        if (now > midPointTime) {
          overdueAppointments.push({
            ...apt,
            midPointTime,
            appointmentStartTime,
            appointmentEndTime
          });
        }
      }

      if (overdueAppointments.length === 0) {
        return;
      }

      console.log(`⚠️ [No-Show] Tìm thấy ${overdueAppointments.length} lịch hẹn đã qua nửa thời gian khám mà chưa check-in`);

      // Cập nhật status thành no-show
      const appointmentIds = overdueAppointments.map(apt => apt._id);
      const result = await Appointment.updateMany(
        { _id: { $in: appointmentIds } },
        { 
          $set: { 
            status: 'no-show',
            updatedAt: now
          } 
        }
      );

      console.log(`✅ [No-Show] Đã đánh dấu ${result.modifiedCount} lịch hẹn là no-show:`);
      overdueAppointments.forEach(apt => {
        console.log(`   - ${apt.appointmentCode} (${apt.appointmentDate.toLocaleDateString()} ${apt.startTime}-${apt.endTime}) - Điểm giữa: ${apt.midPointTime.toLocaleTimeString()} - ${apt.patientInfo?.name || 'N/A'}`);
      });

      // 🔥 Tùy chọn: Gửi thông báo/email về no-show (nâng cấp trong tương lai)
      // Có thể publish vào RabbitMQ queue để email service thông báo cho nhân viên

    } catch (error) {
      console.error('❌ [No-Show] Lỗi Cron:', error.message);
      console.error('Stack trace:', error.stack);
    }
  });

  console.log('⏰ Cron kiểm tra no-show đã khởi động (mỗi 1 phút)');
}

/**
 * Khởi động các cron job thiết yếu
 * Lưu ý: Auto-progress và auto-complete đã bị xóa (thay bằng Socket.IO)
 */
function startAllCronJobs() {
  startCleanupExpiredLocksCron();
  startReminderEmailCron();
  startNoShowCron();
  console.log('✅ Các cron job thiết yếu đã khởi động (dọn dẹp + nhắc nhở + no-show)');
  console.log('ℹ️  Auto-progress và auto-complete giờ được xử lý bởi Socket.IO events');
}

module.exports = {
  startAllCronJobs,
  startCleanupExpiredLocksCron,
  startReminderEmailCron,
  startNoShowCron
};
