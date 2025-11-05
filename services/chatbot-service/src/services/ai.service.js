const { openai, config } = require('../config/openai.config');
const { DENTAL_ASSISTANT_PROMPT } = require('../config/systemPrompts');
const { processApiIntegration } = require('./apiIntegration.service');
const { handleQuery } = require('./queryEngine.service');

class AIService {
  /**
   * Send message to GPT and get response (with Query Engine integration)
   * @param {Array} messages - Array of messages in OpenAI format
   * @param {String} systemPrompt - System prompt (optional, uses default if not provided)
   * @param {String} authToken - JWT token for authenticated API calls (optional)
   * @returns {Promise<Object>} - { response: string, queryData: any }
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
      console.log('🤖 GPT Response:', gptResponse);

      // Step 2: Check if GPT wants to query database
      if (this.hasQueryRequest(gptResponse)) {
        console.log('🔍 Query request detected, executing Query Engine...');
        
        // Extract query prompt from [QUERY]...[/QUERY] tags
        const queryPrompt = this.extractQueryPrompt(gptResponse);
        console.log('📝 Query Prompt:', queryPrompt);

        // Execute Query Engine
        const queryResult = await handleQuery(queryPrompt);

        if (queryResult.success) {
          console.log(`✅ Query executed successfully: ${queryResult.count} results`);
          
          // Step 3: Send query results back to GPT for natural language response
          const resultsContext = this.formatQueryResultsForGPT(queryResult);
          
          const finalResponse = await openai.chat.completions.create({
            model: config.model,
            messages: [
              { role: 'system', content: systemPrompt },
              ...messages,
              { 
                role: 'system', 
                content: `KẾT QUẢ TRỊ VẤN:\n${resultsContext}\n\nHãy tổng hợp thông tin trên và trả lời người dùng một cách tự nhiên, thân thiện. Đừng nói về query hay database.` 
              }
            ],
            temperature: config.temperature,
            max_tokens: config.maxTokens
          });

          return {
            response: finalResponse.choices[0].message.content,
            queryData: queryResult.data,
            queryCount: queryResult.count,
            usedQuery: true,
            query: queryResult.query
          };
        } else {
          console.error('❌ Query execution failed:', queryResult.error);
          // Fallback to GPT response without query data
          return {
            response: gptResponse.replace(/\[QUERY\].*?\[\/QUERY\]/g, '').trim() || 'Xin lỗi, tôi không tìm thấy thông tin phù hợp. Vui lòng liên hệ hotline để được hỗ trợ! 📞',
            queryData: null,
            usedQuery: false,
            error: queryResult.error
          };
        }
      } else {
        // No query needed, return direct GPT response
        console.log('ℹ️  No query needed, returning GPT response');
        return {
          response: gptResponse,
          queryData: null,
          usedQuery: false
        };
      }

    } catch (error) {
      console.error('❌ OpenAI API Error:', error);
      throw new Error('Xin lỗi, tôi đang gặp sự cố kỹ thuật. Vui lòng thử lại sau.');
    }
  }

  /**
   * Check if GPT response contains query request
   * @param {String} response - GPT response
   * @returns {Boolean}
   */
  hasQueryRequest(response) {
    return response.includes('[QUERY]') && response.includes('[/QUERY]');
  }

  /**
   * Extract query prompt from [QUERY]...[/QUERY] tags
   * @param {String} response - GPT response
   * @returns {String}
   */
  extractQueryPrompt(response) {
    const match = response.match(/\[QUERY\](.*?)\[\/QUERY\]/s);
    return match ? match[1].trim() : '';
  }

  /**
   * Format query results for GPT to generate natural language response
   * @param {Object} queryResult - Result from Query Engine
   * @returns {String}
   */
  formatQueryResultsForGPT(queryResult) {
    if (!queryResult.success || !queryResult.data || queryResult.data.length === 0) {
      return 'Không tìm thấy kết quả nào trong database.';
    }

    let formatted = `Tìm thấy ${queryResult.count} kết quả từ collection "${queryResult.query.collection}":\n\n`;
    
    // Limit to first 5 results for context
    const limitedData = queryResult.data.slice(0, 5);
    
    limitedData.forEach((item, index) => {
      formatted += `${index + 1}. ${JSON.stringify(item, null, 2)}\n\n`;
    });

    if (queryResult.count > 5) {
      formatted += `... và ${queryResult.count - 5} kết quả khác.`;
    }

    return formatted;
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
      // Tiếng Việt - Cơ bản
      'răng', 'nha khoa', 'khám', 'bác sĩ', 'nha sĩ', 'dịch vụ', 
      'đặt lịch', 'đặt hẹn', 'giá', 'chi phí', 'phí', 'tiền',
      
      // Dịch vụ
      'tẩy trắng', 'niềng', 'chỉnh nha', 'bọc răng', 'cấy ghép',
      'nhổ', 'trám', 'implant', 'sứ', 'veneer', 'lấy cao',
      
      // Triệu chứng & Bệnh lý
      'nướu', 'viêm', 'đau', 'nhức', 'sâu', 'mất', 'hỏng', 
      'chảy máu', 'sưng', 'mủ', 'ố vàng', 'mảng bám', 'khớp cắn',
      'thưa', 'móm', 'hô', 'lệch', 'lung lay', 'yếu',
      
      // Phòng khám & Thương hiệu
      'phòng khám', 'smilecare', 'smile care', 'nha khoa smile',
      
      // English
      'appointment', 'teeth', 'tooth', 'dental', 'dentist', 
      'orthodontic', 'braces', 'whitening', 'cavity', 'gum'
    ];

    const lowerMessage = message.toLowerCase();
    return dentalKeywords.some(keyword => lowerMessage.includes(keyword));
  }
}

module.exports = new AIService();
