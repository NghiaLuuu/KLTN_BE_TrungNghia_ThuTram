// API Integration Service - Thực thi các API call và chèn kết quả vào hội thoại

const { callInternalApi } = require('../utils/internalApiClient');
const { parseApiRequest, hasApiRequest } = require('../utils/apiRequestParser');
const { RESPONSE_TEMPLATES } = require('../config/apiMapping');

/**
 * Kiểm tra phản hồi GPT có cần API call không
 * @param {string} gptResponse - Phản hồi từ GPT
 * @returns {boolean} True nếu cần API call
 */
function needsApiCall(gptResponse) {
  return hasApiRequest(gptResponse);
}

/**
 * Thực thi API call dựa trên yêu cầu của GPT
 * @param {string} gptResponse - Phản hồi từ GPT chứa API request
 * @param {string} authToken - JWT token tùy chọn cho các call có xác thực
 * @returns {Promise<object>} { success: boolean, data: any, error: string }
 */
async function executeApiCall(gptResponse, authToken = null) {
  try {
    // Phân tích API request từ phản hồi GPT
    const parseResult = parseApiRequest(gptResponse);
    
    if (!parseResult.success) {
      console.error('[API Integration] Parse thất bại:', parseResult.error);
      return {
        success: false,
        data: null,
        error: parseResult.error
      };
    }

    const { action, params } = parseResult.apiRequest;

    // Gọi internal API
    console.log(`[API Integration] Thực thi ${action} với params:`, params);
    const apiResult = await callInternalApi(action, params, authToken);

    return apiResult;

  } catch (error) {
    console.error('[API Integration] Lỗi thực thi:', error.message);
    return {
      success: false,
      data: null,
      error: error.message
    };
  }
}

/**
 * Định dạng kết quả API thành phản hồi dễ đọc cho người dùng
 * @param {string} action - Tên action API
 * @param {object} apiResult - Kết quả từ API call
 * @returns {string} Phản hồi đã định dạng
 */
function formatApiResult(action, apiResult) {
  if (!apiResult.success) {
    return RESPONSE_TEMPLATES.API_ERROR();
  }

  const data = apiResult.data;

  // Handle different action types
  switch (action) {
    case 'SEARCH_SERVICES':
    case 'GET_ALL_SERVICES':
      return RESPONSE_TEMPLATES.SERVICES_FOUND(data?.services || data || []);

    case 'GET_AVAILABLE_SLOTS':
      const date = data?.date || 'này';
      return RESPONSE_TEMPLATES.SLOTS_FOUND(data?.slots || data || [], date);

    case 'GET_DOCTORS_LIST':
    case 'GET_DOCTORS_BY_SERVICE':
      return RESPONSE_TEMPLATES.DOCTORS_FOUND(data?.doctors || data || []);

    case 'GET_SERVICE_DETAIL':
      if (!data || !data.name) {
        return 'Không tìm thấy thông tin dịch vụ này. Vui lòng liên hệ hotline! 📞';
      }
      let response = `**${data.name}**\n\n`;
      if (data.description) {
        response += `📝 Mô tả: ${data.description}\n\n`;
      }
      if (data.price) {
        response += `💰 Giá: ${data.price.toLocaleString('vi-VN')} VNĐ\n\n`;
      }
      if (data.duration) {
        response += `⏱️ Thời gian: ${data.duration} phút\n\n`;
      }
      response += 'Bạn muốn đặt lịch khám dịch vụ này không? 😊';
      return response;

    case 'GET_DOCTOR_INFO':
      if (!data || !data.fullName) {
        return 'Không tìm thấy thông tin Nha sĩ. Vui lòng liên hệ hotline! 👨‍⚕️';
      }
      let doctorResponse = `**BS. ${data.fullName}**\n\n`;
      if (data.specialization) {
        doctorResponse += `🎓 Chuyên môn: ${data.specialization}\n`;
      }
      if (data.experience) {
        doctorResponse += `💼 Kinh nghiệm: ${data.experience} năm\n`;
      }
      if (data.email) {
        doctorResponse += `📧 Email: ${data.email}\n`;
      }
      doctorResponse += '\nBạn muốn đặt lịch với Nha sĩ này không? 😊';
      return doctorResponse;

    case 'GET_DOCTOR_SCHEDULE':
      if (!data || !data.slots || data.slots.length === 0) {
        return 'Nha sĩ này hiện không có lịch trống. Vui lòng chọn ngày khác! 📅';
      }
      let scheduleResponse = `Lịch khám của Nha sĩ:\n\n`;
      data.slots.slice(0, 10).forEach((slot, index) => {
        scheduleResponse += `${index + 1}. ${slot.startTime} - ${slot.endTime}\n`;
      });
      scheduleResponse += '\nBạn muốn đặt khung giờ nào? 🦷';
      return scheduleResponse;

    default:
      // Phản hồi chung cho các action không xác định
      if (Array.isArray(data)) {
        return `Tìm thấy ${data.length} kết quả. Bạn cần thông tin gì thêm không?`;
      }
      return 'Đã tìm thấy thông tin. Bạn cần hỗ trợ gì thêm không?';
  }
}

/**
 * Chèn kết quả API vào ngữ cảnh hội thoại
 * @param {Array} messages - Các tin nhắn hội thoại hiện tại
 * @param {string} apiResponse - Phản hồi API đã định dạng
 * @returns {Array} Tin nhắn đã cập nhật với kết quả API
 */
function injectApiResult(messages, apiResponse) {
  // Thêm kết quả API như system message
  const systemMessage = {
    role: 'system',
    content: `API Result: ${apiResponse}\n\nHãy sử dụng thông tin này để trả lời người dùng một cách tự nhiên và thân thiện.`
  };

  return [...messages, systemMessage];
}

/**
 * Luồng tích hợp API hoàn chỉnh
 * @param {string} gptResponse - Phản hồi GPT ban đầu
 * @param {Array} conversationMessages - Hội thoại hiện tại
 * @param {string} authToken - JWT token tùy chọn
 * @returns {Promise<object>} { needsApi: boolean, finalResponse: string, updatedMessages: Array }
 */
async function processApiIntegration(gptResponse, conversationMessages, authToken = null) {
  try {
    // Kiểm tra có cần API call không
    if (!needsApiCall(gptResponse)) {
      return {
        needsApi: false,
        finalResponse: gptResponse,
        updatedMessages: conversationMessages,
        apiData: null
      };
    }

    // Phân tích và trích xuất action
    const parseResult = parseApiRequest(gptResponse);
    if (!parseResult.success) {
      console.error('[API Integration] Parse thất bại, trả về phản hồi gốc');
      return {
        needsApi: false,
        finalResponse: gptResponse,
        updatedMessages: conversationMessages,
        apiData: null
      };
    }

    // Thực thi API call
    const apiResult = await executeApiCall(gptResponse, authToken);
    
    // Định dạng kết quả API
    const action = parseResult.apiRequest.action;
    const formattedResult = formatApiResult(action, apiResult);

    // Chèn vào hội thoại (tùy chọn - cho ngữ cảnh)
    const updatedMessages = injectApiResult(conversationMessages, formattedResult);

    return {
      needsApi: true,
      finalResponse: formattedResult,
      updatedMessages,
      apiData: apiResult.data,
      action
    };

  } catch (error) {
    console.error('[API Integration] Process error:', error.message);
    return {
      needsApi: false,
      finalResponse: gptResponse,
      updatedMessages: conversationMessages,
      apiData: null,
      error: error.message
    };
  }
}

module.exports = {
  needsApiCall,
  executeApiCall,
  formatApiResult,
  injectApiResult,
  processApiIntegration
};
