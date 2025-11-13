# 📊 Kế hoạch: Thống kê Hiệu suất Sử dụng Phòng khám (Clinic Utilization Statistics)

## 🎯 Mục tiêu
Thay thế giao diện "Thống kê BN Quay lại" bằng giao diện mới **"Thống kê Hiệu suất Phòng khám"** để đo lường tỷ lệ sử dụng slots (có/không có appointment).

---

## 📋 Phân tích Model

### 1. Slot Model (schedule-service)
```javascript
{
  scheduleId: ObjectId,
  roomId: ObjectId,           // ✅ Quan trọng: Để filter theo room
  subRoomId: ObjectId,         // null nếu room không có subroom
  date: Date,                  // ✅ Quan trọng: Để lọc theo ngày/tháng/quý/năm
  shiftName: String,           // 'Ca Sáng', 'Ca Chiều', 'Ca Tối'
  startTime: Date,             // ✅ Quan trọng: Thời gian bắt đầu slot
  endTime: Date,
  dentist: [ObjectId],         // Array các nha sĩ
  nurse: [ObjectId],           // Array các y tá
  status: String,              // 'available', 'locked', 'booked'
  appointmentId: ObjectId,     // ✅ QUAN TRỌNG: null = không có lịch hẹn, có giá trị = có lịch hẹn
  isActive: Boolean,           // true/false
  duration: Number,            // Thời lượng (phút)
  isHolidayOverride: Boolean
}
```

**Logic tính toán:**
- **Slot có appointment**: `appointmentId !== null`
- **Slot không có appointment**: `appointmentId === null`
- **Tỷ lệ sử dụng** = (Số slot có appointment / Tổng số slot active) × 100%

### 2. Room Model (room-service)
```javascript
{
  name: String,                // ✅ Tên phòng
  roomType: String,            // ✅ Loại phòng (CONSULTATION, SURGERY, X_RAY, etc.)
  hasSubRooms: Boolean,
  subRooms: [{
    name: String,              // "Buồng 1", "Buồng 2"
    isActive: Boolean
  }],
  isActive: Boolean,
  autoScheduleEnabled: Boolean
}
```

**Các loại phòng:**
- **Bookable** (có thể đặt lịch): CONSULTATION, GENERAL_TREATMENT, SURGERY, ORTHODONTIC, COSMETIC, PEDIATRIC
- **Non-bookable** (không đặt lịch qua UI): X_RAY, STERILIZATION, LAB, SUPPORT

---

## 🎨 Thiết kế Giao diện

### Tiêu đề
**"Thống kê Hiệu suất Sử dụng Phòng khám"**

### Bộ lọc (Filters)
1. **Khoảng thời gian** (Dropdown)
   - Theo ngày (Day) - chọn ngày cụ thể
   - Theo tháng (Month) - chọn tháng/năm
   - Theo quý (Quarter) - chọn quý/năm
   - Theo năm (Year) - chọn năm

2. **Chọn phòng** (Multi-select)
   - Hiển thị danh sách tất cả rooms (active)
   - Cho phép chọn 1 hoặc nhiều phòng
   - Mặc định: chọn tất cả phòng **bookable** (loại trừ X_RAY, STERILIZATION, LAB, SUPPORT)
   - Hiển thị badge loại phòng (roomType)

3. **Trạng thái slot** (Optional filter)
   - Chỉ tính slot active (`isActive = true`)
   - Có thể filter theo shift (Ca Sáng/Chiều/Tối)

### Hiển thị dữ liệu

#### 1. Tổng quan (Summary Cards)
```
┌────────────────────────────────────────────────────────────────┐
│  📊 Tổng số slot        │  ✅ Có lịch hẹn      │  ❌ Trống      │
│     1,200 slots         │    850 slots (70.8%) │  350 slots    │
└────────────────────────────────────────────────────────────────┘
```

#### 2. Biểu đồ cột (Bar Chart)
- **Trục X**: Danh sách phòng đã chọn
- **Trục Y**: Số lượng slots
- **2 cột cho mỗi phòng**:
  - Cột xanh: Slots có appointment
  - Cột xám: Slots trống
- Hiển thị tỷ lệ % trên mỗi cột

