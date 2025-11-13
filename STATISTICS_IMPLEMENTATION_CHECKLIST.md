# ✅ Statistics Implementation Checklist

## 🎯 Current Status Overview

| API | Frontend | Backend | Status | Priority |
|-----|----------|---------|--------|----------|
| Revenue Stats | ✅ Ready | ✅ 90% | 🟢 Minor fixes | P3 |
| Booking Channel | ✅ Ready | ⚠️ 70% | 🟡 Enhancements | P2 |
| Clinic Utilization | ✅ Ready | ❌ 0% | 🔴 Full build | P1 |

---

## 🔴 Priority 1: Clinic Utilization (4-6 hours)

### Backend Implementation

#### Step 1: schedule-service RPC Handler (1h)
**File:** `services/schedule-service/src/utils/rpcServer.js`

```javascript
case 'getUtilizationStatistics': {
  const { startDate, endDate, roomIds, timeRange, shiftName } = payload;
  
  // Build query
  const query = {
    isActive: true,
    startTime: { $gte: new Date(startDate), $lte: new Date(endDate) }
  };
  
  if (roomIds && roomIds.length > 0) {
    query.roomId = { $in: roomIds.map(id => mongoose.Types.ObjectId(id)) };
  }
  
  if (shiftName) {
    query.shiftName = shiftName;
  }
  
  // Get slots
  const slots = await Slot.find(query).lean();
  
  // Calculate metrics
  const totalSlots = slots.length;
  const bookedSlots = slots.filter(s => s.appointmentId).length;
  const emptySlots = totalSlots - bookedSlots;
  const utilizationRate = totalSlots > 0 ? (bookedSlots / totalSlots) * 100 : 0;
  
  // Group by room
  const byRoom = {};
  slots.forEach(slot => {
    const roomId = slot.roomId.toString();
    if (!byRoom[roomId]) {
      byRoom[roomId] = { total: 0, booked: 0 };
    }
    byRoom[roomId].total++;
    if (slot.appointmentId) byRoom[roomId].booked++;
  });
  
  // Group by shift
  const byShift = {
    'Ca Sáng': { total: 0, booked: 0 },
    'Ca Chiều': { total: 0, booked: 0 },
    'Ca Tối': { total: 0, booked: 0 }
  };
  slots.forEach(slot => {
    byShift[slot.shiftName].total++;
    if (slot.appointmentId) byShift[slot.shiftName].booked++;
  });
  
  response = {
    success: true,
    data: {
      summary: { totalSlots, bookedSlots, emptySlots, utilizationRate },
      byRoom: Object.entries(byRoom).map(([roomId, stats]) => ({
        roomId,
        totalSlots: stats.total,
        bookedSlots: stats.booked,
        emptySlots: stats.total - stats.booked,
        utilizationRate: (stats.booked / stats.total) * 100
      })),
      byShift: Object.entries(byShift).map(([shift, stats]) => ({
        shift,
        ...stats,
        rate: (stats.booked / stats.total) * 100
      }))
    }
  };
  break;
}
```

- [ ] Add RPC handler to schedule-service
- [ ] Test with sample data
- [ ] Handle edge cases (no slots, division by zero)

#### Step 2: statistic-service Connector (30min)
**File:** `services/statistic-service/src/services/serviceConnector.js`

```javascript
static async getSlotUtilizationStats(startDate, endDate, roomIds, timeRange, shiftName) {
  try {
    const message = {
      action: 'getUtilizationStatistics',
      payload: { startDate, endDate, roomIds, timeRange, shiftName }
    };
    
    const result = await rabbitClient.request('schedule_queue', message);
    return result.data || null;
  } catch (error) {
    console.error('Error getting slot utilization:', error);
    throw new Error('Không thể lấy thống kê hiệu suất');
  }
}
```

- [ ] Add method to ServiceConnector
- [ ] Test RPC communication

#### Step 3: statistic-service Logic (1h)
**File:** `services/statistic-service/src/services/statisticService.js`

