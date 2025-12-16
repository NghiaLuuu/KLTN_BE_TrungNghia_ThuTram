// Client API nội bộ - Gọi các microservice khác

const axios = require('axios');
const { API_ENDPOINTS } = require('../config/apiMapping');

/**
 * Tạo instance axios cho các cuộc gọi API nội bộ
 */
const internalAxios = axios.create({
  timeout: 10000, // 10 giây
  headers: {
    'Content-Type': 'application/json',
    'X-Internal-Call': 'true' // Đánh dấu là cuộc gọi service nội bộ
  }
});

/**
 * Xây dựng URL với các path parameters
 * @param {string} path - Đường dẫn URL với các placeholder :param
 * @param {object} params - Object các tham số
 * @returns {string} URL hoàn chỉnh
 */
function buildUrl(path, params) {
  let url = path;
  
  // Thay thế các path parameters (:id, :doctorId, v.v.)
  Object.keys(params).forEach(key => {
    const placeholder = `:${key}`;
    if (url.includes(placeholder)) {
      url = url.replace(placeholder, params[key]);
      delete params[key]; // Xóa khỏi params sau khi sử dụng trong path
    }
  });
  
  return url;
}

/**
 * Gọi API endpoint nội bộ
 * @param {string} action - Tên action từ API_ENDPOINTS
 * @param {object} params - Các tham số API
 * @param {string} authToken - JWT token tùy chọn cho các request cần xác thực
 * @returns {Promise<object>} Dữ liệu phản hồi API
 */
async function callInternalApi(action, params = {}, authToken = null) {
  try {
    // Lấy cấu hình endpoint
    const endpoint = API_ENDPOINTS[action];
    
    if (!endpoint) {
      throw new Error(`Action API không xác định: ${action}`);
    }

    // Xây dựng URL
    const path = buildUrl(endpoint.path, { ...params });
    const url = `${endpoint.baseUrl}${path}`;

    // Chuẩn bị cấu hình request
    const config = {
      method: endpoint.method,
      url
    };

    // Thêm auth token nếu có
    if (authToken) {
      config.headers = {
        ...config.headers,
        'Authorization': `Bearer ${authToken}`
      };
    }

    // Thêm query params cho các request GET
    if (endpoint.method === 'GET' && Object.keys(params).length > 0) {
      config.params = params;
    }

    // Thêm body cho các request POST/PUT
    if (['POST', 'PUT', 'PATCH'].includes(endpoint.method)) {
      config.data = params;
    }

    // Thực hiện gọi API
    console.log(`[Internal API] Đang gọi ${action}: ${config.method} ${url}`);
    const response = await internalAxios(config);

    // Trả về dữ liệu
    return {
      success: true,
      data: response.data?.data || response.data,
      statusCode: response.status
    };

  } catch (error) {
    console.error(`[Internal API] Lỗi khi gọi ${action}:`, error.message);
    
    // Xử lý các loại lỗi khác nhau
    if (error.response) {
      // Server phản hồi với trạng thái lỗi
      return {
        success: false,
        error: error.response.data?.message || error.message,
        statusCode: error.response.status
      };
    } else if (error.request) {
      // Request được gửi nhưng không có phản hồi
      return {
        success: false,
        error: 'Dịch vụ không khả dụng. Vui lòng thử lại sau.',
        statusCode: 503
      };
    } else {
      // Lỗi trong thiết lập request
      return {
        success: false,
        error: error.message,
        statusCode: 500
      };
    }
  }
}

/**
 * Gọi nhiều API song song
 * @param {Array<{action: string, params: object}>} requests - Mảng các API request
 * @param {string} authToken - JWT token tùy chọn
 * @returns {Promise<Array<object>>} Mảng các phản hồi API
 */
async function callMultipleApis(requests, authToken = null) {
  try {
    const promises = requests.map(req => 
      callInternalApi(req.action, req.params, authToken)
    );
    
    const results = await Promise.allSettled(promises);
    
    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        console.error(`[Internal API] Request ${index} thất bại:`, result.reason);
        return {
          success: false,
          error: result.reason?.message || 'Lỗi không xác định',
          statusCode: 500
        };
      }
    });

  } catch (error) {
    console.error('[Internal API] Lỗi trong các cuộc gọi song song:', error.message);
    throw error;
  }
}

/**
 * Kiểm tra sức khỏe dịch vụ
 * @param {string} serviceUrl - URL gốc của dịch vụ
 * @returns {Promise<boolean>} True nếu dịch vụ hoạt động tốt
 */
async function checkServiceHealth(serviceUrl) {
  try {
    const response = await internalAxios.get(`${serviceUrl}/health`, {
      timeout: 3000
    });
    return response.status === 200;
  } catch (error) {
    console.error(`[Health Check] ${serviceUrl} is down:`, error.message);
    return false;
  }
}

module.exports = {
  callInternalApi,
  callMultipleApis,
  checkServiceHealth,
  internalAxios
};
