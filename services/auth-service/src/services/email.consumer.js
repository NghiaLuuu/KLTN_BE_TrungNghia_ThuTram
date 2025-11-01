const rabbitmqClient = require('../utils/rabbitmq.client');
const { sendEmail } = require('../utils/mail.util');

/**
 * Email Consumer Service
 * Listens to email_notifications queue and sends emails
 */

const EMAIL_QUEUE_NAME = 'email_notifications';

// Format date helper
const formatDate = (date) => {
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
};

const formatTime = (date) => {
  const d = new Date(date);
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
};

// Email templates
const createSlotCancellationEmail = (notification) => {
  const { name, role, slotInfo, reason } = notification;
  const date = formatDate(slotInfo.date);
  const startTime = formatTime(slotInfo.startTime);
  const endTime = formatTime(slotInfo.endTime);

  const roleText = {
    patient: 'Kính gửi Quý khách hàng',
    dentist: 'Kính gửi Bác sĩ',
    nurse: 'Kính gửi Y tá'
  };

  const subject = '[THÔNG BÁO KHẨN] Lịch Khám Bị Hủy - Smile Dental';

  const text = `
${roleText[role] || 'Kính gửi'} ${name},

Chúng tôi rất tiếc phải thông báo rằng lịch ${role === 'patient' ? 'khám' : 'làm việc'} của bạn đã bị hủy do tình huống khẩn cấp.

📅 THÔNG TIN LỊCH BỊ HỦY:
- Ngày: ${date}
- Ca: ${slotInfo.shiftName}
- Thời gian: ${startTime} - ${endTime}

❗ LÝ DO:
${reason}

${role === 'patient' ? `
🔄 HƯỚNG DẪN ĐẶT LỊCH MỚI:
Quý khách vui lòng:
1. Truy cập website: ${process.env.FRONTEND_URL || 'https://smiledental.com'}
2. Đặt lại lịch khám trong thời gian phù hợp
3. Hoặc liên hệ hotline: ${process.env.HOTLINE || '1900-xxxx'} để được hỗ trợ

💰 HOÀN TIỀN (nếu đã thanh toán):
Chúng tôi sẽ hoàn lại toàn bộ số tiền đã thanh toán trong vòng 3-5 ngày làm việc.
` : `
📋 LƯU Ý:
Quý ${role === 'dentist' ? 'Bác sĩ' : 'Y tá'} vui lòng kiểm tra lại lịch làm việc và sắp xếp thời gian phù hợp.
`}

Chúng tôi chân thành xin lỗi vì sự bất tiện này và cam kết phục vụ bạn tốt hơn trong tương lai.

Trân trọng,
Đội ngũ Smile Dental
Email: ${process.env.EMAIL_FROM}
Hotline: ${process.env.HOTLINE || '1900-xxxx'}
`;

  return { subject, text };
};

// 🆕 Email template for slot status change (enable/disable)
const createSlotStatusChangeEmail = (notification) => {
  const { name, role, slotInfo, action, reason } = notification;
  
  // slotInfo already contains formatted strings from schedule-service
  // date: 'DD/MM/YYYY', startTime: 'HH:mm', endTime: 'HH:mm'
  const date = slotInfo.date; // Already formatted as '27/10/2025'
  const startTime = slotInfo.startTime; // Already formatted as '08:00'
  const endTime = slotInfo.endTime; // Already formatted as '12:00'
  const slotCount = slotInfo.slotCount || 1;

  const roleText = {
    patient: 'Kính gửi Quý khách hàng',
    dentist: 'Kính gửi Bác sĩ',
    nurse: 'Kính gửi Y tá'
  };

  const isEnabled = action === 'enabled';
  
  const subject = isEnabled 
    ? '[THÔNG BÁO] Lịch Khám Được Kích Hoạt Lại - Smile Dental'
    : '[THÔNG BÁO] Thay Đổi Trạng Thái Lịch Khám - Smile Dental';

  const text = `
${roleText[role] || 'Kính gửi'} ${name},

${isEnabled ? `
Chúng tôi xin thông báo lịch ${role === 'patient' ? 'khám' : 'làm việc'} của bạn đã được KÍCH HOẠT LẠI.
` : `
Chúng tôi xin thông báo lịch ${role === 'patient' ? 'khám' : 'làm việc'} của bạn đã bị TẠM NGƯNG.
`}

📅 THÔNG TIN LỊCH:
- Ngày: ${date}
- Ca: ${slotInfo.shiftName}
- Thời gian: ${startTime} - ${endTime}
${slotCount > 1 ? `- Số lượng slot: ${slotCount}\n` : ''}${notification.appointmentCode ? `- Mã lịch hẹn: ${notification.appointmentCode}\n` : ''}

${isEnabled ? '✅' : '❗'} ${isEnabled ? 'TRẠNG THÁI' : 'LÝ DO'}:
${reason}

${role === 'patient' ? (
  isEnabled ? `
✅ LỊCH ĐÃ SẴN SÀNG:
Lịch khám của bạn đã có thể sử dụng bình thường. Vui lòng đến đúng giờ theo lịch đã đặt.

📞 Liên hệ: ${process.env.HOTLINE || '1900-xxxx'} nếu cần hỗ trợ.
` : `
🔄 HƯỚNG DẪN:
Lịch khám tạm thời không khả dụng. Quý khách vui lòng:
1. Liên hệ hotline: ${process.env.HOTLINE || '1900-xxxx'}
2. Hoặc đợi thông báo tiếp theo khi lịch được kích hoạt lại

💰 HOÀN TIỀN (nếu đã thanh toán):
Nếu không thể sắp xếp lại, chúng tôi sẽ hoàn tiền trong 3-5 ngày làm việc.
`
) : `
📋 LƯU Ý:
Quý ${role === 'dentist' ? 'Bác sĩ' : 'Y tá'} vui lòng kiểm tra lại lịch làm việc.
${isEnabled ? 'Lịch đã sẵn sàng cho ca làm việc.' : 'Lịch tạm thời không hoạt động.'}
`}

Trân trọng,
Đội ngũ Smile Dental
Email: ${process.env.EMAIL_FROM}
Hotline: ${process.env.HOTLINE || '1900-xxxx'}
`;

  return { subject, text };
};

