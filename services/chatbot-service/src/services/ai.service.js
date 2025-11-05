const { openai, config } = require('../config/openai.config');
const { DENTAL_ASSISTANT_PROMPT } = require('../config/systemPrompts');
const { processApiIntegration } = require('./apiIntegration.service');

class AIService {
  /**
   * Send message to GPT and get response (with API integration support)
   * @param {Array} messages - Array of messages in OpenAI format
   * @param {String} systemPrompt - System prompt (optional, uses default if not provided)
   * @param {String} authToken - JWT token for authenticated API calls (optional)
   * @returns {Promise<Object>} - { response: string, apiData: any }
   */
  async sendMessageToGPT(messages, systemPrompt = DENTAL_ASSISTANT_PROMPT, authToken = null) {
    try {
      // Step 1: Get initial response from GPT
      const response = await openai.chat.completions.create({
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages
        ],
        temperature: config.temperature,
        max_tokens: config.maxTokens
      });

      const gptResponse = response.choices[0].message.content;

      // Step 2: Check if GPT wants to call API
      const apiIntegration = await processApiIntegration(gptResponse, messages, authToken);

      // Step 3: Return appropriate response
      if (apiIntegration.needsApi) {
        console.log('✅ API Integration executed:', apiIntegration.action);
        return {
          response: apiIntegration.finalResponse,
          apiData: apiIntegration.apiData,
          usedApi: true,
          action: apiIntegration.action
        };
      } else {
        return {
          response: gptResponse,
          apiData: null,
          usedApi: false
        };
      }

    } catch (error) {
      console.error('❌ OpenAI API Error:', error);
      throw new Error('Xin lỗi, tôi đang gặp sự cố kỹ thuật. Vui lòng thử lại sau.');
    }
  }

  /**
   * Send message to GPT (simplified version without API integration)
   * @param {Array} messages - Array of messages
   * @param {String} systemPrompt - System prompt
   * @returns {Promise<String>} - GPT response text only
   */
  async sendSimpleMessage(messages, systemPrompt = DENTAL_ASSISTANT_PROMPT) {
    try {
      const response = await openai.chat.completions.create({
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages
        ],
        temperature: config.temperature,
        max_tokens: config.maxTokens
      });

      return response.choices[0].message.content;
    } catch (error) {
      console.error('❌ OpenAI API Error:', error);
      throw new Error('Xin lỗi, tôi đang gặp sự cố kỹ thuật. Vui lòng thử lại sau.');
    }
  }

  /**
   * Format conversation history for OpenAI
   * @param {Array} messages - Messages from database
   * @returns {Array} - Formatted messages for OpenAI
   */
  formatMessagesForGPT(messages) {
    return messages
      .filter(msg => msg.role !== 'system')
      .map(msg => ({
        role: msg.role,
        content: msg.content
      }));
  }

  /**
   * Check if message is dental-related
   * @param {String} message - User message
   * @returns {Boolean}
   */
  isDentalRelated(message) {
    const dentalKeywords = [
      'răng', 'nha khoa', 'khám', 'bác sĩ', 'dịch vụ', 
      'đặt lịch', 'giá', 'chi phí', 'tẩy trắng', 'niềng',
      'nhổ', 'trám', 'implant', 'sứ', 'nướu', 'viêm',
      'đau', 'sâu', 'mất', 'hỏng', 'chảy máu', 'khớp cắn',
      'phòng khám', 'smilecare', 'appointment', 'teeth', 'dental'
    ];

    const lowerMessage = message.toLowerCase();
    return dentalKeywords.some(keyword => lowerMessage.includes(keyword));
  }
}

module.exports = new AIService();
