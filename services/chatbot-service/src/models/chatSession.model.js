const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ['user', 'assistant', 'system'],
    required: true
  },
  content: {
    type: String,
    required: true
  },
  imageUrl: {
    type: String, // S3 URL for uploaded images
    required: false
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
});

const chatSessionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.Mixed, // Allow both ObjectId and String (for anonymous users)
    required: true,
    index: true
  },
  sessionId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  messages: [messageSchema],
  isActive: {
    type: Boolean,
    default: true
  },
  bookingContext: {
    type: {
      isInBookingFlow: { type: Boolean, default: false },
      selectedService: { type: Object, default: null },
      selectedServiceAddOn: { type: Object, default: null },
      selectedServiceItem: { type: Object, default: null }, // Combined service+addon for flat list
      flatServiceList: { type: Array, default: [] }, // Flat numbered list
      availableDentists: { type: Array, default: [] }, // Dentist list
      selectedDentist: { type: Object, default: null },
      availableDates: { type: Array, default: [] }, // Working dates
      selectedDate: { type: String, default: null },
      availableSlotGroups: { type: Array, default: [] }, // Slot groups
      selectedSlot: { type: Object, default: null },
      selectedSlotGroup: { type: Object, default: null }, // Selected slot group
      step: { 
        type: String, 
        enum: ['SERVICE_SELECTION', 'ADDON_SELECTION', 'DENTIST_SELECTION', 'DATE_SELECTION', 'SLOT_SELECTION', 'CONFIRMATION', null],
        default: null 
      },
      lastUpdated: { type: Date, default: null }
    },
    default: {
      isInBookingFlow: false,
      selectedService: null,
      selectedServiceAddOn: null,
      selectedServiceItem: null,
      flatServiceList: [],
      availableDentists: [],
      selectedDentist: null,
      availableDates: [],
      selectedDate: null,
      availableSlotGroups: [],
      selectedSlot: null,
      selectedSlotGroup: null,
      step: null,
      lastUpdated: null
    }
  }
}, {
  timestamps: true
});

// Index for faster queries
chatSessionSchema.index({ userId: 1, createdAt: -1 });

const ChatSession = mongoose.model('ChatSession', chatSessionSchema);

module.exports = ChatSession;
