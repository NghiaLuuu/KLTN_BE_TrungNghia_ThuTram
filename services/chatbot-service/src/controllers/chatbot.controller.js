const aiService = require('../services/ai.service');
const chatSessionRepo = require('../repositories/chatSession.repository');
const imageAnalysisService = require('../services/imageAnalysis.service');
const { validateImageFile, optimizeImage } = require('../utils/imageValidator');
const { handleQuery } = require('../services/queryEngine.service');
const bookingService = require('../services/booking.service');
const axios = require('axios');
const { DENTAL_ASSISTANT_PROMPT, buildBookingContextPrompt } = require('../config/systemPrompts');

/**
 * Kiểm tra tin nhắn của user có phải là xác nhận đặt lịch không
 * Hỗ trợ nhiều cách nói tự nhiên của người Việt
 * @param {String} message - Tin nhắn của user
 * @returns {Boolean}
 */
function isConfirmationMessage(message) {
  const input = message.trim().toLowerCase();
  
  // Các từ khóa xác nhận trực tiếp
  const confirmKeywords = [
    'có', 'yes', 'ok', 'oke', 'okie', 'okay',
    'đồng ý', 'xác nhận', 'được', 'đc',
    'ừ', 'ửm', 'um', 'uhm', 'u', // Các cách nói ngắn
    'đặt', 'đặt đi', 'đặt luôn', 'đặt ngay',
    'muốn đặt', 'tôi muốn đặt', 'em muốn đặt',
    'tiếp tục', 'tiếp', 'go', 'làm đi', 'chốt',
    'book', 'confirm', 'agree', 'sure', 'yê', 'ye',
    'rồi', 'xong', 'đúng rồi', 'đúng', 'chuẩn'
  ];
  
  // Kiểm tra từ khóa trực tiếp
  for (const keyword of confirmKeywords) {
    if (input === keyword || input.includes(keyword)) {
      return true;
    }
  }
  
  // Kiểm tra các pattern xác nhận tự nhiên
  const confirmPatterns = [
    /^(có|ok|yes|\u0111c|\u01b0|\u01b0m|u|um)$/i, // Trả lời ngắn gọn
    /muốn.*đặt/i, // "tôi muốn đặt", "em muốn đặt lịch"
    /đặt.*lịch/i, // "đặt lịch đi", "đặt lịch ngay"
    /xác.*nhận/i, // "xác nhận giùm", "xác nhận đi"
    /đồng.*ý/i, // "đồng ý", "em đồng ý"
    /chốt.*đơn/i, // "chốt đơn", "chốt luôn"
  ];
  
  for (const pattern of confirmPatterns) {
    if (pattern.test(input)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Kiểm tra tin nhắn của user có phải là từ chối đặt lịch không
 * @param {String} message - Tin nhắn của user
 * @returns {Boolean}
 */
function isRejectionMessage(message) {
  const input = message.trim().toLowerCase();
  
  const rejectKeywords = [
    'không', 'ko', 'k', 'no', 'nope',
    'thôi', 'hủy', 'bỏ', 'cancel',
    'không muốn', 'không đặt', 'không cần',
    'lúc khác', 'để sau', 'chưa', 'chưa muốn'
  ];
  
  for (const keyword of rejectKeywords) {
    if (input === keyword || input.includes(keyword)) {
      return true;
    }
  }
  
  return false;
}

class ChatbotController {
  /**
   * POST /api/ai/chat
   * Gửi tin nhắn và nhận phản hồi AI
   */
  async sendMessage(req, res) {
    try {
      const { message } = req.body;
      const userId = req.user?.userId || req.user?._id || 'anonymous';

      if (!message || message.trim() === '') {
        return res.status(400).json({
          success: false,
          message: 'Tin nhắn không được để trống'
        });
      }

      // Lấy hoặc tạo session trước (cần thiết cho kiểm tra luồng đặt lịch)
      const session = await chatSessionRepo.getOrCreateSession(userId);

      // Kiểm tra booking context để xem user có đang trong luồng đặt lịch không
      const bookingContext = await chatSessionRepo.getBookingContext(session.sessionId);
      const isInBookingFlow = bookingContext && bookingContext.isInBookingFlow;

      // Kiểm tra tin nhắn có liên quan đến nha khoa không
      const isDentalRelated = aiService.isDentalRelated(message);
      
      // Kiểm tra user có đang trong luồng đặt lịch không (mới nhận danh sách dịch vụ) - từ messages
      const recentMessages = session.messages.slice(-7); // 7 tin nhắn gần nhất cho ngữ cảnh tốt hơn
      const hasRecentBookingMessages = recentMessages.some(msg => 
        msg.role === 'assistant' && 
        (msg.content.includes('Dịch vụ khám và điều trị') || 
         msg.content.includes('Dịch vụ được Nha sĩ chỉ định') ||
         msg.content.includes('Danh sách dịch vụ có thể đặt lịch') ||
         msg.content.includes('Danh sách nha sĩ khả dụng') ||
         msg.content.includes('Ngày làm việc có lịch trống') ||
         msg.content.includes('Khung giờ trống') ||
         msg.content.includes('Bạn muốn đặt lịch cho dịch vụ nào'))
      );
      
      // Bỏ qua kiểm tra lạc chủ đề nếu:
      // 1. User đang trong luồng đặt lịch (context hoặc messages)
      // 2. Tin nhắn là số (chọn dịch vụ/nha sĩ/ngày/slot)
      // 3. Tin nhắn chứa từ khóa đặt lịch
      // 4. Tin nhắn trông giống tên người (cho việc chọn nha sĩ)
      const isNumberSelection = /^\d+$/.test(message.trim());
      const looksLikePersonName = /^[A-ZÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ][a-zàáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]+(\s[A-ZÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ][a-zàáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]+)+$/i.test(message.trim());
      const hasBookingKeywords = ['đặt lịch', 'dịch vụ', 'khám', 'hẹn', 'có', 'không', 'bất kỳ', 'nha sĩ', 'Nha sĩ', 'ngày', 'giờ'].some(kw => 
        message.toLowerCase().includes(kw)
      );
      
      if (!isDentalRelated && !isInBookingFlow && !hasRecentBookingMessages && !isNumberSelection && !hasBookingKeywords && !looksLikePersonName) {
        // Tăng số lần lạc chủ đề (rate limiting)
        if (req.rateLimit && req.rateLimit.incrementOffTopicCount) {
          const rateStatus = await req.rateLimit.incrementOffTopicCount(userId);
          
          if (rateStatus.isBlocked) {
            return res.status(429).json({
              success: false,
              message: `Bạn đã hỏi quá nhiều nội dung không liên quan đến nha khoa (${rateStatus.count}/3 lần). Vui lòng chờ ${rateStatus.remainingTime} giây trước khi tiếp tục.`,
              isBlocked: true,
              remainingTime: rateStatus.remainingTime,
              offTopicCount: rateStatus.count,
              timestamp: new Date().toISOString()
            });
          }
          
          const rejectMessage = `Xin lỗi, tôi chỉ có thể hỗ trợ các vấn đề liên quan đến phòng khám nha khoa SmileCare. Bạn có câu hỏi nào về răng miệng không? 😊\n\n⚠️ Lưu ý: Bạn đã hỏi ${rateStatus.count}/3 lần nội dung không liên quan. Nếu tiếp tục, bạn sẽ bị chặn 1 phút.`;
          
          return res.json({
            success: true,
            response: rejectMessage,
            isOffTopic: true,
            offTopicCount: rateStatus.count,
            timestamp: new Date().toISOString()
          });
        }
        
        // Fallback nếu rate limiter không khả dụng
        const rejectMessage = 'Xin lỗi, tôi chỉ có thể hỗ trợ các vấn đề liên quan đến phòng khám nha khoa SmileCare. Bạn có câu hỏi nào về răng miệng không? 😊';
        
        return res.json({
          success: true,
          response: rejectMessage,
          isOffTopic: true,
          timestamp: new Date().toISOString()
        });
      }
      
      // Reset số lần lạc chủ đề khi có tin nhắn nha khoa hợp lệ
      if (req.rateLimit && req.rateLimit.resetOffTopicCount) {
        await req.rateLimit.resetOffTopicCount(userId);
      }

      // Thêm tin nhắn user vào session
      await chatSessionRepo.addMessage(session.sessionId, 'user', message);

      // Lấy lịch sử hội thoại (tối ưu cho chi phí)
      // Đọc 20 tin nhắn ở bước CONFIRMATION khi user xác nhận (để có đủ ngữ cảnh đặt lịch)
      // Đọc 10 tin nhắn ở bước CONFIRMATION cho GPT tóm tắt
      // Các bước khác: 5 tin nhắn là đủ cho ngữ cảnh
      let historyLimit = 5; // Mặc định cho hầu hết các bước
      
      if (bookingContext && bookingContext.step === 'CONFIRMATION') {
        // Nếu user xác nhận, đọc nhiều lịch sử hơn để đảm bảo có đủ dữ liệu đặt lịch
        if (isConfirmationMessage(message)) {
          historyLimit = 20; // Đọc đầy đủ ngữ cảnh khi xác nhận
        } else {
          historyLimit = 10; // Bước xác nhận bình thường
        }
      }

      // Lấy auth token từ request (cho các API call có xác thực)
      const authToken = req.headers.authorization?.split(' ')[1] || null;

      // ====================================================================
      // BOOKING FLOW HANDLERS - XỬ LÝ TRƯỚC KHI GỌI GPT
      // Khi user đang trong booking flow, handlers sẽ xử lý trực tiếp
      // mà không cần gọi GPT (tiết kiệm token và response nhanh hơn)
      // ====================================================================
      
      // 1. SERVICE_SELECTION - User đang chọn dịch vụ
      if (bookingContext && bookingContext.isInBookingFlow && bookingContext.step === 'SERVICE_SELECTION') {
        console.log('🎯 [HANDLER] User đang ở bước SERVICE_SELECTION');
        
        let selectedItem = await this.matchServiceFromFlatList(
          message,
          bookingContext.flatServiceList
        );
        
        // Nếu không match được, thử dùng GPT parse
        if (!selectedItem && bookingContext.flatServiceList?.length > 0) {
          console.log('🧠 Thử dùng GPT để parse lựa chọn dịch vụ...');
          const gptResult = await aiService.parseSelectionWithGPT(message, bookingContext.flatServiceList, 'service');
          
          if (gptResult.success && gptResult.selectedIndex !== null) {
            selectedItem = bookingContext.flatServiceList[gptResult.selectedIndex];
            console.log(`✅ GPT parse thành công: ${selectedItem.serviceName}`);
          }
        }
        
        if (selectedItem) {
          console.log('✅ Đã chọn dịch vụ:', selectedItem.serviceName);
          return await this.handleDentistSelection(req, res, session, selectedItem, userId, authToken);
        }
        
        // Nếu vẫn không match được, hiển thị thông báo lỗi thân thiện
        const errorMessage = `❓ Tôi không hiểu lựa chọn "${message}". Vui lòng:\n\n` +
          `📝 Chọn số (1, 2, 3...) tương ứng với dịch vụ\n` +
          `📝 Hoặc gõ tên dịch vụ bạn muốn\n\n` +
          `💡 Ví dụ: "4" hoặc "Khám tổng quát"`;
        
        await chatSessionRepo.addMessage(session.sessionId, 'assistant', errorMessage);
        return res.json({ success: true, response: errorMessage, sessionId: session.sessionId, timestamp: new Date().toISOString() });
      }
      
      // 2. DENTIST_SELECTION - User đang chọn nha sĩ
      if (bookingContext && bookingContext.isInBookingFlow && bookingContext.step === 'DENTIST_SELECTION') {
        console.log('🎯 [HANDLER] User đang ở bước DENTIST_SELECTION');
        
        let selectedDentist = await this.matchDentistSelection(
          message,
          bookingContext.availableDentists
        );
        
        // Nếu không match được, thử dùng GPT parse
        if (!selectedDentist && bookingContext.availableDentists?.length > 0) {
          console.log('🧠 Thử dùng GPT để parse lựa chọn nha sĩ...');
          const gptResult = await aiService.parseSelectionWithGPT(message, bookingContext.availableDentists, 'dentist');
          
          if (gptResult.success && gptResult.selectedIndex !== null) {
            selectedDentist = bookingContext.availableDentists[gptResult.selectedIndex];
            console.log(`✅ GPT parse thành công: ${selectedDentist.fullName}`);
          }
        }
        
        if (selectedDentist) {
          console.log('✅ Đã chọn nha sĩ:', selectedDentist.fullName);
          return await this.handleDateSelection(req, res, session, bookingContext.selectedServiceItem, selectedDentist, userId, authToken);
        }
        
        // Nếu vẫn không match được
        const errorMessage = `❓ Tôi không hiểu lựa chọn "${message}". Vui lòng:\n\n` +
          `📝 Chọn số (1, 2, 3...) tương ứng với nha sĩ\n` +
          `📝 Hoặc gõ tên nha sĩ (VD: "bác sĩ Sơn")\n` +
          `📝 Hoặc gõ "bất kỳ" để hệ thống chọn tự động\n\n` +
          `💡 Ví dụ: "1" hoặc "Nguyễn Trường Sơn"`;
        
        await chatSessionRepo.addMessage(session.sessionId, 'assistant', errorMessage);
        return res.json({ success: true, response: errorMessage, sessionId: session.sessionId, timestamp: new Date().toISOString() });
      }
      
      // 3. DATE_SELECTION - User đang chọn ngày
      if (bookingContext && bookingContext.isInBookingFlow && bookingContext.step === 'DATE_SELECTION') {
        console.log('🎯 [HANDLER] User đang ở bước DATE_SELECTION');
        console.log('📦 availableDates:', bookingContext.availableDates?.length || 0, 'ngày');
        
        let selectedDate = await this.matchDateSelection(
          message,
          bookingContext.availableDates
        );
        
        // Nếu không match được, thử dùng GPT parse
        if (!selectedDate && bookingContext.availableDates?.length > 0) {
          console.log('🧠 Thử dùng GPT để parse lựa chọn ngày...');
          const gptResult = await aiService.parseSelectionWithGPT(message, bookingContext.availableDates, 'date');
          
          if (gptResult.success && gptResult.selectedIndex !== null) {
            selectedDate = bookingContext.availableDates[gptResult.selectedIndex];
            console.log(`✅ GPT parse thành công: ${selectedDate}`);
          }
        }
        
        if (selectedDate) {
          console.log('✅ Đã chọn ngày:', selectedDate);
          return await this.handleSlotSelection(req, res, session, bookingContext.selectedServiceItem, bookingContext.selectedDentist, selectedDate, userId, authToken);
        }
        
        // Nếu vẫn không match được
        const errorMessage = `❓ Tôi không hiểu lựa chọn "${message}". Vui lòng:\n\n` +
          `📝 Chọn số (1, 2, 3...) tương ứng với ngày\n` +
          `📝 Hoặc gõ ngày theo định dạng DD/MM/YYYY (VD: "27/12/2025")\n` +
          `📝 Hoặc gõ "thứ bảy ngày 27 tháng 12"\n\n` +
          `💡 Ví dụ: "1" hoặc "27/12/2025"`;
        
        await chatSessionRepo.addMessage(session.sessionId, 'assistant', errorMessage);
        return res.json({ success: true, response: errorMessage, sessionId: session.sessionId, timestamp: new Date().toISOString() });
      }
      
      // 4. SLOT_SELECTION - User đang chọn khung giờ
      if (bookingContext && bookingContext.isInBookingFlow && bookingContext.step === 'SLOT_SELECTION') {
        console.log('🎯 [HANDLER] User đang ở bước SLOT_SELECTION');
        console.log('📦 availableSlotGroups:', bookingContext.availableSlotGroups?.length || 0, 'slots');
        
        let selectedSlotGroup = await this.matchSlotGroupSelection(
          message,
          bookingContext.availableSlotGroups
        );
        
        // Nếu không match được, thử dùng GPT parse
        if (!selectedSlotGroup && bookingContext.availableSlotGroups?.length > 0) {
          console.log('🧠 Thử dùng GPT để parse lựa chọn khung giờ...');
          const gptResult = await aiService.parseSelectionWithGPT(message, bookingContext.availableSlotGroups, 'slot');
          
          if (gptResult.success && gptResult.selectedIndex !== null) {
            selectedSlotGroup = bookingContext.availableSlotGroups[gptResult.selectedIndex];
            console.log(`✅ GPT parse thành công: ${selectedSlotGroup.startTime}`);
          }
        }
        
        if (selectedSlotGroup) {
          console.log('✅ Đã chọn khung giờ:', selectedSlotGroup.startTime);
          return await this.handleFinalConfirmation(req, res, session, {
            selectedServiceItem: bookingContext.selectedServiceItem,
            selectedDentist: bookingContext.selectedDentist,
            selectedDate: bookingContext.selectedDate,
            selectedSlotGroup: selectedSlotGroup
          }, userId, authToken);
        }
        
        // Nếu vẫn không match được
        const errorMessage = `❓ Tôi không hiểu lựa chọn "${message}". Vui lòng:\n\n` +
          `📝 Chọn số (1, 2, 3...) tương ứng với khung giờ\n` +
          `📝 Hoặc gõ giờ (VD: "10:00" hoặc "10h00")\n\n` +
          `💡 Ví dụ: "2" hoặc "10:00"`;
        
        await chatSessionRepo.addMessage(session.sessionId, 'assistant', errorMessage);
        return res.json({ success: true, response: errorMessage, sessionId: session.sessionId, timestamp: new Date().toISOString() });
      }
      
      // 5. CONFIRMATION - User đang xác nhận đặt lịch
      if (bookingContext && bookingContext.isInBookingFlow && bookingContext.step === 'CONFIRMATION') {
        console.log('🎯 [HANDLER] User đang ở bước CONFIRMATION');
        
        if (isConfirmationMessage(message)) {
          console.log('✅ User xác nhận đặt lịch');
          // Xử lý xác nhận - lấy lại context mới nhất
          const latestContext = await chatSessionRepo.getBookingContext(session.sessionId);
          
          if (!latestContext || !latestContext.selectedSlotGroup) {
            const errorMessage = '❌ Không tìm thấy thông tin đặt lịch. Vui lòng thử đặt lại từ đầu!';
            await chatSessionRepo.addMessage(session.sessionId, 'assistant', errorMessage);
            return res.json({ success: false, response: errorMessage, sessionId: session.sessionId, timestamp: new Date().toISOString() });
          }
          
          // Trích xuất thông tin và tạo booking
          return await this.processBookingConfirmation(req, res, session, latestContext, userId, authToken);
        }
        
        if (isRejectionMessage(message)) {
          console.log('❌ User từ chối đặt lịch');
          const cancelMessage = '❌ Đã hủy đặt lịch.\n\nNếu bạn cần đặt lại, vui lòng nói "đặt lịch" hoặc liên hệ hotline! 📞';
          await chatSessionRepo.clearBookingContext(session.sessionId);
          await chatSessionRepo.addMessage(session.sessionId, 'assistant', cancelMessage);
          return res.json({ success: true, response: cancelMessage, sessionId: session.sessionId, timestamp: new Date().toISOString() });
        }
        
        // Nếu không phải xác nhận hay từ chối, nhắc user
        const promptMessage = `🤔 Bạn muốn xác nhận đặt lịch không?\n\n` +
          `✅ Trả lời "Có" hoặc "Đồng ý" để xác nhận\n` +
          `❌ Trả lời "Không" hoặc "Hủy" để hủy bỏ`;
        
        await chatSessionRepo.addMessage(session.sessionId, 'assistant', promptMessage);
        return res.json({ success: true, response: promptMessage, sessionId: session.sessionId, timestamp: new Date().toISOString() });
      }
      
      // ====================================================================
      // NẾU KHÔNG TRONG BOOKING FLOW, GỌI GPT XỬ LÝ
      // ====================================================================
      
      const history = await chatSessionRepo.getHistory(userId, historyLimit);
      const formattedMessages = aiService.formatMessagesForGPT(history);

      // Tạo dynamic system prompt với booking context để GPT hiểu user đang ở step nào
      const bookingContextPrompt = buildBookingContextPrompt(bookingContext);
      const dynamicSystemPrompt = DENTAL_ASSISTANT_PROMPT + bookingContextPrompt;
      
      console.log('📦 Booking context step:', bookingContext?.step || 'NONE');
      if (bookingContextPrompt) {
        console.log('🎯 Đã thêm booking context prompt cho GPT');
      }

      // Lấy phản hồi GPT (với tích hợp Query Engine và booking context)
      const result = await aiService.sendMessageToGPT(formattedMessages, dynamicSystemPrompt, authToken);

      // ====================================================================
      // NOTE: Các booking flow handlers đã được xử lý TRƯỚC GPT call (dòng 199-342)
      // Nếu đến đây nghĩa là user đang hỏi chuyện ngoài booking flow
      // hoặc tin nhắn không match với bất kỳ handler nào
      // ====================================================================

      // Kiểm tra tin nhắn user có chứa ý định đặt lịch không (trước khi xử lý GPT)
      // CHỈ khi user KHÔNG đang trong booking flow
      const newBookingKeywords = [
        'đặt lịch', 'dat lich', 'book', 'hẹn khám', 'muốn khám',
        'dịch vụ được chỉ định', 'dịch vụ chỉ định', 'chỉ định nha sĩ',
        'có dịch vụ nào', 'dịch vụ gì'
      ];
      
      // Chỉ detect booking intent khi user KHÔNG đang trong booking flow
      // Nếu đang trong booking flow, các keywords như "muốn đặt" là để xác nhận, không phải bắt đầu mới
      const hasBookingIntent = !isInBookingFlow && newBookingKeywords.some(keyword => 
        message.toLowerCase().includes(keyword)
      );
      
      if (hasBookingIntent) {
        console.log('📅 Phát hiện ý định đặt lịch trong tin nhắn user!');
        
        try {
          // Tự động lấy danh sách dịch vụ khả dụng của user
          const servicesResult = await bookingService.getUserAvailableServices(userId, authToken);
          
          if (servicesResult.services.length === 0) {
            const noServicesResponse = 'Hiện tại chưa có dịch vụ nào khả dụng. Vui lòng liên hệ hotline để được hỗ trợ! 📞';
            await chatSessionRepo.addMessage(session.sessionId, 'assistant', noServicesResponse);
            
            return res.json({
              success: true,
              response: noServicesResponse,
              sessionId: session.sessionId,
              timestamp: new Date().toISOString()
            });
          }
          
          // Định dạng danh sách dịch vụ với cấu trúc PHẲNG (tất cả tổ hợp dịch vụ + addon)
          let servicesMessage = '📋 **Danh sách dịch vụ có thể đặt lịch:**\n\n';
          
          const recommended = servicesResult.services.filter(s => s.isRecommended);
          const regular = servicesResult.services.filter(s => !s.isRecommended);
          
          // Làm phẳng tất cả dịch vụ thành danh sách đánh số
          let flatServiceList = [];
          let counter = 1;
          
          // Thêm dịch vụ được khuyến nghị (từ treatmentIndications)
          // QUAN TRỌNG: Với dịch vụ được khuyến nghị, chỉ hiển thị addon CỤ THỂ được chỉ định
          recommended.forEach(service => {
            // Kiểm tra dịch vụ này có addon cụ thể được chỉ định không
            if (service.recommendedAddOnId) {
              // Tìm addon cụ thể được chỉ định
              const indicatedAddon = service.serviceAddOns?.find(
                addon => addon._id.toString() === service.recommendedAddOnId.toString()
              );
              
              if (indicatedAddon) {
                flatServiceList.push({
                  number: counter++,
                  serviceId: service._id,
                  serviceName: service.name,
                  addOnId: indicatedAddon._id,
                  addOnName: indicatedAddon.name,
                  price: indicatedAddon.effectivePrice || indicatedAddon.price || indicatedAddon.basePrice || 0,
                  duration: indicatedAddon.durationMinutes || 30,
                  isRecommended: true,
                  requireExamFirst: service.requireExamFirst,
                  recordId: service.recordId,
                  recordDentistId: service.recordDentistId,
                  recordDentistName: service.recordDentistName
                });
              }
            } else if (service.serviceAddOns && service.serviceAddOns.length > 0) {
              // Nếu không có addon cụ thể được chỉ định, hiển thị tất cả addons (fallback)
              service.serviceAddOns.forEach(addon => {
                flatServiceList.push({
                  number: counter++,
                  serviceId: service._id,
                  serviceName: service.name,
                  addOnId: addon._id,
                  addOnName: addon.name,
                  price: addon.effectivePrice || addon.price || addon.basePrice || 0,
                  duration: addon.durationMinutes || 30,
                  isRecommended: true,
                  requireExamFirst: service.requireExamFirst,
                  recordId: service.recordId,
                  recordDentistId: service.recordDentistId,
                  recordDentistName: service.recordDentistName
                });
              });
            } else {
              // Service without addons
              flatServiceList.push({
                number: counter++,
                serviceId: service._id,
                serviceName: service.name,
                addOnId: null,
                addOnName: null,
                price: 0,
                duration: 30,
                isRecommended: true,
                requireExamFirst: service.requireExamFirst,
                recordId: service.recordId,
                recordDentistId: service.recordDentistId,
                recordDentistName: service.recordDentistName
              });
            }
          });
          
          // Thêm dịch vụ thường với TẤT CẢ addons của chúng (không phải recommended, nên hiển tất cả tùy chọn)
          regular.forEach(service => {
            if (service.serviceAddOns && service.serviceAddOns.length > 0) {
              service.serviceAddOns.forEach(addon => {
                flatServiceList.push({
                  number: counter++,
                  serviceId: service._id,
                  serviceName: service.name,
                  addOnId: addon._id,
                  addOnName: addon.name,
                  price: addon.effectivePrice || addon.price || addon.basePrice || 0,
                  duration: addon.durationMinutes || 30,
                  isRecommended: false,
                  requireExamFirst: service.requireExamFirst
                });
              });
            } else {
              // Dịch vụ không có addons
              flatServiceList.push({
                number: counter++,
                serviceId: service._id,
                serviceName: service.name,
                addOnId: null,
                addOnName: null,
                price: 0,
                duration: 30,
                isRecommended: false,
                requireExamFirst: service.requireExamFirst
              });
            }
          });
          
          // Định dạng danh sách
          flatServiceList.forEach(item => {
            const displayName = item.addOnName 
              ? `${item.serviceName} - ${item.addOnName}` 
              : item.serviceName;
            
            const priceStr = item.price > 0 ? ` - ${item.price.toLocaleString('vi-VN')}đ` : '';
            const durationStr = ` (${item.duration} phút)`;
            const recommendedTag = item.isRecommended ? ' 🩺 (Dịch vụ chỉ định)' : '';
            
            servicesMessage += `${item.number}. ${displayName}${priceStr}${durationStr}${recommendedTag}\n`;
          });
          
          servicesMessage += '\n💡 Chọn dịch vụ bằng số (1, 2, 3...) hoặc gõ tên dịch vụ';
          
          // Lưu vào session
          await chatSessionRepo.addMessage(session.sessionId, 'assistant', servicesMessage);
          
          // Cập nhật booking context - user đang trong luồng đặt lịch
          await chatSessionRepo.updateBookingContext(session.sessionId, {
            isInBookingFlow: true,
            step: 'SERVICE_SELECTION',
            flatServiceList: flatServiceList, // Store flat list for selection
            selectedService: null,
            selectedServiceAddOn: null,
            selectedDentist: null,
            selectedDate: null,
            selectedSlot: null
          });
          
          return res.json({
            success: true,
            response: servicesMessage,
            sessionId: session.sessionId,
            timestamp: new Date().toISOString(),
            bookingMode: true,
            servicesData: {
              flatServiceList: flatServiceList,
              total: flatServiceList.length
            }
          });
          
        } catch (bookingError) {
          console.error('❌ Lỗi lấy dịch vụ đặt lịch:', bookingError);
          
          // Fallback trả về phản hồi GPT bình thường
          const errorResponse = `Xin lỗi, tôi không thể tải danh sách dịch vụ lúc này: ${bookingError.message}. Vui lòng thử lại sau hoặc liên hệ hotline! 📞`;
          await chatSessionRepo.addMessage(session.sessionId, 'assistant', errorResponse);
          
          return res.json({
            success: true,
            response: errorResponse,
            sessionId: session.sessionId,
            timestamp: new Date().toISOString()
          });
        }
      }
      
      // GPT Booking Action Handler - xử lý các tag [BOOKING_*] từ phản hồi GPT
      // CHỈ xử lý khi user KHÔNG đang trong booking flow (vì handlers đã xử lý)
      // Khi user nhập text như "số 4", "một", GPT trả về các tag như [BOOKING_GET_DENTISTS serviceId=4...]
      // Handler này phân tích các tag đó và chuyển user đến bước đặt lịch phù hợp
      if (result.usedBooking && result.bookingAction && !isInBookingFlow) {
        console.log('📅 Đang xử lý GPT booking action:', result.bookingAction);
        
        try {
          const bookingResult = await this.handleBookingAction(
            result.bookingAction,
            userId,
            authToken
          );
          
          // Thay thế tag đặt lịch bằng kết quả thực tế
          let finalResponse = result.response.replace(
            result.bookingAction.fullMatch,
            bookingResult.message
          );
          
          // Lưu phản hồi assistant
          await chatSessionRepo.addMessage(session.sessionId, 'assistant', finalResponse);
          
          return res.json({
            success: true,
            response: finalResponse,
            sessionId: session.sessionId,
            timestamp: new Date().toISOString(),
            usedBooking: true,
            bookingData: bookingResult.data || null
          });
        } catch (bookingError) {
          console.error('❌ Booking action error:', bookingError);
          
          // Fallback response
          const errorResponse = `Xin lỗi, tôi không thể xử lý yêu cầu đặt lịch: ${bookingError.message}. Vui lòng thử lại hoặc liên hệ hotline để được hỗ trợ! 📞`;
          await chatSessionRepo.addMessage(session.sessionId, 'assistant', errorResponse);
          
          return res.json({
            success: true,
            response: errorResponse,
            sessionId: session.sessionId,
            timestamp: new Date().toISOString()
          });
        }
      }

      // Clean up response nếu có booking tags (xóa các tags không được xử lý)
      let cleanedResponse = result.response;
      if (isInBookingFlow && result.usedBooking) {
        // Xóa các booking tags vì đang trong flow và handlers đã xử lý
        cleanedResponse = cleanedResponse.replace(/\[BOOKING_[^\]]+\]/g, '').trim();
        console.log('🧹 Đã clean up booking tags từ GPT response (user đang trong booking flow)');
      }

      // Save assistant response
      await chatSessionRepo.addMessage(session.sessionId, 'assistant', cleanedResponse);

      res.json({
        success: true,
        response: cleanedResponse,
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
   * Lấy lịch sử chat của user hiện tại
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
   * Xóa lịch sử chat của user hiện tại
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
   * Phân tích ảnh răng sử dụng GPT-4 Vision
   */
  async analyzeImage(req, res) {
    try {
      const userId = req.user?.userId || req.user?._id;
      const userMessage = req.body.message || '';

      // Kiểm tra file ảnh có tồn tại không
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'Vui lòng upload ảnh để phân tích'
        });
      }

      // Validate file ảnh
      const validation = await validateImageFile(req.file);
      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          message: validation.error
        });
      }

      // Tối ưu ảnh (nén nếu cần)
      const optimizedBuffer = await optimizeImage(req.file.buffer, req.file.mimetype);

      // Phân tích ảnh với GPT-4 Vision
      console.log('🔍 Bắt đầu phân tích ảnh...');
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

      // Lưu phân tích vào chat session
      const session = await chatSessionRepo.getOrCreateSession(userId);
      
      // Lưu tin nhắn user với chỉ báo ảnh và URL S3
      await chatSessionRepo.addMessage(
        session.sessionId, 
        'user', 
        `[Đã gửi ảnh] ${userMessage || 'Phân tích ảnh răng của tôi'}`,
        analysis.imageUrl // URL S3
      );

      // Lưu phân tích AI
      await chatSessionRepo.addMessage(
        session.sessionId,
        'assistant',
        analysis.analysis
      );

      // Tạo câu hỏi theo dõi
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
   * Phân tích nhiều ảnh răng để so sánh
   */
  async analyzeMultipleImages(req, res) {
    try {
      const userId = req.user?.userId || req.user?._id;
      const userMessage = req.body.message || '';

      // Kiểm tra ảnh có tồn tại không
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

      // Validate và tối ưu tất cả ảnh
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

      // Phân tích nhiều ảnh
      console.log(`🔍 Đang phân tích ${processedImages.length} ảnh...`);
      const analysis = await imageAnalysisService.analyzeMultipleImages(
        processedImages,
        userMessage || `So sánh ${processedImages.length} ảnh răng`
      );

      // Lưu vào chat session
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
   * Thực thi truy vấn MongoDB ngôn ngữ tự nhiên sử dụng AI Query Engine
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

      console.log(`\n🧠 Yêu cầu Smart Query từ user ${userId}`);
      console.log(`📝 Prompt: "${prompt}"`);

      // Thực thi query engine
      const result = await handleQuery(prompt);

      if (result.success) {
        // Lưu vào chat session
        const session = await chatSessionRepo.getOrCreateSession(userId);
        
        await chatSessionRepo.addMessage(
          session.sessionId,
          'user',
          `[Smart Query] ${prompt}`
        );

        // Định dạng thông điệp phản hồi
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

  /**
   * POST /api/ai/booking/start
   * Bắt đầu luồng đặt lịch - Lấy danh sách dịch vụ khả dụng của user
   */
  async startBooking(req, res) {
    try {
      const userId = req.user?.userId || req.user?._id;
      
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Vui lòng đăng nhập để đặt lịch'
        });
      }

      const result = await bookingService.getUserAvailableServices(userId);
      
      res.json({
        success: true,
        data: result,
        message: 'Vui lòng chọn dịch vụ bạn muốn đặt lịch'
      });
      
    } catch (error) {
      console.error('❌ Start booking error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Không thể bắt đầu đặt lịch'
      });
    }
  }

  /**
   * POST /api/ai/booking/get-dentists
   * Lấy danh sách nha sĩ khả dụng cho dịch vụ đã chọn
   */
  async getBookingDentists(req, res) {
    try {
      const { serviceId, serviceAddOnId } = req.body;
      
      if (!serviceId) {
        return res.status(400).json({
          success: false,
          message: 'Thiếu thông tin dịch vụ'
        });
      }

      const result = await bookingService.getAvailableDentists(serviceId, serviceAddOnId);
      
      res.json({
        success: true,
        data: result,
        message: 'Vui lòng chọn nha sĩ'
      });
      
    } catch (error) {
      console.error('❌ Get booking dentists error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Không thể lấy danh sách nha sĩ'
      });
    }
  }

  /**
   * POST /api/ai/booking/get-slots
   * Lấy các khung giờ trống
   */
  async getBookingSlots(req, res) {
    try {
      const { dentistId, date, serviceDuration } = req.body;
      
      if (!dentistId || !date || !serviceDuration) {
        return res.status(400).json({
          success: false,
          message: 'Thiếu thông tin để lấy lịch trống'
        });
      }

      const result = await bookingService.getAvailableSlots(dentistId, date, serviceDuration);
      
      res.json({
        success: true,
        data: result,
        message: 'Vui lòng chọn giờ khám'
      });
      
    } catch (error) {
      console.error('❌ Get booking slots error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Không thể lấy lịch trống'
      });
    }
  }

  /**
   * POST /api/ai/booking/confirm
   * Xác nhận đặt lịch và tạo reservation lịch hẹn
   */
  async confirmBooking(req, res) {
    try {
      const userId = req.user?.userId || req.user?._id;
      const { serviceId, serviceAddOnId, dentistId, date, slotIds, notes } = req.body;
      
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Vui lòng đăng nhập để đặt lịch'
        });
      }

      if (!serviceId || !dentistId || !date || !slotIds || slotIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Thiếu thông tin đặt lịch'
        });
      }

      const result = await bookingService.createReservation({
        userId,
        serviceId,
        serviceAddOnId,
        dentistId,
        date,
        slotIds,
        notes
      });
      
      res.json({
        success: true,
        data: result,
        message: 'Đặt lịch thành công! Vui lòng thanh toán để xác nhận.'
      });
      
    } catch (error) {
      console.error('❌ Confirm booking error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Không thể xác nhận đặt lịch'
      });
    }
  }

  /**
   * Xử lý các GPT booking actions - phân tích tag [BOOKING_*] và thực hiện action phù hợp
   * Hỗ trợ: GET_SERVICES, GET_DENTISTS, GET_DATES, GET_SLOTS, CONFIRM
   * @param {Object} bookingAction - Booking action đã phân tích từ ai.service.extractBookingAction()
   * @param {String} userId - ID người dùng
   * @param {String} authToken - Token xác thực cho API calls
   * @returns {Object} - { message, data }
   */
  async handleBookingAction(bookingAction, userId, authToken) {
    const { action, params, fullMatch } = bookingAction;
    
    // Phân tích params dạng key=value thành object
    const parsedParams = {};
    params.forEach(param => {
      const [key, value] = param.split('=');
      if (key && value !== undefined) {
        parsedParams[key] = value;
      }
    });
    
    console.log(`🎯 Booking action: ${action}`, parsedParams);
    
    // Lấy session hiện tại cho booking context
    const session = await chatSessionRepo.getOrCreateSession(userId);
    
    switch (action) {
      case 'GET_SERVICES':
      case 'CHECK_SERVICES': {
        // Lấy dịch vụ khả dụng cho user
        const servicesResult = await bookingService.getUserAvailableServices(userId, authToken);
        
        if (servicesResult.services.length === 0) {
          return {
            message: 'Hiện tại chưa có dịch vụ nào khả dụng. Vui lòng liên hệ hotline để được hỗ trợ! 📞',
            data: null
          };
        }
        
        // Định dạng danh sách dịch vụ phẳng
        let flatServiceList = [];
        let counter = 1;
        const recommended = servicesResult.services.filter(s => s.isRecommended);
        const regular = servicesResult.services.filter(s => !s.isRecommended);
        
        [...recommended, ...regular].forEach(service => {
          if (service.serviceAddOns && service.serviceAddOns.length > 0) {
            service.serviceAddOns.forEach(addon => {
              flatServiceList.push({
                number: counter++,
                serviceId: service._id,
                serviceName: service.name,
                addOnId: addon._id,
                addOnName: addon.name,
                price: addon.effectivePrice || addon.price || addon.basePrice || 0,
                duration: addon.durationMinutes || 30,
                isRecommended: service.isRecommended
              });
            });
          } else {
            flatServiceList.push({
              number: counter++,
              serviceId: service._id,
              serviceName: service.name,
              addOnId: null,
              addOnName: null,
              price: 0,
              duration: 30,
              isRecommended: service.isRecommended
            });
          }
        });
        
        let message = '📋 **Danh sách dịch vụ có thể đặt lịch:**\n\n';
        flatServiceList.forEach(item => {
          const displayName = item.addOnName ? `${item.serviceName} - ${item.addOnName}` : item.serviceName;
          const priceStr = item.price > 0 ? ` - ${item.price.toLocaleString('vi-VN')}đ` : '';
          const tag = item.isRecommended ? ' 🩺' : '';
          message += `${item.number}. ${displayName}${priceStr}${tag}\n`;
        });
        message += '\n💡 Chọn dịch vụ bằng số (1, 2, 3...) hoặc gõ tên dịch vụ';
        
        // Cập nhật booking context
        await chatSessionRepo.updateBookingContext(session.sessionId, {
          isInBookingFlow: true,
          step: 'SERVICE_SELECTION',
          flatServiceList: flatServiceList
        });
        
        return { message, data: { flatServiceList } };
      }
      
      case 'GET_DENTISTS': {
        let serviceId = parsedParams.serviceId;
        let serviceAddOnId = parsedParams.serviceAddOnId !== '0' ? parsedParams.serviceAddOnId : null;
        let selectedServiceItem = null;
        
        // Lấy booking context trước để kiểm tra user đã chọn dịch vụ chưa
        const bookingContext = await chatSessionRepo.getBookingContext(session.sessionId);
        
        // GPT có thể trả về SỐ THỨ TỰ dịch vụ (1, 2, 3...) thay vì MongoDB _id
        // Kiểm tra nếu serviceId là số nhỏ (có thể là vị trí trong danh sách)
        const serviceNumber = parseInt(serviceId);
        if (!isNaN(serviceNumber) && serviceNumber > 0 && serviceNumber < 100) {
          if (bookingContext && bookingContext.flatServiceList) {
            // Tìm dịch vụ theo số thứ tự trong flatServiceList
            selectedServiceItem = bookingContext.flatServiceList.find(item => item.number === serviceNumber);
            
            if (selectedServiceItem) {
              // Sử dụng MongoDB _id thực
              serviceId = selectedServiceItem.serviceId;
              serviceAddOnId = selectedServiceItem.addOnId;
              console.log(`🔄 Đã map số dịch vụ ${serviceNumber} sang serviceId: ${serviceId}`);
            }
          }
        }
        
        // Fallback: Nếu serviceId vẫn thiếu, thử lấy từ booking context (selectedServiceItem)
        // Xảy ra khi user nói "có" (yes) sau khi GPT hỏi "bạn có muốn chọn nha sĩ không?"
        if (!serviceId && bookingContext && bookingContext.selectedServiceItem) {
          console.log('🔄 Fallback: Sử dụng selectedServiceItem từ booking context');
          selectedServiceItem = bookingContext.selectedServiceItem;
          serviceId = selectedServiceItem.serviceId;
          serviceAddOnId = selectedServiceItem.addOnId;
        }
        
        // Cũng thử selectedService nếu selectedServiceItem không có
        if (!serviceId && bookingContext && bookingContext.selectedService) {
          console.log('🔄 Fallback: Sử dụng selectedService từ booking context');
          serviceId = bookingContext.selectedService.serviceId;
          serviceAddOnId = bookingContext.selectedService.serviceAddOnId;
        }
        
        if (!serviceId) {
          return { message: 'Vui lòng chọn dịch vụ trước khi chọn nha sĩ.', data: null };
        }
        
        // Lấy danh sách nha sĩ sử dụng schedule-service API (giống handleDentistSelection)
        const SCHEDULE_SERVICE_URL = process.env.SCHEDULE_SERVICE_URL || 'http://localhost:3005';
        const serviceDuration = selectedServiceItem?.duration || 30;
        
        const dentistsResponse = await axios.get(
          `${SCHEDULE_SERVICE_URL}/api/slot/dentists-with-nearest-slot`,
          {
            params: {
              serviceId: serviceId,
              serviceDuration: serviceDuration
            }
          }
        );
        
        // Trích xuất mảng nha sĩ từ response
        let dentists = [];
        if (dentistsResponse.data.success && dentistsResponse.data.data) {
          if (dentistsResponse.data.data.dentists && Array.isArray(dentistsResponse.data.data.dentists)) {
            dentists = dentistsResponse.data.data.dentists;
          } else if (Array.isArray(dentistsResponse.data.data)) {
            dentists = dentistsResponse.data.data;
          }
        }
        
        if (!dentists || dentists.length === 0) {
          return { message: 'Hiện tại không có nha sĩ nào khả dụng cho dịch vụ này.', data: null };
        }
        
        let message = '👨‍⚕️ **Danh sách nha sĩ khả dụng:**\n\n';
        dentists.forEach((dentist, index) => {
          message += `${index + 1}. ${dentist.fullName || dentist.name}\n`;
        });
        message += '\n💡 Chọn nha sĩ bằng số hoặc gõ tên';
        
        // Cập nhật booking context với selectedServiceItem cho các bước sau
        await chatSessionRepo.updateBookingContext(session.sessionId, {
          isInBookingFlow: true,
          step: 'DENTIST_SELECTION',
          selectedService: { serviceId, serviceAddOnId },
          selectedServiceItem: selectedServiceItem, // Bao gồm full service item để dùng sau
          availableDentists: dentists
        });
        
        return { message, data: { dentists } };
      }
      
      case 'GET_DATES': {
        const dentistId = parsedParams.dentistId;
        
        if (!dentistId) {
          return { message: 'Vui lòng chọn nha sĩ trước khi chọn ngày.', data: null };
        }
        
        // Lấy booking context để lấy selectedServiceItem
        const bookingContext = await chatSessionRepo.getBookingContext(session.sessionId);
        const selectedServiceItem = bookingContext?.selectedServiceItem;
        const serviceId = selectedServiceItem?.serviceId || bookingContext?.selectedService?.serviceId;
        const serviceDuration = selectedServiceItem?.duration || 30;
        
        // Gọi schedule-service API để lấy ngày làm việc thực tế
        const SCHEDULE_SERVICE_URL = process.env.SCHEDULE_SERVICE_URL || 'http://localhost:3005';
        
        const datesResponse = await axios.get(
          `${SCHEDULE_SERVICE_URL}/api/slot/dentist/${dentistId}/working-dates`,
          {
            params: {
              serviceId: serviceId,
              serviceDuration: serviceDuration
            }
          }
        );
        
        // Trích xuất mảng working dates
        let workingDates = [];
        let maxBookingDays = 30;
        
        if (datesResponse.data.success && datesResponse.data.data) {
          if (datesResponse.data.data.maxBookingDays) {
            maxBookingDays = datesResponse.data.data.maxBookingDays;
          }
          if (datesResponse.data.data.workingDates && Array.isArray(datesResponse.data.data.workingDates)) {
            workingDates = datesResponse.data.data.workingDates;
          } else if (Array.isArray(datesResponse.data.data)) {
            workingDates = datesResponse.data.data;
          }
        }
        
        if (workingDates.length === 0) {
          return { message: 'Nha sĩ này hiện không có lịch trống. Vui lòng chọn nha sĩ khác.', data: null };
        }
        
        // Chuẩn hóa ngày về định dạng YYYY-MM-DD
        const normalizedDates = workingDates.map(dateItem => {
          const dateStr = typeof dateItem === 'string' ? dateItem : (dateItem.date || dateItem);
          const date = new Date(dateStr);
          return date.toISOString().split('T')[0];
        });
        
        // Định dạng message
        let message = '📅 **Ngày làm việc có lịch trống:**\n\n';
        const maxDates = Math.min(normalizedDates.length, maxBookingDays);
        normalizedDates.slice(0, maxDates).forEach((dateStr, index) => {
          const d = new Date(dateStr);
          const dayName = d.toLocaleDateString('vi-VN', { weekday: 'long' });
          const formatted = d.toLocaleDateString('vi-VN');
          message += `${index + 1}. ${dayName}, ${formatted}\n`;
        });
        
        if (normalizedDates.length > maxDates) {
          message += `\n... và ${normalizedDates.length - maxDates} ngày khác.\n`;
        }
        message += '\n💡 Chọn ngày bằng số (1, 2, 3...)';
        
        // Cập nhật booking context
        await chatSessionRepo.updateBookingContext(session.sessionId, {
          step: 'DATE_SELECTION',
          selectedDentist: { _id: dentistId },
          availableDates: normalizedDates
        });
        
        return { message, data: { availableDates: normalizedDates } };
      }
      
      case 'GET_SLOTS': {
        const dentistId = parsedParams.dentistId;
        const date = parsedParams.date;
        const duration = parseInt(parsedParams.duration) || 30;
        
        if (!dentistId || !date) {
          return { message: 'Vui lòng chọn nha sĩ và ngày trước khi chọn giờ.', data: null };
        }
        
        const slots = await bookingService.getAvailableSlots(dentistId, date, duration);
        
        if (!slots || slots.length === 0) {
          return { message: 'Không có khung giờ trống cho ngày này. Vui lòng chọn ngày khác.', data: null };
        }
        
        let message = '⏰ **Khung giờ trống:**\n\n';
        slots.forEach((slot, index) => {
          message += `${index + 1}. ${slot.startTime} - ${slot.endTime}\n`;
        });
        message += '\n💡 Chọn khung giờ bằng số (1, 2, 3...)';
        
        // Cập nhật booking context
        await chatSessionRepo.updateBookingContext(session.sessionId, {
          step: 'SLOT_SELECTION',
          selectedDate: date,
          availableSlotGroups: slots
        });
        
        return { message, data: { slots } };
      }
      
      default:
        console.log(`⚠️ Unknown booking action: ${action}`);
        return {
          message: 'Xin lỗi, tôi không hiểu yêu cầu đặt lịch này. Vui lòng thử lại.',
          data: null
        };
    }
  }

  /**
   * Khớp lựa chọn dịch vụ từ danh sách phẳng (theo số hoặc tên)
   */
  async matchServiceFromFlatList(userInput, flatServiceList) {
    if (!flatServiceList || flatServiceList.length === 0) return null;
    
    const input = userInput.trim().toLowerCase();
    
    // Thử khớp theo số - exact match
    const exactNumberMatch = input.match(/^(\d+)$/);
    if (exactNumberMatch) {
      const number = parseInt(exactNumberMatch[1]);
      const found = flatServiceList.find(item => item.number === number);
      if (found) return found;
    }
    
    // Thử trích xuất số từ câu tự nhiên như "tôi muốn chọn số 4", "chọn 4", "số 4"
    const naturalNumberMatch = input.match(/(?:chọn|số|chon|so|lấy|lay|muốn|muon|đặt|dat)\s*(?:số|so)?\s*(\d+)/i);
    if (naturalNumberMatch) {
      const number = parseInt(naturalNumberMatch[1]);
      const found = flatServiceList.find(item => item.number === number);
      if (found) return found;
    }
    
    // Thử khớp số đứng một mình trong câu
    const anyNumberMatch = input.match(/(\d+)/);
    if (anyNumberMatch) {
      const number = parseInt(anyNumberMatch[1]);
      const found = flatServiceList.find(item => item.number === number);
      if (found) return found;
    }
    
    // Thử khớp số tiếng Việt
    const vietnameseNumber = this.parseVietnameseNumber(input);
    if (vietnameseNumber !== null && vietnameseNumber > 0) {
      const found = flatServiceList.find(item => item.number === vietnameseNumber);
      if (found) return found;
    }
    
    // Thử khớp theo tên dịch vụ hoặc addon (fuzzy)
    for (const item of flatServiceList) {
      const fullName = item.addOnName 
        ? `${item.serviceName} ${item.addOnName}`.toLowerCase()
        : item.serviceName.toLowerCase();
      
      if (fullName.includes(input) || input.includes(item.serviceName.toLowerCase())) {
        return item;
      }
    }
    
    return null;
  }

  /**
   * Xử lý việc chọn nha sĩ sau khi đã chọn dịch vụ
   */
  async handleDentistSelection(req, res, session, selectedItem, userId, authToken) {
    try {
      console.log('👨‍⚕️ Đang lấy danh sách nha sĩ cho dịch vụ:', selectedItem.serviceName);
      
      // Cập nhật booking context
      await chatSessionRepo.updateBookingContext(session.sessionId, {
        isInBookingFlow: true,
        step: 'DENTIST_SELECTION',
        selectedServiceItem: selectedItem,
        selectedDentist: null,
        selectedDate: null,
        selectedSlot: null
      });
      
      // Gọi API để lấy nha sĩ với slot gần nhất
      const SCHEDULE_SERVICE_URL = process.env.SCHEDULE_SERVICE_URL || 'http://localhost:3005';
      
      const dentistsResponse = await axios.get(
        `${SCHEDULE_SERVICE_URL}/api/slot/dentists-with-nearest-slot`,
        {
          params: {
            serviceId: selectedItem.serviceId,
            serviceDuration: selectedItem.duration
          },
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : {}
        }
      );
      
      console.log('📦 Dentists response:', dentistsResponse.data);
      
      // Extract dentists array from response
      let dentists = [];
      if (dentistsResponse.data.success && dentistsResponse.data.data) {
        // Check if data contains dentists array or is directly an array
        if (dentistsResponse.data.data.dentists && Array.isArray(dentistsResponse.data.data.dentists)) {
          dentists = dentistsResponse.data.data.dentists;
        } else if (Array.isArray(dentistsResponse.data.data)) {
          dentists = dentistsResponse.data.data;
        }
      }
      
      if (dentists.length === 0) {
        const noDentistsMessage = `Xin lỗi, hiện tại không có nha sĩ nào khả dụng cho dịch vụ "${selectedItem.serviceName}". Vui lòng liên hệ hotline! 📞`;
        
        await chatSessionRepo.addMessage(session.sessionId, 'assistant', noDentistsMessage);
        
        return res.json({
          success: true,
          response: noDentistsMessage,
          sessionId: session.sessionId,
          timestamp: new Date().toISOString()
        });
      }
      
      // Format dentist list
      let dentistMessage = `✅ Bạn đã chọn: **${selectedItem.serviceName}`;
      if (selectedItem.addOnName) {
        dentistMessage += ` - ${selectedItem.addOnName}`;
      }
      dentistMessage += `**\n\n👨‍⚕️ **Danh sách nha sĩ khả dụng:**\n\n`;
      
      dentists.slice(0, 10).forEach((dentist, idx) => {
        dentistMessage += `${idx + 1}. ${dentist.fullName || dentist.name}`;
        
        // Check if this dentist is the one who examined and created the indication
        const isRecordDentist = selectedItem.recordDentistId && 
          dentist._id && 
          dentist._id.toString() === selectedItem.recordDentistId.toString();
        
        if (isRecordDentist) {
          dentistMessage += ` 👨‍⚕️ (Nha sĩ đã khám)`;
        } else if (dentist.specialization) {
          dentistMessage += ` (${dentist.specialization})`;
        }
        if (dentist.nearestSlot) {
          // Format nearestSlot properly
          console.log('🔍 nearestSlot type:', typeof dentist.nearestSlot, 'value:', JSON.stringify(dentist.nearestSlot));
          
          let slotInfo = '';
          if (typeof dentist.nearestSlot === 'object' && dentist.nearestSlot !== null) {
            // Check various possible object structures
            if (dentist.nearestSlot.date && dentist.nearestSlot.startTime) {
              // Format: { date: '2025-11-14', startTime: '09:00' }
              const slotDate = new Date(dentist.nearestSlot.date);
              slotInfo = `${slotDate.toLocaleDateString('vi-VN')} ${dentist.nearestSlot.startTime}`;
            } else if (dentist.nearestSlot.$date) {
              // MongoDB date format: { $date: '...' }
              const slotDate = new Date(dentist.nearestSlot.$date);
              slotInfo = slotDate.toLocaleDateString('vi-VN');
            } else {
              // Try to extract any date-like string
              const jsonStr = JSON.stringify(dentist.nearestSlot);
              if (jsonStr !== '{}' && jsonStr !== '[object Object]') {
                slotInfo = jsonStr.replace(/[{}"]/g, '');
              }
            }
          } else if (typeof dentist.nearestSlot === 'string') {
            slotInfo = dentist.nearestSlot;
          }
          
          if (slotInfo && slotInfo !== '[object Object]') {
            dentistMessage += `\n   📅 Lịch gần nhất: ${slotInfo}`;
          }
        }
        dentistMessage += '\n';
      });
      
      if (dentists.length > 10) {
        dentistMessage += `\n... và ${dentists.length - 10} nha sĩ khác.\n`;
      }
      
      dentistMessage += '\n💡 Chọn nha sĩ (1, 2, 3...) hoặc gõ "bất kỳ" để hệ thống chọn tự động';
      
      // Save dentist list to context
      await chatSessionRepo.updateBookingContext(session.sessionId, {
        isInBookingFlow: true,
        step: 'DENTIST_SELECTION',
        selectedServiceItem: selectedItem,
        availableDentists: dentists
      });
      
      await chatSessionRepo.addMessage(session.sessionId, 'assistant', dentistMessage);
      
      return res.json({
        success: true,
        response: dentistMessage,
        sessionId: session.sessionId,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      console.error('❌ Handle dentist selection error:', error);
      
      const errorResponse = `Xin lỗi, không thể tải danh sách nha sĩ: ${error.message}. Vui lòng thử lại! 📞`;
      await chatSessionRepo.addMessage(session.sessionId, 'assistant', errorResponse);
      
      return res.json({
        success: true,
        response: errorResponse,
        sessionId: session.sessionId,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Khớp lựa chọn nha sĩ từ input người dùng
   */
  async matchDentistSelection(userInput, availableDentists) {
    if (!availableDentists || availableDentists.length === 0) return null;
    
    const input = userInput.trim().toLowerCase();
    
    // Xử lý "bất kỳ" hoặc "any" -> trả về nha sĩ đầu tiên
    if (input.includes('bất kỳ') || input.includes('bat ky') || input === 'any') {
      return availableDentists[0];
    }
    
    // Thử khớp theo số - exact match
    const exactNumberMatch = input.match(/^(\d+)$/);
    if (exactNumberMatch) {
      const index = parseInt(exactNumberMatch[1]) - 1;
      if (index >= 0 && index < availableDentists.length) {
        return availableDentists[index];
      }
    }
    
    // Thử trích xuất số từ câu tự nhiên như "chọn nha sĩ số 1", "bác sĩ 2", "số 3"
    const naturalNumberMatch = input.match(/(?:chọn|số|chon|so|bác sĩ|bac si|nha sĩ|nha si|muốn|muon)\s*(?:số|so)?\s*(\d+)/i);
    if (naturalNumberMatch) {
      const index = parseInt(naturalNumberMatch[1]) - 1;
      if (index >= 0 && index < availableDentists.length) {
        return availableDentists[index];
      }
    }
    
    // Thử khớp số đứng một mình trong câu
    const anyNumberMatch = input.match(/(\d+)/);
    if (anyNumberMatch) {
      const index = parseInt(anyNumberMatch[1]) - 1;
      if (index >= 0 && index < availableDentists.length) {
        return availableDentists[index];
      }
    }
    
    // Thử khớp số tiếng Việt
    const vietnameseNumber = this.parseVietnameseNumber(input);
    if (vietnameseNumber !== null && vietnameseNumber > 0) {
      const index = vietnameseNumber - 1;
      if (index >= 0 && index < availableDentists.length) {
        return availableDentists[index];
      }
    }
    
    // Thử khớp theo tên nha sĩ (fuzzy) - bao gồm tên riêng
    for (const dentist of availableDentists) {
      const fullName = (dentist.fullName || dentist.name || '').toLowerCase();
      // Tách tên thành các phần để match linh hoạt hơn
      const nameParts = fullName.split(/\s+/);
      
      if (fullName.includes(input) || input.includes(fullName)) {
        return dentist;
      }
      
      // Kiểm tra xem input có chứa bất kỳ phần nào của tên không
      for (const part of nameParts) {
        if (part.length > 2 && input.includes(part)) {
          return dentist;
        }
      }
    }
    
    return null;
  }

  /**
   * Xử lý việc chọn ngày sau khi đã chọn nha sĩ
   */
  async handleDateSelection(req, res, session, selectedServiceItem, selectedDentist, userId, authToken) {
    try {
      console.log('📅 Đang lấy ngày làm việc của nha sĩ:', selectedDentist.fullName);
      
      // Cập nhật booking context
      await chatSessionRepo.updateBookingContext(session.sessionId, {
        isInBookingFlow: true,
        step: 'DATE_SELECTION',
        selectedServiceItem: selectedServiceItem,
        selectedDentist: selectedDentist,
        selectedDate: null,
        selectedSlot: null
      });
      
      // Gọi API để lấy ngày làm việc
      const SCHEDULE_SERVICE_URL = process.env.SCHEDULE_SERVICE_URL || 'http://localhost:3005';
      
      const datesResponse = await axios.get(
        `${SCHEDULE_SERVICE_URL}/api/slot/dentist/${selectedDentist._id}/working-dates`,
        {
          params: {
            serviceId: selectedServiceItem.serviceId,
            serviceDuration: selectedServiceItem.duration
          },
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : {}
        }
      );
      
      console.log('📦 Working dates response:', datesResponse.data);
      
      // Extract working dates array and maxBookingDays from response
      let workingDates = [];
      let maxBookingDays = 30; // Default fallback
      
      if (datesResponse.data.success && datesResponse.data.data) {
        // Extract maxBookingDays from response
        if (datesResponse.data.data.maxBookingDays) {
          maxBookingDays = datesResponse.data.data.maxBookingDays;
        }
        
        // Check if data contains workingDates array or is directly an array
        if (datesResponse.data.data.workingDates && Array.isArray(datesResponse.data.data.workingDates)) {
          workingDates = datesResponse.data.data.workingDates;
        } else if (Array.isArray(datesResponse.data.data)) {
          workingDates = datesResponse.data.data;
        }
      }
      
      if (workingDates.length === 0) {
        const noDatesMessage = `Xin lỗi, nha sĩ ${selectedDentist.fullName} hiện không có lịch trống. Vui lòng chọn nha sĩ khác hoặc liên hệ hotline! 📞`;
        
        await chatSessionRepo.addMessage(session.sessionId, 'assistant', noDatesMessage);
        
        return res.json({
          success: true,
          response: noDatesMessage,
          sessionId: session.sessionId,
          timestamp: new Date().toISOString()
        });
      }
      
      // Format date list
      let dateMessage = `✅ Đã chọn nha sĩ: **${selectedDentist.fullName}**\n\n📅 **Ngày làm việc có lịch trống:**\n\n`;
      
      // Hiển thị tất cả ngày dựa vào maxBookingDays từ scheduleConfig
      const maxDates = Math.min(workingDates.length, maxBookingDays);
      workingDates.slice(0, maxDates).forEach((dateItem, idx) => {
        // Handle both string format and object format
        const dateStr = typeof dateItem === 'string' ? dateItem : (dateItem.date || dateItem);
        const date = new Date(dateStr);
        const dayName = date.toLocaleDateString('vi-VN', { weekday: 'long' });
        const dateFormatted = date.toLocaleDateString('vi-VN');
        
        dateMessage += `${idx + 1}. ${dayName}, ${dateFormatted}\n`;
      });
      
      if (workingDates.length > maxDates) {
        dateMessage += `\n... và ${workingDates.length - maxDates} ngày khác.\n`;
      }
      
      dateMessage += '\n💡 Chọn ngày (1, 2, 3...) hoặc gõ ngày theo định dạng "DD/MM/YYYY"';
      
      // Normalize working dates to array of date strings (YYYY-MM-DD)
      const normalizedDates = workingDates.map(dateItem => {
        const dateStr = typeof dateItem === 'string' ? dateItem : (dateItem.date || dateItem);
        // Ensure format is YYYY-MM-DD
        const date = new Date(dateStr);
        return date.toISOString().split('T')[0];
      });
      
      // Save dates to context
      await chatSessionRepo.updateBookingContext(session.sessionId, {
        isInBookingFlow: true,
        step: 'DATE_SELECTION',
        selectedServiceItem: selectedServiceItem,
        selectedDentist: selectedDentist,
        availableDates: normalizedDates
      });
      
      await chatSessionRepo.addMessage(session.sessionId, 'assistant', dateMessage);
      
      return res.json({
        success: true,
        response: dateMessage,
        sessionId: session.sessionId,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      console.error('❌ Handle date selection error:', error);
      
      const errorResponse = `Xin lỗi, không thể tải lịch làm việc: ${error.message}. Vui lòng thử lại! 📞`;
      await chatSessionRepo.addMessage(session.sessionId, 'assistant', errorResponse);
      
      return res.json({
        success: true,
        response: errorResponse,
        sessionId: session.sessionId,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Khớp lựa chọn ngày từ input người dùng
   */
  async matchDateSelection(userInput, availableDates) {
    if (!availableDates || availableDates.length === 0) return null;
    
    const input = userInput.trim().toLowerCase();
    
    // Thử khớp theo số - exact match
    const exactNumberMatch = input.match(/^(\d+)$/);
    if (exactNumberMatch) {
      const index = parseInt(exactNumberMatch[1]) - 1;
      if (index >= 0 && index < availableDates.length) {
        return availableDates[index];
      }
    }
    
    // Thử trích xuất số từ câu tự nhiên như "chọn ngày số 1", "ngày 2"
    const naturalNumberMatch = input.match(/(?:chọn|số|chon|so|ngày|ngay|muốn|muon)\s*(?:số|so)?\s*(\d+)/i);
    if (naturalNumberMatch) {
      const index = parseInt(naturalNumberMatch[1]) - 1;
      if (index >= 0 && index < availableDates.length) {
        return availableDates[index];
      }
    }
    
    // Thử khớp số tiếng Việt
    const vietnameseNumber = this.parseVietnameseNumber(input);
    if (vietnameseNumber !== null && vietnameseNumber > 0) {
      const index = vietnameseNumber - 1;
      if (index >= 0 && index < availableDates.length) {
        return availableDates[index];
      }
    }
    
    // Thử khớp theo định dạng ngày DD/MM/YYYY
    const dateMatch = input.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (dateMatch) {
      const [, day, month, year] = dateMatch;
      const inputDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      
      if (availableDates.includes(inputDate)) {
        return inputDate;
      }
    }
    
    // Thử khớp theo định dạng "ngày DD tháng MM" hoặc "ngày DD/MM"
    // Ví dụ: "ngày 27 tháng 12", "ngày 27/12", "27 tháng 12"
    const vietnameseDateMatch = input.match(/(?:ngày\s*)?(\d{1,2})(?:\s*[\/\-]\s*|\s*tháng\s*)(\d{1,2})/i);
    if (vietnameseDateMatch) {
      const [, day, month] = vietnameseDateMatch;
      const currentYear = new Date().getFullYear();
      const inputDate = `${currentYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      
      if (availableDates.includes(inputDate)) {
        return inputDate;
      }
      
      // Thử năm sau nếu không tìm thấy
      const nextYear = currentYear + 1;
      const inputDateNextYear = `${nextYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      if (availableDates.includes(inputDateNextYear)) {
        return inputDateNextYear;
      }
    }
    
    // Thử khớp theo thứ trong tuần - "thứ hai", "thứ bảy", "chủ nhật"
    const dayOfWeekMap = {
      'chủ nhật': 0, 'chu nhat': 0, 'cn': 0,
      'thứ hai': 1, 'thu hai': 1, 't2': 1,
      'thứ ba': 2, 'thu ba': 2, 't3': 2,
      'thứ tư': 3, 'thu tu': 3, 't4': 3,
      'thứ năm': 4, 'thu nam': 4, 't5': 4,
      'thứ sáu': 5, 'thu sau': 5, 't6': 5,
      'thứ bảy': 6, 'thu bay': 6, 't7': 6
    };
    
    // Tìm thứ trong input
    let targetDayOfWeek = null;
    for (const [dayName, dayNum] of Object.entries(dayOfWeekMap)) {
      if (input.includes(dayName)) {
        targetDayOfWeek = dayNum;
        break;
      }
    }
    
    if (targetDayOfWeek !== null) {
      // Nếu input cũng có ngày cụ thể (VD: "thứ bảy ngày 27"), ưu tiên ngày đó
      const dayInInput = input.match(/ngày\s*(\d{1,2})/i);
      if (dayInInput) {
        const targetDay = parseInt(dayInInput[1]);
        // Tìm ngày có thứ khớp và ngày trong tháng khớp
        for (const dateStr of availableDates) {
          const date = new Date(dateStr);
          if (date.getDay() === targetDayOfWeek && date.getDate() === targetDay) {
            return dateStr;
          }
        }
      }
      
      // Nếu không có ngày cụ thể, tìm ngày gần nhất có thứ khớp
      for (const dateStr of availableDates) {
        const date = new Date(dateStr);
        if (date.getDay() === targetDayOfWeek) {
          return dateStr;
        }
      }
    }
    
    // Thử khớp số đứng một mình trong câu (cuối cùng)
    const anyNumberMatch = input.match(/(\d+)/);
    if (anyNumberMatch) {
      const index = parseInt(anyNumberMatch[1]) - 1;
      if (index >= 0 && index < availableDates.length) {
        return availableDates[index];
      }
    }
    
    return null;
  }

  /**
   * Xử lý việc chọn khung giờ sau khi đã chọn ngày
   */
  async handleSlotSelection(req, res, session, selectedServiceItem, selectedDentist, selectedDate, userId, authToken) {
    try {
      console.log('🕐 Đang lấy khung giờ cho ngày:', selectedDate);
      
      // Cập nhật booking context
      await chatSessionRepo.updateBookingContext(session.sessionId, {
        isInBookingFlow: true,
        step: 'SLOT_SELECTION',
        selectedServiceItem: selectedServiceItem,
        selectedDentist: selectedDentist,
        selectedDate: selectedDate,
        selectedSlot: null
      });
      
      // Gọi API để lấy chi tiết khung giờ
      const SCHEDULE_SERVICE_URL = process.env.SCHEDULE_SERVICE_URL || 'http://localhost:3005';
      
      // QUAN TRỌNG: Sử dụng thời lượng addon nếu có (cho dịch vụ được đề xuất)
      // Đối với dịch vụ không được đề xuất, sử dụng thời lượng addon dài nhất
      const serviceDuration = selectedServiceItem.duration || 30;
      
      console.log(`🕐 Đang lấy khung giờ với thời lượng: ${serviceDuration} phút cho ${selectedServiceItem.addOnName || selectedServiceItem.serviceName}`);
      
      const slotsResponse = await axios.get(
        `${SCHEDULE_SERVICE_URL}/api/slot/dentist/${selectedDentist._id}/details/future`,
        {
          params: {
            date: selectedDate,
            serviceId: selectedServiceItem.serviceId,
            serviceDuration: serviceDuration // ← Thêm thông số duration
          },
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : {}
        }
      );
      
      console.log('📦 Kết quả khung giờ:', slotsResponse.data);
      
      // Trích xuất các slot riêng lẻ từ response
      let individualSlots = [];
      if (slotsResponse.data.success && slotsResponse.data.data) {
        individualSlots = slotsResponse.data.data.slots || [];
      }
      
      // Nhóm các slot liên tiếp theo thời lượng dịch vụ
      const slotDuration = 15; // Mỗi slot là 15 phút
      const slotsNeeded = Math.ceil(serviceDuration / slotDuration);
      const slotGroups = [];
      
      for (let i = 0; i <= individualSlots.length - slotsNeeded; i++) {
        const group = [];
        let isConsecutive = true;
        
        for (let j = 0; j < slotsNeeded; j++) {
          const currentSlot = individualSlots[i + j];
          group.push(currentSlot);
          
          if (j > 0) {
            const prevSlot = individualSlots[i + j - 1];
            const prevEnd = new Date(prevSlot.startTime).getTime() + (15 * 60 * 1000);
            const currentStart = new Date(currentSlot.startTime).getTime();
            
            // Kiểm tra xem các slot có liên tiếp không (tối đa 1ms chênh lệch)
            if (Math.abs(currentStart - prevEnd) > 1000) {
              isConsecutive = false;
              break;
            }
          }
        }
        
        if (isConsecutive) {
          const firstSlot = group[0];
          const lastSlot = group[group.length - 1];
          const lastSlotEnd = new Date(lastSlot.startTime).getTime() + (15 * 60 * 1000);
          
          slotGroups.push({
            startTime: firstSlot.startTime,
            startTimeVN: firstSlot.startTimeVN,
            endTime: new Date(lastSlotEnd).toISOString(),
            endTimeVN: new Date(lastSlotEnd).toLocaleTimeString('en-GB', { 
              timeZone: 'Asia/Ho_Chi_Minh', 
              hour12: false,
              hour: '2-digit',
              minute: '2-digit'
            }),
            slotIds: group.map(s => s._id),
            slots: group
          });
        }
      }
      
      console.log(`✅ Đã nhóm ${individualSlots.length} slots thành ${slotGroups.length} nhóm (${slotsNeeded} slots mỗi nhóm)`);
      
      if (slotGroups.length === 0) {
        const noSlotsMessage = `Xin lỗi, ngày ${new Date(selectedDate).toLocaleDateString('vi-VN')} không có khung giờ trống. Vui lòng chọn ngày khác! 📞`;
        
        await chatSessionRepo.addMessage(session.sessionId, 'assistant', noSlotsMessage);
        
        return res.json({
          success: true,
          response: noSlotsMessage,
          sessionId: session.sessionId,
          timestamp: new Date().toISOString()
        });
      }
      
      // Định dạng các nhóm khung giờ
      const dateFormatted = new Date(selectedDate).toLocaleDateString('vi-VN');
      
      let slotMessage = `✅ Đã chọn ngày: **${dateFormatted}**\n\n🕐 **Khung giờ trống:**\n\n`;
      
      // Hiển thị tối đa 50 slots thay vì 12
      const maxSlots = Math.min(slotGroups.length, 50);
      slotGroups.slice(0, maxSlots).forEach((group, idx) => {
        // Schedule-service trả về: startTime (ISO), startTimeVN (HH:mm), endTimeVN (HH:mm)
        // Ưu tiên dùng startTimeVN/endTimeVN đã được convert sẵn
        let startTime = group.startTimeVN || group.startTime;
        let endTime = group.endTimeVN || group.endTime;
        
        // Nếu vẫn là ISO string thì convert UTC+7
        if (startTime && typeof startTime === 'string' && (startTime.includes('T') || startTime.includes('Z'))) {
          const date = new Date(startTime);
          const vnHours = date.getUTCHours() + 7;
          const hours = (vnHours >= 24 ? vnHours - 24 : vnHours).toString().padStart(2, '0');
          const minutes = date.getUTCMinutes().toString().padStart(2, '0');
          startTime = `${hours}:${minutes}`;
        }
        
        if (endTime && typeof endTime === 'string' && (endTime.includes('T') || endTime.includes('Z'))) {
          const date = new Date(endTime);
          const vnHours = date.getUTCHours() + 7;
          const hours = (vnHours >= 24 ? vnHours - 24 : vnHours).toString().padStart(2, '0');
          const minutes = date.getUTCMinutes().toString().padStart(2, '0');
          endTime = `${hours}:${minutes}`;
        }
        
        // Hiển thị startTime - endTime, nếu không có endTime thì chỉ hiển thị startTime
        const timeDisplay = endTime ? `${startTime} - ${endTime}` : `${startTime}`;
        slotMessage += `${idx + 1}. ${timeDisplay}\n`;
      });
      
      if (slotGroups.length > maxSlots) {
        slotMessage += `\n... và ${slotGroups.length - maxSlots} khung giờ khác.\n`;
      }
      
      slotMessage += '\n💡 Chọn khung giờ (1, 2, 3...)';
      
      // Lưu các nhóm khung giờ vào context
      await chatSessionRepo.updateBookingContext(session.sessionId, {
        isInBookingFlow: true,
        step: 'SLOT_SELECTION',
        selectedServiceItem: selectedServiceItem,
        selectedDentist: selectedDentist,
        selectedDate: selectedDate,
        availableSlotGroups: slotGroups
      });
      
      await chatSessionRepo.addMessage(session.sessionId, 'assistant', slotMessage);
      
      return res.json({
        success: true,
        response: slotMessage,
        sessionId: session.sessionId,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      console.error('❌ Handle slot selection error:', error);
      
      const errorResponse = `Xin lỗi, không thể tải khung giờ: ${error.message}. Vui lòng thử lại! 📞`;
      await chatSessionRepo.addMessage(session.sessionId, 'assistant', errorResponse);
      
      return res.json({
        success: true,
        response: errorResponse,
        sessionId: session.sessionId,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Khớp lựa chọn nhóm khung giờ từ input người dùng
   */
  async matchSlotGroupSelection(userInput, availableSlotGroups) {
    if (!availableSlotGroups || availableSlotGroups.length === 0) return null;
    
    const input = userInput.trim().toLowerCase();
    
    // Thử khớp theo số - exact match
    const exactNumberMatch = input.match(/^(\d+)$/);
    if (exactNumberMatch) {
      const index = parseInt(exactNumberMatch[1]) - 1;
      if (index >= 0 && index < availableSlotGroups.length) {
        return availableSlotGroups[index];
      }
    }
    
    // Thử trích xuất số từ câu tự nhiên như "chọn giờ số 2", "khung 3", "slot 1"
    const naturalNumberMatch = input.match(/(?:chọn|số|chon|so|giờ|gio|khung|slot|muốn|muon)\s*(?:số|so)?\s*(\d+)/i);
    if (naturalNumberMatch) {
      const index = parseInt(naturalNumberMatch[1]) - 1;
      if (index >= 0 && index < availableSlotGroups.length) {
        return availableSlotGroups[index];
      }
    }
    
    // Thử khớp số tiếng Việt (một, hai, ba, ..., mười ba, hai mươi, ...)
    const vietnameseNumber = this.parseVietnameseNumber(input);
    if (vietnameseNumber !== null && vietnameseNumber > 0) {
      const index = vietnameseNumber - 1;
      if (index >= 0 && index < availableSlotGroups.length) {
        return availableSlotGroups[index];
      }
    }
    
    // Thử khớp theo định dạng giờ (ví dụ: "16:00" hoặc "16h00")
    const timeMatch = input.match(/(\d{1,2})[h:](\d{2})/);
    if (timeMatch) {
      const targetTime = `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`;
      const found = availableSlotGroups.find(slot => {
        const slotTime = slot.startTimeVN || slot.startTime;
        return slotTime && slotTime.includes(targetTime);
      });
      if (found) return found;
    }
    
    // Thử khớp số đứng một mình trong câu (cuối cùng)
    const anyNumberMatch = input.match(/(\d+)/);
    if (anyNumberMatch) {
      const index = parseInt(anyNumberMatch[1]) - 1;
      if (index >= 0 && index < availableSlotGroups.length) {
        return availableSlotGroups[index];
      }
    }
    
    return null;
  }

  /**
   * Chuyển đổi số tiếng Việt thành số nguyên
   * Hỗ trợ: một (1), hai (2), ..., mười (10), mười một (11), ..., hai mươi (20), ...
   * Cũng hỗ trợ: "số một", "số 1", "thứ hai", v.v.
   */
  parseVietnameseNumber(input) {
    const vnNumbers = {
      'không': 0, 'một': 1, 'hai': 2, 'ba': 3, 'bốn': 4, 'năm': 5,
      'sáu': 6, 'bảy': 7, 'tám': 8, 'chín': 9, 'mười': 10,
      'mươi': 10, 'linh': 0, 'lẻ': 0
    };
    
    let text = input.trim().toLowerCase();
    
    // Xử lý pattern "số X" (ví dụ: "số bốn" -> "bốn", "số 4" -> "4")
    if (text.startsWith('số ')) {
      text = text.substring(3).trim();
      // Nếu bây giờ là chữ số, trả về trực tiếp
      const digitMatch = text.match(/^(\d+)$/);
      if (digitMatch) {
        return parseInt(digitMatch[1]);
      }
    }
    
    // Khớp trực tiếp cho các số đơn giản
    if (vnNumbers[text] !== undefined) {
      return vnNumbers[text];
    }
    
    // Xử lý số ghép như "mười ba" (13), "hai mươi mốt" (21)
    const parts = text.split(/\s+/);
    
    if (parts.length === 2) {
      // Pattern "mười X" (11-19)
      if (parts[0] === 'mười') {
        const unit = vnNumbers[parts[1]];
        if (unit !== undefined) {
          return 10 + (parts[1] === 'mốt' ? 1 : unit);
        }
      }
      // Pattern "X mươi" (20, 30, ...)
      const tens = vnNumbers[parts[0]];
      if (tens !== undefined && (parts[1] === 'mươi' || parts[1] === 'chục')) {
        return tens * 10;
      }
    }
    
    if (parts.length === 3) {
      // Pattern "X mươi Y" (21, 32, ...)
      const tens = vnNumbers[parts[0]];
      const unit = parts[2] === 'mốt' ? 1 : vnNumbers[parts[2]];
      if (tens !== undefined && unit !== undefined && (parts[1] === 'mươi' || parts[1] === 'mươi')) {
        return tens * 10 + unit;
      }
    }
    
    return null;
  }

  /**
   * Xử lý khi user xác nhận đặt lịch - trích xuất dữ liệu và redirect sang thanh toán
   */
  async processBookingConfirmation(req, res, session, bookingContext, userId, authToken) {
    try {
      console.log('✅ Đang xử lý xác nhận đặt lịch...');
      console.log('📦 Booking context:', JSON.stringify(bookingContext, null, 2));
      
      const selectedServiceItem = bookingContext.selectedServiceItem;
      const selectedDentist = bookingContext.selectedDentist;
      const selectedDate = bookingContext.selectedDate;
      const selectedSlotGroup = bookingContext.selectedSlotGroup;
      
      console.log('🔍 Selected slot group:', JSON.stringify(selectedSlotGroup, null, 2));
      
      // Trích xuất slot IDs - slotIds là mảng từ handleSlotSelection
      let slotIds = [];
      if (selectedSlotGroup && selectedSlotGroup.slotIds) {
        slotIds = Array.isArray(selectedSlotGroup.slotIds) 
          ? [...selectedSlotGroup.slotIds] 
          : (selectedSlotGroup.slotIds.toArray ? selectedSlotGroup.slotIds.toArray() : []);
      }
      console.log('🔍 Extracted slotIds:', slotIds, 'length:', slotIds.length);
      
      const slotId = slotIds.length > 0 ? slotIds[0] : (selectedSlotGroup?._id || selectedSlotGroup?.slotId || selectedSlotGroup?.id);
      
      if (!slotId) {
        console.error('❌ No slot ID found in selectedSlotGroup:', selectedSlotGroup);
        const errorMessage = '❌ Không thể lấy thông tin slot. Vui lòng thử đặt lại lịch!';
        await chatSessionRepo.addMessage(session.sessionId, 'assistant', errorMessage);
        return res.json({ success: false, response: errorMessage, sessionId: session.sessionId, timestamp: new Date().toISOString() });
      }
      
      console.log('✅ Slot ID extracted:', slotId);
      
      // Định dạng displayTime cho frontend
      let startTimeDisplay = selectedSlotGroup.startTimeVN || selectedSlotGroup.startTime;
      let endTimeDisplay = selectedSlotGroup.endTimeVN || selectedSlotGroup.endTime;
      
      // Chuyển ISO string thành HH:mm nếu cần
      if (startTimeDisplay && typeof startTimeDisplay === 'string' && (startTimeDisplay.includes('T') || startTimeDisplay.includes('Z'))) {
        const date = new Date(startTimeDisplay);
        const vnHours = date.getUTCHours() + 7;
        const hours = (vnHours >= 24 ? vnHours - 24 : vnHours).toString().padStart(2, '0');
        const minutes = date.getUTCMinutes().toString().padStart(2, '0');
        startTimeDisplay = `${hours}:${minutes}`;
      }
      
      if (endTimeDisplay && typeof endTimeDisplay === 'string' && (endTimeDisplay.includes('T') || endTimeDisplay.includes('Z'))) {
        const date = new Date(endTimeDisplay);
        const vnHours = date.getUTCHours() + 7;
        const hours = (vnHours >= 24 ? vnHours - 24 : vnHours).toString().padStart(2, '0');
        const minutes = date.getUTCMinutes().toString().padStart(2, '0');
        endTimeDisplay = `${hours}:${minutes}`;
      }
      
      const displayTime = endTimeDisplay ? `${startTimeDisplay} - ${endTimeDisplay}` : startTimeDisplay;
      
      // Chuẩn bị booking data để gửi về frontend
      const bookingData = {
        service: {
          _id: selectedServiceItem.serviceId,
          name: selectedServiceItem.serviceName,
          requireExamFirst: selectedServiceItem.requireExamFirst || false
        },
        serviceAddOn: selectedServiceItem.addOnId ? {
          _id: selectedServiceItem.addOnId,
          name: selectedServiceItem.addOnName,
          price: selectedServiceItem.price,
          durationMinutes: selectedServiceItem.duration
        } : null,
        serviceAddOnUserSelected: !!selectedServiceItem.addOnId,
        dentist: {
          _id: selectedDentist._id,
          fullName: selectedDentist.fullName || selectedDentist.name,
          name: selectedDentist.fullName || selectedDentist.name,
          gender: selectedDentist.gender,
          title: selectedDentist.title
        },
        date: selectedDate,
        slotGroup: {
          slotIds: slotIds.length > 0 ? slotIds : [slotId],
          slots: slotIds.length > 0 ? slotIds : [slotId],
          startTime: selectedSlotGroup.startTime,
          endTime: selectedSlotGroup.endTime,
          displayTime: displayTime
        },
        examRecordId: selectedServiceItem.recordId || null
      };
      
      console.log('📦 Final booking data:', JSON.stringify(bookingData, null, 2));
      
      const successMessage = `✅ **Đặt lịch thành công!**\n\n🔄 Đang chuyển đến trang thanh toán...\n\n💡 Vui lòng hoàn tất thanh toán để xác nhận lịch hẹn của bạn.`;
      
      // Xóa booking context
      await chatSessionRepo.clearBookingContext(session.sessionId);
      await chatSessionRepo.addMessage(session.sessionId, 'assistant', successMessage);
      
      return res.json({
        success: true,
        response: successMessage,
        sessionId: session.sessionId,
        timestamp: new Date().toISOString(),
        bookingData: bookingData,
        redirectToPayment: true
      });
      
    } catch (error) {
      console.error('❌ Process booking confirmation error:', error);
      const errorMessage = `❌ Không thể xử lý đặt lịch: ${error.message}. Vui lòng thử lại!`;
      await chatSessionRepo.addMessage(session.sessionId, 'assistant', errorMessage);
      return res.json({ success: false, response: errorMessage, sessionId: session.sessionId, timestamp: new Date().toISOString() });
    }
  }

  /**
   * Xử lý xác nhận cuối cùng
   */
  async handleFinalConfirmation(req, res, session, bookingData, userId, authToken) {
    try {
      console.log('✅ Đang hiển thị xác nhận cuối cùng');
      
      const { selectedServiceItem, selectedDentist, selectedDate, selectedSlotGroup } = bookingData;
      
      // Định dạng thông điệp xác nhận
      const dateFormatted = new Date(selectedDate).toLocaleDateString('vi-VN', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      });
      
      let confirmMessage = '📋 **XÁC NHẬN THÔNG TIN ĐẶT LỊCH**\n\n';
      
      confirmMessage += `🦷 **Dịch vụ:** ${selectedServiceItem.serviceName}`;
      if (selectedServiceItem.addOnName) {
        confirmMessage += ` - ${selectedServiceItem.addOnName}`;
      }
      if (selectedServiceItem.isRecommended) {
        confirmMessage += ' ⭐ (Chỉ định)';
      }
      confirmMessage += '\n';
      
      if (selectedServiceItem.price > 0) {
        confirmMessage += `💰 **Giá:** ${selectedServiceItem.price.toLocaleString('vi-VN')}đ\n`;
      }
      
      confirmMessage += `⏱️ **Thời gian dự kiến:** ${selectedServiceItem.duration} phút\n\n`;
      
      confirmMessage += `👨‍⚕️ **Nha sĩ:** ${selectedDentist.fullName || selectedDentist.name}\n`;
      if (selectedDentist.specialization) {
        confirmMessage += `   📌 Chuyên môn: ${selectedDentist.specialization}\n`;
      }
      confirmMessage += '\n';
      
      confirmMessage += `📅 **Ngày:** ${dateFormatted}\n`;
      
      // Schedule-service trả về: startTime (ISO), startTimeVN (HH:mm), endTimeVN (HH:mm)
      let startTime = selectedSlotGroup.startTimeVN || selectedSlotGroup.startTime;
      let endTime = selectedSlotGroup.endTimeVN || selectedSlotGroup.endTime;
      
      // Nếu vẫn là ISO string thì convert UTC+7
      if (startTime && typeof startTime === 'string' && (startTime.includes('T') || startTime.includes('Z'))) {
        const date = new Date(startTime);
        const vnHours = date.getUTCHours() + 7;
        const hours = (vnHours >= 24 ? vnHours - 24 : vnHours).toString().padStart(2, '0');
        const minutes = date.getUTCMinutes().toString().padStart(2, '0');
        startTime = `${hours}:${minutes}`;
      }
      
      if (endTime && typeof endTime === 'string' && (endTime.includes('T') || endTime.includes('Z'))) {
        const date = new Date(endTime);
        const vnHours = date.getUTCHours() + 7;
        const hours = (vnHours >= 24 ? vnHours - 24 : vnHours).toString().padStart(2, '0');
        const minutes = date.getUTCMinutes().toString().padStart(2, '0');
        endTime = `${hours}:${minutes}`;
      }
      
      const timeDisplay = endTime ? `${startTime} - ${endTime}` : `${startTime}`;
      confirmMessage += `🕐 **Giờ:** ${timeDisplay}\n\n`;
      
      confirmMessage += '💡 Xác nhận đặt lịch? (Có/Không)';
      
      // Cập nhật context sang bước CONFIRMATION
      await chatSessionRepo.updateBookingContext(session.sessionId, {
        isInBookingFlow: true,
        step: 'CONFIRMATION',
        selectedServiceItem: selectedServiceItem,
        selectedDentist: selectedDentist,
        selectedDate: selectedDate,
        selectedSlotGroup: selectedSlotGroup
      });
      
      await chatSessionRepo.addMessage(session.sessionId, 'assistant', confirmMessage);
      
      return res.json({
        success: true,
        response: confirmMessage,
        sessionId: session.sessionId,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      console.error('❌ Handle final confirmation error:', error);
      
      const errorResponse = `Xin lỗi, không thể hiển thị xác nhận: ${error.message}. Vui lòng thử lại! 📞`;
      await chatSessionRepo.addMessage(session.sessionId, 'assistant', errorResponse);
      
      return res.json({
        success: true,
        response: errorResponse,
        sessionId: session.sessionId,
        timestamp: new Date().toISOString()
      });
    }
  }
}

module.exports = new ChatbotController();
