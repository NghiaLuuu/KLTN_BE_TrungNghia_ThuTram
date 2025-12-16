const DayClosure = require('../models/dayClosure.model');
const axios = require('axios');
const { sendRpcRequest } = require('../utils/rabbitmq.client');

// Hàm hỗ trợ: Lấy thông tin người dùng theo ID từ auth-service
async function getUserById(userId) {
  try {
    if (!userId) return null;
    console.log(`   📞 Calling auth_queue.getUserById(${userId})...`);
    const userData = await sendRpcRequest('auth_queue', {
      action: 'getUserById',
      payload: { userId: userId.toString() }
    }, 5000);
    
    console.log(`   📨 Response from auth_queue:`, JSON.stringify(userData).substring(0, 200));
    
    // Xử lý các định dạng response khác nhau
    if (userData && userData.success && userData.data) {
      return userData.data;
    }
    // Đôi khi RPC trả về data trực tiếp mà không có wrapper success
    if (userData && (userData.fullName || userData.email || userData.phone)) {
      return userData;
    }
    return null;
  } catch (error) {
    console.error(`❌ Không thể lấy user ${userId}:`, error.message);
    return null;
  }
}

// Hàm hỗ trợ: Lấy thông tin phòng theo ID từ room-service
async function getRoomById(roomId) {
  try {
    if (!roomId) return null;
    console.log(`   📞 Calling room_queue.getRoomById(${roomId})...`);
    const roomData = await sendRpcRequest('room_queue', {
      action: 'getRoomById',
      payload: { roomId: roomId.toString() }
    }, 5000);
    
    console.log(`   📨 Response from room_queue:`, JSON.stringify(roomData).substring(0, 200));
    
    // Xử lý các định dạng response khác nhau
    if (roomData && roomData.success && roomData.data) {
      return roomData.data;
    }
    // Đôi khi RPC trả về data trực tiếp mà không có wrapper success
    if (roomData && roomData.name) {
      return roomData;
    }
    return null;
  } catch (error) {
    console.error(`❌ Không thể lấy room ${roomId}:`, error.message);
    return null;
  }
}

/**
 * Lấy tất cả bản ghi đóng cửa theo ngày với bộ lọc tùy chọn
 * @param {Object} filters - Các bộ lọc truy vấn
 * @param {Date} filters.startDate - Lọc theo ngày bắt đầu
 * @param {Date} filters.endDate - Lọc theo ngày kết thúc
 * @param {String} filters.status - Lọc theo trạng thái (active, restored)
 * @param {String} filters.roomId - Lọc theo phòng
 * @param {Number} filters.page - Số trang (bắt đầu từ 1)
 * @param {Number} filters.limit - Số mục mỗi trang
 */
