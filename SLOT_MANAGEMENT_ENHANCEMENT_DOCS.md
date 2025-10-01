# Slot Management API - Enhanced Version

## Tóm tắt cập nhật

Đã cải tiến hệ thống quản lý nhân sự với các tính năng mới:

### ✅ Validation thời gian theo giờ Việt Nam
- **Chặn quý/năm quá khứ**: Không được phân công cho quý đã qua
- **Chỉ cập nhật slot tương lai**: Tự động lọc slot có startTime > hiện tại (VN timezone)
- **Thông báo lỗi rõ ràng**: Cải thiện message khi không tìm thấy schedule/slot

### ✅ API mới 
1. `GET /api/slots/available-quarters` - Lấy danh sách quý/năm phù hợp
2. `GET /api/slots/available-shifts` - Lấy danh sách ca làm việc

### ✅ Cập nhật API hiện tại  
- `POST /api/slots/assign-staff` - Thêm validation quý/năm + lọc slot tương lai + logic subRoom thông minh
- `POST /api/slots/reassign-staff` - Tương tự assign-staff + phân biệt rõ ràng phòng có/không có subRoom
- `PATCH /api/slots/staff` - Thêm kiểm tra thời gian slot + validation slots cùng room/subRoom

---

## API Documentation

### 1. GET /api/slots/available-quarters
**Mục đích**: Lấy danh sách quý/năm đã có lịch để phân công nhân sự

**Response**:
```json
{
  "success": true,
  "data": {
    "currentQuarter": {
      "quarter": 4,
      "year": 2025,
      "currentDate": "2025-10-01T03:00:00.000Z"
    },
    "availableOptions": [
      {
        "quarter": 4,
        "year": 2025,
        "label": "Quý 4/2025 (Hiện tại)",
        "isCurrent": true,
        "hasSchedules": true,
        "isCreated": true
      },
      {
        "quarter": 1,
        "year": 2026,
        "label": "Quý 1/2026",
        "isCurrent": false,
        "hasSchedules": true,
        "isCreated": true
      }
    ]
  }
}
```

**Đặc điểm**:
- Sử dụng logic từ `scheduleService.getAvailableQuarters()`
- Chỉ trả về quý có `hasSchedules: true` hoặc `isCreated: true`
- Tự động lọc ra những quý chưa tạo lịch
- Đảm bảo không thể phân công nhân sự cho quý không có lịch

### 2. GET /api/slots/available-shifts
**Mục đích**: Lấy danh sách ca làm việc từ ScheduleConfig

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "value": "Ca Sáng",
      "label": "Ca Sáng", 
      "timeRange": "07:00 - 11:30"
    },
    {
      "value": "Ca Chiều",
      "label": "Ca Chiều",
      "timeRange": "13:30 - 17:30"
    },
    {
      "value": "Ca Tối", 
      "label": "Ca Tối",
      "timeRange": "18:00 - 21:00"
    }
  ]
}
```

**Lưu ý**: 
- Dữ liệu lấy từ `ScheduleConfig.getSingleton()`
- Chỉ trả về shifts có `isActive: true`
- Thời gian là `startTime - endTime` từ config thực tế

### 3. POST /api/slots/assign-staff (Enhanced)
**Thay đổi**:
- ✅ Validation: quarter/year không được ở quá khứ
- ✅ Filter: chỉ chọn slot có startTime > hiện tại (VN timezone)
- ✅ Error messages: rõ ràng hơn

**Request Body**:
```json
{
  "roomId": "64f0c3a1e8a1b23c4d5e6f70",
  "quarter": 4,
  "year": 2025,
  "shifts": ["Ca Sáng", "Ca Chiều"],
  "dentistIds": ["68d9f8bab5a75931c6cd0d7d"],
  "nurseIds": ["68d9f8bab5a75931c6cd0a11"]
}
```

**Error Cases**:
```json
// Quý trong quá khứ
{
  "success": false,
  "message": "Không thể cập nhật quý 2/2025 vì đã thuộc quá khứ. Quý hiện tại là 4/2025"
}

// Không có schedule
{
  "success": false, 
  "message": "Không tìm thấy lịch làm việc nào cho phòng trong quý 1/2026. Vui lòng tạo lịch làm việc trước khi phân công nhân sự."
}

// Tất cả slot đã được phân công
{
  "success": false,
  "message": "Tất cả slot trong quý 4/2025 đã được phân công nhân sự. Sử dụng API reassign-staff để thay đổi nhân sự."
}

