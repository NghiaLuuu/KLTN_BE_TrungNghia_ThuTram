# Hệ thống Tự động Sinh Lịch (Auto-Schedule System)

## Tổng quan
Hệ thống tự động sinh lịch theo quý với **cấu hình bật/tắt đơn giản**. Khi **BẬT** thì tự động kiểm tra vào cuối tháng và sinh lịch cho quý tiếp theo. Khi **TẮT** thì tắt hoàn toàn.

## Tính năng chính

### 1. **Cấu hình đơn giản** 
- **1 nút BẬT/TẮT** duy nhất cho toàn bộ hệ thống
- **Không có cấu hình phức tạp** - đơn giản và dễ sử dụng
- **Thống kê** về số lần chạy và kết quả

### 2. **Khi BẬT - Tự động hoàn toàn**
- ✅ **Kiểm tra cuối tháng**: 23:59 ngày 28-31 → sinh lịch mới
- ✅ **Theo dõi hàng ngày**: 0:00 hàng ngày → thông báo trạng thái  
- ✅ **Backup đầu quý**: Ngày 1 tháng 1,4,7,10 → đảm bảo không miss

### 3. **Khi TẮT - Hoàn toàn thủ công**
- ❌ **Không tự động sinh lịch** - tất cả phải làm thủ công
- ❌ **Không theo dõi** - không có thông báo gì
- ✅ **Vẫn có thể trigger thủ công** qua API

### 4. API Endpoints

#### **Cấu hình đơn giản**
```
GET /api/auto-schedule/config
- Xem cấu hình hiện tại (bật/tắt + thống kê)
- Requires: Authentication
```

```
PATCH /api/auto-schedule/config
- Bật/tắt hệ thống auto-schedule
- Requires: Authentication
- Body: { enabled: true/false }
```

```
PATCH /api/auto-schedule/toggle  
- Tương tự như trên (alias)
- Body: { enabled: true/false }
```

#### Manual Triggers
```
POST /api/auto-schedule/generate
- Kích hoạt sinh lịch thủ công cho tất cả phòng
- Requires: Authentication
```

```
POST /api/auto-schedule/generate/:roomId
- Kích hoạt sinh lịch thủ công cho phòng cụ thể
- Params: roomId
- Requires: Authentication
```

#### Status Monitoring
```
GET /api/auto-schedule/status/:roomId
- Kiểm tra trạng thái quý cho phòng cụ thể
- Params: roomId
- Requires: Authentication
```

```
GET /api/auto-schedule/check
- Kiểm tra xem có nên chạy auto-generation không
- Public endpoint for monitoring
```

```
GET /api/auto-schedule/cron-info
- Xem thông tin về cron job schedules
- Public endpoint
```

## Cấu hình Auto-Schedule

### Model: AutoScheduleConfig (Đơn giản)
```javascript
{
  _id: 'global_auto_schedule_config', // Fixed ID
  enabled: true,                      // CHỈ CÓ 1 TRƯỜNG BẬT/TẮT
  stats: {
    lastAutoRun: Date,               // Lần chạy cuối cùng
    totalAutoRuns: Number,           // Tổng số lần chạy
    lastSuccessfulRun: Date,         // Lần chạy thành công cuối
    lastFailedRun: Date              // Lần chạy thất bại cuối
  },
  lastModifiedBy: String,            // Ai thay đổi cuối cùng
  createdAt: Date,
  updatedAt: Date
}
```

### Cách hoạt động đơn giản

**BẬT (enabled: true)**:
1. ✅ Cron job cuối tháng chạy → sinh lịch tự động
2. ✅ Cron job hàng ngày chạy → theo dõi và thông báo
3. ✅ Cron job đầu quý chạy → backup check

**TẮT (enabled: false)**:
1. ❌ Tất cả cron jobs bỏ qua
2. ❌ Không sinh lịch tự động
3. ✅ Vẫn có thể trigger manual qua API

### Logic sinh lịch theo quý
1. **Kiểm tra quý hiện tại**: Xác định quý dựa trên tháng hiện tại
2. **Kiểm tra tính đầy đủ**: Kiểm tra xem tất cả tháng trong quý đã có lịch chưa
3. **Sinh lịch quý tiếp theo**: Nếu quý hiện tại hoàn thành, tự động sinh quý tiếp theo

