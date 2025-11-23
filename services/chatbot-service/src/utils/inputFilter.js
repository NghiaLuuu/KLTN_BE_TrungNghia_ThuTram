/**
 * Input Filter
 * Check if user message is related to dental/healthcare topics
 */

// Dental-related keywords (Vietnamese)
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

// Topics to reject (off-topic)
const REJECT_KEYWORDS = [
  'chính trị', 'bầu cử', 'tổng thống', 'quốc hội',
  'thể thao', 'bóng đá', 'world cup', 'olympic',
  'giải trí', 'phim', 'ca sĩ', 'diễn viên',
  'thời tiết', 'weather', 'dự báo', 'nóng', 'lạnh',
  'chứng khoán', 'crypto', 'bitcoin', 'đầu tư'
];

/**
 * Check if message is dental-related
 * @param {string} message - User message
 * @returns {object} { isValid: boolean, reason: string }
 */
const isDentalRelated = (message) => {
  if (!message || typeof message !== 'string') {
    return { isValid: false, reason: 'Empty message' };
  }

  const lowerMessage = message.toLowerCase();

  // Check for reject keywords first
  for (const keyword of REJECT_KEYWORDS) {
    if (lowerMessage.includes(keyword)) {
      return {
        isValid: false,
        reason: 'Off-topic: Not related to dental care'
      };
    }
  }

  // Check for dental keywords
  for (const keyword of DENTAL_KEYWORDS) {
    if (lowerMessage.includes(keyword)) {
      return {
        isValid: true,
        reason: 'Related to dental care'
      };
    }
  }

  // If no dental keywords found but message is a question, allow it
  // (GPT will handle politely declining if truly off-topic)
  if (lowerMessage.includes('?') || 
      lowerMessage.includes('sao') ||
      lowerMessage.includes('thế nào') ||
      lowerMessage.includes('như thế nào')) {
    return {
      isValid: true,
      reason: 'Question - let GPT evaluate'
    };
  }

  // Default: reject if no clear dental context
  return {
    isValid: false,
    reason: 'No clear dental context found'
  };
};

module.exports = {
  isDentalRelated,
  DENTAL_KEYWORDS,
  REJECT_KEYWORDS
};
