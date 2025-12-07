const DayClosure = require('../models/dayClosure.model');

/**
 * Get all day closure records with optional filters
 * @param {Object} filters - Query filters
 * @param {Date} filters.startDate - Start date filter
 * @param {Date} filters.endDate - End date filter
 * @param {String} filters.status - Status filter (active, restored)
 * @param {String} filters.roomId - Filter by room
 * @param {Number} filters.page - Page number (1-based)
 * @param {Number} filters.limit - Items per page
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

    // Date range filter
    // Handle both YYYY-MM-DD and ISO string formats
    if (startDate || endDate) {
      query.dateFrom = {};
      if (startDate) {
        // Parse as YYYY-MM-DD and set to start of day in UTC
        const start = new Date(startDate);
        start.setUTCHours(0, 0, 0, 0);
        query.dateFrom.$gte = start;
      }
      if (endDate) {
        // Parse as YYYY-MM-DD and set to end of day in UTC
        const end = new Date(endDate);
        end.setUTCHours(23, 59, 59, 999);
        query.dateFrom.$lte = end;
      }
    }

    // Status filter
    if (status) {
      query.status = status;
    }

    // Room filter
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

    // Format records for display
    const formattedRecords = records.map(record => {
      const dateValue = record.dateFrom || record.createdAt;
      const d = new Date(dateValue);
      // Sử dụng UTC methods để đảm bảo nhất quán
      const formattedDate = `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
      
      return {
        ...record,
        date: dateValue, // For backward compatibility
        dateFrom: dateValue,
        formattedDate,
        formattedDateFrom: formattedDate,
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
 * Get a single day closure record by ID with full details
 * @param {String} id - DayClosure record ID
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

    // Format date - use dateFrom from new model
    const dateValue = record.dateFrom || record.createdAt;
    const d = new Date(dateValue);
    // Sử dụng UTC methods để đảm bảo nhất quán
    const formattedDate = `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
    
    return {
      success: true,
      data: {
        ...record,
        date: dateValue, // For backward compatibility
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

    // Group by month
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

    return {
      success: true,
      data: {
        closureDate: record.dateFrom || record.date,
        reason: record.reason,
        patients: patients.map(p => ({
          appointmentId: p.appointmentId,
          patientName: p.patientName,
          patientEmail: p.patientEmail,
          patientPhone: p.patientPhone,
          appointmentTime: `${p.startTime} - ${p.endTime}`,
          shiftName: p.shiftName,
          roomName: p.roomName,
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
        }))
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
      action: 'disable', // Only get disable operations
      'cancelledAppointments.0': { $exists: true } // Must have at least 1 cancelled appointment
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

    // Flatten all cancelled appointments from all records
    let allPatients = [];
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
        
        // Use actual cancelledAt from appointment if available, fallback to record's dateFrom
        const actualCancelledAt = p.cancelledAt || record.dateFrom || record.createdAt;
        const cancelledDate = new Date(actualCancelledAt);
        
        // Calculate Vietnam time (UTC+7) for appointmentDate
        const appointmentDateUTC = p.appointmentDate ? new Date(p.appointmentDate) : null;
        const appointmentDateVN = appointmentDateUTC ? new Date(appointmentDateUTC.getTime() + 7 * 60 * 60 * 1000) : null;
        
        return {
          // Patient info
          appointmentId: p.appointmentId,
          patientId: p.patientId,
          patientName: p.patientName,
          patientEmail: p.patientEmail,
          patientPhone: p.patientPhone,
          
          // Appointment info
          appointmentDate: p.appointmentDate,
          appointmentDateVN: appointmentDateVN, // Vietnam timezone (UTC+7)
          appointmentTime: `${p.startTime} - ${p.endTime}`,
          startTime: p.startTime,
          endTime: p.endTime,
          shiftName: p.shiftName,
          
          // Room & Staff
          roomId: p.roomId,
          roomName: p.roomName,
          dentists: p.dentists?.map(d => d.dentistName).join(', ') || 'N/A',
          dentistIds: p.dentists?.map(d => d.dentistId) || [],
          nurses: p.nurses?.map(n => n.nurseName).join(', ') || 'N/A',
          
          // Financial
          paymentId: p.paymentInfo?.paymentId || null,
          paymentStatus: p.paymentInfo?.status || 'N/A',
          invoiceId: p.invoiceInfo?.invoiceId || null,
          invoiceStatus: p.invoiceInfo?.status || 'N/A',
          
          // Cancellation info - use actual appointment cancelledAt
          cancelledAt: actualCancelledAt,
          cancelledDate: cancelledDate,
          cancelledReason: record.reason,
          cancelledBy: (record.closedBy?.userName && record.closedBy.userName !== 'System') 
            ? record.closedBy.userName 
            : 'Admin',
          operationType: record.operationType,
          emailSent: p.emailSent,
          
          // For grouping/display
          closureId: record._id,
          formattedCancelledDate: cancelledDate.toLocaleDateString('vi-VN'),
          formattedCancelledTime: cancelledDate.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
          formattedCancelledDateTime: `${cancelledDate.toLocaleDateString('vi-VN')} ${cancelledDate.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`
        };
      });
      
      allPatients = allPatients.concat(patients);
    });

    // Filter by appointment date range (client-side filtering for precise date matching)
    // Use appointmentDate (UTC) for filtering, then convert to Vietnam date for comparison
    if (startDate || endDate) {
      console.log(`🔍 Filtering by date range: ${startDate} to ${endDate}`);
      console.log(`📊 Total patients before filter: ${allPatients.length}`);
      
      allPatients = allPatients.filter(p => {
        if (!p.appointmentDate) return false;
        
        // Ensure appointmentDate is a Date object (could be string or Date from MongoDB)
        const apptDateUTC = p.appointmentDate instanceof Date 
          ? p.appointmentDate 
          : new Date(p.appointmentDate);
        
        // Get UTC timestamp and add 7 hours for Vietnam timezone
        const vnTimestamp = apptDateUTC.getTime() + 7 * 60 * 60 * 1000;
        const apptDateVN = new Date(vnTimestamp);
        
        // Extract Vietnam date in YYYY-MM-DD format using UTC methods
        // (apptDateVN is actually a UTC date that represents VN time)
        const year = apptDateVN.getUTCFullYear();
        const month = String(apptDateVN.getUTCMonth() + 1).padStart(2, '0');
        const day = String(apptDateVN.getUTCDate()).padStart(2, '0');
        const apptDateStr = `${year}-${month}-${day}`; // YYYY-MM-DD in VN timezone
        
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
        
        // Debug log for first 3 patients
        if (allPatients.indexOf(p) < 3) {
          console.log(`  Patient ${p.patientName}: appointmentDate(UTC)=${apptDateUTC.toISOString()} → VN=${apptDateStr}, match=${match}`);
        }
        
        return match;
      });
      
      console.log(`✅ Total patients after filter: ${allPatients.length}`);
    }

    // Filter by room (client-side filtering for precise matching)
    if (roomId) {
      allPatients = allPatients.filter(p => 
        p.roomId && p.roomId.toString() === roomId.toString()
      );
    }

    // Filter by dentist (client-side filtering for precise matching)
    if (dentistId) {
      allPatients = allPatients.filter(p => 
        p.dentistIds && p.dentistIds.some(id => id.toString() === dentistId.toString())
      );
    }

    // Client-side filtering by patient name (if provided)
    if (patientName && patientName.trim()) {
      const searchTerm = patientName.toLowerCase().trim();
      allPatients = allPatients.filter(p => 
        p.patientName?.toLowerCase().includes(searchTerm) ||
        p.patientEmail?.toLowerCase().includes(searchTerm) ||
        p.patientPhone?.includes(searchTerm)
      );
    }

    // Pagination
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
