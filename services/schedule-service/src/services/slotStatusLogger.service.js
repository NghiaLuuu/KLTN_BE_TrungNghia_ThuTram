/**
 * Dịch vụ Ghi log Trạng thái Slot
 * Ghi log tập trung cho TẤT CẢ các thao tác bật/tắt slot
 */

const SlotStatusChange = require('../models/dayClosure.model');
const Slot = require('../models/slot.model');
const axios = require('axios');

const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:3001';
const APPOINTMENT_SERVICE_URL = process.env.APPOINTMENT_SERVICE_URL || 'http://localhost:3006';
const ROOM_SERVICE_URL = process.env.ROOM_SERVICE_URL || 'http://localhost:3009';

/**
 * Ghi log thay đổi trạng thái slot
 * @param {Object} params
 * @param {String} params.operationType - Loại thao tác
 * @param {String} params.action - 'enable' hoặc 'disable'
 * @param {Object} params.criteria - Tiêu chí dùng cho thao tác
 * @param {String} params.reason - Lý do thay đổi
 * @param {Object} params.currentUser - Người thực hiện thao tác
 * @param {Array} params.affectedSlotIds - Mảng ID các slot bị ảnh hưởng
 * @param {Array} params.affectedSlots - Tùy chọn: Các slots đã lấy trước (hữu ích khi slots đã được tải)
 * @param {Object} params.stats - Thống kê thao tác
 */
