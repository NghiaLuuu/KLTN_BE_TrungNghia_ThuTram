const aiService = require('../services/ai.service');
const chatSessionRepo = require('../repositories/chatSession.repository');
const imageAnalysisService = require('../services/imageAnalysis.service');
const { validateImageFile, optimizeImage } = require('../utils/imageValidator');
const { handleQuery } = require('../services/queryEngine.service');

class ChatbotController {
  /**
   * POST /api/ai/chat
   * Send message and get AI response
   */
  async sendMessage(req, res) {
    try {
      const { message } = req.body;
      const userId = req.user?.userId || req.user?._id;

      if (!message || message.trim() === '') {
        return res.status(400).json({
          success: false,
          message: 'Tin nhắn không được để trống'
        });
      }

      // Check if message is dental-related
      if (!aiService.isDentalRelated(message)) {
        const rejectMessage = 'Xin lỗi, tôi chỉ có thể hỗ trợ các vấn đề liên quan đến phòng khám nha khoa SmileCare. Bạn có câu hỏi nào về răng miệng không? 😊';
        
        return res.json({
          success: true,
          response: rejectMessage,
          timestamp: new Date().toISOString()
        });
      }

      // Get or create session
      const session = await chatSessionRepo.getOrCreateSession(userId);

      // Add user message to session
      await chatSessionRepo.addMessage(session.sessionId, 'user', message);

      // Get conversation history (last 10 messages for context)
      const history = await chatSessionRepo.getHistory(userId, 10);
      const formattedMessages = aiService.formatMessagesForGPT(history);

      // Get auth token from request (for authenticated API calls)
      const authToken = req.headers.authorization?.split(' ')[1] || null;

      // Get GPT response (with Query Engine integration)
      const result = await aiService.sendMessageToGPT(formattedMessages, undefined, authToken);

      // Save assistant response
      await chatSessionRepo.addMessage(session.sessionId, 'assistant', result.response);

      res.json({
        success: true,
        response: result.response,
        sessionId: session.sessionId,
        timestamp: new Date().toISOString(),
        usedQuery: result.usedQuery || false,
        queryCount: result.queryCount || 0,
        query: result.query || null
      });

    } catch (error) {
      console.error('❌ Chat error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Có lỗi xảy ra khi xử lý tin nhắn'
      });
    }
  }

  /**
   * GET /api/ai/history
   * Get chat history for current user
   */
  async getChatHistory(req, res) {
    try {
      const userId = req.user?.userId || req.user?._id;
      const limit = parseInt(req.query.limit) || 50;

      const history = await chatSessionRepo.getHistory(userId, limit);

      res.json({
        success: true,
        data: history,
        total: history.length
      });

    } catch (error) {
      console.error('❌ Get history error:', error);
      res.status(500).json({
        success: false,
        message: 'Không thể lấy lịch sử chat'
      });
    }
  }

  /**
   * DELETE /api/ai/history
   * Clear chat history for current user
   */
  async clearHistory(req, res) {
    try {
      const userId = req.user?.userId || req.user?._id;

      const session = await chatSessionRepo.findActiveByUserId(userId);
      
      if (session) {
        await chatSessionRepo.deactivateSession(session.sessionId);
      }

      res.json({
        success: true,
        message: 'Đã xóa lịch sử chat thành công'
      });

    } catch (error) {
      console.error('❌ Clear history error:', error);
      res.status(500).json({
        success: false,
        message: 'Không thể xóa lịch sử chat'
      });
    }
  }

  /**
   * POST /api/ai/analyze-image
   * Analyze teeth image using GPT-4 Vision
   */
  async analyzeImage(req, res) {
    try {
      const userId = req.user?.userId || req.user?._id;
      const userMessage = req.body.message || '';

      // Check if image file exists
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'Vui lòng upload ảnh để phân tích'
        });
      }

      // Validate image file
      const validation = await validateImageFile(req.file);
      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          message: validation.error
        });
      }

      // Optimize image (compress if needed)
      const optimizedBuffer = await optimizeImage(req.file.buffer, req.file.mimetype);

      // Analyze image with GPT-4 Vision
      console.log('🔍 Starting image analysis...');
      const analysis = await imageAnalysisService.analyzeTeethImage(
        optimizedBuffer,
        req.file.mimetype,
        userMessage,
        req.file.originalname || 'teeth-image.jpg'
      );

      // If not a teeth image, reject
      if (!analysis.isTeethImage) {
        return res.json({
          success: false,
          message: 'Ảnh bạn gửi không phải là hình răng/miệng. Vui lòng gửi lại ảnh răng để tôi có thể tư vấn chính xác hơn. 🦷',
          isTeethImage: false
        });
      }

      // Save analysis to chat session
      const session = await chatSessionRepo.getOrCreateSession(userId);
      
      // Save user message with image indicator and S3 URL
      await chatSessionRepo.addMessage(
        session.sessionId, 
        'user', 
        `[Đã gửi ảnh] ${userMessage || 'Phân tích ảnh răng của tôi'}`,
        analysis.imageUrl // S3 URL
      );

      // Save AI analysis
      await chatSessionRepo.addMessage(
        session.sessionId,
        'assistant',
        analysis.analysis
      );

      // Generate follow-up questions
      const followUpQuestions = imageAnalysisService.generateFollowUpQuestions(
        analysis.analysis,
        analysis.suggestions
      );

      res.json({
        success: true,
        analysis: analysis.analysis,
        isTeethImage: true,
        suggestions: analysis.suggestions,
        imageUrl: analysis.imageUrl, // S3 URL
        followUpQuestions,
        sessionId: session.sessionId,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('❌ Image analysis error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Không thể phân tích ảnh. Vui lòng thử lại sau.'
      });
    }
  }

  /**
   * POST /api/ai/analyze-multiple-images
   * Analyze multiple teeth images for comparison
   */
  async analyzeMultipleImages(req, res) {
    try {
      const userId = req.user?.userId || req.user?._id;
      const userMessage = req.body.message || '';

      // Check if images exist
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Vui lòng upload ít nhất 1 ảnh'
        });
      }

      if (req.files.length > 4) {
        return res.status(400).json({
          success: false,
          message: 'Chỉ có thể upload tối đa 4 ảnh cùng lúc'
        });
      }

      // Validate and optimize all images
      const processedImages = [];
      for (const file of req.files) {
        const validation = await validateImageFile(file);
        if (validation.valid) {
          const optimizedBuffer = await optimizeImage(file.buffer, file.mimetype);
          processedImages.push({
            buffer: optimizedBuffer,
            mimeType: file.mimetype
          });
        }
      }

      if (processedImages.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Không có ảnh hợp lệ nào để phân tích'
        });
      }

      // Analyze multiple images
      console.log(`🔍 Analyzing ${processedImages.length} images...`);
      const analysis = await imageAnalysisService.analyzeMultipleImages(
        processedImages,
        userMessage || `So sánh ${processedImages.length} ảnh răng`
      );

      // Save to chat session
      const session = await chatSessionRepo.getOrCreateSession(userId);
      await chatSessionRepo.addMessage(
        session.sessionId,
        'user',
        `[Đã gửi ${processedImages.length} ảnh] ${userMessage || 'So sánh ảnh răng'}`
      );
      await chatSessionRepo.addMessage(
        session.sessionId,
        'assistant',
        analysis.analysis
      );

      res.json({
        success: true,
        analysis: analysis.analysis,
        imagesCount: processedImages.length,
        sessionId: session.sessionId,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('❌ Multiple images analysis error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Không thể phân tích ảnh. Vui lòng thử lại sau.'
      });
    }
  }

  /**
   * POST /api/ai/smart-query
   * Execute natural language MongoDB query using AI Query Engine
   */
  async smartQuery(req, res) {
    try {
      const { prompt } = req.body;
      const userId = req.user?.userId || req.user?._id;

      if (!prompt || prompt.trim() === '') {
        return res.status(400).json({
          success: false,
          message: 'Vui lòng nhập câu hỏi để truy vấn'
        });
      }

      console.log(`\n🧠 Smart Query Request from user ${userId}`);
      console.log(`📝 Prompt: "${prompt}"`);

      // Execute query engine
      const result = await handleQuery(prompt);

      if (result.success) {
        // Save to chat session
        const session = await chatSessionRepo.getOrCreateSession(userId);
        
        await chatSessionRepo.addMessage(
          session.sessionId,
          'user',
          `[Smart Query] ${prompt}`
        );

        // Format response message
        const responseMessage = `✅ Đã tìm thấy ${result.count} kết quả:\n\n` +
          `📊 Collection: ${result.query.collection}\n` +
          `🔍 Filter: ${JSON.stringify(result.query.filter)}\n` +
          `🔄 Retries: ${result.retries}`;

        await chatSessionRepo.addMessage(
          session.sessionId,
          'assistant',
          responseMessage
        );

        res.json({
          success: true,
          query: result.query,
          data: result.data,
          count: result.count,
          retries: result.retries,
          message: `Tìm thấy ${result.count} kết quả`,
          sessionId: session.sessionId
        });
      } else {
        res.status(400).json({
          success: false,
          message: result.error,
          retries: result.retries,
          query: result.query
        });
      }

    } catch (error) {
      console.error('❌ Smart Query error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Không thể thực thi truy vấn'
      });
    }
  }
}

module.exports = new ChatbotController();