#### 3. Biểu đồ tròn (Pie Chart)
- Tỷ lệ slots có/không có appointment trong tổng thể
- Màu xanh: Có appointment
- Màu xám: Không có appointment

#### 4. Bảng chi tiết (Detail Table)
| Phòng | Loại | Tổng slot | Có lịch | Trống | Tỷ lệ sử dụng | Trung bình/ngày |
|-------|------|-----------|---------|-------|---------------|-----------------|
| Phòng 1 | CONSULTATION | 400 | 320 | 80 | 80% | 13.3 slots/day |
| Phòng 2 | SURGERY | 300 | 210 | 90 | 70% | 10 slots/day |
| ... | ... | ... | ... | ... | ... | ... |

#### 5. Biểu đồ xu hướng (Line Chart - nếu chọn nhiều ngày/tháng)
- Hiển thị xu hướng tỷ lệ sử dụng theo thời gian
- Có thể so sánh nhiều phòng trên cùng 1 chart

#### 6. Breakdown theo ca (Shift Analysis)
```
Ca Sáng:   600 slots → 450 có appointment (75%)
Ca Chiều:  400 slots → 300 có appointment (75%)
Ca Tối:    200 slots → 100 có appointment (50%)
```

---

## 🔧 Backend Implementation

### 1. API Endpoint mới
**Route:** `GET /api/statistics/clinic-utilization`

**Query Parameters:**
```typescript
{
  timeRange: 'day' | 'month' | 'quarter' | 'year',
  startDate: string,      // ISO date
  endDate: string,        // ISO date
  roomIds: string[],      // Array of room IDs (comma-separated)
  shiftName?: string      // Optional: filter by shift
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "summary": {
      "totalSlots": 1200,
      "bookedSlots": 850,
      "emptySlots": 350,
      "utilizationRate": 70.8
    },
    "byRoom": [
      {
        "roomId": "...",
        "roomName": "Phòng 1",
        "roomType": "CONSULTATION",
        "totalSlots": 400,
        "bookedSlots": 320,
        "emptySlots": 80,
        "utilizationRate": 80,
        "avgSlotsPerDay": 13.3
      }
    ],
    "byShift": {
      "Ca Sáng": { "total": 600, "booked": 450, "rate": 75 },
      "Ca Chiều": { "total": 400, "booked": 300, "rate": 75 },
      "Ca Tối": { "total": 200, "booked": 100, "rate": 50 }
    },
    "timeline": [
      {
        "date": "2025-11-01",
        "totalSlots": 40,
        "bookedSlots": 32,
        "utilizationRate": 80
      }
    ]
  }
}
```

### 2. Service Logic (statistic-service)

#### File: `clinicUtilizationService.js`

**Core Query:**
```javascript
async getClinicUtilization({ timeRange, startDate, endDate, roomIds, shiftName }) {
  // 1. Build query filter
  const query = {
    isActive: true,
    startTime: { $gte: new Date(startDate), $lte: new Date(endDate) }
  };
  
  if (roomIds && roomIds.length > 0) {
    query.roomId = { $in: roomIds.map(id => new ObjectId(id)) };
  }
  
  if (shiftName) {
    query.shiftName = shiftName;
  }
  
  // 2. Aggregate slots
  const slots = await Slot.find(query).lean();
  
  // 3. Calculate statistics
  const totalSlots = slots.length;
  const bookedSlots = slots.filter(s => s.appointmentId !== null).length;
  const emptySlots = totalSlots - bookedSlots;
  const utilizationRate = totalSlots > 0 ? (bookedSlots / totalSlots) * 100 : 0;
  
  // 4. Group by room
  const byRoom = this.groupByRoom(slots, roomIds);
  
  // 5. Group by shift
  const byShift = this.groupByShift(slots);
  
  // 6. Timeline (for trend analysis)
  const timeline = this.generateTimeline(slots, timeRange);
  
  return {
    summary: { totalSlots, bookedSlots, emptySlots, utilizationRate },
    byRoom,
    byShift,
    timeline
  };
}
```

### 3. RPC Calls

