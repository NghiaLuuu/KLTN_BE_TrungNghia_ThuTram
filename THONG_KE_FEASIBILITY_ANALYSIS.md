# PHÂN TÍCH TÍNH KHẢ THI TÍNH NĂNG THỐNG KÊ

## 📊 TỔNG QUAN
Giao diện FE hiện tại đang sử dụng **MOCK DATA** và cần kiểm tra xem BE có đủ dữ liệu từ models để thực thi các API thống kê thực tế hay không.

---

## 🎯 CÁC API THỐNG KÊ TRONG FE

### 1. **API Revenue Statistics** (Thống kê Doanh thu)
**Trang:** `RevenueStatistics.jsx`

**Dữ liệu cần:**
```javascript
{
  summary: {
    totalRevenue,           // ✅ Tính từ Payment/Invoice
    totalAppointments,       // ✅ Đếm từ Appointment
    totalServices,           // ✅ Đếm từ Appointment.serviceId
    avgRevenuePerAppointment // ✅ Tính toán
  },
  revenueByDentist: [
    {
      dentistId, dentistName,  // ✅ Từ Appointment.dentistId
      totalRevenue,            // ✅ JOIN Payment
      appointmentCount,        // ✅ Đếm Appointment
      serviceCount             // ✅ Đếm dịch vụ
    }
  ],
  revenueByService: [
    {
      serviceId, serviceName,  // ✅ Từ Appointment.serviceId
      totalRevenue,            // ✅ JOIN Payment
      totalCount               // ✅ Đếm Appointment
    }
  ],
  revenueByTime: [           // ✅ GROUP BY date
    { date, revenue }
  ]
}
```

**Phân tích BE:**
- ✅ **Appointment Model** có đầy đủ:
  - `dentistId`, `dentistName`
  - `serviceId`, `serviceName`
  - `appointmentDate`
  - `paymentId`, `invoiceId`
  - `totalAmount`
  - `status` (để lọc completed)
  - `bookedByRole` (để phân biệt online/offline)

- ✅ **Payment Model** có:
  - `appointmentId` (để JOIN)
  - `finalAmount`, `paidAmount`
  - `status` (COMPLETED)
  - `processedAt` (timestamp)
  - `method` (cash/vnpay/visa)

- ✅ **Invoice Model** có:
  - `appointmentId`
  - `totalAmount`
  - `status` (PAID)
  - `issueDate`

**KẾT LUẬN:** ✅ **KHẢ THI 100%** - Có thể JOIN Appointment + Payment/Invoice để lấy dữ liệu thực

---

### 2. **API Booking Channel Statistics** (Online vs Offline)
**Trang:** `BookingChannelStatistics.jsx`

**Dữ liệu cần:**
```javascript
{
  summary: {
    total,
    online: { count, percentage, completionRate },  // ✅
    offline: { count, percentage, completionRate }  // ✅
  },
  trend: [                // ✅ GROUP BY date + bookedByRole
    { date, online, offline }
  ],
  offlineByRole: [        // ✅ Từ bookedByRole
    { role, name, count, percentage }
  ],
  topStaff: [             // ⚠️ CẦN THÊM
    { staffId, name, role, count, efficiency }
  ]
}
```

**Phân tích BE:**
- ✅ **Appointment Model** có:
  - `bookedByRole` (patient/receptionist/admin/manager)
  - Virtual field: `bookingChannel` → 'online' nếu role='patient', 'offline' nếu khác
  - `bookedBy` (userId)
  - `bookedAt`
  - `status`

- ⚠️ **THIẾU:** 
  - Thông tin chi tiết nhân viên (name, efficiency) → Cần gọi RPC tới `auth-service` để lấy user info
  - Hoặc lưu `bookedByName` trong Appointment

**KẾT LUẬN:** ✅ **KHẢ THI 90%** - Có thể thống kê online/offline, nhưng cần RPC để lấy thông tin nhân viên chi tiết

---

### 3. **API Patient Retention Statistics** (Bệnh nhân quay lại)
**Trang:** `PatientRetentionStatistics.jsx`

**Dữ liệu cần:**
```javascript
{
  summary: {
    total,
    newPatients: { count, percentage },      // ⚠️ Cần logic xác định bệnh nhân mới
    returningPatients: { count, percentage }, // ⚠️ Cần đếm lần khám
    retentionRate,
    avgCLV                                   // ✅ Tổng revenue / số bệnh nhân
  },
  trend: [
    { date, new, returning }
  ],
  loyalPatients: [                          // ⚠️ Cần aggregate
    { 
      patientId, name, phone, 
      totalVisits,                           // Đếm appointments
      totalSpent,                            // Tổng payments
      firstVisit, lastVisit,
      frequency                              // Visits / tháng
    }
  ],
  cohortAnalysis: [                         // ⚠️ Phức tạp
    { month, newPatients, withSecondVisit, retentionRate }
  ]
}
```

**Phân tích BE:**
- ✅ **Appointment Model** có:
  - `patientId` (để GROUP BY)
  - `appointmentDate`
  - `status`

