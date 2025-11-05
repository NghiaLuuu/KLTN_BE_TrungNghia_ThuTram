/**
 * Response Formatter
 * Format API responses consistently
 */

/**
 * Format success response
 */
const formatSuccessResponse = (message, data = null) => {
  const response = {
    success: true,
    message,
    timestamp: new Date().toISOString()
  };

  if (data) {
    response.data = data;
  }

  return response;
};

/**
 * Format error response
 */
const formatErrorResponse = (error, statusCode = 500) => {
  return {
    success: false,
    message: error.message || 'An error occurred',
    error: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    timestamp: new Date().toISOString(),
    statusCode
  };
};

/**
 * Format chatbot response
 */
const formatChatbotResponse = (assistantMessage, apiData = null) => {
  return {
    success: true,
    response: assistantMessage,
    hasApiData: !!apiData,
    apiData: apiData,
    timestamp: new Date().toISOString()
  };
};

module.exports = {
  formatSuccessResponse,
  formatErrorResponse,
  formatChatbotResponse
};