**Calls to room-service:**
```javascript
// Get room details (name, type) for selected roomIds
const rooms = await rpcClient.call('room_queue', {
  action: 'get_rooms_by_ids',
  payload: { roomIds }
});
```

**Calls to schedule-service:**
```javascript
// Get slots with filters
const slots = await rpcClient.call('schedule_queue', {
  action: 'get_slots_for_statistics',
  payload: { startDate, endDate, roomIds, shiftName }
});
```

---

## 📁 File Structure

### Backend (statistic-service)
```
services/statistic-service/
├── src/
│   ├── controllers/
│   │   └── statisticController.js          [UPDATE] Add clinic utilization endpoint
│   ├── services/
│   │   ├── statisticService.js             [UPDATE] Remove patient retention
│   │   └── clinicUtilizationService.js     [NEW] Core logic for utilization stats
│   ├── routes/
│   │   └── statisticRoute.js               [UPDATE] Add /clinic-utilization route
│   └── utils/
│       └── dateHelper.js                    [NEW] Helper for date range calculations
```

### Frontend (SmileDental-FE-new)
```
src/
├── pages/
│   └── Statistics/
│       ├── PatientRetentionStatistics.jsx  [DELETE]
│       └── ClinicUtilizationStatistics.jsx [NEW] New statistics page
├── services/
│   └── statisticsAPI.js                    [UPDATE] Add new API call
├── components/
│   └── Layout/
│       └── DashboardLayout.jsx             [UPDATE] Update menu item
└── App.jsx                                 [UPDATE] Update route
```

---

## ✅ Tasks Checklist

### Phase 1: Xóa Patient Retention (15 phút)
- [ ] **FE**: Xóa file `PatientRetentionStatistics.jsx`
- [ ] **FE**: Xóa import trong `App.jsx`
- [ ] **FE**: Xóa route `/dashboard/statistics/patient-retention` trong `App.jsx`
- [ ] **FE**: Xóa menu item trong `DashboardLayout.jsx`
- [ ] **FE**: Xóa API call `getPatientRetentionStatistics` trong `statisticsAPI.js`
- [ ] **BE**: Xóa hoặc comment code liên quan `calculateRetentionRate` trong `statisticService.js`
- [ ] **BE**: Xóa route `/patient-retention` trong `statisticRoute.js` (nếu có)

### Phase 2: Backend - Clinic Utilization (1-2 giờ)
- [ ] **Create** `clinicUtilizationService.js`
  - [ ] Function: `getClinicUtilization()`
  - [ ] Function: `groupByRoom()`
  - [ ] Function: `groupByShift()`
  - [ ] Function: `generateTimeline()`
- [ ] **Create** `dateHelper.js`
  - [ ] Function: `getDateRange(timeRange, startDate)`
  - [ ] Function: `formatDateForQuery()`
  - [ ] Function: `getQuarterDates(year, quarter)`
- [ ] **Update** `statisticController.js`
  - [ ] Add `getClinicUtilization` controller
- [ ] **Update** `statisticRoute.js`
  - [ ] Add `GET /api/statistics/clinic-utilization`
- [ ] **Add RPC handlers** (if needed)
  - [ ] schedule-service: `get_slots_for_statistics`
  - [ ] room-service: `get_rooms_by_ids`
- [ ] **Test API** với Postman/Thunder Client

### Phase 3: Frontend - Clinic Utilization (2-3 giờ)
- [ ] **Create** `ClinicUtilizationStatistics.jsx`
  - [ ] Setup state management (filters, data, loading)
  - [ ] Implement time range selector (day/month/quarter/year)
  - [ ] Implement multi-select room picker
  - [ ] Fetch rooms list from API
  - [ ] Fetch statistics data
  - [ ] Render summary cards
  - [ ] Render bar chart (Recharts/Chart.js)
  - [ ] Render pie chart
  - [ ] Render detail table with sorting
  - [ ] Render shift breakdown
  - [ ] Render timeline chart (if applicable)
  - [ ] Add export to Excel/PDF (optional)
- [ ] **Update** `statisticsAPI.js`
  - [ ] Add `getClinicUtilization(params)` function
- [ ] **Update** `App.jsx`
  - [ ] Import new component
  - [ ] Add route `/dashboard/statistics/clinic-utilization`
