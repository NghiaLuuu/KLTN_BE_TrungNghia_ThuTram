# Appointment Service - Quick API Test Guide

Tệp này chứa các endpoint, header mẫu và JSON bodies để bạn copy/paste thử nghiệm bằng Postman.

Base URL (local):
http://localhost:3006/api/appointment

---

## Header chung
- Content-Type: application/json
- Authorization: Bearer <JWT_TOKEN>

> Nếu bạn chưa có JWT token, xem phần "Sinh token test nhanh" ở cuối file.

---

## Endpoints & Payloads

1) GET /available-slots
- Mục đích: Lấy nhóm slot có thể đặt theo dentist, ngày, duration
- Query params (BẮT BUỘC cả 3):
  * dentistId (MongoId) - ID của nha sĩ
  * date (YYYY-MM-DD) - Ngày khám
  * serviceDuration (số nguyên 15-480) - Thời gian dịch vụ (phút)
- Ví dụ URL:
  http://localhost:3006/api/appointment/available-slots?dentistId=64c7d4eaf6f5a2b3c4d5e6f7&date=2025-10-10&serviceDuration=30

- Validation errors nếu thiếu params:
  {
    "success": false,
    "message": "Dữ liệu không hợp lệ",
    "errors": [
      { "field": "dentistId", "message": "Dentist ID là bắt buộc" },
      { "field": "date", "message": "Ngày là bắt buộc" },
      { "field": "serviceDuration", "message": "Thời gian dịch vụ là bắt buộc" }
    ]
  }


2) POST /reserve
- Mục đích: Tạo reservation tạm (online) và lấy paymentUrl
- Roles: patient (hoặc bất kỳ token hợp lệ nếu bạn skip auth)
- Body (application/json):

{
  "serviceId": "650000000000000000000001",
  "serviceAddOnId": "650000000000000000000002",
  "dentistId": "64c7d4eaf6f5a2b3c4d5e6f7",
  "slotIds": [
    "660000000000000000000001",
    "660000000000000000000002"
  ],
  "date": "2025-10-10",
  "patientId": "64a7b2c8e4d3f2a0b1c2d3e4",
  "patientInfo": {
    "name": "Nguyen Van A",
    "phone": "0123456789",
    "birthYear": 1990,
    "email": "a@example.com"
  },
  "notes": "Test reserve via Postman"
}

- Kết quả mong đợi: 201 Created, data chứa reservationId, paymentUrl, expiresAt, v.v.


3) POST /create-offline
- Mục đích: Tạo appointment trực tiếp cho walk-in hoặc nhân viên đặt (không cần payment)
- Roles: staff, admin, dentist
- Body (application/json):

{
  "serviceId": "650000000000000000000001",
  "serviceAddOnId": "650000000000000000000002",
  "dentistId": "64c7d4eaf6f5a2b3c4d5e6f7",
  "slotIds": [
    "660000000000000000000001",
    "660000000000000000000002"
  ],
  "date": "2025-10-10",
  "patientInfo": {
    "name": "Walk-in Test",
    "phone": "0987654321",
    "birthYear": 1995,
    "email": "walkin@example.com"
  },
  "notes": "Created by staff for walk-in"
}

- Kết quả mong đợi: 201 Created, appointment object, event `appointment_created` được publish (nếu invoice-service listening sẽ tạo hóa đơn)


4) GET /code/:appointmentCode
- Ví dụ:
  GET http://localhost:3006/api/appointment/code/AP000001-10102025
- Kết quả: appointment object hoặc 404


5) GET /patient/:patientId
- Ví dụ:
  GET http://localhost:3006/api/appointment/patient/64a7b2c8e4d3f2a0b1c2d3e4
- Optional query: ?status=confirmed&dateFrom=2025-10-01&dateTo=2025-10-31


6) GET /dentist/:dentistId
- Ví dụ:
  GET http://localhost:3006/api/appointment/dentist/64c7d4eaf6f5a2b3c4d5e6f7
- Optional query: ?date=2025-10-10


7) PATCH /:id/check-in
- Mục đích: Check-in appointment
- Ví dụ:
  PATCH http://localhost:3006/api/appointment/650000000000000000000010/check-in
- Roles: dentist, admin, staff
- No body required


8) PATCH /:id/complete
- Mục đích: Mark appointment as completed
- Ví dụ:
  PATCH http://localhost:3006/api/appointment/650000000000000000000010/complete
- Body:
{
  "actualDuration": 35,
  "notes": "Procedure completed successfully"
}
- Roles: dentist, admin


9) PATCH /:id/cancel
- Mục đích: Cancel appointment
- Ví dụ:
  PATCH http://localhost:3006/api/appointment/650000000000000000000010/cancel
- Body:
{
  "reason": "Patient requested cancellation due to illness"
}


---

## Các giá trị sample (copy/paste)
- samplePatientId: 64a7b2c8e4d3f2a0b1c2d3e4
- sampleStaffId: 64b7c3d9f5e4a1b2c3d4e5f6
- sampleDentistId: 64c7d4eaf6f5a2b3c4d5e6f7
- sampleServiceId: 650000000000000000000001
- sampleServiceAddOnId: 650000000000000000000002
- sampleRoomId: 670000000000000000000001
- sampleSlotIds: ["660000000000000000000001","660000000000000000000002"]


---

## Sinh token test nhanh (nếu không có auth-service)
Bạn có thể chạy 1-liner Node để in JWT (dùng `ACCESS_TOKEN_SECRET` từ `.env`):

PowerShell one-liner:

node -e "const jwt=require('jsonwebtoken'); const secret='e12bc4df2fd231bc0498c7e33a412312'; const users=[{_id:'64a7b2c8e4d3f2a0b1c2d3e4', role:'patient', name:'Test Patient'},{_id:'64b7c3d9f5e4a1b2c3d4e5f6', role:'staff', name:'Test Staff'},{_id:'64c7d4eaf6f5a2b3c4d5e6f7', role:'dentist', name:'Dr. Tooth'},{_id:'64d7e5fb07f6a3b4c5d6e7f8', role:'admin', name:'Admin User'}]; users.forEach(u=>console.log(u.role+':',jwt.sign({_id:u._id, role:u.role, name:u.name}, secret, {expiresIn: '7d'})));"

- Copy token cho role tương ứng và dán vào header Authorization: Bearer <token>

> Gợi ý: để test `POST /create-offline` dùng token của role `staff` hoặc `admin`.

---

Nếu bạn muốn, tôi có thể tiếp tục và:
- Tạo file `scripts/generate_tokens.js` để dễ chạy (tôi có thể thêm file này),
- Hoặc tạo Postman collection JSON sẵn để import.

Cho tôi biết bạn muốn tôi tạo tiếp cái nào (tokens file hoặc Postman collection) — tôi sẽ làm luôn.