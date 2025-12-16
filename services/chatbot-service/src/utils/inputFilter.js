/**
 * Bộ lọc Input
 * Kiểm tra xem tin nhắn người dùng có liên quan đến nha khoa/chăm sóc sức khỏe không
 */

// Các từ khóa liên quan nha khoa (tiếng Việt)
const DENTAL_KEYWORDS = [
  'răng', 'nha khoa', 'Nha sĩ', 'nha sĩ', 'khám', 'điều trị',
  'dịch vụ', 'giá', 'chi phí', 'đặt lịch', 'hẹn', 'booking',
  'tẩy trắng', 'niềng răng', 'nhổ răng', 'trám răng', 'implant',
  'bọc răng sứ', 'cạo vôi', 'tẩy trắng', 'sâu răng', 'viêm nướu',
  'chảy máu chân răng', 'mảng bám', 'cao răng', 'hôi miệng',
  'lấy tủy', 'nội nha', 'chỉnh nha', 'phục hình', 'phẫu thuật',
  'smile', 'dental', 'teeth', 'tooth', 'dentist', 'clinic',
  'phòng khám', 'smilecare', 'smile care', 'tư vấn', 'khách hàng',
  'lịch làm việc', 'thời gian', 'slot', 'ca', 'làm việc'
];

// Các chủ đề bị từ chối (ngoài phạm vi)
const REJECT_KEYWORDS = [
  'chính trị', 'bầu cử', 'tổng thống', 'quốc hội',
  'thể thao', 'bóng đá', 'world cup', 'olympic',
  'giải trí', 'phim', 'ca sĩ', 'diễn viên',
  'thời tiết', 'weather', 'dự báo', 'nóng', 'lạnh',
  'chứng khoán', 'crypto', 'bitcoin', 'đầu tư'
];

/**
 * Kiểm tra xem tin nhắn có liên quan nha khoa không
 * @param {string} message - Tin nhắn người dùng
 * @returns {object} { isValid: boolean, reason: string }
 */
const isDentalRelated = (message) => {
  if (!message || typeof message !== 'string') {
    return { isValid: false, reason: 'Tin nhắn trống' };
  }

  const lowerMessage = message.toLowerCase();

  // Kiểm tra từ khóa bị từ chối trước
  for (const keyword of REJECT_KEYWORDS) {
    if (lowerMessage.includes(keyword)) {
      return {
        isValid: false,
        reason: 'Ngoài phạm vi: Không liên quan đến nha khoa'
      };
    }
  }

  // Kiểm tra từ khóa nha khoa
  for (const keyword of DENTAL_KEYWORDS) {
    if (lowerMessage.includes(keyword)) {
      return {
        isValid: true,
        reason: 'Liên quan đến nha khoa'
      };
    }
  }

  // Nếu không tìm thấy từ khóa nha khoa nhưng tin nhắn là câu hỏi, cho phép
  // (GPT sẽ xử lý từ chối lịch sự nếu thực sự ngoài phạm vi)
  if (lowerMessage.includes('?') || 
      lowerMessage.includes('sao') ||
      lowerMessage.includes('thế nào') ||
      lowerMessage.includes('như thế nào')) {
    return {
      isValid: true,
      reason: 'Câu hỏi - để GPT đánh giá'
    };
  }

  // Mặc định: từ chối nếu không có ngữ cảnh nha khoa rõ ràng
  return {
    isValid: false,
    reason: 'Không tìm thấy ngữ cảnh nha khoa rõ ràng'
  };
};

module.exports = {
  isDentalRelated,
  DENTAL_KEYWORDS,
  REJECT_KEYWORDS
};
