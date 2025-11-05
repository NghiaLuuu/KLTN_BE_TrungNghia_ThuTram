// Internal API Client - Call other microservices

const axios = require('axios');
const { API_ENDPOINTS } = require('../config/apiMapping');

/**
 * Create axios instance for internal API calls
 */
const internalAxios = axios.create({
  timeout: 10000, // 10 seconds
  headers: {
    'Content-Type': 'application/json',
    'X-Internal-Call': 'true' // Mark as internal service call
  }
});

/**
 * Build URL with path parameters
 * @param {string} path - URL path with :param placeholders
 * @param {object} params - Parameters object
 * @returns {string} Complete URL
 */
function buildUrl(path, params) {
  let url = path;
  
  // Replace path parameters (:id, :doctorId, etc.)
  Object.keys(params).forEach(key => {
    const placeholder = `:${key}`;
    if (url.includes(placeholder)) {
      url = url.replace(placeholder, params[key]);
      delete params[key]; // Remove from params after using in path
    }
  });
  
  return url;
}

/**
 * Call internal API endpoint
 * @param {string} action - Action name from API_ENDPOINTS
 * @param {object} params - API parameters
 * @param {string} authToken - Optional JWT token for authenticated requests
 * @returns {Promise<object>} API response data
 */
async function callInternalApi(action, params = {}, authToken = null) {
  try {
    // Get endpoint config
    const endpoint = API_ENDPOINTS[action];
    
    if (!endpoint) {
      throw new Error(`Unknown API action: ${action}`);
    }

    // Build URL
    const path = buildUrl(endpoint.path, { ...params });
    const url = `${endpoint.baseUrl}${path}`;

    // Prepare request config
    const config = {
      method: endpoint.method,
      url
    };

    // Add auth token if provided
    if (authToken) {
      config.headers = {
        ...config.headers,
        'Authorization': `Bearer ${authToken}`
      };
    }

    // Add query params for GET requests
    if (endpoint.method === 'GET' && Object.keys(params).length > 0) {
      config.params = params;
    }

    // Add body for POST/PUT requests
    if (['POST', 'PUT', 'PATCH'].includes(endpoint.method)) {
      config.data = params;
    }

    // Make API call
    console.log(`[Internal API] Calling ${action}: ${config.method} ${url}`);
    const response = await internalAxios(config);

    // Return data
    return {
      success: true,
      data: response.data?.data || response.data,
      statusCode: response.status
    };

  } catch (error) {
    console.error(`[Internal API] Error calling ${action}:`, error.message);
    
    // Handle different error types
    if (error.response) {
      // Server responded with error status
      return {
        success: false,
        error: error.response.data?.message || error.message,
        statusCode: error.response.status
      };
    } else if (error.request) {
      // Request made but no response
      return {
        success: false,
        error: 'Service unavailable. Please try again later.',
        statusCode: 503
      };
    } else {
      // Error in request setup
      return {
        success: false,
        error: error.message,
        statusCode: 500
      };
    }
  }
}

/**
 * Call multiple APIs in parallel
 * @param {Array<{action: string, params: object}>} requests - Array of API requests
 * @param {string} authToken - Optional JWT token
 * @returns {Promise<Array<object>>} Array of API responses
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
        console.error(`[Internal API] Request ${index} failed:`, result.reason);
        return {
          success: false,
          error: result.reason?.message || 'Unknown error',
          statusCode: 500
        };
      }
    });

  } catch (error) {
    console.error('[Internal API] Error in parallel calls:', error.message);
    throw error;
  }
}

/**
 * Health check for a service
 * @param {string} serviceUrl - Service base URL
 * @returns {Promise<boolean>} True if service is healthy
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