// Message handler
const handleEmailNotification = async (message) => {
  try {
    const { type, notifications, metadata } = message;

    console.log(`📧 Processing ${type} with ${notifications?.length || 0} notifications`);

    if (type === 'slot_cancellation_batch' && Array.isArray(notifications)) {
      let successCount = 0;
      let failCount = 0;

      // Send emails sequentially to avoid rate limits
      for (const notification of notifications) {
        try {
          const { email } = notification;
          
          if (!email) {
            console.warn('⚠️ Notification missing email, skipping...');
            failCount++;
            continue;
          }

          const { subject, text } = createSlotCancellationEmail(notification);

          await sendEmail(email, subject, text);
          
          console.log(`✅ Email sent to: ${email} (${notification.role})`);
          successCount++;

          // Add delay to avoid rate limits (Gmail: 500 emails/day, ~1 email/3 seconds safe)
          await new Promise(resolve => setTimeout(resolve, 3000));

        } catch (emailError) {
          console.error(`❌ Failed to send email to ${notification.email}:`, emailError.message);
          failCount++;
        }
      }

      console.log(`📊 Email batch completed: ${successCount} success, ${failCount} failed`);
      
      if (metadata) {
        console.log(`📝 Metadata: Room ${metadata.roomId}, Date ${metadata.date}, By ${metadata.disabledBy}`);
      }
    } else if (type === 'slot_status_change' && Array.isArray(notifications)) {
      // 🆕 Handle slot status change (enable/disable)
      let successCount = 0;
      let failCount = 0;

      for (const notification of notifications) {
        try {
          const { email } = notification;
          
          if (!email) {
            console.warn('⚠️ Notification missing email, skipping...');
            failCount++;
            continue;
          }

          const { subject, text } = createSlotStatusChangeEmail(notification);

          await sendEmail(email, subject, text);
          
          console.log(`✅ Email sent to: ${email} (${notification.role}) - Action: ${notification.action}`);
          successCount++;

          // Add delay to avoid rate limits
          await new Promise(resolve => setTimeout(resolve, 3000));

        } catch (emailError) {
          console.error(`❌ Failed to send email to ${notification.email}:`, emailError.message);
          failCount++;
        }
      }

      console.log(`📊 Email batch completed: ${successCount} success, ${failCount} failed`);
      
      if (metadata) {
        console.log(`📝 Metadata: Action ${metadata.action}, Affected slots: ${metadata.affectedSlots}, Unique appointments: ${metadata.uniqueAppointments}`);
      }
    } else {
      console.warn(`⚠️ Unknown message type: ${type}`);
    }
  } catch (error) {
    console.error('❌ Error handling email notification:', error);
    throw error; // Re-throw to nack the message
  }
};

// Start email consumer
const startEmailConsumer = async () => {
  try {
    console.log('🚀 Starting email consumer...');
    
    await rabbitmqClient.connect();
    await rabbitmqClient.consumeQueue(EMAIL_QUEUE_NAME, handleEmailNotification);
    
    console.log(`✅ Email consumer started, listening on queue: ${EMAIL_QUEUE_NAME}`);
  } catch (error) {
    console.error('❌ Failed to start email consumer:', error);
    
    // Retry after delay
    setTimeout(() => {
      console.log('🔄 Retrying email consumer startup...');
      startEmailConsumer();
    }, 10000);
  }
};

module.exports = {
  startEmailConsumer,
  handleEmailNotification
};
