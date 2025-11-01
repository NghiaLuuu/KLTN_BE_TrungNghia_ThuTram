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

    // Date range filter
    if (startDate || endDate) {
      query.dateFrom = {};
      if (startDate) {
        query.dateFrom.$gte = new Date(startDate);
      }
      if (endDate) {
        query.dateFrom.$lte = new Date(endDate);
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
      const formattedDate = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
      
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
    const formattedDate = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    
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
      if (startDate) query.dateFrom.$gte = new Date(startDate);
      if (endDate) query.dateFrom.$lte = new Date(endDate);
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
      const date = new Date(record.date);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
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
          paymentStatus: p.paymentInfo?.status || 'N/A',
          invoiceStatus: p.invoiceInfo?.status || 'N/A',
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
 * @param {Date} filters.startDate
 * @param {Date} filters.endDate
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

    // Date range filter
    if (startDate || endDate) {
      query.dateFrom = {};
      if (startDate) {
        query.dateFrom.$gte = new Date(startDate);
      }
      if (endDate) {
        query.dateFrom.$lte = new Date(endDate);
      }
    }

    // Room filter
    if (roomId) {
      query['cancelledAppointments.roomId'] = roomId;
    }

    // Dentist filter
    if (dentistId) {
      query['cancelledAppointments.dentists.dentistId'] = dentistId;
    }

    const skip = (page - 1) * limit;

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
        
        return {
          // Patient info
          appointmentId: p.appointmentId,
          patientId: p.patientId,
          patientName: p.patientName,
          patientEmail: p.patientEmail,
          patientPhone: p.patientPhone,
          
          // Appointment info
          appointmentDate: p.appointmentDate,
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
          cancelledBy: record.closedBy?.userName || 'System',
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
