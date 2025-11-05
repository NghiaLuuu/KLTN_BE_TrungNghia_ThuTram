// Parse API request JSON from GPT responses

/**
 * Parse API request from GPT response
 * Expected format in GPT response:
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
 * Extract API request JSON from GPT response text
 * @param {string} responseText - GPT response text
 * @returns {object|null} Parsed API request or null
 */
function extractApiRequest(responseText) {
  try {
    // Look for [API_CALL] tags first (new format)
    const apiCallMatch = responseText.match(/\[API_CALL\]([\s\S]*?)\[\/API_CALL\]/);
    if (apiCallMatch) {
      console.log('[Parser] Found [API_CALL] tag:', apiCallMatch[1].trim());
      return JSON.parse(apiCallMatch[1].trim());
    }

    // Look for JSON block in markdown code fence
    const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      console.log('[Parser] Found ```json block:', jsonMatch[1].trim());
      return JSON.parse(jsonMatch[1].trim());
    }

    // Look for JSON object directly
    const objectMatch = responseText.match(/\{[\s\S]*"action"[\s\S]*\}/);
    if (objectMatch) {
      console.log('[Parser] Found JSON object:', objectMatch[0]);
      return JSON.parse(objectMatch[0]);
    }

    console.log('[Parser] No API request found in:', responseText);
    return null;
  } catch (error) {
    console.error('[Parser] Error extracting API request:', error.message);
    return null;
  }
}

/**
 * Validate API request structure
 * @param {object} apiRequest - Parsed API request
 * @returns {boolean} True if valid
 */
function validateApiRequest(apiRequest) {
  if (!apiRequest || typeof apiRequest !== 'object') {
    return false;
  }

  // Must have action field
  if (!apiRequest.action || typeof apiRequest.action !== 'string') {
    return false;
  }

  // Action must be valid
  if (!API_ENDPOINTS[apiRequest.action]) {
    console.warn(`Invalid action: ${apiRequest.action}`);
    return false;
  }

  // Params must be object (can be empty)
  if (apiRequest.params && typeof apiRequest.params !== 'object') {
    return false;
  }

  return true;
}

/**
 * Check if required params are present
 * @param {object} apiRequest - Parsed API request
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
 * Parse and validate full API request
 * @param {string} responseText - GPT response text
 * @returns {object} { success: boolean, apiRequest: object, error: string }
 */
function parseApiRequest(responseText) {
  // Extract API request
  const apiRequest = extractApiRequest(responseText);
  
  if (!apiRequest) {
    return {
      success: false,
      apiRequest: null,
      error: 'No API request found in response'
    };
  }

  // Validate structure
  if (!validateApiRequest(apiRequest)) {
    return {
      success: false,
      apiRequest: null,
      error: 'Invalid API request structure'
    };
  }

  // Check required params
  const paramCheck = checkRequiredParams(apiRequest);
  if (!paramCheck.valid) {
    return {
      success: false,
      apiRequest: null,
      error: `Missing required params: ${paramCheck.missing.join(', ')}`
    };
  }

  return {
    success: true,
    apiRequest,
    error: null
  };
}

/**
 * Check if response text contains API request
 * @param {string} responseText - GPT response text
 * @returns {boolean} True if contains API request
 */
function hasApiRequest(responseText) {
  if (!responseText || typeof responseText !== 'string') {
    return false;
  }

  // Check for [API_CALL] tags (priority)
  if (responseText.includes('[API_CALL]')) {
    return true;
  }

  // Check for JSON markers
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
