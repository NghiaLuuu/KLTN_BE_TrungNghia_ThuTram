const aiService = require('../services/ai.service');
const chatSessionRepo = require('../repositories/chatSession.repository');
const imageAnalysisService = require('../services/imageAnalysis.service');
const { validateImageFile, optimizeImage } = require('../utils/imageValidator');
const { handleQuery } = require('../services/queryEngine.service');
const bookingService = require('../services/booking.service');
const axios = require('axios');

class ChatbotController {
  /**
   * POST /api/ai/chat
   * Send message and get AI response
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

      // Get or create session first (needed for booking flow check)
      const session = await chatSessionRepo.getOrCreateSession(userId);

      // Check booking context to see if user is in booking flow
      const bookingContext = await chatSessionRepo.getBookingContext(session.sessionId);
      const isInBookingFlowContext = bookingContext && bookingContext.isInBookingFlow;

      // Check if message is dental-related
      const isDentalRelated = aiService.isDentalRelated(message);
      
      // Check if user is in booking flow (recently received service list)
      const recentMessages = session.messages.slice(-7); // Last 7 messages for better context
      const isInBookingFlow = recentMessages.some(msg => 
        msg.role === 'assistant' && 
        (msg.content.includes('Dịch vụ khám và điều trị') || 
         msg.content.includes('Dịch vụ được Nha sĩ chỉ định') ||
         msg.content.includes('Danh sách dịch vụ có thể đặt lịch') ||
         msg.content.includes('Danh sách nha sĩ khả dụng') ||
         msg.content.includes('Ngày làm việc có lịch trống') ||
         msg.content.includes('Khung giờ trống') ||
         msg.content.includes('Bạn muốn đặt lịch cho dịch vụ nào'))
      );
      
      // Skip off-topic check if:
      // 1. User is in booking flow (context or messages)
      // 2. Message is a number (service/dentist/date/slot selection)
      // 3. Message contains booking keywords
      // 4. Message looks like a person name (for dentist selection)
      const isNumberSelection = /^\d+$/.test(message.trim());
      const looksLikePersonName = /^[A-ZÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ][a-zàáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]+(\s[A-ZÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ][a-zàáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]+)+$/i.test(message.trim());
      const hasBookingKeywords = ['đặt lịch', 'dịch vụ', 'khám', 'hẹn', 'có', 'không', 'bất kỳ', 'nha sĩ', 'Nha sĩ', 'ngày', 'giờ'].some(kw => 
        message.toLowerCase().includes(kw)
      );
      
      if (!isDentalRelated && !isInBookingFlowContext && !isInBookingFlow && !isNumberSelection && !hasBookingKeywords && !looksLikePersonName) {
        // Increment off-topic count (rate limiting)
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
        
        // Fallback if rate limiter not available
        const rejectMessage = 'Xin lỗi, tôi chỉ có thể hỗ trợ các vấn đề liên quan đến phòng khám nha khoa SmileCare. Bạn có câu hỏi nào về răng miệng không? 😊';
        
        return res.json({
          success: true,
          response: rejectMessage,
          isOffTopic: true,
          timestamp: new Date().toISOString()
        });
      }
      
      // Reset off-topic count on valid dental message
      if (req.rateLimit && req.rateLimit.resetOffTopicCount) {
        await req.rateLimit.resetOffTopicCount(userId);
      }

      // Add user message to session
      await chatSessionRepo.addMessage(session.sessionId, 'user', message);

      // Get conversation history (optimized for cost)
      // Read 20 messages at CONFIRMATION step when user confirms (to get full booking context)
      // Read 10 messages at CONFIRMATION step for GPT summary
      // Other steps: 5 messages is enough for context
      let historyLimit = 5; // Default for most steps
      
      if (bookingContext && bookingContext.step === 'CONFIRMATION') {
        const input = message.trim().toLowerCase();
        // If user is confirming (Có), read more history to ensure we have all booking data
        if (input.includes('có') || input.includes('yes') || input.includes('ok') || input.includes('đồng ý') || input.includes('xác nhận')) {
          historyLimit = 20; // Read full context when confirming
        } else {
          historyLimit = 10; // Normal confirmation step
        }
      }
      
      const history = await chatSessionRepo.getHistory(userId, historyLimit);
      const formattedMessages = aiService.formatMessagesForGPT(history);

      // Get auth token from request (for authenticated API calls)
      const authToken = req.headers.authorization?.split(' ')[1] || null;

      // Get GPT response (with Query Engine integration)
      const result = await aiService.sendMessageToGPT(formattedMessages, undefined, authToken);

      // Check if user is selecting a service (after seeing the service list)
      // bookingContext already fetched above
      
      if (bookingContext && bookingContext.isInBookingFlow && bookingContext.step === 'SERVICE_SELECTION') {
        console.log('🎯 User is in SERVICE_SELECTION step');
        
        // Try to match service selection from flat list
        const selectedItem = await this.matchServiceFromFlatList(
          message,
          bookingContext.flatServiceList
        );
        
        if (selectedItem) {
          console.log('✅ Service selected:', selectedItem);
          
          // Handle dentist selection flow (skip addon selection)
          return await this.handleDentistSelection(
            req,
            res,
            session,
            selectedItem,
            userId,
            authToken
          );
        }
      }

      // Check if user is selecting a dentist
      if (bookingContext && bookingContext.isInBookingFlow && bookingContext.step === 'DENTIST_SELECTION') {
        console.log('🎯 User is in DENTIST_SELECTION step');
        
        // Try to match dentist selection
        const selectedDentist = await this.matchDentistSelection(
          message,
          bookingContext.availableDentists
        );
        
        if (selectedDentist) {
          console.log('✅ Dentist selected:', selectedDentist.fullName);
          
          // Handle date selection flow
          return await this.handleDateSelection(
            req,
            res,
            session,
            bookingContext.selectedServiceItem,
            selectedDentist,
            userId,
            authToken
          );
        }
      }

      // Check if user is selecting a date
      if (bookingContext && bookingContext.isInBookingFlow && bookingContext.step === 'DATE_SELECTION') {
        console.log('🎯 User is in DATE_SELECTION step');
        
        // Try to match date selection
        const selectedDate = await this.matchDateSelection(
          message,
          bookingContext.availableDates
        );
        
        if (selectedDate) {
          console.log('✅ Date selected:', selectedDate);
          
          // Handle slot selection flow
          return await this.handleSlotSelection(
            req,
            res,
            session,
            bookingContext.selectedServiceItem,
            bookingContext.selectedDentist,
            selectedDate,
            userId,
            authToken
          );
        }
      }

      // Check if user is selecting a slot
      if (bookingContext && bookingContext.isInBookingFlow && bookingContext.step === 'SLOT_SELECTION') {
        console.log('🎯 User is in SLOT_SELECTION step');
        
        // Try to match slot group selection
        const selectedSlotGroup = await this.matchSlotGroupSelection(
          message,
          bookingContext.availableSlotGroups
        );
        
        if (selectedSlotGroup) {
          console.log('✅ Slot group selected:', selectedSlotGroup);
          
          // Handle final confirmation
          return await this.handleFinalConfirmation(
            req,
            res,
            session,
            {
              selectedServiceItem: bookingContext.selectedServiceItem,
              selectedDentist: bookingContext.selectedDentist,
              selectedDate: bookingContext.selectedDate,
              selectedSlotGroup: selectedSlotGroup
            },
            userId,
            authToken
          );
        }
      }

      // Check if user is confirming booking
      if (bookingContext && bookingContext.isInBookingFlow && bookingContext.step === 'CONFIRMATION') {
        console.log('🎯 User is in CONFIRMATION step');
        
        const input = message.trim().toLowerCase();
        
        if (input.includes('có') || input.includes('yes') || input.includes('ok') || input.includes('đồng ý') || input.includes('xác nhận')) {
          // User confirmed - Re-fetch booking context to ensure we have latest data
          console.log('✅ User confirmed booking, re-fetching booking context...');
          
          const latestContext = await chatSessionRepo.getBookingContext(session.sessionId);
          
          if (!latestContext || !latestContext.selectedSlotGroup) {
            console.error('❌ No booking context or selectedSlotGroup found after re-fetch');
            const errorMessage = '❌ Không tìm thấy thông tin đặt lịch. Vui lòng thử đặt lại từ đầu!';
            await chatSessionRepo.addMessage(session.sessionId, 'assistant', errorMessage);
            return res.json({
              success: false,
              response: errorMessage,
              sessionId: session.sessionId,
              timestamp: new Date().toISOString()
            });
          }
          
          console.log('📦 Latest booking context:', JSON.stringify(latestContext, null, 2));
          
          const selectedServiceItem = latestContext.selectedServiceItem;
          const selectedDentist = latestContext.selectedDentist;
          const selectedDate = latestContext.selectedDate;
          const selectedSlotGroup = latestContext.selectedSlotGroup;
          
          console.log('🔍 Selected slot group:', JSON.stringify(selectedSlotGroup, null, 2));
          console.log('🔍 selectedSlotGroup type:', typeof selectedSlotGroup);
          console.log('🔍 selectedSlotGroup.slotIds:', selectedSlotGroup ? selectedSlotGroup.slotIds : 'undefined');
          console.log('🔍 slotIds type:', selectedSlotGroup && selectedSlotGroup.slotIds ? typeof selectedSlotGroup.slotIds : 'undefined');
          console.log('🔍 slotIds isArray:', selectedSlotGroup && selectedSlotGroup.slotIds ? Array.isArray(selectedSlotGroup.slotIds) : false);
          
          // Extract slot IDs - slotIds is an array from handleSlotSelection
          // Handle both plain object and MongoDB document
          let slotIds = [];
          if (selectedSlotGroup && selectedSlotGroup.slotIds) {
            // Convert to plain array if needed (MongoDB might return special array type)
            slotIds = Array.isArray(selectedSlotGroup.slotIds) 
              ? [...selectedSlotGroup.slotIds] 
              : (selectedSlotGroup.slotIds.toArray ? selectedSlotGroup.slotIds.toArray() : []);
          }
          console.log('🔍 Extracted slotIds:', slotIds, 'length:', slotIds.length);
          
          const slotId = slotIds.length > 0 ? slotIds[0] : (selectedSlotGroup?._id || selectedSlotGroup?.slotId || selectedSlotGroup?.id);
          console.log('🔍 Final slotId:', slotId);
          
          if (!slotId) {
            console.error('❌ No slot ID found in selectedSlotGroup:', selectedSlotGroup);
            const errorMessage = '❌ Không thể lấy thông tin slot. Vui lòng thử đặt lại lịch!';
            await chatSessionRepo.addMessage(session.sessionId, 'assistant', errorMessage);
            return res.json({
              success: false,
              response: errorMessage,
              sessionId: session.sessionId,
              timestamp: new Date().toISOString()
            });
          }
          
          console.log('✅ Slot ID extracted:', slotId);
          console.log('✅ All slot IDs:', slotIds);
          
          // Prepare booking data to send to frontend
          const bookingData = {
            service: {
              _id: selectedServiceItem.serviceId,
              name: selectedServiceItem.serviceName
            },
            serviceAddOn: {
              _id: selectedServiceItem.addOnId,
              name: selectedServiceItem.addOnName,
              price: selectedServiceItem.price,
              durationMinutes: selectedServiceItem.duration
            },
            dentist: {
              _id: selectedDentist._id,
              name: selectedDentist.fullName || selectedDentist.name,
              fullName: selectedDentist.fullName || selectedDentist.name
            },
            date: selectedDate,
            slotGroup: {
              slotIds: slotIds.length > 0 ? slotIds : [slotId], // ✅ Use full slotIds array from handleSlotSelection
              slots: slotIds.length > 0 ? slotIds : [slotId],   // Keep both for compatibility
              startTime: selectedSlotGroup.startTime,
              endTime: selectedSlotGroup.endTime
            }
          };
          
          console.log('📦 Final booking data:', JSON.stringify(bookingData, null, 2));
          
          const successMessage = `✅ **Đặt lịch thành công!**\n\n🔄 Đang chuyển đến trang thanh toán...\n\n💡 Vui lòng hoàn tất thanh toán để xác nhận lịch hẹn của bạn.`;
          
          // Clear booking context
          await chatSessionRepo.clearBookingContext(session.sessionId);
          await chatSessionRepo.addMessage(session.sessionId, 'assistant', successMessage);
          
          return res.json({
            success: true,
            response: successMessage,
            sessionId: session.sessionId,
            timestamp: new Date().toISOString(),
            bookingData: bookingData, // 🔥 Return booking data for frontend to handle
            redirectToPayment: true // Flag to indicate frontend should redirect
          });
        } else if (input.includes('không') || input.includes('no') || input.includes('hủy') || input.includes('cancel')) {
          // User cancelled
          const cancelMessage = '❌ Đã hủy đặt lịch.\n\nNếu bạn cần đặt lại, vui lòng nói "đặt lịch" hoặc liên hệ hotline! 📞';
          
          // Clear booking context
          await chatSessionRepo.clearBookingContext(session.sessionId);
          await chatSessionRepo.addMessage(session.sessionId, 'assistant', cancelMessage);
          
          return res.json({
            success: true,
            response: cancelMessage,
            sessionId: session.sessionId,
            timestamp: new Date().toISOString()
          });
        }
      }

      // Check if user message contains booking intent (before GPT processing)
      const bookingKeywords = [
        'đặt lịch', 'dat lich', 'book', 'hẹn khám', 'muốn khám',
        'dịch vụ được chỉ định', 'dịch vụ chỉ định', 'chỉ định nha sĩ',
        'có dịch vụ nào', 'dịch vụ gì'
      ];
      
      const hasBookingIntent = bookingKeywords.some(keyword => 
        message.toLowerCase().includes(keyword)
      );
      
      if (hasBookingIntent) {
        console.log('📅 Booking intent detected in user message!');
        
        try {
          // Automatically get user's available services
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
          
          // Format services list with FLAT structure (all service + addon combinations)
          let servicesMessage = '📋 **Danh sách dịch vụ có thể đặt lịch:**\n\n';
          
          const recommended = servicesResult.services.filter(s => s.isRecommended);
          const regular = servicesResult.services.filter(s => !s.isRecommended);
          
          // Flatten all services into a single numbered list
          let flatServiceList = [];
          let counter = 1;
          
          // Add recommended services (from treatmentIndications)
          // IMPORTANT: For recommended services, only show the SPECIFIC addon that was indicated
          recommended.forEach(service => {
            // Check if this service has a specific addon indicated
            if (service.recommendedAddOnId) {
              // Find the specific addon that was indicated
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
              // If no specific addon indicated, show all addons (fallback)
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
          
          // Add regular services with ALL their addons (not recommended, so show all options)
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
              // Service without addons
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
          
          // Format the list
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
          
          // Save to session
          await chatSessionRepo.addMessage(session.sessionId, 'assistant', servicesMessage);
          
          // Set booking context - user is now in booking flow
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
          console.error('❌ Booking services fetch error:', bookingError);
          
          // Fallback to normal GPT response
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
      
      // GPT Booking Action Handler - processes [BOOKING_*] tags from GPT response
      // When user inputs text like "số 4", "một", GPT returns tags like [BOOKING_GET_DENTISTS serviceId=4...]
      // This handler parses those tags and transitions user to the appropriate booking step
      if (result.usedBooking && result.bookingAction) {
        console.log('📅 Processing GPT booking action:', result.bookingAction);
        
        try {
          const bookingResult = await this.handleBookingAction(
            result.bookingAction,
            userId,
            authToken
          );
          
          // Replace booking tag with actual result
          let finalResponse = result.response.replace(
            result.bookingAction.fullMatch,
            bookingResult.message
          );
          
          // Save assistant response
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

  /**
   * POST /api/ai/booking/start
   * Start booking flow - Get user's available services
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
   * Get available dentists for selected service
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
   * Get available time slots
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
   * Confirm booking and create appointment reservation
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
   * Handle GPT booking actions - parse [BOOKING_*] tags and execute appropriate action
   * Supports: GET_SERVICES, GET_DENTISTS, GET_DATES, GET_SLOTS, CONFIRM
   * @param {Object} bookingAction - Parsed booking action from ai.service.extractBookingAction()
   * @param {String} userId - User ID
   * @param {String} authToken - Auth token for API calls
   * @returns {Object} - { message, data }
   */
  async handleBookingAction(bookingAction, userId, authToken) {
    const { action, params, fullMatch } = bookingAction;
    
    // Parse key=value params into object
    const parsedParams = {};
    params.forEach(param => {
      const [key, value] = param.split('=');
      if (key && value !== undefined) {
        parsedParams[key] = value;
      }
    });
    
    console.log(`🎯 Booking action: ${action}`, parsedParams);
    
    // Get current session for booking context
    const session = await chatSessionRepo.getOrCreateSession(userId);
    
    switch (action) {
      case 'GET_SERVICES':
      case 'CHECK_SERVICES': {
        // Fetch available services for user
        const servicesResult = await bookingService.getUserAvailableServices(userId, authToken);
        
        if (servicesResult.services.length === 0) {
          return {
            message: 'Hiện tại chưa có dịch vụ nào khả dụng. Vui lòng liên hệ hotline để được hỗ trợ! 📞',
            data: null
          };
        }
        
        // Format flat service list
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
        
        // Update booking context
        await chatSessionRepo.updateBookingContext(session.sessionId, {
          isInBookingFlow: true,
          step: 'SERVICE_SELECTION',
          flatServiceList: flatServiceList
        });
        
        return { message, data: { flatServiceList } };
      }
      
      case 'GET_DENTISTS': {
        const serviceId = parsedParams.serviceId;
        const serviceAddOnId = parsedParams.serviceAddOnId !== '0' ? parsedParams.serviceAddOnId : null;
        
        if (!serviceId) {
          return { message: 'Vui lòng chọn dịch vụ trước khi chọn nha sĩ.', data: null };
        }
        
        // Fetch dentists for service
        const dentists = await bookingService.getAvailableDentists(serviceId, serviceAddOnId);
        
        if (!dentists || dentists.length === 0) {
          return { message: 'Hiện tại không có nha sĩ nào khả dụng cho dịch vụ này.', data: null };
        }
        
        let message = '👨‍⚕️ **Danh sách nha sĩ khả dụng:**\n\n';
        dentists.forEach((dentist, index) => {
          message += `${index + 1}. ${dentist.fullName || dentist.name}\n`;
        });
        message += '\n💡 Chọn nha sĩ bằng số hoặc gõ tên';
        
        // Update booking context
        await chatSessionRepo.updateBookingContext(session.sessionId, {
          isInBookingFlow: true,
          step: 'DENTIST_SELECTION',
          selectedService: { serviceId, serviceAddOnId },
          availableDentists: dentists
        });
        
        return { message, data: { dentists } };
      }
      
      case 'GET_DATES': {
        const dentistId = parsedParams.dentistId;
        
        if (!dentistId) {
          return { message: 'Vui lòng chọn nha sĩ trước khi chọn ngày.', data: null };
        }
        
        // For now, return next 7 available days
        const today = new Date();
        const availableDates = [];
        for (let i = 1; i <= 7; i++) {
          const date = new Date(today);
          date.setDate(date.getDate() + i);
          availableDates.push(date.toISOString().split('T')[0]);
        }
        
        let message = '📅 **Ngày làm việc có lịch trống:**\n\n';
        availableDates.forEach((date, index) => {
          const d = new Date(date);
          const formatted = d.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit' });
          message += `${index + 1}. ${formatted}\n`;
        });
        message += '\n💡 Chọn ngày bằng số (1, 2, 3...)';
        
        // Update booking context
        await chatSessionRepo.updateBookingContext(session.sessionId, {
          step: 'DATE_SELECTION',
          selectedDentist: { _id: dentistId },
          availableDates: availableDates
        });
        
        return { message, data: { availableDates } };
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
        
        // Update booking context
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
   * Match service selection from flat list (by number or name)
   */
  async matchServiceFromFlatList(userInput, flatServiceList) {
    if (!flatServiceList || flatServiceList.length === 0) return null;
    
    const input = userInput.trim().toLowerCase();
    
    // Try match by number
    const numberMatch = input.match(/^(\d+)$/);
    if (numberMatch) {
      const number = parseInt(numberMatch[1]);
      const found = flatServiceList.find(item => item.number === number);
      if (found) return found;
    }
    
    // Try match by service name or addon name (fuzzy)
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
   * Handle dentist selection after service is chosen
   */
  async handleDentistSelection(req, res, session, selectedItem, userId, authToken) {
    try {
      console.log('�‍⚕️ Fetching dentists for service:', selectedItem.serviceName);
      
      // Update booking context
      await chatSessionRepo.updateBookingContext(session.sessionId, {
        isInBookingFlow: true,
        step: 'DENTIST_SELECTION',
        selectedServiceItem: selectedItem,
        selectedDentist: null,
        selectedDate: null,
        selectedSlot: null
      });
      
      // Call API to get dentists with nearest slot
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
   * Match dentist selection from user input
   */
  async matchDentistSelection(userInput, availableDentists) {
    if (!availableDentists || availableDentists.length === 0) return null;
    
    const input = userInput.trim().toLowerCase();
    
    // Handle "bất kỳ" or "any" -> return first dentist
    if (input.includes('bất kỳ') || input.includes('bat ky') || input === 'any') {
      return availableDentists[0];
    }
    
    // Try match by number
    const numberMatch = input.match(/^(\d+)$/);
    if (numberMatch) {
      const index = parseInt(numberMatch[1]) - 1;
      if (index >= 0 && index < availableDentists.length) {
        return availableDentists[index];
      }
    }
    
    // Try match by dentist name (fuzzy)
    for (const dentist of availableDentists) {
      const name = (dentist.fullName || dentist.name || '').toLowerCase();
      if (name.includes(input) || input.includes(name)) {
        return dentist;
      }
    }
    
    return null;
  }

  /**
   * Handle date selection after dentist is chosen
   */
  async handleDateSelection(req, res, session, selectedServiceItem, selectedDentist, userId, authToken) {
    try {
      console.log('📅 Fetching working dates for dentist:', selectedDentist.fullName);
      
      // Update booking context
      await chatSessionRepo.updateBookingContext(session.sessionId, {
        isInBookingFlow: true,
        step: 'DATE_SELECTION',
        selectedServiceItem: selectedServiceItem,
        selectedDentist: selectedDentist,
        selectedDate: null,
        selectedSlot: null
      });
      
      // Call API to get working dates
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
   * Match date selection from user input
   */
  async matchDateSelection(userInput, availableDates) {
    if (!availableDates || availableDates.length === 0) return null;
    
    const input = userInput.trim();
    
    // Try match by number
    const numberMatch = input.match(/^(\d+)$/);
    if (numberMatch) {
      const index = parseInt(numberMatch[1]) - 1;
      if (index >= 0 && index < availableDates.length) {
        return availableDates[index];
      }
    }
    
    // Try match by date format DD/MM/YYYY
    const dateMatch = input.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (dateMatch) {
      const [, day, month, year] = dateMatch;
      const inputDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      
      if (availableDates.includes(inputDate)) {
        return inputDate;
      }
    }
    
    return null;
  }

  /**
   * Handle slot selection after date is chosen
   */
  async handleSlotSelection(req, res, session, selectedServiceItem, selectedDentist, selectedDate, userId, authToken) {
    try {
      console.log('🕐 Fetching slots for date:', selectedDate);
      
      // Update booking context
      await chatSessionRepo.updateBookingContext(session.sessionId, {
        isInBookingFlow: true,
        step: 'SLOT_SELECTION',
        selectedServiceItem: selectedServiceItem,
        selectedDentist: selectedDentist,
        selectedDate: selectedDate,
        selectedSlot: null
      });
      
      // Call API to get slot details
      const SCHEDULE_SERVICE_URL = process.env.SCHEDULE_SERVICE_URL || 'http://localhost:3005';
      
      // IMPORTANT: Use addon duration if available (for recommended services)
      // For non-recommended services, use longest addon duration
      const serviceDuration = selectedServiceItem.duration || 30;
      
      console.log(`🕐 Fetching slots with duration: ${serviceDuration} minutes for ${selectedServiceItem.addOnName || selectedServiceItem.serviceName}`);
      
      const slotsResponse = await axios.get(
        `${SCHEDULE_SERVICE_URL}/api/slot/dentist/${selectedDentist._id}/details/future`,
        {
          params: {
            date: selectedDate,
            serviceId: selectedServiceItem.serviceId,
            serviceDuration: serviceDuration // ← Add duration parameter
          },
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : {}
        }
      );
      
      console.log('📦 Slots response:', slotsResponse.data);
      
      // Extract individual slots from response
      let individualSlots = [];
      if (slotsResponse.data.success && slotsResponse.data.data) {
        individualSlots = slotsResponse.data.data.slots || [];
      }
      
      // Group consecutive slots by serviceDuration
      const slotDuration = 15; // Each slot is 15 minutes
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
            
            // Check if slots are consecutive (max 1ms gap)
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
      
      console.log(`✅ Grouped ${individualSlots.length} slots into ${slotGroups.length} groups (${slotsNeeded} slots per group)`);
      
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
      
      // Format slot groups
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
      
      // Save slot groups to context
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
   * Match slot group selection from user input
   */
  async matchSlotGroupSelection(userInput, availableSlotGroups) {
    if (!availableSlotGroups || availableSlotGroups.length === 0) return null;
    
    const input = userInput.trim();
    
    // Try match by number
    const numberMatch = input.match(/^(\d+)$/);
    if (numberMatch) {
      const index = parseInt(numberMatch[1]) - 1;
      if (index >= 0 && index < availableSlotGroups.length) {
        return availableSlotGroups[index];
      }
    }
    
    return null;
  }

  /**
   * Handle final confirmation
   */
  async handleFinalConfirmation(req, res, session, bookingData, userId, authToken) {
    try {
      console.log('✅ Showing final confirmation');
      
      const { selectedServiceItem, selectedDentist, selectedDate, selectedSlotGroup } = bookingData;
      
      // Format confirmation message
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
      
      // Update context to CONFIRMATION step
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