// Không match yêu cầu
{
  "success": false,
  "message": "Không tìm thấy slot phù hợp trong quý 4/2025. Có 15 slot chưa có nhân sự nhưng không match với yêu cầu."
}
```

**Response Success**:
```json
{
  "success": true,
  "data": {
    "message": "Phân công nhân sự thành công cho 12 slot chưa được phân công trước đó",
    "slotsUpdated": 12,
    "shifts": ["Ca Sáng", "Ca Chiều"],
    "dentistAssigned": "68d9f8bab5a75931c6cd0d7d",
    "nurseAssigned": "68d9f8bab5a75931c6cd0a11"
  }
}
```

### 4. POST /api/slots/reassign-staff (Enhanced)
**Thay đổi**: Tương tự assign-staff, nhưng chỉ làm việc với slot đã có nhân sự

**Request Body**: Giống assign-staff

**Response Success**:
```json
{
  "success": true,
  "data": {
    "message": "Đã phân công lại thành công 8 slot",
    "updatedCount": 8,
    "quarter": 4,
    "year": 2025,
    "shifts": "Ca Sáng, Ca Chiều",
    "dentistAssigned": "68d9f8bab5a75931c6cd0d7d",
    "nurseAssigned": "68d9f8bab5a75931c6cd0a11"
  }
}
```

**Error Cases**: Tương tự assign-staff + thông báo riêng cho reassign

### 5. PATCH /api/slots/staff (Enhanced)  
**Thay đổi**:
- ✅ Validation: slot phải có startTime > hiện tại (VN timezone)
- ✅ Error message: hiển thị thời gian cụ thể

**Request Body**:
```json
{
  "slotIds": ["650f0b1a2c3d4e5f67890123", "650f0b1a2c3d4e5f67890124"],
  "dentistId": "68d9f8bab5a75931c6cd0d7d"
}
```

**Error Cases**:
```json
// Slot đã qua thời điểm hiện tại
{
  "success": false,
  "message": "Slot 650f0b1a2c3d4e5f67890123 đã qua thời điểm hiện tại (01/10/2025 08:30:00), không thể cập nhật"
}

// Slot chưa được phân công nhân sự
{
  "success": false,
  "message": "Slot 650f0b1a2c3d4e5f67890123 chưa được phân công nhân sự, không thể cập nhật. Vui lòng sử dụng API phân công thay thế."
}
```

---

## Quy tắc validation

### 1. Thời gian (Vietnam Timezone)
- **Quý/năm**: Không được chọn quý đã qua
- **Slot**: Chỉ cập nhật slot có startTime > hiện tại
- **Timezone**: Tất cả so sánh theo giờ Việt Nam (UTC+7)

### 2. Schedule/Slot availability
- **Schedule**: Phải tồn tại schedule trong quý mới phân công được
- **Slot status**: 
  - assign: slot chưa có dentist/nurse
  - reassign: slot đã có dentist hoặc nurse  
  - update: slot đã có staff (có thể đã được book)

### 3. SubRoom Logic 🆕
- **Phòng có subRoom**: Bắt buộc phải gửi `subRoomId` cụ thể
- **Phòng không có subRoom**: Không được gửi `subRoomId` (để null/undefined)
- **Validation**: subRoomId phải thuộc về roomId đã chỉ định
- **Update slots**: Tất cả slots phải cùng room và cùng subRoom

**Error Examples**:
```json
// Phòng không có subRoom nhưng gửi subRoomId
{
  "success": false,
  "message": "Phòng \"Khoa Nhi\" không có subroom nhưng bạn đã chỉ định subRoomId. Vui lòng bỏ subRoomId hoặc chọn phòng khác."
}

// Phòng có subRoom nhưng không chỉ định
{
  "success": false, 
  "message": "Phòng \"Khoa Nội\" có 3 subroom. Vui lòng chỉ định subRoomId cụ thể: 64f...123 (Khu A), 64f...124 (Khu B), 64f...125 (Khu C)"
}

// SubRoom không thuộc phòng
{
  "success": false,
  "message": "SubRoom không thuộc về phòng \"Khoa Ngoại\". Vui lòng kiểm tra lại subRoomId."
}
```

### 4. Quyền hạn
- **Manager/Admin**: Mới được phân công/cập nhật nhân sự
- **Authentication**: Cần token hợp lệ trong header

---

## Test Cases

### Workflow cơ bản:
1. **Lấy options**: `GET /available-quarters` và `GET /available-shifts`
2. **Chọn phù hợp**: Chọn quarter >= hiện tại, shifts phù hợp
3. **Phân công**: `POST /assign-staff` với data hợp lệ
4. **Điều chỉnh**: `POST /reassign-staff` hoặc `PATCH /staff` nếu cần

### Edge cases nên test:
- ❌ Chọn quarter quá khứ → Error validation
- ❌ Quarter không có schedule → Error message rõ ràng  
- ❌ Slot đã qua giờ → Error với thời gian cụ thể
- ❌ Slot chưa có staff → Error yêu cầu dùng assign API
- ❌ Token không có quyền → 403 Forbidden
- ✅ Quarter hiện tại, có schedule → Success

### Sample cURL:
```bash
# Lấy danh sách quý
curl -X GET "http://localhost:3002/api/slots/available-quarters" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Phân công nhân sự
curl -X POST "http://localhost:3002/api/slots/assign-staff" \
  -H "Authorization: Bearer YOUR_MANAGER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "roomId": "64f0c3a1e8a1b23c4d5e6f70",
    "quarter": 4,
    "year": 2025, 
    "shifts": ["Ca Sáng"],
    "dentistIds": ["68d9f8bab5a75931c6cd0d7d"],
    "nurseIds": []
  }'
```

---

## Lưu ý triển khai

### 1. Database
- Slot startTime lưu dưới dạng UTC Date
- So sánh với Vietnam time qua util function

### 2. Performance  
- Cache quarters/shifts (ít thay đổi)
- Index slot.startTime cho query nhanh

### 3. Monitoring
- Log failed assignments (past quarter/missing schedule)
- Track slot update attempts on past slots

### 4. Future enhancements
- Bulk validation trước khi assign
- Schedule auto-creation cho quarter mới
- Notification khi slot sắp hết hạn update