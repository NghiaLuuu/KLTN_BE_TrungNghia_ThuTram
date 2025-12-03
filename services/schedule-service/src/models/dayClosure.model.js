const mongoose = require('mongoose');

/**
 * SlotStatusChange Model - Tracks ALL slot enable/disable operations
 * Used for: individual slots, room-based, dentist-based, date-based, and full day closures
 */
const dayClosureSchema = new mongoose.Schema(
  {
    // Operation type
    operationType: {
      type: String,
      enum: [
        'disable_all_day',        // Tắt tất cả phòng trong 1 ngày
        'enable_all_day',         // Bật lại tất cả phòng trong 1 ngày
        'disable_flexible',       // Tắt theo tiêu chí (ngày, ca, phòng, nha sĩ)
        'enable_flexible',        // Bật theo tiêu chí
        'toggle_individual'       // Bật/tắt slot cụ thể theo ID
      ],
      required: true,
      index: true
    },

    // Action: enable or disable
    action: {
      type: String,
      enum: ['enable', 'disable'],
      required: true,
      index: true
    },

    // Date range affected (for queries)
    dateFrom: {
      type: Date,
      index: true
    },
    dateTo: {
      type: Date,
      index: true
    },

    // Criteria used for flexible operations
    criteria: {
      date: String,           // Single date (YYYY-MM-DD)
      startDate: String,      // Date range start
      endDate: String,        // Date range end
      shiftName: String,      // 'Ca Sáng', 'Ca Chiều', 'Ca Tối'
      dentistId: mongoose.Schema.Types.ObjectId,
      nurseId: mongoose.Schema.Types.ObjectId,
      roomId: mongoose.Schema.Types.ObjectId,
      subRoomId: mongoose.Schema.Types.ObjectId,
      slotIds: [String]       // For individual slot operations
    },

    // Reason for change
    reason: {
      type: String,
      required: function() {
        return this.action === 'disable'; // Required only for disable operations
      }
    },

    // Type of closure/operation
    closureType: {
      type: String,
      enum: ['emergency', 'planned', 'maintenance', 'staff_absence', 'other'],
      default: 'other'
    },

    // 🆕 Flag to distinguish appointment cancellation from slot toggle/closure
    isAppointmentCancellation: {
      type: Boolean,
      default: false
    },

    // Statistics
    stats: {
      totalSlotsDisabled: { type: Number, default: 0 },
      affectedRoomsCount: { type: Number, default: 0 },
      appointmentsCancelledCount: { type: Number, default: 0 },
      emailsSentCount: { type: Number, default: 0 }
    },

    // Affected rooms
    affectedRooms: [{
      roomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Room' },
      roomName: String,
      slotsDisabled: Number,
      slots: [{ // Chi tiết các slot bị tắt
        slotId: { type: mongoose.Schema.Types.ObjectId, ref: 'Slot' },
        date: Date,
        startTime: String,
        endTime: String,
        shiftName: String,
        dentistNames: [String],
        nurseNames: [String],
        hasAppointment: Boolean
      }]
    }],

    // Detailed information about cancelled appointments
    cancelledAppointments: [{
      // Appointment info
      appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment' },
      appointmentDate: Date,
      cancelledAt: Date, // Thời gian hủy thực tế từ appointment.cancelledAt
      shiftName: String,
      startTime: String,
      endTime: String,

      // Patient info
      patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      patientName: String,
      patientEmail: String,
      patientPhone: String,

      // Room info
      roomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Room' },
      roomName: String,

      // Staff info
      dentists: [{
        dentistId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        dentistName: String,
        dentistEmail: String
      }],
      nurses: [{
        nurseId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        nurseName: String,
        nurseEmail: String
      }],

      // Payment & Invoice info (optional, may not exist yet)
      paymentInfo: {
        paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment' },
        status: String,
        amount: Number,
        method: String
      },
      invoiceInfo: {
        invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice' },
        invoiceNumber: String,
        status: String
      },

      // Notification status
      emailSent: { type: Boolean, default: false },
      emailSentAt: Date
    }],

    // Affected staff without appointments (they had slots assigned but no patients)
    affectedStaffWithoutAppointments: [{
      userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      name: String,
      email: String,
      role: { type: String, enum: ['dentist', 'nurse'] },
      emailSent: { type: Boolean, default: false }
    }],

    // Who performed the closure
    closedBy: {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      userName: String,
      userRole: String
    },

    // Status tracking
    status: {
      type: String,
      enum: ['active', 'partially_restored', 'fully_restored'],
      default: 'active'
    },

    // If restored
    restoredAt: Date,
    restoredBy: {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      userName: String
    },
    restorationReason: String
  },
  {
    timestamps: true
  }
);

// Indexes for efficient querying
dayClosureSchema.index({ dateFrom: -1, dateTo: -1 });
dayClosureSchema.index({ operationType: 1, createdAt: -1 });
dayClosureSchema.index({ action: 1, createdAt: -1 });
dayClosureSchema.index({ status: 1, dateFrom: -1 });
dayClosureSchema.index({ 'closedBy.userId': 1 });
dayClosureSchema.index({ createdAt: -1 });
dayClosureSchema.index({ 'criteria.roomId': 1 });
dayClosureSchema.index({ 'criteria.dentistId': 1 });

// Virtual for formatted date
dayClosureSchema.virtual('formattedDateFrom').get(function() {
  if (!this.dateFrom) return '';
  const d = new Date(this.dateFrom);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
});

dayClosureSchema.virtual('formattedDateTo').get(function() {
  if (!this.dateTo) return '';
  const d = new Date(this.dateTo);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
});

// Virtual for total affected people
dayClosureSchema.virtual('totalAffectedPeople').get(function() {
  let count = 0;
  if (this.cancelledAppointments) {
    count += this.cancelledAppointments.length; // Patients
    const dentistIds = new Set();
    const nurseIds = new Set();
    this.cancelledAppointments.forEach(appt => {
      appt.dentists?.forEach(d => dentistIds.add(d.dentistId?.toString()));
      appt.nurses?.forEach(n => nurseIds.add(n.nurseId?.toString()));
    });
    count += dentistIds.size + nurseIds.size;
  }
  if (this.affectedStaffWithoutAppointments) {
    count += this.affectedStaffWithoutAppointments.length;
  }
  return count;
});

// Method to get operation summary
dayClosureSchema.methods.getSummary = function() {
  const actionText = this.action === 'disable' ? 'Tắt' : 'Bật';
  const operationNames = {
    disable_all_day: 'tất cả phòng trong ngày',
    enable_all_day: 'tất cả phòng trong ngày',
    disable_flexible: 'slots theo tiêu chí',
    enable_flexible: 'slots theo tiêu chí',
    toggle_individual: 'slots cụ thể'
  };
  
  return `${actionText} ${operationNames[this.operationType] || 'slots'}`;
};

dayClosureSchema.set('toJSON', { virtuals: true });
dayClosureSchema.set('toObject', { virtuals: true });

const SlotStatusChange = mongoose.model('SlotStatusChange', dayClosureSchema);

module.exports = SlotStatusChange;
