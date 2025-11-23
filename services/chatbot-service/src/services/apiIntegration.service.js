// API Integration Service - Execute API calls and inject results into conversation

const { callInternalApi } = require('../utils/internalApiClient');
const { parseApiRequest, hasApiRequest } = require('../utils/apiRequestParser');
const { RESPONSE_TEMPLATES } = require('../config/apiMapping');

/**
 * Check if GPT response needs API call
 * @param {string} gptResponse - Response from GPT
 * @returns {boolean} True if needs API call
 */
function needsApiCall(gptResponse) {
  return hasApiRequest(gptResponse);
}

/**
 * Execute API call based on GPT's request
 * @param {string} gptResponse - Response from GPT containing API request
 * @param {string} authToken - Optional JWT token for authenticated calls
 * @returns {Promise<object>} { success: boolean, data: any, error: string }
 */
async function executeApiCall(gptResponse, authToken = null) {
  try {
    // Parse API request from GPT response
    const parseResult = parseApiRequest(gptResponse);
    
    if (!parseResult.success) {
      console.error('[API Integration] Parse failed:', parseResult.error);
      return {
        success: false,
        data: null,
        error: parseResult.error
      };
    }

    const { action, params } = parseResult.apiRequest;

    // Call internal API
    console.log(`[API Integration] Executing ${action} with params:`, params);
    const apiResult = await callInternalApi(action, params, authToken);

    return apiResult;

  } catch (error) {
    console.error('[API Integration] Execution error:', error.message);
    return {
      success: false,
      data: null,
      error: error.message
    };
  }
}

/**
 * Format API result into human-readable response
 * @param {string} action - API action name
 * @param {object} apiResult - Result from API call
 * @returns {string} Formatted response text
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
      // Generic response for unknown actions
      if (Array.isArray(data)) {
        return `Tìm thấy ${data.length} kết quả. Bạn cần thông tin gì thêm không?`;
      }
      return 'Đã tìm thấy thông tin. Bạn cần hỗ trợ gì thêm không?';
  }
}

/**
 * Inject API result into conversation context
 * @param {Array} messages - Current conversation messages
 * @param {string} apiResponse - Formatted API response
 * @returns {Array} Updated messages with API result
 */
function injectApiResult(messages, apiResponse) {
  // Add API result as system message
  const systemMessage = {
    role: 'system',
    content: `API Result: ${apiResponse}\n\nHãy sử dụng thông tin này để trả lời người dùng một cách tự nhiên và thân thiện.`
  };

  return [...messages, systemMessage];
}

/**
 * Complete API integration flow
 * @param {string} gptResponse - Initial GPT response
 * @param {Array} conversationMessages - Current conversation
 * @param {string} authToken - Optional JWT token
 * @returns {Promise<object>} { needsApi: boolean, finalResponse: string, updatedMessages: Array }
 */
async function processApiIntegration(gptResponse, conversationMessages, authToken = null) {
  try {
    // Check if API call is needed
    if (!needsApiCall(gptResponse)) {
      return {
        needsApi: false,
        finalResponse: gptResponse,
        updatedMessages: conversationMessages,
        apiData: null
      };
    }

    // Parse and extract action
    const parseResult = parseApiRequest(gptResponse);
    if (!parseResult.success) {
      console.error('[API Integration] Parse failed, returning original response');
      return {
        needsApi: false,
        finalResponse: gptResponse,
        updatedMessages: conversationMessages,
        apiData: null
      };
    }

    // Execute API call
    const apiResult = await executeApiCall(gptResponse, authToken);
    
    // Format API result
    const action = parseResult.apiRequest.action;
    const formattedResult = formatApiResult(action, apiResult);

    // Inject into conversation (optional - for context)
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
