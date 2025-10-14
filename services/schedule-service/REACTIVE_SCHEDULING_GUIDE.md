# Reactive Scheduling Implementation Guide

## Tổng quan

Tính năng cho phép:
1. **Lưu snapshot subroom isActive** khi tạo lịch (giống shift config)
2. **API Edit Schedule**: Cho phép edit schedule đã qua, toggle isActive schedule
3. **Reactive Scheduling**: Kích hoạt lại ca/subroom đã tắt khi tạo lịch

## 1. Database Schema Updates

### Schedule Model - DONE ✅
```javascript
subRoomSnapshot: [{
  subRoomId: { type: mongoose.Schema.Types.ObjectId, required: true },
  name: { type: String, required: true },
  isActive: { type: Boolean, default: true },
  isGenerated: { type: Boolean, default: false }
}]
```

## 2. Backend API Changes

### A. Lưu subRoom snapshot khi tạo lịch

**File**: `schedule.service.js` - `generateRoomSchedule()`

**Thêm logic:**
```javascript
// Lấy thông tin subrooms từ room-service
const roomDetails = await getRoomDetails(roomId);

if (roomDetails.hasSubRooms && selectedSubRoomIds && selectedSubRoomIds.length > 0) {
  // Tạo snapshot cho TẤT CẢ subrooms (kể cả không chọn)
  subRoomSnapshot = roomDetails.subRooms.map(sr => ({
    subRoomId: sr._id,
    name: sr.name,
    isActive: sr.isActive,
    isGenerated: selectedSubRoomIds.includes(sr._id.toString())
  }));
}

// Lưu vào schedule
const schedule = new Schedule({
  // ... existing fields
  subRoomSnapshot: subRoomSnapshot
});
```

### B. API Edit Schedule

**File**: `schedule.controller.js`

**Endpoint mới:**
```javascript
// PUT /schedules/:scheduleId
exports.updateSchedule = async (req, res) => {
  try {
    const { scheduleId } = req.params;
    const { 
      isActive, 
      reactivateShifts,  // ['morning', 'afternoon'] - ca muốn kích hoạt
      reactivateSubRooms // ['subRoomId1', 'subRoomId2'] - buồng muốn kích hoạt
    } = req.body;
    
    const schedule = await Schedule.findById(scheduleId);
    if (!schedule) {
      return res.status(404).json({ success: false, message: 'Schedule not found' });
    }
    
    // 1. Update isActive của schedule
    if (typeof isActive === 'boolean') {
      schedule.isActive = isActive;
      
      if (!isActive) {
        // CẢNH BÁO: Tắt schedule sẽ ẩn lịch khỏi bệnh nhân
        console.warn(`⚠️ DANGEROUS: Schedule ${scheduleId} isActive set to false. Hidden from patients!`);
      }
    }
    
    // 2. Reactivate shifts (chỉ cho phép false → true)
    if (reactivateShifts && Array.isArray(reactivateShifts)) {
      reactivateShifts.forEach(shiftKey => {
        if (schedule.shiftConfig[shiftKey]) {
          const currentValue = schedule.shiftConfig[shiftKey].isActive;
          
          if (currentValue === false) {
            // ✅ Cho phép: false → true (kích hoạt lại)
            schedule.shiftConfig[shiftKey].isActive = true;
            console.log(`✅ Reactivated shift: ${shiftKey}`);
          } else {
            // ❌ KHÔNG cho phép: true → false (tắt ca đã bật)
            console.warn(`❌ Cannot deactivate shift: ${shiftKey} (already active)`);
          }
        }
      });
    }
    
    // 3. Reactivate subRooms (chỉ cho phép false → true)
    if (reactivateSubRooms && Array.isArray(reactivateSubRooms)) {
      if (schedule.subRoomSnapshot && schedule.subRoomSnapshot.length > 0) {
        schedule.subRoomSnapshot.forEach(sr => {
          if (reactivateSubRooms.includes(sr.subRoomId.toString())) {
            const currentValue = sr.isActive;
            
            if (currentValue === false) {
              // ✅ Cho phép: false → true (kích hoạt lại)
              sr.isActive = true;
              console.log(`✅ Reactivated subRoom: ${sr.name}`);
            } else {
              // ❌ KHÔNG cho phép: true → false
              console.warn(`❌ Cannot deactivate subRoom: ${sr.name} (already active)`);
            }
          }
        });
      }
    }
    
    await schedule.save();
    
    return res.status(200).json({
      success: true,
      message: 'Schedule updated successfully',
      data: schedule
    });
    
  } catch (error) {
    console.error('Error updating schedule:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};
```