- [ ] **Update** `DashboardLayout.jsx`
  - [ ] Add menu item "📊 Hiệu suất Phòng khám"
  - [ ] Update key to `/dashboard/statistics/clinic-utilization`

### Phase 4: Testing & Polish (30 phút - 1 giờ)
- [ ] Test with different time ranges
- [ ] Test with single/multiple rooms
- [ ] Test with empty data scenarios
- [ ] Test responsive design (mobile/tablet)
- [ ] Verify calculations are correct
- [ ] Add loading states
- [ ] Add error handling
- [ ] Add tooltips/help text

---

## 🎯 Key Metrics

### Tính toán chính
1. **Utilization Rate** = (Slots có appointmentId / Tổng slots active) × 100%
2. **Empty Rate** = 100% - Utilization Rate
3. **Avg Slots Per Day** = Total slots / Number of days in range
4. **Peak Utilization** = Shift/Room có tỷ lệ cao nhất

### Insights cần hiển thị
- 📈 Phòng nào có tỷ lệ sử dụng cao nhất/thấp nhất
- 🕐 Ca nào có nhiều slot trống nhất
- 📉 Xu hướng tăng/giảm theo thời gian
- ⚠️ Cảnh báo: Phòng có tỷ lệ sử dụng < 50% (inefficient)
- ✅ Phòng có tỷ lệ sử dụng > 90% (consider expanding capacity)

---

## 🔍 Sample Queries

### MongoDB Aggregation (schedule-service)
```javascript
db.slots.aggregate([
  // Filter
  {
    $match: {
      isActive: true,
      startTime: { $gte: ISODate("2025-11-01"), $lte: ISODate("2025-11-30") },
      roomId: { $in: [roomId1, roomId2] }
    }
  },
  // Group by room
  {
    $group: {
      _id: "$roomId",
      totalSlots: { $sum: 1 },
      bookedSlots: {
        $sum: { $cond: [{ $ne: ["$appointmentId", null] }, 1, 0] }
      }
    }
  },
  // Calculate utilization
  {
    $project: {
      roomId: "$_id",
      totalSlots: 1,
      bookedSlots: 1,
      emptySlots: { $subtract: ["$totalSlots", "$bookedSlots"] },
      utilizationRate: {
        $multiply: [
          { $divide: ["$bookedSlots", "$totalSlots"] },
          100
        ]
      }
    }
  }
])
```

---

## 📊 Example UI Mockup

```
┌─────────────────────────────────────────────────────────────────┐
│  📊 Thống kê Hiệu suất Sử dụng Phòng khám                       │
├─────────────────────────────────────────────────────────────────┤
│  🔍 Bộ lọc:                                                     │
│  [Theo tháng ▼] [Tháng 11/2025] [Chọn phòng: 8/10 selected]   │
├─────────────────────────────────────────────────────────────────┤
│  Tổng quan:                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│  │ 1,200    │  │ 850      │  │ 350      │  │ 70.8%    │      │
│  │ Tổng slot│  │ Có lịch  │  │ Trống    │  │ Sử dụng  │      │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘      │
├─────────────────────────────────────────────────────────────────┤
│  Biểu đồ theo phòng:                                           │
│  [Bar Chart: X=Rooms, Y=Slots, 2 bars per room]               │
├─────────────────────────────────────────────────────────────────┤
│  Chi tiết:                                                      │
│  [Table with columns: Phòng | Loại | Tổng | Có lịch | % ]     │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Estimated Time
- **Phase 1** (Cleanup): 15 phút
- **Phase 2** (Backend): 1-2 giờ
- **Phase 3** (Frontend): 2-3 giờ
- **Phase 4** (Testing): 30 phút - 1 giờ

**Total:** ~4-6.5 giờ

---

## 📝 Notes
- Chỉ tính slots có `isActive = true`
- Mặc định filter các phòng non-bookable (X_RAY, STERILIZATION, LAB, SUPPORT)
- Có thể mở rộng thêm filter theo dentist/nurse
- Có thể thêm comparison mode (so sánh 2 khoảng thời gian)
- Cần cache kết quả cho query lớn (nhiều tháng/năm)
