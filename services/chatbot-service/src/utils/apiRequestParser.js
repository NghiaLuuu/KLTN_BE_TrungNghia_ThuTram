// Phân tích JSON request API từ các phản hồi GPT

/**
 * Phân tích API request từ phản hồi GPT
 * Định dạng mong đợi trong phản hồi GPT:
 * ```json
 * {
 *   "action": "SEARCH_SERVICES",
 *   "params": {
 *     "query": "tẩy trắng răng"
 *   }
 * }
 * ```
 */

const { API_ENDPOINTS } = require('../config/apiMapping');

/**
 * Trích xuất JSON API request từ văn bản phản hồi GPT
 * @param {string} responseText - Văn bản phản hồi GPT
 * @returns {object|null} API request đã phân tích hoặc null
 */
function extractApiRequest(responseText) {
  try {
    // Tìm tag [API_CALL] trước (định dạng mới)
    const apiCallMatch = responseText.match(/\[API_CALL\]([\s\S]*?)\[\/API_CALL\]/);
    if (apiCallMatch) {
      console.log('[Parser] Tìm thấy tag [API_CALL]:', apiCallMatch[1].trim());
      return JSON.parse(apiCallMatch[1].trim());
    }

    // Tìm khối JSON trong markdown code fence
    const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      console.log('[Parser] Tìm thấy khối ```json:', jsonMatch[1].trim());
      return JSON.parse(jsonMatch[1].trim());
    }

    // Tìm object JSON trực tiếp
    const objectMatch = responseText.match(/\{[\s\S]*"action"[\s\S]*\}/);
    if (objectMatch) {
      console.log('[Parser] Tìm thấy object JSON:', objectMatch[0]);
      return JSON.parse(objectMatch[0]);
    }

    console.log('[Parser] Không tìm thấy API request trong:', responseText);
    return null;
  } catch (error) {
    console.error('[Parser] Lỗi trích xuất API request:', error.message);
    return null;
  }
}

/**
 * Xác thực cấu trúc API request
 * @param {object} apiRequest - API request đã phân tích
 * @returns {boolean} True nếu hợp lệ
 */
function validateApiRequest(apiRequest) {
  if (!apiRequest || typeof apiRequest !== 'object') {
    return false;
  }

  // Phải có trường action
  if (!apiRequest.action || typeof apiRequest.action !== 'string') {
    return false;
  }

  // Action phải hợp lệ
  if (!API_ENDPOINTS[apiRequest.action]) {
    console.warn(`Action không hợp lệ: ${apiRequest.action}`);
    return false;
  }

  // Params phải là object (có thể rỗng)
  if (apiRequest.params && typeof apiRequest.params !== 'object') {
    return false;
  }

  return true;
}

/**
 * Kiểm tra xem các params bắt buộc có hiện diện không
 * @param {object} apiRequest - API request đã phân tích
 * @returns {object} { valid: boolean, missing: string[] }
 */
function checkRequiredParams(apiRequest) {
  const endpoint = API_ENDPOINTS[apiRequest.action];
  
  if (!endpoint || !endpoint.params || endpoint.params.length === 0) {
    return { valid: true, missing: [] };
  }

  const params = apiRequest.params || {};
  const missing = [];

  endpoint.params.forEach(param => {
    if (!params[param]) {
      missing.push(param);
    }
  });

  return {
    valid: missing.length === 0,
    missing
  };
}

/**
 * Phân tích và xác thực đầy đủ API request
 * @param {string} responseText - Văn bản phản hồi GPT
 * @returns {object} { success: boolean, apiRequest: object, error: string }
 */
function parseApiRequest(responseText) {
  // Trích xuất API request
  const apiRequest = extractApiRequest(responseText);
  
  if (!apiRequest) {
    return {
      success: false,
      apiRequest: null,
      error: 'Không tìm thấy API request trong phản hồi'
    };
  }

  // Xác thực cấu trúc
  if (!validateApiRequest(apiRequest)) {
    return {
      success: false,
      apiRequest: null,
      error: 'Cấu trúc API request không hợp lệ'
    };
  }

  // Kiểm tra các params bắt buộc
  const paramCheck = checkRequiredParams(apiRequest);
  if (!paramCheck.valid) {
    return {
      success: false,
      apiRequest: null,
      error: `Thiếu các params bắt buộc: ${paramCheck.missing.join(', ')}`
    };
  }

  return {
    success: true,
    apiRequest,
    error: null
  };
}

/**
 * Kiểm tra xem văn bản phản hồi có chứa API request không
 * @param {string} responseText - Văn bản phản hồi GPT
 * @returns {boolean} True nếu có chứa API request
 */
function hasApiRequest(responseText) {
  if (!responseText || typeof responseText !== 'string') {
    return false;
  }

  // Kiểm tra tag [API_CALL] (ưu tiên)
  if (responseText.includes('[API_CALL]')) {
    return true;
  }

  // Kiểm tra các marker JSON
  return responseText.includes('"action"') && 
         (responseText.includes('```json') || responseText.includes('{'));
}

module.exports = {
  extractApiRequest,
  validateApiRequest,
  checkRequiredParams,
  parseApiRequest,
  hasApiRequest
};
