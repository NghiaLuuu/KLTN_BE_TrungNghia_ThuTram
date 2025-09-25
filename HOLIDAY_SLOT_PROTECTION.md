# Holiday Management với Slot Protection

## Tổng quan
Hệ thống quản lý ngày nghỉ với logic bảo vệ slots đã được sử dụng. Khi tạo/cập nhật holiday, hệ thống sẽ kiểm tra và xử lý slots một cách thông minh.

## Logic xử lý Holiday

### 🔍 **Khi tạo Holiday mới**

#### Bước 1: Kiểm tra slots đã được sử dụng
```javascript
// Tìm slots trong khoảng thời gian có appointmentId != null
const usedSlots = await Slot.find({
  startTime: { $gte: startDate, $lte: endDate },
  appointmentId: { $ne: null }
});
```

#### Bước 2: Xử lý theo trạng thái
- **✅ Nếu KHÔNG có slots được sử dụng:**
  - Tạo holiday thành công
  - Ẩn tất cả slots trong khoảng thời gian (`isActive: false`)
  - Log số lượng slots đã ẩn

- **❌ Nếu CÓ slots được sử dụng:**
  - **TỪCHỐI tạo holiday**
  - Trả về lỗi chi tiết với danh sách ngày có cuộc hẹn
  - Không thay đổi gì trong database

### 🔄 **Khi cập nhật Holiday**

#### Trường hợp 1: Chỉ thay đổi tên/ghi chú
- Không ảnh hưởng đến slots
- Cập nhật thông tin holiday bình thường

#### Trường hợp 2: Thay đổi ngày tháng
1. **Hiện lại slots** trong khoảng thời gian cũ
2. **Kiểm tra slots** trong khoảng thời gian mới
3. **Nếu có slots được sử dụng trong ngày mới:**
   - Rollback: Ẩn lại slots trong khoảng cũ
   - Từ chối cập nhật với lỗi chi tiết
4. **Nếu không có slots được sử dụng:**
   - Ẩn slots trong khoảng thời gian mới
   - Cập nhật holiday thành công

### 🗑️ **Khi xóa Holiday**
- Tìm holiday theo ID
- Lưu lại thông tin ngày tháng trước khi xóa
- Xóa holiday
- **Hiện lại tất cả slots** trong khoảng thời gian (`isActive: true`)

## API Response Format

### ✅ **Success Response**
```json
{
  "success": true,
  "message": "Ngày nghỉ đã được thêm thành công",
  "data": {
    "_id": "...",
    "holidays": [...]
  }
}
```

### ❌ **Error Response - Slots đã được sử dụng**
```json
{
  "success": false,
  "message": "Không thể tạo ngày nghỉ vì có 5 lịch đã được sử dụng trong các ngày: 2024-01-15, 2024-01-16. Vui lòng hủy các cuộc hẹn trước khi tạo ngày nghỉ.",
  "type": "SLOTS_IN_USE"
}
```

### ❌ **Error Response - Validation**
```json
{
  "success": false,
  "message": "Holiday name already exists: Tết Nguyên Đán",
  "type": "VALIDATION_ERROR"
}
```

## Database Operations

### Slot Model Structure
```javascript
{
  startTime: Date,        // Thời gian bắt đầu (UTC)
  endTime: Date,          // Thời gian kết thúc (UTC)
  appointmentId: ObjectId, // null = chưa đặt, != null = đã đặt
  isActive: Boolean       // true = hiện, false = ẩn
}
```

### Hide Slots Operation
```javascript
await Slot.updateMany(
  {
    startTime: { $gte: startVN, $lte: endVN },
    appointmentId: null // Chỉ ẩn slots chưa sử dụng
  },
  { $set: { isActive: false } }
);
```

### Show Slots Operation
```javascript
await Slot.updateMany(
  {
    startTime: { $gte: startVN, $lte: endVN }
  },
  { $set: { isActive: true } }
);
```

## Timezone Handling

### Vietnam Timezone Conversion
```javascript
const startVN = new Date(startDate.toLocaleString("en-US", {timeZone: "Asia/Ho_Chi_Minh"}));
startVN.setHours(0, 0, 0, 0);    // Bắt đầu ngày
const endVN = new Date(endDate.toLocaleString("en-US", {timeZone: "Asia/Ho_Chi_Minh"}));
endVN.setHours(23, 59, 59, 999); // Kết thúc ngày
```

## Logging

### Console Logs chi tiết
```javascript
// Khi tạo holiday
console.log(`🔍 Kiểm tra slots đã được sử dụng trong khoảng 2024-01-15 - 2024-01-20`);
console.log(`✅ Đã tạo ngày nghỉ "Tết Nguyên Đán" và ẩn 150 slots`);

// Khi cập nhật holiday
console.log(`📅 Ngày nghỉ "Tết" thay đổi từ 2024-01-15-2024-01-20 sang 2024-01-16-2024-01-21`);
console.log(`🔓 Đã hiện lại 50 slots từ khoảng thời gian cũ`);
console.log(`🔒 Đã ẩn 75 slots trong khoảng thời gian mới`);

// Khi xóa holiday
console.log(`✅ Đã xóa ngày nghỉ "Tết Nguyên Đán" và hiện lại 150 slots`);
```

## Error Handling

### Các loại lỗi được xử lý
1. **SLOTS_IN_USE**: Có slots đã được đặt lịch
2. **VALIDATION_ERROR**: Lỗi validate dữ liệu đầu vào
3. **OVERLAP_ERROR**: Trùng lặp với holiday khác
4. **DATABASE_ERROR**: Lỗi thao tác database

### Safety Measures
- **Rollback operations**: Nếu update fails, tự động rollback changes
- **Transaction-like behavior**: Đảm bảo tính nhất quán dữ liệu
- **Detailed error messages**: Thông báo lỗi chi tiết cho user
- **Fallback handling**: Xử lý graceful khi có lỗi unexpected

## Use Cases

### Scenario 1: Tạo holiday thành công
```
Input: Tết Nguyên Đán (2024-01-15 → 2024-01-20)
Check: Không có slots nào được đặt
Result: ✅ Tạo holiday + ẩn 120 slots
```

### Scenario 2: Tạo holiday thất bại
```
Input: Nghỉ Lễ (2024-02-10 → 2024-02-12)
Check: Có 3 cuộc hẹn đã đặt vào 2024-02-11
Result: ❌ Từ chối + thông báo cụ thể
```

### Scenario 3: Update holiday thành công
```
Input: Thay đổi từ 15-20/01 → 16-21/01
Check: Ngày mới không có cuộc hẹn
Result: ✅ Hiện slots cũ + ẩn slots mới
```

### Scenario 4: Update holiday thất bại
```
Input: Thay đổi từ 15-20/01 → 10-25/01
Check: Ngày 22-25/01 có cuộc hẹn
Result: ❌ Rollback + từ chối update
```