```javascript
async getClinicUtilizationStatistics(startDate, endDate, roomIds, timeRange, shiftName = null) {
  const cacheKey = CacheUtils.generateKey('clinic-utilization', {
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    roomIds: roomIds?.join(','),
    timeRange,
    shiftName
  });
  
  return await CacheUtils.getOrSet(cacheKey, async () => {
    try {
      // Get slot stats from schedule-service
      const slotStats = await ServiceConnector.getSlotUtilizationStats(
        startDate, endDate, roomIds, timeRange, shiftName
      );
      
      if (!slotStats) {
        return this.getEmptyUtilizationStats();
      }
      
      // Get room details from room-service
      const rooms = await ServiceConnector.getRoomsByIds(roomIds);
      
      // Merge room info with stats
      const byRoom = slotStats.byRoom.map(stat => {
        const room = rooms.find(r => r._id.toString() === stat.roomId);
        return {
          ...stat,
          roomName: room?.name || 'Unknown',
          roomType: room?.roomType || 'Unknown'
        };
      });
      
      // Calculate timeline if date range > 1 day
      const timeline = this.generateTimeline(slotStats, timeRange);
      
      return {
        period: { startDate, endDate, timeRange },
        summary: slotStats.summary,
        byRoom,
        byShift: slotStats.byShift,
        timeline
      };
    } catch (error) {
      console.error('Clinic utilization error:', error);
      throw new Error('Không thể lấy thống kê hiệu suất');
    }
  }, 1800);
}

getEmptyUtilizationStats() {
  return {
    summary: { totalSlots: 0, bookedSlots: 0, emptySlots: 0, utilizationRate: 0 },
    byRoom: [],
    byShift: [],
    timeline: []
  };
}
```

- [ ] Add service method
- [ ] Implement timeline generation
- [ ] Add error handling

#### Step 4: Controller (30min)
**File:** `services/statistic-service/src/controllers/statistic.controller.js`

```javascript
async getClinicUtilizationStats(req, res) {
  try {
    const { startDate, endDate, roomIds, timeRange = 'month', shiftName } = req.query;
    
    const dateRange = DateUtils.parseDateRange(startDate, endDate, timeRange);
    const roomIdArray = roomIds ? (Array.isArray(roomIds) ? roomIds : roomIds.split(',')) : [];
    
    const stats = await statisticService.getClinicUtilizationStatistics(
      dateRange.startDate,
      dateRange.endDate,
      roomIdArray,
      timeRange,
      shiftName
    );
    
    res.json({
      success: true,
      message: 'Lấy thống kê hiệu suất phòng khám thành công',
      data: stats
    });
  } catch (error) {
    console.error('Clinic utilization stats error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Lỗi khi lấy thống kê hiệu suất'
    });
  }
}
```

- [ ] Add controller method
- [ ] Handle query parameters
- [ ] Add error responses

#### Step 5: Validation (15min)
**File:** `services/statistic-service/src/validations/statistic.validation.js`

```javascript
const clinicUtilizationValidation = [
  query('startDate')
    .optional()
    .isISO8601()
    .withMessage('startDate phải là ISO 8601 date'),
  query('endDate')
    .optional()
    .isISO8601()
    .withMessage('endDate phải là ISO 8601 date'),
  query('roomIds')
    .optional()
    .custom((value) => {
      if (typeof value === 'string') return true;
      if (Array.isArray(value)) return true;
      throw new Error('roomIds phải là string hoặc array');
    }),
  query('timeRange')
    .optional()
    .isIn(['day', 'month', 'quarter', 'year'])
    .withMessage('timeRange phải là day, month, quarter hoặc year'),
  query('shiftName')
    .optional()
    .isIn(['Ca Sáng', 'Ca Chiều', 'Ca Tối'])
    .withMessage('shiftName không hợp lệ')
];
```

- [ ] Add validation rules
- [ ] Export validation

#### Step 6: Route (15min)
**File:** `services/statistic-service/src/routes/statistic.routes.js`

```javascript
router.get('/clinic-utilization',
  requireAdminOrManager,
  clinicUtilizationValidation,
  validate,
  statisticController.getClinicUtilizationStats
);
```

- [ ] Add route
- [ ] Position after other stats routes
- [ ] Test route registration

#### Step 7: Frontend Integration (30min)
**File:** `SmileDental-FE-new/src/services/statisticsAPI.js`

```javascript
export const getClinicUtilizationStatistics = async (params = {}) => {
  try {
    const response = await axiosClient.get('/statistics/clinic-utilization', { params });
    return response.data;
  } catch (error) {
    console.error('Error fetching clinic utilization:', error);
    throw error;
  }
};
```

**File:** `SmileDental-FE-new/src/pages/Statistics/ClinicUtilizationStatistics.jsx`