- ⚠️ **THIẾU LOGIC:**
  - Xác định bệnh nhân mới vs quay lại:
    ```javascript
    // Bệnh nhân mới: chỉ có 1 appointment
    // Quay lại: có >= 2 appointments
    ```
  - Tính Customer Lifetime Value (CLV): JOIN với Payment
  - Cohort Analysis: Phức tạp, cần aggregate pipeline

- ⚠️ **Patient Info:**
  - Cần RPC tới `auth-service` để lấy thông tin bệnh nhân đầy đủ
  - Hoặc sử dụng `patientInfo` embedded trong Appointment

**KẾT LUẬN:** ⚠️ **KHẢ THI 70%** - Cần viết aggregation pipeline phức tạp và RPC để lấy patient info

---

### 4. **API Appointment Statistics** (Thống kê lịch hẹn)

**Dữ liệu cần:**
```javascript
{
  summary: {
    total, completed, cancelled, noShow,
    completionRate, cancellationRate, noShowRate
  },
  trend: [
    { date, total, completed, cancelled, noShow }
  ],
  byTimeSlot: [                             // ⚠️ Cần parse startTime
    { timeSlot: '08:00-09:00', count }
  ],
  byDayOfWeek: [                            // ✅ Từ appointmentDate
    { day: 'Mon', count }
  ]
}
```

**Phân tích BE:**
- ✅ **Appointment Model** có:
  - `status` (confirmed/completed/cancelled/no-show)
  - `appointmentDate`
  - `startTime`, `endTime` (String: "09:00")

- ⚠️ **CẦN XỬ LÝ:**
  - Parse `startTime` để group theo time slot
  - Extract day of week từ `appointmentDate`

**KẾT LUẬN:** ✅ **KHẢ THI 95%** - Cần logic xử lý time slot

---

### 5. **API Service Usage Statistics** (Thống kê dịch vụ)

**Dữ liệu cần:**
```javascript
{
  summary: {
    totalServices, totalRevenue, avgServiceValue
  },
  byCategory: [                             // ⚠️ Category không có trong Appointment
    { category: 'cosmetic', count, revenue }
  ],
  trendingServices: [                       // ⚠️ Cần so sánh period
    { serviceId, name, growth, count, prevCount }
  ],
  topServices: [
    { serviceId, name, count, revenue }
  ]
}
```

**Phân tích BE:**
- ✅ **Appointment Model** có:
  - `serviceId`, `serviceName`
  - `serviceType` (exam/treatment)
  - `totalAmount`

- ⚠️ **THIẾU:**
  - `serviceCategory` (cosmetic/implant/orthodontics...) 
    → Không có trong Appointment, cần JOIN với service-service
  - Growth calculation → Cần so sánh 2 time periods

- 💡 **GIẢI PHÁP:**
  - Gọi RPC tới `service-service` để lấy category
  - Hoặc thêm field `serviceCategory` vào Appointment khi tạo

**KẾT LUẬN:** ⚠️ **KHẢ THI 80%** - Cần RPC hoặc thêm field vào Appointment

---

### 6. **API Dentist Performance Statistics** (Hiệu suất nha sỹ)

**Dữ liệu cần:**
```javascript
{
  dentists: [
    {
      dentistId, dentistName, specialization,  // ⚠️ Specialization không có
      totalAppointments, completed, cancelled,
      completionRate, totalRevenue,
      patientSatisfaction,                      // ❌ Chưa có feedback system
      repeatPatientRate                         // ⚠️ Cần tính
    }
  ]
}
```

**Phân tích BE:**
- ✅ **Appointment Model** có:
  - `dentistId`, `dentistName`
  - `status`
  - `appointmentDate`

- ⚠️ **THIẾU:**
  - `specialization` → Cần RPC tới `auth-service`
  - `patientSatisfaction` → ❌ Chưa có feedback/rating system
  - `repeatPatientRate` → Cần đếm bệnh nhân quay lại với cùng dentist

**KẾT LUẬN:** ⚠️ **KHẢ THI 60%** - Thiếu feedback system, cần RPC

---

## 📋 BẢNG TỔNG HỢP KHẢ THI

| API | Tính khả thi | Dữ liệu có sẵn | Cần bổ sung |
|-----|-------------|----------------|-------------|
| **Revenue Statistics** | ✅ 100% | Appointment + Payment/Invoice | - |
| **Booking Channel** | ✅ 90% | Appointment.bookedByRole | RPC lấy staff info |
| **Patient Retention** | ⚠️ 70% | Appointment.patientId | Aggregation pipeline phức tạp |
| **Appointment Stats** | ✅ 95% | Appointment.status + date | Parse time slot |
| **Service Usage** | ⚠️ 80% | Appointment.serviceId | RPC lấy category |
| **Dentist Performance** | ⚠️ 60% | Appointment.dentistId | Feedback system, RPC |

---

## 🔧 GIẢI PHÁP KẾ HOẠCH