async function getDayClosures(filters = {}) {
  try {
    const {
      startDate,
      endDate,
      status,
      roomId,
      page = 1,
      limit = 20
    } = filters;

    const query = {};

    // 🆕 Filter out appointment cancellations (only show slot closures)
    query.isAppointmentCancellation = { $ne: true };

    // Lọc theo khoảng ngày
    // Xử lý cả định dạng YYYY-MM-DD và chuỗi ISO
    if (startDate || endDate) {
      query.dateFrom = {};
      if (startDate) {
        // Parse như YYYY-MM-DD và đặt đầu ngày theo UTC
        const start = new Date(startDate);
        start.setUTCHours(0, 0, 0, 0);
        query.dateFrom.$gte = start;
      }
      if (endDate) {
        // Parse như YYYY-MM-DD và đặt cuối ngày theo UTC
        const end = new Date(endDate);
        end.setUTCHours(23, 59, 59, 999);
        query.dateFrom.$lte = end;
      }
    }

    // Lọc theo trạng thái
    if (status) {
      query.status = status;
    }

    // Lọc theo phòng
    if (roomId) {
      query['affectedRooms.roomId'] = roomId;
    }

    const skip = (page - 1) * limit;

    const [records, total] = await Promise.all([
      DayClosure.find(query)
        .sort({ dateFrom: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      DayClosure.countDocuments(query)
    ]);

    // Định dạng các bản ghi để hiển thị
    const formattedRecords = records.map(record => {
      const dateValue = record.dateFrom || record.createdAt;
      const d = new Date(dateValue);
      // Sử dụng UTC methods để đảm bảo nhất quán
      const formattedDate = `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
      
      // Định dạng dateTo nếu có
      let formattedDateTo = null;
      if (record.dateTo) {
        const dTo = new Date(record.dateTo);
        formattedDateTo = `${String(dTo.getUTCDate()).padStart(2, '0')}/${String(dTo.getUTCMonth() + 1).padStart(2, '0')}/${dTo.getUTCFullYear()}`;
      }
      
      return {
        ...record,
        date: dateValue, // Để tương thích ngược
        dateFrom: dateValue,
        formattedDate,
        formattedDateFrom: formattedDate,
        formattedDateTo,
        totalPatients: record.cancelledAppointments?.length || 0,
        totalStaffAffected: (record.affectedStaffWithoutAppointments?.length || 0) + 
          (record.cancelledAppointments?.reduce((sum, appt) => {
            return sum + (appt.dentists?.length || 0) + (appt.nurses?.length || 0);
          }, 0) || 0)
      };
    });

    return {
      success: true,
      data: formattedRecords,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    };
  } catch (error) {
    console.error('Error getting day closures:', error);
    throw error;
  }
}

/**
 * Lấy một bản ghi đóng cửa theo ID với đầy đủ chi tiết
 * @param {String} id - ID bản ghi DayClosure
 */
async function getDayClosureById(id) {
  try {
    const record = await DayClosure.findById(id).lean();
    
    if (!record) {
      return {
        success: false,
        message: 'Không tìm thấy bản ghi'
      };
    }

    // Định dạng ngày - sử dụng dateFrom từ model mới
    const dateValue = record.dateFrom || record.createdAt;
    const d = new Date(dateValue);
    // Sử dụng UTC methods để đảm bảo nhất quán
    const formattedDate = `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
    
    // 🔧 SỬa: Làm giàu dữ liệu nếu không đầy đủ
    const ROOM_SERVICE_URL = process.env.ROOM_SERVICE_URL || 'http://localhost:3009';
    const APPOINTMENT_SERVICE_URL = process.env.APPOINTMENT_SERVICE_URL || 'http://localhost:3006';
    const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:3001';
    
    // Làm giàu closedBy.userName nếu là "System" hoặc thiếu
    let enrichedClosedBy = record.closedBy || {};
    if (enrichedClosedBy.userId && (!enrichedClosedBy.userName || enrichedClosedBy.userName === 'System')) {
      try {
        // Ghi chú: route auth-service là /api/user/:id (không có 's')
        const userResponse = await axios.get(
          `${AUTH_SERVICE_URL}/api/user/${enrichedClosedBy.userId}`,
          { timeout: 3000 }
        );
        
        // auth-service trả về: { success: true, user: { fullName, ... } }
        if (userResponse.data?.success && userResponse.data?.user?.fullName) {
          enrichedClosedBy = {
            ...enrichedClosedBy,
            userName: userResponse.data.user.fullName
          };
        }
      } catch (fetchError) {
        console.warn(`⚠️ Could not fetch user name for userId ${enrichedClosedBy.userId}:`, fetchError.message);
      }
    }
    
    // Làm giàu restoredBy.userName nếu tồn tại và là "System" hoặc thiếu
    let enrichedRestoredBy = record.restoredBy || null;
    if (enrichedRestoredBy?.userId && (!enrichedRestoredBy.userName || enrichedRestoredBy.userName === 'System')) {
      try {
        // Ghi chú: route auth-service là /api/user/:id (không có 's')
        const userResponse = await axios.get(
          `${AUTH_SERVICE_URL}/api/user/${enrichedRestoredBy.userId}`,
          { timeout: 3000 }
        );
        
        // auth-service trả về: { success: true, user: { fullName, ... } }
        if (userResponse.data?.success && userResponse.data?.user?.fullName) {
          enrichedRestoredBy = {
            ...enrichedRestoredBy,
            userName: userResponse.data.user.fullName
          };
        }
      } catch (fetchError) {
        console.warn(`⚠️ Could not fetch user name for restoredBy userId ${enrichedRestoredBy.userId}:`, fetchError.message);
      }
    }
    
    // Làm giàu affectedRooms
    const enrichedAffectedRooms = await Promise.all((record.affectedRooms || []).map(async (room) => {
      let roomName = room.roomName;
      
      if (roomName === 'Unknown Room' && room.roomId) {
        try {
          // Ghi chú: route room-service là /api/room/:roomId
          // Định dạng response: { room: { name, ... } }
          const roomResponse = await axios.get(
            `${ROOM_SERVICE_URL}/api/room/${room.roomId}`,
            { timeout: 3000 }
          );
          
          // room-service returns: { room: { name, ... } }
          if (roomResponse.data?.room?.name) {
            roomName = roomResponse.data.room.name;
          }
        } catch (fetchError) {
          console.warn(`⚠️ Could not fetch room name for roomId ${room.roomId}:`, fetchError.message);
        }
      }
      
      return {
        ...room,
        roomName
      };
    }));
    
    // Làm giàu cancelledAppointments
    const enrichedCancelledAppointments = await Promise.all((record.cancelledAppointments || []).map(async (p) => {
      let patientName = p.patientName;
      let patientEmail = p.patientEmail;
      let patientPhone = p.patientPhone;
      let roomName = p.roomName;
      
      // Nếu dữ liệu không đầy đủ, thử lấy thêm
      if (patientName === 'Unknown' || !patientName || roomName === 'Unknown Room') {
        try {
          // Lấy chi tiết cuộc hẹn cho thông tin bệnh nhân
          if ((patientName === 'Unknown' || !patientName) && p.appointmentId) {
            const aptResponse = await axios.get(
              `${APPOINTMENT_SERVICE_URL}/api/appointments/by-ids?ids=${p.appointmentId}`,
              { timeout: 3000 }
            );
            
            if (aptResponse.data?.success && aptResponse.data?.data?.length > 0) {
              const apt = aptResponse.data.data[0];
              if (apt.patientInfo) {
                patientName = apt.patientInfo.name || patientName;
                patientEmail = apt.patientInfo.email || patientEmail;
                patientPhone = apt.patientInfo.phone || patientPhone;
              }
            }
          }
          
          // Lấy tên phòng nếu chưa có
          // Ghi chú: room-service trả về { room: { name, ... } }
          if (roomName === 'Unknown Room' && p.roomId) {
            const roomResponse = await axios.get(
              `${ROOM_SERVICE_URL}/api/room/${p.roomId}`,
              { timeout: 3000 }
            );
            
            if (roomResponse.data?.room?.name) {
              roomName = roomResponse.data.room.name;
            }
          }
        } catch (fetchError) {
          console.warn(`⚠️ Could not enrich data for appointment ${p.appointmentId}:`, fetchError.message);
        }
      }
      
      return {
        ...p,
        patientName,
        patientEmail,
        patientPhone,
        roomName
      };
    }));
    
    return {
      success: true,
      data: {
        ...record,
        closedBy: enrichedClosedBy,
        restoredBy: enrichedRestoredBy,
        affectedRooms: enrichedAffectedRooms,
        cancelledAppointments: enrichedCancelledAppointments,
        date: dateValue, // Để tương thích ngược
        dateFrom: dateValue,
        formattedDate,
        formattedDateFrom: formattedDate
      }
    };
  } catch (error) {
    console.error('Error getting day closure by ID:', error);
    throw error;
  }
}

/**
 * Get statistics for a date range
 * @param {Date} startDate
 * @param {Date} endDate
 */
async function getDayClosureStats(startDate, endDate) {
  try {
    const query = {};
    
    if (startDate || endDate) {
      query.dateFrom = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setUTCHours(0, 0, 0, 0);
        query.dateFrom.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setUTCHours(23, 59, 59, 999);
        query.dateFrom.$lte = end;
      }
    }

    const records = await DayClosure.find(query).lean();

    const stats = {
      totalClosures: records.length,
      totalSlotsDisabled: records.reduce((sum, r) => sum + (r.stats?.totalSlotsDisabled || 0), 0),
      totalAppointmentsCancelled: records.reduce((sum, r) => sum + (r.stats?.appointmentsCancelledCount || 0), 0),
      totalRoomsAffected: records.reduce((sum, r) => sum + (r.stats?.affectedRoomsCount || 0), 0),
      totalEmailsSent: records.reduce((sum, r) => sum + (r.stats?.emailsSentCount || 0), 0),
      byStatus: {
        active: records.filter(r => r.status === 'active').length,
        partially_restored: records.filter(r => r.status === 'partially_restored').length,
        fully_restored: records.filter(r => r.status === 'fully_restored').length
      },
      byMonth: {}
    };

    // Nhóm theo tháng
    records.forEach(record => {
      const date = new Date(record.dateFrom || record.date);
      // Sử dụng UTC để nhất quán
      const monthKey = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
      if (!stats.byMonth[monthKey]) {
        stats.byMonth[monthKey] = 0;
      }
      stats.byMonth[monthKey]++;
    });

    return {
      success: true,
      data: stats
    };
  } catch (error) {
    console.error('Error getting day closure stats:', error);
    throw error;
  }
}

/**
 * Get cancelled patients for a specific closure
 * @param {String} closureId - DayClosure record ID
 */
async function getCancelledPatients(closureId) {
  try {
    const record = await DayClosure.findById(closureId).lean();
    
    if (!record) {
      return {
        success: false,
        message: 'Không tìm thấy bản ghi'
      };
    }

    const patients = record.cancelledAppointments || [];
    
    // 🔧 FIX: Re-fetch patient info if data is incomplete (from old closures)
    const enrichedPatients = await Promise.all(patients.map(async (p) => {
      let patientName = p.patientName;
      let patientEmail = p.patientEmail;
      let patientPhone = p.patientPhone;
      let roomName = p.roomName;
      
      // Nếu dữ liệu bệnh nhân không đầy đủ, thử lấy từ cuộc hẹn
      if (patientName === 'Unknown' || !patientName || roomName === 'Unknown Room') {
        try {
          const APPOINTMENT_SERVICE_URL = process.env.APPOINTMENT_SERVICE_URL || 'http://localhost:3006';
          const ROOM_SERVICE_URL = process.env.ROOM_SERVICE_URL || 'http://localhost:3009';
          
          // Lấy chi tiết cuộc hẹn
          if (p.appointmentId) {
            const aptResponse = await axios.get(
              `${APPOINTMENT_SERVICE_URL}/api/appointments/by-ids?ids=${p.appointmentId}`,
              { timeout: 3000 }
            );
            
            if (aptResponse.data?.success && aptResponse.data?.data?.length > 0) {
              const apt = aptResponse.data.data[0];
              if (apt.patientInfo) {
                patientName = apt.patientInfo.name || patientName;
                patientEmail = apt.patientInfo.email || patientEmail;
                patientPhone = apt.patientInfo.phone || patientPhone;
              }
            }
          }
          
          // Lấy tên phòng nếu thiếu
          // Ghi chú: room-service trả về { room: { name, ... } }
          if (roomName === 'Unknown Room' && p.roomId) {
            const roomResponse = await axios.get(
              `${ROOM_SERVICE_URL}/api/room/${p.roomId}`,
              { timeout: 3000 }
            );
            
            if (roomResponse.data?.room?.name) {
              roomName = roomResponse.data.room.name;
            }
          }
        } catch (fetchError) {
          console.warn(`⚠️ Could not enrich patient data for appointment ${p.appointmentId}:`, fetchError.message);
        }
      }
      
      return {
        appointmentId: p.appointmentId,
        patientName,
        patientEmail,
        patientPhone,
        appointmentTime: `${p.startTime} - ${p.endTime}`,
        shiftName: p.shiftName,
        roomName,
        dentists: p.dentists?.map(d => d.dentistName).join(', ') || 'N/A',
        nurses: p.nurses?.map(n => n.nurseName).join(', ') || 'N/A',
        paymentInfo: p.paymentInfo ? {
          paymentId: p.paymentInfo.paymentId,
          status: p.paymentInfo.status
        } : null,
        invoiceInfo: p.invoiceInfo ? {
          invoiceId: p.invoiceInfo.invoiceId,
          status: p.invoiceInfo.status
        } : null,
        emailSent: p.emailSent
      };
    }));

    return {
      success: true,
      data: {
        closureDate: record.dateFrom || record.date,
        reason: record.reason,
        patients: enrichedPatients
      }
    };
  } catch (error) {
    console.error('Error getting cancelled patients:', error);
    throw error;
  }
}

/**
 * Get all cancelled patients with filters (for patient list view)
 * @param {Object} filters
 * @param {Date} filters.startDate - Filter by appointment date (ngày hẹn)
 * @param {Date} filters.endDate - Filter by appointment date (ngày hẹn)
 * @param {String} filters.roomId
 * @param {String} filters.dentistId
 * @param {String} filters.patientName - Search by patient name
 * @param {Number} filters.page
 * @param {Number} filters.limit
 */
async function getAllCancelledPatients(filters = {}) {
  try {
    const {
      startDate,
      endDate,
      roomId,
      dentistId,
      patientName,
      page = 1,
      limit = 50
    } = filters;

    const query = {
      action: 'disable', // Chỉ lấy các thao tác vô hiệu hóa
      'cancelledAppointments.0': { $exists: true } // Phải có ít nhất 1 cuộc hẹn bị hủy
    };

    const skip = (page - 1) * limit;

    // KHÔNG filter theo ngày ở MongoDB vì:
    // - startDate/endDate là filter theo appointmentDate (ngày hẹn)
    // - dateFrom là ngày đóng cửa (cancelledAt)
    // - Nếu filter dateFrom sẽ miss data (ví dụ: hủy ngày 2/12 nhưng lịch hẹn là 29/12)
    // Giới hạn 1 năm gần nhất để tránh quá tải nếu KHÔNG có bất kỳ filter nào
    const hasAnyFilter = startDate || endDate || roomId || dentistId || patientName;
    
    if (!hasAnyFilter) {
      // Nếu không có filter nào, giới hạn 1 năm gần nhất
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
      oneYearAgo.setUTCHours(0, 0, 0, 0);
      query.dateFrom = { $gte: oneYearAgo };
    }
    // KHÔNG filter dateFrom khi có startDate/endDate vì chúng filter theo appointmentDate
    
    const records = await DayClosure.find(query)
      .sort({ dateFrom: -1, createdAt: -1 })
      .lean();

    // Làm phẳng tất cả các cuộc hẹn bị hủy từ tất cả bản ghi
    let allPatients = [];
    
    // Thu thập TẤT CẢ patientIds và roomIds duy nhất để lấy dữ liệu mới
    // Điều này đảm bảo chúng ta luôn có thông tin mới nhất ngay cả khi dữ liệu lưu trữ không đầy đủ
    const allPatientIds = new Set();
    const allRoomIds = new Set();
    
    records.forEach(record => {
      (record.cancelledAppointments || []).forEach(p => {
        // Thu thập tất cả patientIds (không chỉ các Unknown)
        if (p.patientId) {
          allPatientIds.add(p.patientId.toString());
        }
        // Thu thập tất cả roomIds (không chỉ các Unknown)
        if (p.roomId) {
          allRoomIds.add(p.roomId.toString());
        }
      });
    });
    
    // Lấy hàng loạt tất cả bệnh nhân và phòng qua RPC
    const patientCache = new Map();
    const roomCache = new Map();
    
    // Lấy TẤT CẢ bệnh nhân song song
    if (allPatientIds.size > 0) {
      console.log(`🔍 Fetching ${allPatientIds.size} patients from auth-service...`);
      const patientPromises = Array.from(allPatientIds).map(async (patientId) => {
        const userData = await getUserById(patientId);
        if (userData) {
          patientCache.set(patientId, userData);
        }
      });
      await Promise.all(patientPromises);
      console.log(`✅ Fetched ${patientCache.size}/${allPatientIds.size} patients from auth-service`);
    }
    
    // Lấy TẤT CẢ phòng song song
    if (allRoomIds.size > 0) {
      console.log(`🔍 Fetching ${allRoomIds.size} rooms from room-service...`);
      const roomPromises = Array.from(allRoomIds).map(async (roomId) => {
        const roomData = await getRoomById(roomId);
        if (roomData) {
          roomCache.set(roomId, roomData);
        }
      });
      await Promise.all(roomPromises);
      console.log(`✅ Fetched ${roomCache.size}/${allRoomIds.size} rooms from room-service`);
    }
    
    records.forEach(record => {
      const patients = (record.cancelledAppointments || []).map(p => {
        // Debug: Check if paymentInfo/invoiceInfo exists in raw data
        if (p.paymentInfo || p.invoiceInfo) {
          console.log('🔍 Found payment/invoice in cancelled appointment:', {
            appointmentId: p.appointmentId,
            hasPaymentInfo: !!p.paymentInfo,
            paymentId: p.paymentInfo?.paymentId,
            hasInvoiceInfo: !!p.invoiceInfo,
            invoiceId: p.invoiceInfo?.invoiceId
          });
        }
        
        // Sử dụng cancelledAt thực tế từ appointment nếu có, fallback sang dateFrom của record
        const actualCancelledAt = p.cancelledAt || record.dateFrom || record.createdAt;
        const cancelledDate = new Date(actualCancelledAt);
        
        // Tính thời gian Việt Nam (UTC+7) cho appointmentDate
        const appointmentDateUTC = p.appointmentDate ? new Date(p.appointmentDate) : null;
        const appointmentDateVN = appointmentDateUTC ? new Date(appointmentDateUTC.getTime() + 7 * 60 * 60 * 1000) : null;
        
        // Luôn cố gắng lấy thông tin bệnh nhân từ cache trước (dữ liệu mới từ auth-service)
        // Fallback sang dữ liệu đã lưu nếu cache miss
        let patientName = p.patientName;
        let patientEmail = p.patientEmail;
        let patientPhone = p.patientPhone;
        
        if (p.patientId) {
          const cachedPatient = patientCache.get(p.patientId.toString());
          if (cachedPatient) {
            // Sử dụng dữ liệu mới từ auth-service
            patientName = cachedPatient.fullName || cachedPatient.name || patientName || 'Unknown';
            patientEmail = cachedPatient.email || patientEmail || '';
            patientPhone = cachedPatient.phone || cachedPatient.phoneNumber || patientPhone || '';
          }
        }
        
        // Luôn cố gắng lấy thông tin phòng từ cache trước (dữ liệu mới từ room-service)
        // Fallback sang dữ liệu đã lưu nếu cache miss
        let roomName = p.roomName;
        if (p.roomId) {
          const cachedRoom = roomCache.get(p.roomId.toString());
          if (cachedRoom) {
            // Sử dụng dữ liệu mới từ room-service
            roomName = cachedRoom.name || cachedRoom.roomName || roomName || 'Unknown Room';
          }
        }
        
        return {
          // Thông tin bệnh nhân
          appointmentId: p.appointmentId,
          patientId: p.patientId,
          patientName: patientName || 'Unknown',
          patientEmail: patientEmail || '',
          patientPhone: patientPhone || '',
          
          // Thông tin cuộc hẹn
          appointmentDate: p.appointmentDate,
          appointmentDateVN: appointmentDateVN, // Múi giờ Việt Nam (UTC+7)
          appointmentTime: `${p.startTime} - ${p.endTime}`,
          startTime: p.startTime,
          endTime: p.endTime,
          shiftName: p.shiftName,
          
          // Room & Staff
          roomId: p.roomId,
          roomName: roomName || 'Unknown Room',
          dentists: p.dentists?.map(d => d.dentistName).join(', ') || 'N/A',
          dentistIds: p.dentists?.map(d => d.dentistId) || [],
          nurses: p.nurses?.map(n => n.nurseName).join(', ') || 'N/A',
          
          // Financial
          paymentId: p.paymentInfo?.paymentId || null,
          paymentStatus: p.paymentInfo?.status || 'N/A',
          invoiceId: p.invoiceInfo?.invoiceId || null,
          invoiceStatus: p.invoiceInfo?.status || 'N/A',
          
          // Thông tin hủy - sử dụng cancelledAt thực tế của cuộc hẹn
          cancelledAt: actualCancelledAt,
          cancelledDate: cancelledDate,
          cancelledReason: record.reason,
          cancelledBy: (record.closedBy?.userName && record.closedBy.userName !== 'System') 
            ? record.closedBy.userName 
            : 'Admin',
          operationType: record.operationType,
          emailSent: p.emailSent,
          
          // Để nhóm/hiển thị
          closureId: record._id,
          formattedCancelledDate: cancelledDate.toLocaleDateString('vi-VN'),
          formattedCancelledTime: cancelledDate.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
          formattedCancelledDateTime: `${cancelledDate.toLocaleDateString('vi-VN')} ${cancelledDate.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`
        };
      });
      
      allPatients = allPatients.concat(patients);
    });

    // Lọc theo khoảng ngày cuộc hẹn (lọc phía client cho khớp chính xác ngày)
    // Sử dụng appointmentDate (UTC) để lọc, sau đó chuyển sang ngày Việt Nam để so sánh
    if (startDate || endDate) {
      console.log(`🔍 Filtering by date range: ${startDate} to ${endDate}`);
      console.log(`📊 Total patients before filter: ${allPatients.length}`);
      
      allPatients = allPatients.filter(p => {
        if (!p.appointmentDate) return false;
        
        // Đảm bảo appointmentDate là đối tượng Date (có thể là string hoặc Date từ MongoDB)
        const apptDateUTC = p.appointmentDate instanceof Date 
          ? p.appointmentDate 
          : new Date(p.appointmentDate);
        
        // Lấy timestamp UTC và thêm 7 giờ cho múi giờ Việt Nam
        const vnTimestamp = apptDateUTC.getTime() + 7 * 60 * 60 * 1000;
        const apptDateVN = new Date(vnTimestamp);
        
        // Trích xuất ngày Việt Nam theo định dạng YYYY-MM-DD sử dụng UTC methods
        // (apptDateVN thực ra là ngày UTC biểu diễn thời gian VN)
        const year = apptDateVN.getUTCFullYear();
        const month = String(apptDateVN.getUTCMonth() + 1).padStart(2, '0');
        const day = String(apptDateVN.getUTCDate()).padStart(2, '0');
        const apptDateStr = `${year}-${month}-${day}`; // YYYY-MM-DD theo múi giờ VN
        
        let match = false;
        if (startDate && endDate) {
          match = apptDateStr >= startDate && apptDateStr <= endDate;
        } else if (startDate) {
          match = apptDateStr >= startDate;
        } else if (endDate) {
          match = apptDateStr <= endDate;
        } else {
          match = true;
        }
        
        // Debug log cho 3 bệnh nhân đầu tiên
        if (allPatients.indexOf(p) < 3) {
          console.log(`  Patient ${p.patientName}: appointmentDate(UTC)=${apptDateUTC.toISOString()} → VN=${apptDateStr}, match=${match}`);
        }
        
        return match;
      });
      
      console.log(`✅ Total patients after filter: ${allPatients.length}`);
    }

    // Lọc theo phòng (lọc phía client để khớp chính xác)
    if (roomId) {
      allPatients = allPatients.filter(p => 
        p.roomId && p.roomId.toString() === roomId.toString()
      );
    }

    // Lọc theo nha sĩ (lọc phía client để khớp chính xác)
    if (dentistId) {
      allPatients = allPatients.filter(p => 
        p.dentistIds && p.dentistIds.some(id => id.toString() === dentistId.toString())
      );
    }

    // Lọc phía client theo tên bệnh nhân (nếu có)
    if (patientName && patientName.trim()) {
      const searchTerm = patientName.toLowerCase().trim();
      allPatients = allPatients.filter(p => 
        p.patientName?.toLowerCase().includes(searchTerm) ||
        p.patientEmail?.toLowerCase().includes(searchTerm) ||
        p.patientPhone?.includes(searchTerm)
      );
    }

    // Phân trang
    const total = allPatients.length;
    const paginatedPatients = allPatients.slice(skip, skip + limit);

    return {
      success: true,
      data: paginatedPatients,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    };
  } catch (error) {
    console.error('Error getting all cancelled patients:', error);
    throw error;
  }
}

module.exports = {
  getDayClosures,
  getDayClosureById,
  getDayClosureStats,
  getCancelledPatients,
  getAllCancelledPatients
};