```javascript
// Replace mock API call
const fetchStatistics = async (rooms = selectedRooms) => {
  setLoading(true);
  try {
    const params = {
      startDate: selectedDate.startOf(timeRange).format('YYYY-MM-DD'),
      endDate: selectedDate.endOf(timeRange).format('YYYY-MM-DD'),
      roomIds: rooms,
      timeRange,
      shiftName: selectedShift
    };
    
    const response = await getClinicUtilizationStatistics(params);
    if (response.success) {
      setData(response.data);
      message.success('Đã tải dữ liệu thống kê');
    }
  } catch (error) {
    message.error('Không thể tải dữ liệu thống kê');
  } finally {
    setLoading(false);
  }
};
```

- [ ] Add API function
- [ ] Update component to use real API
- [ ] Remove mock data
- [ ] Test end-to-end

---

## 🟡 Priority 2: Booking Channel Enhancements (2-3 hours)

### Add groupBy Support

#### Step 1: Update Controller
**File:** `statistic.controller.js`

```javascript
async getAppointmentStats(req, res) {
  const { startDate, endDate, dentistId, status, period, groupBy = 'day' } = req.query;
  // Add groupBy parameter
}
```

- [ ] Add groupBy parameter
- [ ] Pass to service

#### Step 2: Update Service
**File:** `statisticService.js`

```javascript
async getAppointmentStatistics(startDate, endDate, filters = {}, groupBy = 'day') {
  // Add groupBy logic
  // Group trends by specified period
}
```

- [ ] Add groupBy parameter
- [ ] Implement grouping logic

### Add Staff Breakdown

#### Step 3: Update appointment-service RPC
**File:** `appointment-service RPC handler`

```javascript
case 'getStatistics': {
  // Add staff breakdown
  const byStaff = await Appointment.aggregate([
    { $match: { bookingChannel: 'offline' } },
    { $group: {
      _id: '$createdBy',
      count: { $sum: 1 }
    }}
  ]);
  
  response.data.byStaff = byStaff;
  break;
}
```

- [ ] Add staff aggregation
- [ ] Include in response

---

## 🟢 Priority 3: Revenue Stats Filters (1-2 hours)

### Add dentist/service filters

#### Step 1: Update Controller
```javascript
async getRevenueStats(req, res) {
  const { startDate, endDate, groupBy, compareWithPrevious, period, dentistId, serviceId } = req.query;
  
  const filters = {};
  if (dentistId) filters.dentistId = dentistId;
  if (serviceId) filters.serviceId = serviceId;
  
  const stats = await statisticService.getRevenueStatistics(
    dateRange.startDate,
    dateRange.endDate,
    groupBy,
    filters  // Pass filters
  );
}
```

- [ ] Accept filter parameters
- [ ] Pass to service

#### Step 2: Update Service
```javascript
async getRevenueStatistics(startDate, endDate, groupBy = 'day', filters = {}) {
  const revenueStats = await ServiceConnector.getRevenueStats(
    startDate, endDate, groupBy, filters
  );
}
```

- [ ] Accept filters parameter
- [ ] Pass to connector

#### Step 3: Update invoice-service RPC
```javascript
case 'getRevenueStatistics': {
  const { startDate, endDate, groupBy, dentistId, serviceId } = payload;
  
  const query = { createdAt: { $gte: startDate, $lte: endDate } };
  if (dentistId) query.dentistId = dentistId;
  if (serviceId) query['services.serviceId'] = serviceId;
  
  // Continue with aggregation...
}
```

- [ ] Handle filter parameters
- [ ] Apply to query

---

## 🧪 Testing Checklist

### Clinic Utilization
- [ ] Test with single room
- [ ] Test with multiple rooms
- [ ] Test with different time ranges
- [ ] Test with shift filter
- [ ] Test with no data
- [ ] Test with empty rooms
- [ ] Verify calculations accuracy
- [ ] Test performance with large date range

### Booking Channel
- [ ] Test groupBy=day
- [ ] Test groupBy=month
- [ ] Test groupBy=quarter
- [ ] Test groupBy=year
- [ ] Verify staff breakdown
- [ ] Test channel percentages

### Revenue Stats
- [ ] Test dentist filter
- [ ] Test service filter
- [ ] Test combined filters
- [ ] Verify calculations

---

## 📝 Documentation

- [ ] Update API documentation
- [ ] Add Postman collection
- [ ] Update CHANGELOG
- [ ] Add code comments
- [ ] Update README

---

## 🚀 Deployment

- [ ] Run tests
- [ ] Code review
- [ ] Staging deployment
- [ ] Production deployment
- [ ] Monitor logs
- [ ] Verify frontend integration

---

**Status:** Ready to implement  
**Est. Total Time:** 7-11 hours  
**Target Completion:** 1-2 days