### Cron Job Schedule
- **End of Month**: `59 23 28-31 * *` - Cuối tháng
- **Daily Check**: `0 0 * * *` - Hàng ngày
- **Start of Quarter**: `0 0 1 1,4,7,10 *` - Đầu quý

### Timezone
- Sử dụng timezone Asia/Ho_Chi_Minh
- Tất cả thời gian được tính theo giờ Việt Nam

## Response Format

### Success Response
```json
{
  "success": true,
  "message": "Auto-generation completed successfully",
  "data": {
    "totalRooms": 5,
    "successful": 4,
    "failed": 1,
    "results": [...]
  }
}
```

### Quarter Status Response
```json
{
  "success": true,
  "data": {
    "currentQuarter": 1,
    "year": 2024,
    "isComplete": false,
    "monthsStatus": {
      "1": { "hasSchedule": true, "monthName": "January" },
      "2": { "hasSchedule": false, "monthName": "February" },
      "3": { "hasSchedule": false, "monthName": "March" }
    },
    "missingMonths": [2, 3],
    "shouldGenerateNext": false
  }
}
```

### Config Response
```json
{
  "success": true,
  "data": {
    "_id": "global_auto_schedule_config",
    "enabled": true,
    "settings": {
      "endOfMonthCheck": true,
      "startOfQuarterCheck": true, 
      "dailyMonitoring": true,
      "daysBeforeEndOfMonth": 3
    },
    "stats": {
      "lastAutoRun": "2024-01-31T16:59:00.000Z",
      "totalAutoRuns": 15,
      "lastSuccessfulRun": "2024-01-31T16:59:00.000Z",
      "lastFailedRun": null
    },
    "lastModifiedBy": "admin_user",
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-30T10:15:00.000Z"
  }
}
```

### Cron Info Response
```json
{
  "success": true,
  "data": {
    "endOfMonth": {
      "schedule": "59 23 28-31 * *",
      "description": "Check and generate schedules at end of month"
    },
    "dailyCheck": {
      "schedule": "0 0 * * *", 
      "description": "Daily status check at midnight"
    },
    "startOfQuarter": {
      "schedule": "0 0 1 1,4,7,10 *",
      "description": "Generate schedules at start of quarter"
    }
  }
}
```

## Logs và Monitoring

### Console Logs
- Cron jobs sẽ log chi tiết về quá trình chạy
- Thông báo kết quả thành công/thất bại
- Cảnh báo khi cần chạy auto-generation

### Error Handling
- Tất cả errors được log và không làm crash service
- Response errors có format nhất quán
- Graceful handling cho các trường hợp edge case

## Cài đặt và Khởi chạy

### Dependencies
```json
{
  "node-cron": "^3.0.3",
  "moment-timezone": "^0.6.0"
}
```

### Initialization
Cron jobs được tự động khởi tạo khi service start:
```javascript
// In index.js
const CronJobManager = require('./utils/cronJobs');
CronJobManager.init();
```

## Lưu ý quan trọng

1. **Global Control**: Hệ thống có thể bật/tắt toàn bộ bằng 1 click
2. **Granular Settings**: Có thể bật/tắt từng loại kiểm tra riêng lẻ
3. **Safety First**: Nếu config bị lỗi, hệ thống sẽ fallback về behavior mặc định
4. **Audit Trail**: Tất cả thay đổi config đều được tracking
5. **Statistics**: Theo dõi được hiệu suất và độ tin cậy của hệ thống
6. **Timezone**: Đảm bảo server timezone được set đúng hoặc sử dụng moment-timezone
7. **Database**: Cần có kết nối Redis và MongoDB ổn định
8. **Memory**: Cron jobs chạy trong memory, không persist qua restart
9. **Authentication**: Các endpoint cấu hình yêu cầu authentication
10. **Monitoring**: Sử dụng daily check để monitor trạng thái hệ thống

## Ví dụ sử dụng

### Tắt hoàn toàn auto-schedule
```bash
curl -X PATCH /api/auto-schedule/config \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}'
```

### Bật lại auto-schedule  
```bash
curl -X PATCH /api/auto-schedule/toggle \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}'
```

### Xem trạng thái hiện tại
```bash
curl -X GET /api/auto-schedule/config \
  -H "Authorization: Bearer <token>"
```