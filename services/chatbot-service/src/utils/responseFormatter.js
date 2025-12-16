/**
 * Bộ định dạng Response
 * Định dạng các phản hồi API nhất quán
 */

/**
 * Định dạng phản hồi thành công
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
 * Định dạng phản hồi lỗi
 */
const formatErrorResponse = (error, statusCode = 500) => {
  return {
    success: false,
    message: error.message || 'Có lỗi xảy ra',
    error: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    timestamp: new Date().toISOString(),
    statusCode
  };
};

/**
 * Định dạng phản hồi chatbot
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
