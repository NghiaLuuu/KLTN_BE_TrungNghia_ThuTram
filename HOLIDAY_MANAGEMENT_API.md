# Holiday Management API Documentation

## Overview
API quản lý ngày nghỉ lễ trong hệ thống đặt lịch. Cho phép quản trị viên thêm, sửa, xóa các ngày nghỉ lễ.

## Base URL
```
http://localhost:3005/api/schedule/config
```

## Authentication
Tất cả endpoint (trừ GET /holidays) yêu cầu JWT token trong header:
```
Authorization: Bearer <your_jwt_token>
```

## Endpoints

### 1. GET /holidays
Lấy danh sách tất cả ngày nghỉ lễ

**Request:**
```http
GET /api/schedule/config/holidays
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "67890abcdef123456789",
      "name": "Tết Nguyên Đán",
      "startDate": "2024-02-10",
      "endDate": "2024-02-12",
      "note": "Nghỉ tết",
      "createdAt": "2024-01-15T10:00:00.000Z",
      "updatedAt": "2024-01-15T10:00:00.000Z"
    },
    {
      "_id": "67890abcdef123456790",
      "name": "Quốc Khánh",
      "startDate": "2024-09-02",
      "endDate": "2024-09-02",
      "note": "Nghỉ quốc khánh",
      "createdAt": "2024-01-15T10:00:00.000Z",
      "updatedAt": "2024-01-20T14:30:00.000Z"
    }
  ]
}
```

### 2. POST /holidays
Thêm ngày nghỉ lễ mới

**Request:**
```http
POST /api/schedule/config/holidays
Authorization: Bearer <your_jwt_token>
Content-Type: application/json

{
  "name": "Tết Nguyên Đán",
  "startDate": "2024-02-10",
  "endDate": "2024-02-12",
  "note": "Nghỉ tết nguyên đán"
}
```

**Validation Rules:**
- `name`: Required, 2-100 characters
- `startDate`: Required, ISO8601 format (YYYY-MM-DD)
- `endDate`: Required, ISO8601 format (YYYY-MM-DD)
- `note`: Optional, additional information

**Response Success (201):**
```json
{
  "success": true,
  "message": "Holiday added successfully",
  "data": {
    "_id": "67890abcdef123456789",
    "name": "Tết Nguyên Đán",
    "startDate": "2024-02-10",
    "endDate": "2024-02-12",
    "note": "Nghỉ tết nguyên đán",
    "createdAt": "2024-01-15T10:00:00.000Z",
    "updatedAt": "2024-01-15T10:00:00.000Z"
  }
}
```

**Response Error (400):**
```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    {
      "field": "name",
      "message": "Holiday name is required",
      "value": ""
    }
  ]
}
```

**Response Error (409):**
```json
{
  "success": false,
  "message": "Holiday already exists for this date range"
}
```

### 3. PATCH /holidays/:holidayId
Cập nhật thông tin ngày nghỉ lễ

**Request:**
```http
PATCH /api/schedule/config/holidays/67890abcdef123456789
Authorization: Bearer <your_jwt_token>
Content-Type: application/json

{
  "name": "Tết Nguyên Đán 2024",
  "note": "Cập nhật thông tin tết"
}
```

**Validation Rules:**
- `holidayId`: Must be valid MongoDB ObjectId
- `name`: Optional, 2-100 characters
- `startDate`: Optional, ISO8601 format (YYYY-MM-DD)
- `endDate`: Optional, ISO8601 format (YYYY-MM-DD)
- `note`: Optional, additional information

**Response Success (200):**
```json
{
  "success": true,
  "message": "Holiday updated successfully",
  "data": {
    "_id": "67890abcdef123456789",
    "name": "Tết Nguyên Đán 2024",
    "startDate": "2024-02-10",
    "endDate": "2024-02-12",
    "note": "Cập nhật thông tin tết",
    "createdAt": "2024-01-15T10:00:00.000Z",
    "updatedAt": "2024-01-20T14:30:00.000Z"
  }
}
```

**Response Error (404):**
```json
{
  "success": false,
  "message": "Holiday not found"
}
```

### 4. DELETE /holidays/:holidayId
Xóa ngày nghỉ lễ

**Request:**
```http
DELETE /api/schedule/config/holidays/67890abcdef123456789
Authorization: Bearer <your_jwt_token>
```

**Response Success (200):**
```json
{
  "success": true,
  "message": "Holiday removed successfully"
}
```

**Response Error (404):**
```json
{
  "success": false,
  "message": "Holiday not found"
}
```

**Response Error (400) - Holiday in use:**
```json
{
  "success": false,
  "message": "Không thể xóa ngày nghỉ vì có 5 lịch đã được sử dụng trong các ngày: 2024-02-10, 2024-02-11. Vui lòng hủy các cuộc hẹn trước khi xóa ngày nghỉ.",
  "type": "HOLIDAY_IN_USE"
}
```

## Error Codes

| Status Code | Description |
|-------------|-------------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request - Validation Error or Holiday in use |
| 401 | Unauthorized - Invalid/Missing Token |
| 404 | Not Found |
| 409 | Conflict - Duplicate Holiday |
| 500 | Internal Server Error |

## Usage Examples

### Thêm ngày nghỉ lễ
```javascript
const response = await fetch('/api/schedule/config/holidays', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + token,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    name: 'Giỗ Tổ Hùng Vương',
    startDate: '2024-04-18',
    endDate: '2024-04-18',
    note: 'Nghỉ lễ giỗ tổ'
  })
});

const result = await response.json();
console.log(result);
```

### Cập nhật ngày nghỉ lễ
```javascript
const response = await fetch(`/api/schedule/config/holidays/${holidayId}`, {
  method: 'PATCH',
  headers: {
    'Authorization': 'Bearer ' + token,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    name: 'Tên ngày nghỉ mới',
    note: 'Cập nhật ghi chú'
  })
});

const result = await response.json();
console.log(result);
```

## Notes
- Hệ thống tự động kiểm tra trùng lặp ngày nghỉ lễ theo `name` và khoảng thời gian
- Không thể xóa hoặc cập nhật ngày nghỉ lễ nếu đã có lịch hẹn được đặt trong khoảng thời gian đó
- Tất cả thời gian được lưu theo UTC
- API hỗ trợ CORS cho frontend
- Ngày nghỉ lễ hỗ trợ khoảng thời gian (startDate - endDate) thay vì chỉ một ngày đơn lẻ