**Route:**
```javascript
router.put('/schedules/:scheduleId', updateSchedule);
```

### C. Detect Missing SubRooms

**File**: `schedule.service.js` - `getRoomSchedulesWithShifts()`

**Thêm logic:**
```javascript
// Lấy danh sách subrooms hiện tại từ room-service
const currentRoom = await getRoomDetails(roomId);

schedules.forEach(schedule => {
  // ... existing shift detection logic
  
  // 🆕 Detect missing subrooms
  if (schedule.subRoomSnapshot && currentRoom.hasSubRooms) {
    const generatedSubRoomIds = schedule.subRoomSnapshot
      .filter(sr => sr.isGenerated)
      .map(sr => sr.subRoomId.toString());
    
    const allCurrentSubRoomIds = currentRoom.subRooms.map(sr => sr._id.toString());
    
    const missingSubRoomIds = allCurrentSubRoomIds.filter(
      id => !generatedSubRoomIds.includes(id)
    );
    
    if (missingSubRoomIds.length > 0) {
      schedule.hasMissingSubRooms = true;
      schedule.missingSubRooms = currentRoom.subRooms
        .filter(sr => missingSubRoomIds.includes(sr._id.toString()))
        .map(sr => ({
          subRoomId: sr._id,
          name: sr.name,
          isActive: sr.isActive
        }));
    } else {
      schedule.hasMissingSubRooms = false;
      schedule.missingSubRooms = [];
    }
  }
});
```

## 3. Frontend Changes

### A. Edit Schedule Modal Component

**File**: `EditScheduleModal.jsx` (NEW)

```jsx
const EditScheduleModal = ({ schedule, onClose, onSuccess }) => {
  const [isActive, setIsActive] = useState(schedule.isActive);
  const [reactivateShifts, setReactivateShifts] = useState([]);
  const [reactivateSubRooms, setReactivateSubRooms] = useState([]);
  
  const handleSubmit = async () => {
    try {
      await scheduleService.updateSchedule(schedule.scheduleId, {
        isActive,
        reactivateShifts,
        reactivateSubRooms
      });
      
      toast.success('Cập nhật lịch thành công!');
      onSuccess();
    } catch (error) {
      toast.error('Lỗi: ' + error.message);
    }
  };
  
  return (
    <Modal title="Chỉnh sửa lịch" open onOk={handleSubmit} onCancel={onClose}>
      {/* Toggle isActive */}
      <Alert type="warning" message="Cảnh báo nguy hiểm" 
        description="Tắt lịch sẽ ẩn lịch khỏi bệnh nhân!" />
      <Switch 
        checked={isActive} 
        onChange={setIsActive}
        checkedChildren="Hiển thị"
        unCheckedChildren="Ẩn"
      />
      
      {/* Reactivate Shifts */}
      {schedule.shiftConfig && (
        <div>
          <Text strong>Kích hoạt lại ca đã tắt:</Text>
          {['morning', 'afternoon', 'evening'].map(key => {
            const shift = schedule.shiftConfig[key];
            if (!shift.isActive && !shift.isGenerated) {
              return (
                <Checkbox 
                  value={key}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setReactivateShifts([...reactivateShifts, key]);
                    } else {
                      setReactivateShifts(reactivateShifts.filter(k => k !== key));
                    }
                  }}
                >
                  {shift.name} (Đã tắt, chưa tạo)
                </Checkbox>
              );
            }
          })}
        </div>
      )}
      
      {/* Reactivate SubRooms */}
      {schedule.subRoomSnapshot && (
        <div>
          <Text strong>Kích hoạt lại buồng đã tắt:</Text>
          {schedule.subRoomSnapshot.map(sr => {
            if (!sr.isActive && !sr.isGenerated) {
              return (
                <Checkbox 
                  value={sr.subRoomId}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setReactivateSubRooms([...reactivateSubRooms, sr.subRoomId]);
                    } else {
                      setReactivateSubRooms(reactivateSubRooms.filter(id => id !== sr.subRoomId));
                    }
                  }}
                >
                  {sr.name} (Đã tắt, chưa tạo)
                </Checkbox>
              );
            }
          })}
        </div>
      )}
    </Modal>
  );
};
```

### B. Update Schedule List Modal

**File**: `CreateScheduleForRoom.jsx`