### Phase 1: Implement API Cơ bản (Ưu tiên cao)
✅ **Revenue Statistics** - Hoàn toàn khả thi
```javascript
// Aggregation pipeline đơn giản
Appointment.aggregate([
  {
    $match: {
      status: 'completed',
      appointmentDate: { $gte: startDate, $lte: endDate }
    }
  },
  {
    $lookup: {
      from: 'payments',
      localField: 'paymentId',
      foreignField: '_id',
      as: 'payment'
    }
  },
  {
    $group: {
      _id: '$dentistId',
      totalRevenue: { $sum: '$payment.finalAmount' },
      appointmentCount: { $sum: 1 }
    }
  }
])
```

✅ **Booking Channel Statistics**
```javascript
Appointment.aggregate([
  {
    $match: { appointmentDate: { $gte: startDate, $lte: endDate } }
  },
  {
    $group: {
      _id: {
        date: { $dateToString: { format: '%Y-%m-%d', date: '$appointmentDate' } },
        channel: {
          $cond: [{ $eq: ['$bookedByRole', 'patient'] }, 'online', 'offline']
        }
      },
      count: { $sum: 1 }
    }
  }
])
```

✅ **Appointment Statistics**
```javascript
Appointment.aggregate([
  {
    $match: { appointmentDate: { $gte: startDate, $lte: endDate } }
  },
  {
    $group: {
      _id: {
        date: { $dateToString: { format: '%Y-%m-%d', date: '$appointmentDate' } },
        status: '$status'
      },
      count: { $sum: 1 }
    }
  }
])
```

### Phase 2: Implement API Trung bình (RPC required)
⚠️ **Service Usage Statistics**
- Cần thêm RPC call tới `service-service` để lấy category
- Hoặc thêm `serviceCategory` vào Appointment khi tạo

⚠️ **Patient Retention Statistics**
- Aggregation pipeline phức tạp hơn
- Cần xác định new vs returning patients

### Phase 3: Implement API Nâng cao (Cần thêm tính năng)
⚠️ **Dentist Performance Statistics**
- Cần implement feedback/rating system
- Cần RPC lấy specialization

---

## 🎯 KẾT LUẬN CHUNG

### ✅ CÓ THỂ THỰC HIỆN NGAY (80% features)
Với BE hiện tại, có thể implement **4/6 API** thống kê với độ chính xác cao:
1. ✅ Revenue Statistics
2. ✅ Booking Channel Statistics (cơ bản)
3. ✅ Appointment Statistics
4. ⚠️ Service Usage (cơ bản, thiếu category)

### ⚠️ CẦN BỔ SUNG (20% features)
1. **RPC calls** tới các services khác:
   - `auth-service`: Lấy thông tin user (staff, dentist, patient)
   - `service-service`: Lấy category, pricing

2. **Aggregation Pipeline phức tạp:**
   - Patient retention cohort analysis
   - Customer lifetime value calculation

3. **New Features:**
   - Feedback/Rating system cho dentist performance
   - Service category trong Appointment model

---

## 💡 KHUYẾN NGHỊ

### Ngắn hạn (1-2 tuần)
1. ✅ Tạo `statistic-service` với 3 API cơ bản:
   - Revenue Statistics
   - Booking Channel Statistics (cơ bản)
   - Appointment Statistics

2. ⚠️ Thêm field `serviceCategory` vào Appointment model khi tạo appointment
   - Parse từ service-service response
   - Lưu để tránh RPC lặp lại

### Trung hạn (2-4 tuần)
3. ⚠️ Implement RPC helper cho statistic-service:
   ```javascript
   // helpers/rpc-client.js
   async getUserInfo(userId) { ... }
   async getServiceInfo(serviceId) { ... }
   ```

4. ⚠️ Implement Patient Retention API với aggregation pipeline

### Dài hạn (1-2 tháng)
5. ❌ Implement Feedback/Rating system
6. ⚠️ Implement Dentist Performance API đầy đủ

---

## 📌 HÀNH ĐỘNG KẾ TIẾP

1. **Tạo statistic-service structure:**
   ```
   statistic-service/
   ├── src/
   │   ├── controllers/
   │   │   ├── revenue.controller.js
   │   │   ├── booking-channel.controller.js
   │   │   └── appointment.controller.js
   │   ├── services/
   │   │   ├── revenue.service.js
   │   │   ├── booking-channel.service.js
   │   │   └── appointment.service.js
   │   ├── helpers/
   │   │   ├── aggregation.helper.js
   │   │   └── rpc-client.helper.js
   │   └── routes/
   │       └── statistic.routes.js
   ```

2. **Aggregate từ Appointment DB:**
   - Không cần tạo model mới
   - Sử dụng MongoDB Aggregation Pipeline
   - JOIN với Payment/Invoice khi cần

3. **Test với dữ liệu thực:**
   - Populate test data trong Appointment DB
   - Verify aggregation results
   - Compare với mock data ở FE

---

**Tác giả:** AI Analysis  
**Ngày:** 2025-11-12  
**Status:** ✅ READY TO IMPLEMENT Phase 1
