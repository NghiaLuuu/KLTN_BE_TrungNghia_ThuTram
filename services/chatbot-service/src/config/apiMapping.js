// API Mapping Configuration - Map user intents to internal API endpoints

const API_BASE_URLS = {
  AUTH_SERVICE: process.env.AUTH_SERVICE_URL || 'http://localhost:3001',
  SERVICE_SERVICE: process.env.SERVICE_SERVICE_URL || 'http://localhost:3004',
  SCHEDULE_SERVICE: process.env.SCHEDULE_SERVICE_URL || 'http://localhost:3005',
  APPOINTMENT_SERVICE: process.env.APPOINTMENT_SERVICE_URL || 'http://localhost:3007'
};

// API Endpoint Mappings
const API_ENDPOINTS = {
  // Service Service APIs
  SEARCH_SERVICES: {
    method: 'GET',
    baseUrl: API_BASE_URLS.SERVICE_SERVICE,
    path: '/api/service/search',
    description: 'Search dental services by name or keyword',
    params: ['query'] // Required params
  },
  
  GET_ALL_SERVICES: {
    method: 'GET',
    baseUrl: API_BASE_URLS.SERVICE_SERVICE,
    path: '/api/service',
    description: 'Get all available dental services',
    params: []
  },
  
  GET_SERVICE_DETAIL: {
    method: 'GET',
    baseUrl: API_BASE_URLS.SERVICE_SERVICE,
    path: '/api/service/:id',
    description: 'Get detailed info of a specific service',
    params: ['id']
  },

  // Schedule Service APIs (COMMENTED OUT - APIs not implemented yet)
  // GET_AVAILABLE_SLOTS: {
  //   method: 'GET',
  //   baseUrl: API_BASE_URLS.SCHEDULE_SERVICE,
  //   path: '/api/schedule/available-slots',
  //   description: 'Get available time slots for booking',
  //   params: ['date', 'serviceId'] // date format: YYYY-MM-DD
  // },

  // GET_DOCTORS_BY_SERVICE: {
  //   method: 'GET',
  //   baseUrl: API_BASE_URLS.SCHEDULE_SERVICE,
  //   path: '/api/schedule/doctors-by-service',
  //   description: 'Get list of doctors who can perform a service',
  //   params: ['serviceId']
  // },

  // GET_DOCTOR_SCHEDULE: {
  //   method: 'GET',
  //   baseUrl: API_BASE_URLS.SCHEDULE_SERVICE,
  //   path: '/api/schedule/doctor/:doctorId',
  //   description: 'Get schedule of a specific doctor',
  //   params: ['doctorId', 'date']
  // },

  // Auth Service APIs (for doctor/staff info)
  GET_DOCTORS_LIST: {
    method: 'GET',
    baseUrl: API_BASE_URLS.AUTH_SERVICE,
    path: '/api/user/public/dentists',
    description: 'Get list of all doctors',
    params: []
  },

  GET_DOCTOR_INFO: {
    method: 'GET',
    baseUrl: API_BASE_URLS.AUTH_SERVICE,
    path: '/api/user/:id',
    description: 'Get detailed info of a doctor',
    params: ['id']
  }
};

// Action Keywords Mapping - Map user intent keywords to API actions
const ACTION_KEYWORDS = {
  // Service search intents
  SEARCH_SERVICES: [
    'tìm dịch vụ', 'tìm kiếm dịch vụ', 'có dịch vụ', 'dịch vụ nào',
    'tẩy trắng', 'niềng răng', 'nhổ răng', 'trám răng', 'cấy implant',
    'bọc răng sứ', 'lấy cao răng', 'nha chu', 'điều trị tủy'
  ],
  
  // Schedule/booking intents
  GET_AVAILABLE_SLOTS: [
    'đặt lịch', 'lịch khám', 'có lịch', 'giờ nào', 'khung giờ',
    'thời gian khám', 'book lịch', 'hẹn lịch', 'slot trống'
  ],

  // Doctor search intents
  GET_DOCTORS_LIST: [
    'bác sĩ nào', 'có bác sĩ', 'danh sách bác sĩ', 'doctor nào',
    'nha sĩ', 'tìm bác sĩ'
  ],

  // Price intents
  GET_SERVICE_DETAIL: [
    'giá', 'chi phí', 'bao nhiêu tiền', 'phí', 'cost'
  ]
};

// Response Templates for API results
const RESPONSE_TEMPLATES = {
  SERVICES_FOUND: (services) => {
    if (services.length === 0) {
      return 'Hiện tại chúng tôi chưa có dịch vụ này. Bạn có thể gọi hotline để được tư vấn thêm nhé! 📞';
    }
    
    let response = `Chúng tôi có ${services.length} dịch vụ phù hợp:\n\n`;
    services.slice(0, 5).forEach((service, index) => {
      response += `${index + 1}. **${service.name}**\n`;
      response += `   - Giá: ${service.price?.toLocaleString('vi-VN')} VNĐ\n`;
      if (service.description) {
        response += `   - Mô tả: ${service.description}\n`;
      }
      response += '\n';
    });
    
    if (services.length > 5) {
      response += `_Và ${services.length - 5} dịch vụ khác..._\n\n`;
    }
    
    response += 'Bạn muốn đặt lịch khám dịch vụ nào không? 😊';
    return response;
  },

  SLOTS_FOUND: (slots, date) => {
    if (slots.length === 0) {
      return `Rất tiếc, ngày ${date} không còn lịch trống. Bạn có thể chọn ngày khác hoặc gọi hotline để được hỗ trợ! 📅`;
    }

    let response = `Các khung giờ còn trống ngày ${date}:\n\n`;
    slots.slice(0, 10).forEach((slot, index) => {
      response += `${index + 1}. ${slot.startTime} - ${slot.endTime}`;
      if (slot.doctorName) {
        response += ` (BS. ${slot.doctorName})`;
      }
      response += '\n';
    });

    response += '\nBạn muốn đặt lịch khung giờ nào? 🦷';
    return response;
  },

  DOCTORS_FOUND: (doctors) => {
    if (doctors.length === 0) {
      return 'Hiện tại chưa có bác sĩ phù hợp. Vui lòng liên hệ hotline để được tư vấn! 👨‍⚕️';
    }

    let response = `Đội ngũ bác sĩ của chúng tôi:\n\n`;
    doctors.forEach((doctor, index) => {
      response += `${index + 1}. **BS. ${doctor.fullName || doctor.name}**\n`;
      if (doctor.specialization) {
        response += `   - Chuyên môn: ${doctor.specialization}\n`;
      }
      if (doctor.experience) {
        response += `   - Kinh nghiệm: ${doctor.experience} năm\n`;
      }
      response += '\n';
    });

    response += 'Bạn muốn đặt lịch với bác sĩ nào? 😊';
    return response;
  },

  API_ERROR: () => {
    return 'Xin lỗi, hệ thống đang bận. Vui lòng thử lại sau hoặc liên hệ hotline để được hỗ trợ trực tiếp! 🙏';
  }
};

module.exports = {
  API_BASE_URLS,
  API_ENDPOINTS,
  ACTION_KEYWORDS,
  RESPONSE_TEMPLATES
};