async function logSlotStatusChange({
  operationType,
  action,
  criteria = {},
  reason,
  currentUser,
  affectedSlotIds = [],
  affectedSlots = null, // 🆕 Cho phép truyền slots đã lấy trước
  stats = {}
}) {
  try {
    console.log(`📝 Ghi log thay đổi trạng thái slot: ${operationType}, action: ${action}, slots: ${affectedSlotIds.length}`);

    // Lấy các slots bị ảnh hưởng - dùng slots đã cung cấp hoặc lấy từ DB
    const slots = affectedSlots || await Slot.find({ _id: { $in: affectedSlotIds } })
      .select('roomId subRoomId dentist nurse startTime endTime shiftName appointmentId date')
      .lean();

    if (slots.length === 0) {
      console.warn('⚠️ Không tìm thấy slots để ghi log');
      return null;
    }

    // Tính khoảng ngày
    const dates = slots.map(s => new Date(s.startTime || s.date));
    const dateFrom = new Date(Math.min(...dates));
    const dateTo = new Date(Math.max(...dates));

    // Lấy dữ liệu bên ngoài
    const [usersCache, roomsCache, appointments] = await Promise.all([
      fetchUsers(),
      fetchRooms(),
      fetchAppointmentsBySlots(slots)
    ]);

    // Lấy các room ID duy nhất
    const roomIds = [...new Set(slots.map(s => s.roomId?.toString()).filter(Boolean))];

    // Xây dựng dữ liệu các phòng bị ảnh hưởng với chi tiết slot
    const affectedRooms = roomIds.map(roomId => {
      const room = roomsCache.get(roomId);
      const roomSlots = slots.filter(s => s.roomId?.toString() === roomId);
      
      // Xây dựng thông tin slot chi tiết
      const slotDetails = roomSlots.map(slot => {
        const dentistIds = Array.isArray(slot.dentist) ? slot.dentist : (slot.dentist ? [slot.dentist] : []);
        const dentistNames = dentistIds.map(dentistId => {
          const dentist = usersCache.find(u => u._id.toString() === dentistId.toString());
          return dentist?.fullName || dentist?.name || 'Unknown';
        }).filter(name => name !== 'Unknown');

        const nurseIds = Array.isArray(slot.nurse) ? slot.nurse : (slot.nurse ? [slot.nurse] : []);
        const nurseNames = nurseIds.map(nurseId => {
          const nurse = usersCache.find(u => u._id.toString() === nurseId.toString());
          return nurse?.fullName || nurse?.name || 'Unknown';
        }).filter(name => name !== 'Unknown');

        const startDate = new Date(slot.startTime || slot.date);
        const endDate = new Date(slot.endTime || slot.date);
        const vnDate = new Date(startDate.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
        const startTimeStr = `${String(vnDate.getHours()).padStart(2, '0')}:${String(vnDate.getMinutes()).padStart(2, '0')}`;
        const vnEndDate = new Date(endDate.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
        const endTimeStr = `${String(vnEndDate.getHours()).padStart(2, '0')}:${String(vnEndDate.getMinutes()).padStart(2, '0')}`;

        return {
          slotId: slot._id,
          appointmentId: slot.appointmentId || null, // 🆕 Thêm appointmentId để FE gom nhóm
          date: slot.date || startDate,
          startTime: startTimeStr,
          endTime: endTimeStr,
          shiftName: slot.shiftName || 'Unknown',
          dentistNames,
          nurseNames,
          hasAppointment: !!slot.appointmentId
        };
      });

      return {
        roomId: roomId,
        roomName: room?.name || 'Unknown Room',
        slotsDisabled: roomSlots.length,
        slots: slotDetails
      };
    });

    // Xây dựng dữ liệu cuộc hẹn bị hủy (chỉ cho slots có cuộc hẹn)
    const slotsWithAppointments = slots.filter(s => s.appointmentId);
    const cancelledAppointments = [];

    console.log(`📋 Logger: Total slots = ${slots.length}, slots with appointments = ${slotsWithAppointments.length}`);
    console.log(`📋 Logger: Fetched ${appointments.length} appointments from appointment-service`);

    for (const slot of slotsWithAppointments) {
      const appointment = appointments.find(a => a._id.toString() === slot.appointmentId.toString());
      if (!appointment) {
        console.warn(`⚠️ Logger: Slot ${slot._id} has appointmentId ${slot.appointmentId} but appointment not found!`);
        
        // Vẫn ghi log với thông tin cơ bản từ slot (cuộc hẹn có thể vừa bị hủy)
        const room = roomsCache.get(slot.roomId?.toString());
        
        const dentistIds = Array.isArray(slot.dentist) ? slot.dentist : (slot.dentist ? [slot.dentist] : []);
        const dentistsData = dentistIds.map(dentistId => {
          const dentist = usersCache.find(u => u._id.toString() === dentistId.toString());
          return {
            dentistId: dentistId,
            dentistName: dentist?.fullName || dentist?.name || 'Unknown',
            dentistEmail: dentist?.email || ''
          };
        }).filter(d => d.dentistName !== 'Unknown');
        
        const nurseIds = Array.isArray(slot.nurse) ? slot.nurse : (slot.nurse ? [slot.nurse] : []);
        const nursesData = nurseIds.map(nurseId => {
          const nurse = usersCache.find(u => u._id.toString() === nurseId);
          return {
            nurseId: nurseId,
            nurseName: nurse?.fullName || nurse?.name || 'Unknown',
            nurseEmail: nurse?.email || ''
          };
        }).filter(n => n.nurseName !== 'Unknown');
        
        const startDate = new Date(slot.startTime || slot.date);
        const endDate = new Date(slot.endTime || slot.date);
        const vnDate = new Date(startDate.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
        const startTimeStr = `${String(vnDate.getHours()).padStart(2, '0')}:${String(vnDate.getMinutes()).padStart(2, '0')}`;
        const vnEndDate = new Date(endDate.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
        const endTimeStr = `${String(vnEndDate.getHours()).padStart(2, '0')}:${String(vnEndDate.getMinutes()).padStart(2, '0')}`;
        
        cancelledAppointments.push({
          appointmentId: slot.appointmentId,
          appointmentDate: startDate,
          cancelledAt: new Date(),
          shiftName: slot.shiftName || 'Unknown',
          startTime: startTimeStr,
          endTime: endTimeStr,
          
          patientId: null,
          patientName: 'Unknown Patient (Appointment not found)',
          patientEmail: '',
          patientPhone: '',
          
          roomId: slot.roomId,
          roomName: room?.name || 'Unknown Room',
          
          dentists: dentistsData,
          nurses: nursesData,
          
          paymentInfo: undefined,
          invoiceInfo: undefined,
          
          emailSent: false,
          emailSentAt: undefined
        });
        
        continue;
      }

      const patient = usersCache.find(u => u._id.toString() === appointment.patientId?.toString());
      const room = roomsCache.get(slot.roomId?.toString());

      // Lấy thông tin nha sĩ
      const dentistIds = Array.isArray(slot.dentist) ? slot.dentist : (slot.dentist ? [slot.dentist] : []);
      const dentistsData = dentistIds.map(dentistId => {
        const dentist = usersCache.find(u => u._id.toString() === dentistId.toString());
        const dentistName = dentist?.fullName || dentist?.name || 'Unknown Dentist';
        const dentistEmail = dentist?.email || '';
        console.log(`👨‍⚕️ Logger: Dentist ${dentistId} - ${dentistName} (${dentistEmail})`);
        return {
          dentistId: dentistId,
          dentistName,
          dentistEmail
        };
      });

      // Lấy thông tin y tá
      const nurseIds = Array.isArray(slot.nurse) ? slot.nurse : (slot.nurse ? [slot.nurse] : []);
      const nursesData = nurseIds.map(nurseId => {
        const nurse = usersCache.find(u => u._id.toString() === nurseId.toString());
        const nurseName = nurse?.fullName || nurse?.name || 'Unknown Nurse';
        const nurseEmail = nurse?.email || '';
        console.log(`👩‍⚕️ Logger: Nurse ${nurseId} - ${nurseName} (${nurseEmail})`);
        return {
          nurseId: nurseId,
          nurseName,
          nurseEmail
        };
      });

      // Định dạng thời gian
      const startDate = new Date(slot.startTime || slot.date);
      const endDate = new Date(slot.endTime || slot.date);
      
      const vnDate = new Date(startDate.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
      const startTimeStr = `${String(vnDate.getHours()).padStart(2, '0')}:${String(vnDate.getMinutes()).padStart(2, '0')}`;
      
      const vnEndDate = new Date(endDate.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
      const endTimeStr = `${String(vnEndDate.getHours()).padStart(2, '0')}:${String(vnEndDate.getMinutes()).padStart(2, '0')}`;

      // Lấy thông tin bệnh nhân - hỗ trợ cả người dùng đã đăng ký và khách vãng lai
      // ⚠️ QUAN TRỌNG: usersCache KHÔNG bao gồm bệnh nhân (chỉ nhân viên), nên phải dùng patientInfo trước!
      let patientName = 'Unknown';
      let patientEmail = '';
      let patientPhone = '';
      
      // Ưu tiên 1: Dùng patientInfo từ cuộc hẹn (dữ liệu nhúng - đáng tin cậy nhất)
      if (appointment.patientInfo && appointment.patientInfo.name) {
        patientName = appointment.patientInfo.name || 'Unknown';
        patientEmail = appointment.patientInfo.email || '';
        patientPhone = appointment.patientInfo.phone || '';
        console.log(`📋 Logger: Dùng patientInfo từ cuộc hẹn: ${patientName}`);
      } 
      // Ưu tiên 2: Thử tìm trong usersCache (cho nhân viên cũng đặt lịch hẹn)
      else if (appointment.patientId && patient) {
        patientName = patient.fullName || patient.name || 'Unknown';
        patientEmail = patient.email || '';
        patientPhone = patient.phone || patient.phoneNumber || '';
        console.log(`📋 Logger: Dùng usersCache cho bệnh nhân: ${patientName}`);
      }
      // Ưu tiên 3: Nếu có patientId nhưng không có trong cache (trường hợp bình thường cho bệnh nhân)
      else if (appointment.patientId) {
        // Thử lấy thông tin bệnh nhân trực tiếp từ auth-service
        try {
          const patientResponse = await axios.get(
            `${AUTH_SERVICE_URL}/api/user/${appointment.patientId}`,
            { timeout: 3000 }
          );
          if (patientResponse.data?.success && patientResponse.data?.data) {
            const patientData = patientResponse.data.data;
            patientName = patientData.fullName || patientData.name || 'Unknown';
            patientEmail = patientData.email || '';
            patientPhone = patientData.phone || patientData.phoneNumber || '';
            console.log(`📋 Logger: Lấy bệnh nhân từ auth-service: ${patientName}`);
          }
        } catch (fetchError) {
          console.warn(`⚠️ Logger: Không thể lấy bệnh nhân ${appointment.patientId}:`, fetchError.message);
        }
      }
      
      console.log(`📋 Logger: Appointment ${appointment._id} - Patient: ${patientName} (${patientEmail})`);
      
      cancelledAppointments.push({
        appointmentId: appointment._id,
        appointmentDate: startDate,
        cancelledAt: appointment.cancelledAt || new Date(),
        shiftName: slot.shiftName || 'Unknown',
        startTime: startTimeStr,
        endTime: endTimeStr,
        
        patientId: appointment.patientId,
        patientName,
        patientEmail,
        patientPhone,
        
        roomId: slot.roomId,
        roomName: (() => {
          const roomName = room?.name || 'Unknown Room';
          console.log(`🏥 Logger: Slot ${slot._id} - RoomId: ${slot.roomId} -> Room: ${roomName}`);
          return roomName;
        })(),
        
        dentists: dentistsData,
        nurses: nursesData,
        
        paymentInfo: appointment.paymentId ? {
          paymentId: appointment.paymentId,
          status: 'has_payment'
        } : undefined,
        
        invoiceInfo: appointment.invoiceId ? {
          invoiceId: appointment.invoiceId,
          status: 'has_invoice'
        } : undefined,
        
        emailSent: false,
        emailSentAt: undefined
      });
      
      // Debug: Log thông tin thanh toán/hóa đơn
      console.log('💰 Thanh toán/Hóa đơn cho cuộc hẹn:', {
        appointmentId: appointment._id,
        paymentId: appointment.paymentId?.toString() || 'null',
        invoiceId: appointment.invoiceId?.toString() || 'null',
        hasPaymentInfo: !!appointment.paymentId,
        hasInvoiceInfo: !!appointment.invoiceId
      });
    }

    // Xây dựng nhân viên bị ảnh hưởng không có cuộc hẹn
    const slotsWithoutAppointments = slots.filter(s => !s.appointmentId);
    const affectedStaffData = [];
    const staffSet = new Set();

    for (const slot of slotsWithoutAppointments) {
      // Thêm nha sĩ
      const dentistIds = Array.isArray(slot.dentist) ? slot.dentist : (slot.dentist ? [slot.dentist] : []);
      for (const dentistId of dentistIds) {
        const key = dentistId.toString();
        if (!staffSet.has(key)) {
          const dentist = usersCache.find(u => u._id.toString() === key);
          if (dentist) {
            affectedStaffData.push({
              userId: dentistId,
              name: dentist.fullName || dentist.name || 'Unknown',
              email: dentist.email || '',
              role: 'dentist',
              emailSent: false
            });
            staffSet.add(key);
          }
        }
      }

      // Thêm y tá
      const nurseIds = Array.isArray(slot.nurse) ? slot.nurse : (slot.nurse ? [slot.nurse] : []);
      for (const nurseId of nurseIds) {
        const key = nurseId.toString();
        if (!staffSet.has(key)) {
          const nurse = usersCache.find(u => u._id.toString() === key);
          if (nurse) {
            affectedStaffData.push({
              userId: nurseId,
              name: nurse.fullName || nurse.name || 'Unknown',
              email: nurse.email || '',
              role: 'nurse',
              emailSent: false
            });
            staffSet.add(key);
          }
        }
      }
    }

    // Tạo bản ghi log
    const logRecord = new SlotStatusChange({
      operationType,
      action,
      dateFrom,
      dateTo,
      criteria,
      reason: reason || undefined,
      closureType: operationType.includes('all_day') ? 'emergency' : 'other',
      stats: {
        totalSlotsDisabled: action === 'disable' ? affectedSlotIds.length : 0,
        affectedRoomsCount: roomIds.length,
        appointmentsCancelledCount: cancelledAppointments.length,
        emailsSentCount: stats.emailsSentCount || 0
      },
      affectedRooms,
      cancelledAppointments,
      affectedStaffWithoutAppointments: affectedStaffData,
      closedBy: {
        userId: currentUser?.userId || null,
        userName: currentUser?.name || currentUser?.fullName || 'System',
        userRole: currentUser?.role || currentUser?.activeRole || 'admin'
      },
      status: action === 'disable' ? 'active' : 'fully_restored'
    });

    await logRecord.save();
    console.log(`✅ Saved slot status change log: ${logRecord._id}`);

    return logRecord;

  } catch (error) {
    console.error('❌ Lỗi khi ghi log thay đổi trạng thái slot:', error);
    console.error(error.stack);
    // Không throw - lỗi ghi log không nên làm hỏng thao tác chính
    return null;
  }
}

// Hỗ trợ: Lấy cache users
async function fetchUsers() {
  try {
    const response = await axios.get(`${AUTH_SERVICE_URL}/api/user/cache/all`, { timeout: 5000 });
    if (response.data?.success) {
      return response.data.data || [];
    }
  } catch (error) {
    console.warn('⚠️ Could not fetch users cache:', error.message);
  }
  return [];
}

// Helper: Fetch rooms cache
async function fetchRooms() {
  const roomsMap = new Map();
  try {
    // Lấy tất cả phòng không giới hạn phân trang
    const url = `${ROOM_SERVICE_URL}/api/room?limit=1000`;
    console.log(`🏥 Fetching rooms from: ${url}`);
    const response = await axios.get(url, { timeout: 5000 });
    
    // Room service trả về: { total, page, limit, totalPages, rooms }
    const rooms = response.data?.rooms || [];
    console.log(`🏥 Fetched ${rooms.length} rooms (total: ${response.data?.total || 0})`);
    
    rooms.forEach(room => {
      roomsMap.set(room._id.toString(), room);
      console.log(`🏥 Room cached: ${room._id} -> ${room.name}`);
    });
  } catch (error) {
    console.warn('⚠️ Could not fetch rooms:', error.message);
    if (error.response) {
      console.warn('⚠️ Response status:', error.response.status);
      console.warn('⚠️ Response data:', error.response.data);
    }
  }
  console.log(`🏥 Total rooms in cache: ${roomsMap.size}`);
  return roomsMap;
}

// Helper: Fetch appointments by slots
async function fetchAppointmentsBySlots(slots) {
  const appointmentIds = slots
    .filter(s => s.appointmentId)
    .map(s => s.appointmentId.toString());

  if (appointmentIds.length === 0) return [];

  try {
    const url = `${APPOINTMENT_SERVICE_URL}/api/appointments/by-ids?ids=${appointmentIds.join(',')}`;
    console.log(`📞 Fetching appointments from: ${url}`);
    console.log(`📞 APPOINTMENT_SERVICE_URL: ${APPOINTMENT_SERVICE_URL}`);
    console.log(`📞 Appointment IDs to fetch: ${appointmentIds.join(', ')}`);
    
    const response = await axios.get(url, { timeout: 5000 });
    
    console.log(`✅ Fetch response status: ${response.status}`);
    console.log(`✅ Fetch response data:`, response.data);
    
    if (response.data?.success) {
      return response.data.data || [];
    }
  } catch (error) {
    console.warn('⚠️ Could not fetch appointments:', error.message);
  }
  return [];
}

module.exports = {
  logSlotStatusChange
};