**Thêm button Edit:**
```jsx
<List.Item
  actions={[
    <Button icon={<EditOutlined />} onClick={() => setEditingSchedule(schedule)}>
      Chỉnh sửa
    </Button>,
    // ... existing buttons
  ]}
>
```

## 4. Testing Checklist

### Backend Tests
- [ ] SubRoom snapshot được lưu khi tạo lịch
- [ ] API update schedule: toggle isActive
- [ ] API update schedule: reactivate shifts (false → true only)
- [ ] API update schedule: reactivate subRooms (false → true only)
- [ ] Detect missing subRooms correctly
- [ ] Không cho phép deactivate (true → false)

### Frontend Tests
- [ ] Modal edit hiển thị đúng
- [ ] Checkbox reactivate shifts
- [ ] Checkbox reactivate subRooms
- [ ] Toggle isActive với cảnh báo
- [ ] Submit và refresh data

## 5. Security & Validation

### Backend Validation
```javascript
// Chỉ admin mới được edit schedule
if (req.user.role !== 'ADMIN') {
  return res.status(403).json({ message: 'Forbidden' });
}

// Validate reactivateShifts
if (reactivateShifts) {
  const validShifts = ['morning', 'afternoon', 'evening'];
  const invalidShifts = reactivateShifts.filter(s => !validShifts.includes(s));
  if (invalidShifts.length > 0) {
    return res.status(400).json({ message: 'Invalid shift keys' });
  }
}

// Validate reactivateSubRooms
if (reactivateSubRooms) {
  for (const id of reactivateSubRooms) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid subRoom ID' });
    }
  }
}
```

## 6. Migration Script (Optional)

**File**: `migrations/add-subroom-snapshot.js`

```javascript
// Thêm subRoomSnapshot cho các schedule cũ
const schedules = await Schedule.find({ subRoomId: { $ne: null } });

for (const schedule of schedules) {
  const room = await getRoomDetails(schedule.roomId);
  
  if (room.hasSubRooms && !schedule.subRoomSnapshot) {
    schedule.subRoomSnapshot = room.subRooms.map(sr => ({
      subRoomId: sr._id,
      name: sr.name,
      isActive: sr.isActive,
      isGenerated: sr._id.toString() === schedule.subRoomId.toString()
    }));
    
    await schedule.save();
  }
}
```

## 7. API Documentation

### PUT /api/schedules/:scheduleId

**Request:**
```json
{
  "isActive": true,
  "reactivateShifts": ["morning", "evening"],
  "reactivateSubRooms": ["subRoomId1", "subRoomId2"]
}
```

**Response:**
```json
{
  "success": true,
  "message": "Schedule updated successfully",
  "data": {
    "_id": "scheduleId",
    "isActive": true,
    "shiftConfig": {
      "morning": { "isActive": true, "isGenerated": false },
      "afternoon": { "isActive": false, "isGenerated": true },
      "evening": { "isActive": true, "isGenerated": false }
    },
    "subRoomSnapshot": [
      { "subRoomId": "id1", "name": "Buồng 1", "isActive": true, "isGenerated": false },
      { "subRoomId": "id2", "name": "Buồng 2", "isActive": true, "isGenerated": true }
    ]
  }
}
```

## 8. Business Logic Rules

### Reactive Scheduling Rules
1. ✅ **Allowed**: `isActive: false → true` (Kích hoạt lại)
2. ❌ **Not Allowed**: `isActive: true → false` (Tắt đã bật)
3. ✅ **Allowed**: Kích hoạt lại shift/subroom **CHƯA tạo lịch** (`isGenerated: false`)
4. ❌ **Not Allowed**: Sửa shift/subroom **ĐÃ tạo lịch** (`isGenerated: true`)

### Use Cases
- **UC1**: Admin tắt Ca Sáng, sau đó muốn tạo lại → Reactivate shift morning
- **UC2**: Admin thêm Buồng 3 mới, muốn tạo cho lịch cũ → Buồng 3 tự động appear trong missingSubRooms
- **UC3**: Schedule đã quá hạn nhưng admin vẫn muốn sửa → API cho phép (không check expired)

## Implementation Priority

1. **HIGH**: Lưu subRoom snapshot (Backend)
2. **HIGH**: Detect missing subrooms (Backend)
3. **MEDIUM**: API Edit Schedule (Backend)
4. **MEDIUM**: Frontend Edit Modal
5. **LOW**: Migration script
6. **LOW**: RabbitMQ events
