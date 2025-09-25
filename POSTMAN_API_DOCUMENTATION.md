# Tài Liệu Hướng Dẫn Test API Postman
## Hệ Thống Quản Lý Phòng Khám Nha Khoa - Kiến Trúc Microservices

### Tổng Quan
Tài liệu này cung cấp hướng dẫn chi tiết để test API bằng Postman cho tất cả 9 microservices trong hệ thống quản lý phòng khám nha khoa.

## Quy Trình Nghiệp Vụ & Kiến Trúc Hệ Thống

### 🏥 **Mục Đích Hệ Thống**
Đây là hệ thống quản lý phòng khám nha khoa toàn diện được thiết kế để xử lý toàn bộ hành trình của bệnh nhân từ đăng ký đến hoàn thành điều trị và thanh toán. Hệ thống quản lý bệnh nhân, nhân viên, lịch hẹn, điều trị, thanh toán và hồ sơ y tế trong kiến trúc microservices tích hợp.

### 🔄 **Quy Trình Nghiệp Vụ Hoàn Chỉnh**
```
1. ĐĂNG KÝ BỆNH NHÂN → 2. ĐẶT LỊCH HẸN → 3. LẬP KẾ HOẠCH ĐIỀU TRỊ → 
4. THỰC HIỆN DỊCH VỤ → 5. XỬ LÝ THANH TOÁN → 6. HỒ SƠ Y TẾ → 7. THEO DÕI SAU ĐIỀU TRỊ
```

### 📋 **Chi Tiết Quy Trình Nghiệp Vụ**

#### **Giai Đoạn 1: Tiếp Nhận Bệnh Nhân (Dịch Vụ Xác Thực)**
- **Đăng Ký**: Bệnh nhân mới đăng ký bằng số điện thoại với xác thực OTP
- **Xác Thực**: Hệ thống đăng nhập bảo mật cho bệnh nhân và nhân viên  
- **Quản Lý Hồ Sơ**: Bệnh nhân duy trì thông tin cá nhân và tải lên giấy tờ y tế
- **Quản Lý Nhân Viên**: Admin tạo tài khoản cho bác sĩ, lễ tân và quản lý
- **Phân Quyền Theo Vai Trò**: Các mức quyền khác nhau (admin, manager, dentist, receptionist, patient)

#### **Giai Đoạn 2: Thiết Lập Cơ Sở Hạ Tầng (Quản Lý Phòng & Dịch Vụ)**
- **Dịch Vụ Phòng**: Quản lý cơ sở hạ tầng vật lý của phòng khám
  - Phòng điều trị với nhiều ghế nha khoa (phòng con)
  - Theo dõi thiết bị theo từng phòng/ghế
  - Quản lý trạng thái sẵn sàng
- **Dịch Vụ Y Tế**: Định nghĩa các liệu pháp nha khoa có sẵn
  - Dịch vụ nha khoa cơ bản (tẩy trắng, trám răng, nhổ răng, v.v.)
  - Dịch vụ bổ sung (điều trị fluoride, gây tê, v.v.) 
  - Quản lý giá cả và thời lượng
  - Phân loại dịch vụ (phòng ngừa, phục hồi, phẫu thuật)

#### **Giai Đoạn 3: Lập Lịch & Hẹn Khám (Dịch Vụ Lịch Trình & Lịch Hẹn)**
- **Dịch Vụ Lịch Trình**: Hệ thống quản lý khung giờ
  - Tạo lịch trình theo quý cho tất cả phòng
  - Quản lý khung giờ có sẵn theo từng phòng theo ngày
  - Xử lý tình trạng sẵn sàng và chặn khung giờ
- **Dịch Vụ Lịch Hẹn**: Hệ thống đặt lịch của bệnh nhân
  - Bệnh nhân đặt lịch hẹn cho các dịch vụ cụ thể
  - Phân công bác sĩ, phòng và khung giờ
  - Theo dõi trạng thái lịch hẹn (chờ, xác nhận, hoàn thành, hủy)
  - Quản lý lịch trình hàng ngày cho nhân viên
  - Thống kê và báo cáo lịch hẹn

#### **Giai Đoạn 4: Điều Trị & Lưu Trữ (Dịch Vụ Hồ Sơ)**
- **Hồ Sơ Y Tế**: Tài liệu điều trị toàn diện
  - Chẩn đoán và lập kế hoạch điều trị
  - Theo dõi tiến trình điều trị
  - Quản lý đơn thuốc
  - Cập nhật chỉ định điều trị
  - Duy trì lịch sử y tế bệnh nhân

#### **Giai Đoạn 5: Quản Lý Tài Chính (Dịch Vụ Thanh Toán & Hóa Đơn)**
- **Dịch Vụ Thanh Toán**: Xử lý thanh toán đa kênh
  - Hỗ trợ các cổng thanh toán MoMo, ZaloPay, VNPay
  - Xác minh thanh toán thời gian thực qua webhook
  - Xử lý và quản lý hoàn tiền
  - Thống kê thanh toán và theo dõi doanh thu
- **Dịch Vụ Hóa Đơn**: Lập hóa đơn và tài liệu tài chính
  - Tự động tạo hóa đơn từ lịch hẹn
  - Lập hóa đơn dựa trên điều trị với chi tiết dịch vụ
  - Tích hợp thanh toán và theo dõi trạng thái
  - Báo cáo doanh thu và thống kê
  - Hoàn thiện và hủy hóa đơn

#### **Giai Đoạn 6: Quản Lý Kho (Dịch Vụ Thuốc)**
- **Kho Thuốc**: Quản lý kho dược phẩm
  - Danh mục thuốc với giá cả và thông số kỹ thuật
  - Theo dõi mức tồn kho với cảnh báo hết hàng
  - Các thao tác kho hàng loạt để cập nhật tồn kho
  - Quản lý ngày hết hạn
  - Tích hợp với hệ thống kê đơn

### 🎯 **Quy Tắc Nghiệp Vụ Chính**

#### **Hành Trình Bệnh Nhân:**
1. **Đăng Ký** → Xác thực OTP → Thiết lập hồ sơ
2. **Đặt Lịch** → Chọn dịch vụ → Chọn khung giờ → Phân công bác sĩ
3. **Điều Trị** → Check-in → Thực hiện điều trị → Theo dõi tiến trình
4. **Thanh Toán** → Hoàn thành dịch vụ → Tạo hóa đơn → Xử lý thanh toán
5. **Hồ Sơ** → Lưu trữ điều trị → Kê đơn thuốc → Lập lịch theo dõi

#### **Vai Trò & Quyền Hạn Nhân Viên:**
- **Admin**: Toàn quyền hệ thống, quản lý người dùng, cấu hình hệ thống
- **Manager**: Quản lý vận hành, báo cáo, giám sát nhân viên (không cấu hình hệ thống)
- **Dentist**: Điều trị bệnh nhân, hồ sơ y tế, quản lý lịch hẹn
- **Receptionist**: Đặt lịch hẹn, check-in bệnh nhân, các thao tác cơ bản
- **Patient**: Hồ sơ cá nhân, đặt lịch hẹn, thanh toán, xem hồ sơ riêng

#### **Quản Lý Tài Nguyên:**
- **Phòng** phải sẵn sàng để đặt lịch hẹn
- **Dịch Vụ** định nghĩa các lựa chọn điều trị và giá cả
- **Lịch Trình** kiểm soát tình trạng sẵn sàng lịch hẹn
- **Mức Tồn Kho** ảnh hưởng đến khả năng kê đơn

#### **Quy Trình Tài Chính:**
- **Lịch Hẹn** → **Dịch Vụ Được Cung Cấp** → **Tạo Hóa Đơn** → **Xử Lý Thanh Toán** → **Theo Dõi Doanh Thu**

### 🔧 **Điểm Tích Hợp**
- **Thanh Toán ↔ Hóa Đơn**: Thanh toán thành công kích hoạt hoàn thiện hóa đơn
- **Lịch Hẹn ↔ Hồ Sơ**: Lịch hẹn tạo ra hồ sơ y tế
- **Hồ Sơ ↔ Thuốc**: Đơn thuốc liên kết với kho thuốc
- **Lịch Trình ↔ Phòng**: Tình trạng sẵn sàng phụ thuộc vào trạng thái phòng
- **Dịch Vụ ↔ Hóa Đơn**: Giá dịch vụ chảy vào hệ thống lập hóa đơn

### 🎪 **Tổng Quan Chiến Lược Test**
Khi test hệ thống này, hãy xem xét toàn bộ quy trình bệnh nhân:
1. Tạo tài khoản nhân viên và thiết lập phòng/dịch vụ
2. Đăng ký bệnh nhân và đặt lịch hẹn  
3. Xử lý điều trị và tạo hồ sơ y tế
4. Xử lý thanh toán và tạo hóa đơn
5. Quản lý kho và đơn thuốc
6. Xác minh báo cáo và thống kê

### Base URLs
- **Auth Service**: `http://localhost:3001`
- **Room Service**: `http://localhost:3002`
- **Service Service**: `http://localhost:3003`
- **Schedule Service**: `http://localhost:3004`
- **Appointment Service**: `http://localhost:3006`
- **Payment Service**: `http://localhost:3007`
- **Invoice Service**: `http://localhost:3008`
- **Record Service**: `http://localhost:3010`
- **Medicine Service**: `http://localhost:3009`

### Authentication Setup
1. **JWT Token**: All protected routes require JWT token in Authorization header
   - Header: `Authorization: Bearer <jwt_token>`
2. **Roles**: `admin`, `manager`, `dentist`, `receptionist`, `patient`, `system`

---

## 1. Dịch Vụ Xác Thực (Port 3001)
**Mục Đích Nghiệp Vụ**: Xử lý xác thực người dùng, đăng ký và quản lý hồ sơ cho tất cả người dùng hệ thống (bệnh nhân và nhân viên)

**Trách Nhiệm Chính**:
- Đăng ký người dùng an toàn với xác thực OTP qua SMS
- Xác thực dựa trên JWT để quản lý phiên làm việc
- Phân quyền theo vai trò (admin, manager, dentist, receptionist, patient)
- Quản lý hồ sơ bao gồm tải lên giấy chứng nhận y tế
- Tạo và quản lý tài khoản nhân viên

### Base URL: `http://localhost:3001/api`

### Authentication Endpoints (`/api/auth`)

#### 1.1 Register with OTP
- **POST** `/auth/register`
- **Body**:
```json
{
  "phone": "0123456789",
  "password": "password123",
  "confirmPassword": "password123",
  "name": "John Doe",
  "email": "john@example.com",
  "dob": "1990-01-01",
  "gender": "male"
}
```
- **Response**: OTP sent to phone

#### 1.2 Verify OTP
- **POST** `/auth/verify-otp`
- **Body**:
```json
{
  "phone": "0123456789",
  "otp": "123456"
}
```

#### 1.3 Login
- **POST** `/auth/login`
- **Body**:
```json
{
  "phone": "0123456789",
  "password": "password123"
}
```
- **Response**: JWT token + user info

#### 1.4 Refresh Token
- **POST** `/auth/refresh-token`
- **Body**:
```json
{
  "refreshToken": "your_refresh_token"
}
```

#### 1.5 Logout
- **POST** `/auth/logout`
- **Headers**: Authorization Bearer token
- **Body**:
```json
{
  "refreshToken": "your_refresh_token"
}
```

#### 1.6 Forgot Password
- **POST** `/auth/forgot-password`
- **Body**:
```json
{
  "phone": "0123456789"
}
```

#### 1.7 Reset Password
- **POST** `/auth/reset-password`
- **Body**:
```json
{
  "phone": "0123456789",
  "otp": "123456",
  "newPassword": "newpassword123"
}
```

#### 1.8 Change Password
- **POST** `/auth/change-password`
- **Headers**: Authorization Bearer token
- **Body**:
```json
{
  "currentPassword": "oldpassword",
  "newPassword": "newpassword123"
}
```

### User Management Endpoints (`/api/user`)

#### 1.9 Get Profile
- **GET** `/user/profile`
- **Headers**: Authorization Bearer token

#### 1.10 Update Profile
- **PUT** `/user/profile`
- **Headers**: Authorization Bearer token
- **Body**:
```json
{
  "name": "Updated Name",
  "email": "updated@example.com",
  "dob": "1990-01-01",
  "gender": "male",
  "address": "123 Street"
}
```

#### 1.11 Upload Certificate (Multipart)
- **POST** `/user/upload-certificate`
- **Headers**: Authorization Bearer token
- **Body**: Form-data with file field `certificate`

#### 1.12 Get All Users (Admin/Manager only)
- **GET** `/user/all`
- **Headers**: Authorization Bearer token
- **Roles**: admin, manager

#### 1.13 Create Staff (Admin/Manager only)
- **POST** `/user/staff`
- **Headers**: Authorization Bearer token
- **Roles**: admin, manager
- **Body**:
```json
{
  "phone": "0987654321",
  "password": "staff123",
  "name": "Staff Name",
  "email": "staff@clinic.com",
  "role": "dentist",
  "specialization": "Orthodontics"
}
```

#### 1.14 Update User Status (Admin/Manager only)
- **PATCH** `/user/:userId/status`
- **Headers**: Authorization Bearer token
- **Roles**: admin, manager
- **Body**:
```json
{
  "status": "active"
}
```

---

## 2. Dịch Vụ Phòng (Port 3002)
**Mục Đích Nghiệp Vụ**: Quản lý cơ sở hạ tầng vật lý của phòng khám nha khoa bao gồm phòng điều trị và ghế nha khoa

**Trách Nhiệm Chính**:
- Quản lý phòng điều trị với theo dõi sức chứa và thiết bị
- Quản lý phòng con (ghế nha khoa) trong mỗi phòng
- Trạng thái sẵn sàng của phòng để lập lịch hẹn
- Kho thiết bị theo từng phòng/ghế
- Tích hợp với hệ thống lập lịch để phân bổ tài nguyên

**Logic Nghiệp Vụ**: Mỗi phòng có thể chứa nhiều ghế nha khoa (phòng con), và cả hai đều phải sẵn sàng để đặt lịch hẹn.

### Base URL: `http://localhost:3002/api/rooms`

#### 2.1 Get All Rooms
- **GET** `/`
- **Query Parameters**: `page`, `limit`, `search`, `status`

#### 2.2 Get Room by ID
- **GET** `/:id`

#### 2.3 Create Room (Admin/Manager only)
- **POST** `/`
- **Headers**: Authorization Bearer token
- **Roles**: admin, manager
- **Body**:
```json
{
  "name": "Room 101",
  "description": "General treatment room",
  "floor": 1,
  "capacity": 2,
  "equipment": ["X-ray machine", "Dental chair"]
}
```

#### 2.4 Update Room (Admin/Manager only)
- **PUT** `/:id`
- **Headers**: Authorization Bearer token
- **Roles**: admin, manager
- **Body**: Same as create

#### 2.5 Delete Room (Admin only)
- **DELETE** `/:id`
- **Headers**: Authorization Bearer token
- **Roles**: admin

#### 2.6 Toggle Room Status (Admin/Manager only)
- **PATCH** `/:id/toggle-status`
- **Headers**: Authorization Bearer token
- **Roles**: admin, manager

#### 2.7 Search Rooms
- **GET** `/search`
- **Query Parameters**: `q`, `page`, `limit`

### Subroom Endpoints

#### 2.8 Get Subrooms by Room
- **GET** `/:roomId/subrooms`

#### 2.9 Create Subroom (Admin/Manager only)
- **POST** `/:roomId/subrooms`
- **Headers**: Authorization Bearer token
- **Roles**: admin, manager
- **Body**:
```json
{
  "name": "Chair A",
  "description": "Main dental chair",
  "equipment": ["Dental light", "Suction unit"]
}
```

#### 2.10 Update Subroom (Admin/Manager only)
- **PUT** `/:roomId/subrooms/:subroomId`
- **Headers**: Authorization Bearer token
- **Roles**: admin, manager

#### 2.11 Delete Subroom (Admin only)
- **DELETE** `/:roomId/subrooms/:subroomId`
- **Headers**: Authorization Bearer token
- **Roles**: admin

#### 2.12 Toggle Subroom Status (Admin/Manager only)
- **PATCH** `/:roomId/subrooms/:subroomId/toggle-status`
- **Headers**: Authorization Bearer token
- **Roles**: admin, manager

---

## 3. Dịch Vụ Y Tế (Port 3003)
**Mục Đích Nghiệp Vụ**: Định nghĩa và quản lý tất cả dịch vụ nha khoa được cung cấp bởi phòng khám với giá cả và các tùy chọn bổ sung

**Trách Nhiệm Chính**:
- Danh mục dịch vụ nha khoa (tẩy trắng, trám răng, nhổ răng, chỉnh nha, v.v.)
- Phân loại dịch vụ (phòng ngừa, phục hồi, phẫu thuật, thẩm mỹ)
- Quản lý giá cơ bản và thời lượng cho mỗi dịch vụ
- Quản lý dịch vụ bổ sung (gây tê, điều trị fluoride, v.v.)
- Thông tin dịch vụ công khai để bệnh nhân tham khảo

**Logic Nghiệp Vụ**: Dịch vụ tạo nền tảng cho việc đặt lịch hẹn và lập hóa đơn. Dịch vụ bổ sung nâng cao dịch vụ cơ bản với các tính năng và chi phí bổ sung.

### Base URL: `http://localhost:3003/api/services`

#### 3.1 Get All Services (Public)
- **GET** `/`
- **Query Parameters**: `page`, `limit`, `category`, `status`

#### 3.2 Get Service by ID (Public)
- **GET** `/:id`

#### 3.3 Search Services (Public)
- **GET** `/search`
- **Query Parameters**: `q`, `page`, `limit`

#### 3.4 Create Service (Admin/Manager only)
- **POST** `/`
- **Headers**: Authorization Bearer token
- **Roles**: admin, manager
- **Body**:
```json
{
  "name": "Teeth Cleaning",
  "description": "Professional dental cleaning",
  "category": "Preventive",
  "basePrice": 100000,
  "duration": 60,
  "isActive": true
}
```

#### 3.5 Update Service (Admin/Manager only)
- **PUT** `/:id`
- **Headers**: Authorization Bearer token
- **Roles**: admin, manager
- **Body**: Same as create

#### 3.6 Delete Service (Admin only)
- **DELETE** `/:id`
- **Headers**: Authorization Bearer token
- **Roles**: admin

#### 3.7 Toggle Service Status (Admin/Manager only)
- **PATCH** `/:id/toggle-status`
- **Headers**: Authorization Bearer token
- **Roles**: admin, manager

### Add-on Service Endpoints

#### 3.8 Get Add-ons for Service (Public)
- **GET** `/:serviceId/addons`

#### 3.9 Create Add-on (Admin/Manager only)
- **POST** `/:serviceId/addons`
- **Headers**: Authorization Bearer token
- **Roles**: admin, manager
- **Body**:
```json
{
  "name": "Fluoride Treatment",
  "description": "Additional fluoride application",
  "price": 50000,
  "isActive": true
}
```

#### 3.10 Update Add-on (Admin/Manager only)
- **PUT** `/:serviceId/addons/:addonId`
- **Headers**: Authorization Bearer token
- **Roles**: admin, manager

#### 3.11 Delete Add-on (Admin only)
- **DELETE** `/:serviceId/addons/:addonId`
- **Headers**: Authorization Bearer token
- **Roles**: admin

#### 3.12 Toggle Add-on Status (Admin/Manager only)
- **PATCH** `/:serviceId/addons/:addonId/toggle-status`
- **Headers**: Authorization Bearer token
- **Roles**: admin, manager

---

## 4. Dịch Vụ Lịch Trình (Port 3004)
**Mục Đích Nghiệp Vụ**: Quản lý tình trạng sẵn sàng của khung giờ cho lịch hẹn trên tất cả phòng và cung cấp cơ sở hạ tầng lập lịch

**Trách Nhiệm Chính**:
- Tạo lịch trình theo quý cho tất cả phòng khám
- Quản lý khung giờ với theo dõi tình trạng sẵn sàng
- Truy vấn lịch trình theo phòng để đặt lịch hẹn
- Quản lý trạng thái khung giờ (sẵn sàng, đã đặt, bị chặn)
- Tích hợp với dịch vụ phòng để lập lịch tài nguyên

**Logic Nghiệp Vụ**: Lịch trình được tạo theo quý và cung cấp nền tảng cho việc đặt lịch hẹn. Khung giờ sẵn sàng phụ thuộc vào tình trạng phòng và thời lượng dịch vụ.

### Base URL: `http://localhost:3004/api/schedules`

#### 4.1 Generate Quarter Schedule (Admin/Manager only)
- **POST** `/quarter/generate`
- **Headers**: Authorization Bearer token
- **Roles**: admin, manager
- **Body**:
```json
{
  "year": 2024,
  "quarter": 1,
  "roomId": "room_id_here"
}
```

#### 4.2 Get Schedule by Room and Date
- **GET** `/room/:roomId/date/:date`
- **Headers**: Authorization Bearer token
- **Date format**: YYYY-MM-DD

#### 4.3 Get Available Slots
- **GET** `/available`
- **Headers**: Authorization Bearer token
- **Query Parameters**: `roomId`, `date`, `serviceId`

#### 4.4 Toggle Slot Status (Admin/Manager only)
- **PATCH** `/slot/:slotId/toggle`
- **Headers**: Authorization Bearer token
- **Roles**: admin, manager

#### 4.5 Get Schedule by Quarter
- **GET** `/quarter/:year/:quarter`
- **Headers**: Authorization Bearer token

#### 4.6 Update Slot (Admin/Manager only)
- **PUT** `/slot/:slotId`
- **Headers**: Authorization Bearer token
- **Roles**: admin, manager
- **Body**:
```json
{
  "startTime": "09:00",
  "endTime": "10:00",
  "isAvailable": true
}
```

---

## 5. Dịch Vụ Lịch Hẹn (Port 3006)
**Mục Đích Nghiệp Vụ**: Hệ thống quản lý lịch hẹn cốt lõi xử lý toàn bộ vòng đời lịch hẹn từ đặt lịch đến hoàn thành

**Trách Nhiệm Chính**:
- Đặt lịch hẹn bệnh nhân với phân công dịch vụ, bác sĩ và phòng
- Quản lý trạng thái lịch hẹn (chờ, xác nhận, hoàn thành, hủy)
- Tạo lịch trình hàng ngày cho nhân viên phòng khám
- Thống kê và báo cáo lịch hẹn cho ban quản lý
- Giao diện xem lịch hẹn riêng cho bệnh nhân và bác sĩ
- Tích hợp với hệ thống thanh toán và hóa đơn

**Logic Nghiệp Vụ**: Lịch hẹn kết nối bệnh nhân, dịch vụ, bác sĩ, phòng và khung giờ. Chúng kích hoạt việc tạo hồ sơ y tế và quy trình lập hóa đơn khi hoàn thành.

### Base URL: `http://localhost:3006/api/appointments`

#### 5.1 Create Appointment
- **POST** `/`
- **Headers**: Authorization Bearer token
- **Body**:
```json
{
  "patientId": "patient_id",
  "dentistId": "dentist_id",
  "serviceId": "service_id",
  "roomId": "room_id",
  "date": "2024-01-15",
  "startTime": "09:00",
  "endTime": "10:00",
  "notes": "Regular checkup"
}
```

#### 5.2 Get All Appointments
- **GET** `/`
- **Headers**: Authorization Bearer token
- **Query Parameters**: `page`, `limit`, `status`, `date`, `dentistId`, `patientId`

#### 5.3 Get Appointment by ID
- **GET** `/:id`
- **Headers**: Authorization Bearer token

#### 5.4 Update Appointment
- **PUT** `/:id`
- **Headers**: Authorization Bearer token
- **Roles**: admin, manager, dentist, receptionist
- **Body**: Same as create

#### 5.5 Cancel Appointment
- **PATCH** `/:id/cancel`
- **Headers**: Authorization Bearer token
- **Body**:
```json
{
  "reason": "Patient request"
}
```

#### 5.6 Confirm Appointment
- **PATCH** `/:id/confirm`
- **Headers**: Authorization Bearer token
- **Roles**: admin, manager, dentist, receptionist

#### 5.7 Complete Appointment
- **PATCH** `/:id/complete`
- **Headers**: Authorization Bearer token
- **Roles**: dentist, admin, manager

#### 5.8 Get Daily Schedule
- **GET** `/daily-schedule/:date`
- **Headers**: Authorization Bearer token
- **Roles**: admin, manager, dentist, receptionist

#### 5.9 Get Patient Appointments
- **GET** `/patient/:patientId`
- **Headers**: Authorization Bearer token

#### 5.10 Get Dentist Appointments
- **GET** `/dentist/:dentistId`
- **Headers**: Authorization Bearer token

#### 5.11 Get Appointment Statistics
- **GET** `/statistics`
- **Headers**: Authorization Bearer token
- **Roles**: admin, manager
- **Query Parameters**: `startDate`, `endDate`

#### 5.12 Search Appointments
- **GET** `/search`
- **Headers**: Authorization Bearer token
- **Query Parameters**: `q`, `page`, `limit`

---

## 6. Dịch Vụ Thanh Toán (Port 3007)
**Mục Đích Nghiệp Vụ**: Xử lý tất cả thanh toán thông qua nhiều cổng thanh toán với xác minh thời gian thực và quản lý hoàn tiền

**Trách Nhiệm Chính**:
- Xử lý thanh toán đa cổng (MoMo, ZaloPay, VNPay)
- Xác minh thanh toán thời gian thực qua webhook
- Xử lý và quản lý hoàn tiền
- Theo dõi và cập nhật trạng thái thanh toán
- Thống kê doanh thu và báo cáo tài chính
- Tích hợp với dịch vụ hóa đơn để tự động lập hóa đơn

**Logic Nghiệp Vụ**: Thanh toán được tạo từ lịch hẹn và kích hoạt việc hoàn thiện hóa đơn khi thành công. Hỗ trợ nhiều phương thức thanh toán với xử lý webhook riêng cho từng cổng.

### Base URL: `http://localhost:3007/api/payments`

#### 6.1 Create Payment
- **POST** `/create`
- **Headers**: Authorization Bearer token
- **Body**:
```json
{
  "appointmentId": "appointment_id",
  "amount": 100000,
  "paymentMethod": "momo",
  "description": "Payment for dental service"
}
```

#### 6.2 Get Payment by ID
- **GET** `/:id`
- **Headers**: Authorization Bearer token

#### 6.3 Get Payment by Transaction ID
- **GET** `/transaction/:transactionId`
- **Headers**: Authorization Bearer token

#### 6.4 Get All Payments
- **GET** `/`
- **Headers**: Authorization Bearer token
- **Roles**: admin, manager
- **Query Parameters**: `page`, `limit`, `status`, `method`

#### 6.5 Update Payment Status
- **PATCH** `/:id/status`
- **Headers**: Authorization Bearer token
- **Roles**: admin, manager, system
- **Body**:
```json
{
  "status": "completed",
  "transactionId": "TXN123456"
}
```

#### 6.6 Process Refund
- **POST** `/:id/refund`
- **Headers**: Authorization Bearer token
- **Roles**: admin, manager
- **Body**:
```json
{
  "amount": 50000,
  "reason": "Service cancellation"
}
```

#### 6.7 Get Refund Status
- **GET** `/refund/:refundId`
- **Headers**: Authorization Bearer token

### Webhook Endpoints

#### 6.8 MoMo Webhook
- **POST** `/webhook/momo`
- **Body**: MoMo webhook payload

#### 6.9 ZaloPay Webhook
- **POST** `/webhook/zalopay`
- **Body**: ZaloPay webhook payload

#### 6.10 VNPay Webhook
- **POST** `/webhook/vnpay`
- **Body**: VNPay webhook payload

### Statistics Endpoints

#### 6.11 Get Payment Statistics
- **GET** `/statistics`
- **Headers**: Authorization Bearer token
- **Roles**: admin, manager
- **Query Parameters**: `startDate`, `endDate`

#### 6.12 Get Revenue Report
- **GET** `/revenue-report`
- **Headers**: Authorization Bearer token
- **Roles**: admin, manager
- **Query Parameters**: `period` (daily, weekly, monthly)

---

## 7. Invoice Service (Port 3008)

### Base URL: `http://localhost:3008/api/invoices`

#### 7.1 Health Check (Public)
- **GET** `/health`

#### 7.2 Create Invoice
- **POST** `/`
- **Headers**: Authorization Bearer token
- **Roles**: admin, manager, dentist, receptionist
- **Body**:
```json
{
  "appointmentId": "appointment_id",
  "patientId": "patient_id",
  "services": [
    {
      "serviceId": "service_id",
      "quantity": 1,
      "price": 100000,
      "addons": ["addon_id_1", "addon_id_2"]
    }
  ],
  "discount": 10000,
  "notes": "Invoice notes"
}
```

#### 7.3 Get All Invoices
- **GET** `/`
- **Headers**: Authorization Bearer token
- **Roles**: admin, manager, dentist, receptionist
- **Query Parameters**: `page`, `limit`, `status`, `patientId`

#### 7.4 Search Invoices
- **GET** `/search`
- **Headers**: Authorization Bearer token
- **Roles**: admin, manager, dentist, receptionist
- **Query Parameters**: `q`, `page`, `limit`

#### 7.5 Get Invoice by ID
- **GET** `/:id`
- **Headers**: Authorization Bearer token
- **Roles**: admin, manager, dentist, receptionist, patient

#### 7.6 Update Invoice
- **PUT** `/:id`
- **Headers**: Authorization Bearer token
- **Roles**: admin, manager, dentist, receptionist
- **Body**: Same as create

#### 7.7 Handle Payment Success
- **POST** `/payment/success`
- **Headers**: Authorization Bearer token
- **Roles**: admin, manager, system
- **Body**:
```json
{
  "invoiceId": "invoice_id",
  "paymentId": "payment_id",
  "transactionId": "TXN123456",
  "amount": 100000
}
```

#### 7.8 Create Invoice from Payment
- **POST** `/payment/create-from-payment`
- **Headers**: Authorization Bearer token
- **Roles**: admin, manager, system
- **Body**:
```json
{
  "paymentId": "payment_id",
  "appointmentId": "appointment_id"
}
```

#### 7.9 Finalize Invoice
- **PATCH** `/:id/finalize`
- **Headers**: Authorization Bearer token
- **Roles**: admin, manager, dentist, receptionist

#### 7.10 Cancel Invoice
- **PATCH** `/:id/cancel`
- **Headers**: Authorization Bearer token
- **Roles**: admin, manager
- **Body**:
```json
{
  "reason": "Cancellation reason"
}
```

#### 7.11 Recalculate Invoice
- **PATCH** `/:id/recalculate`
- **Headers**: Authorization Bearer token
- **Roles**: admin, manager, dentist, receptionist

### Invoice Details Management

#### 7.12 Create Invoice Detail
- **POST** `/:invoiceId/details`
- **Headers**: Authorization Bearer token
- **Roles**: admin, manager, dentist, receptionist
- **Body**:
```json
{
  "serviceId": "service_id",
  "quantity": 1,
  "price": 100000,
  "addons": ["addon_id"]
}
```

#### 7.13 Get Invoice Details
- **GET** `/:invoiceId/details`
- **Headers**: Authorization Bearer token
- **Roles**: admin, manager, dentist, receptionist, patient

#### 7.14 Update Invoice Detail
- **PUT** `/details/:detailId`
- **Headers**: Authorization Bearer token
- **Roles**: admin, manager, dentist, receptionist
- **Body**: Same as create detail

#### 7.15 Mark Treatment Completed
- **PATCH** `/details/:detailId/complete-treatment`
- **Headers**: Authorization Bearer token
- **Roles**: admin, manager, dentist

#### 7.16 Update Treatment Progress
- **PATCH** `/details/:detailId/update-progress`
- **Headers**: Authorization Bearer token
- **Roles**: admin, manager, dentist
- **Body**:
```json
{
  "progress": 50,
  "notes": "Treatment progress notes"
}
```

### Statistics Endpoints

#### 7.17 Get Invoice Statistics
- **GET** `/stats/invoices`
- **Headers**: Authorization Bearer token
- **Roles**: admin, manager
- **Query Parameters**: `startDate`, `endDate`

#### 7.18 Get Revenue Statistics
- **GET** `/stats/revenue`
- **Headers**: Authorization Bearer token
- **Roles**: admin, manager
- **Query Parameters**: `period`, `startDate`, `endDate`

#### 7.19 Get Dashboard Data
- **GET** `/stats/dashboard`
- **Headers**: Authorization Bearer token
- **Roles**: admin, manager, dentist, receptionist

#### 7.20 Get Service Statistics
- **GET** `/stats/services`
- **Headers**: Authorization Bearer token
- **Roles**: admin, manager, dentist
- **Query Parameters**: `startDate`, `endDate`

---

## 8. Dịch Vụ Hồ Sơ Y Tế (Port 3010)
**Mục Đích Nghiệp Vụ**: Quản lý hồ sơ y tế toàn diện với theo dõi điều trị, kê đơn thuốc và lịch sử bệnh án

**Trách Nhiệm Chính**:
- Tạo và quản lý hồ sơ bệnh án cho từng lần khám
- Theo dõi chẩn đoán và kế hoạch điều trị
- Quản lý đơn thuốc và hướng dẫn sử dụng
- Cập nhật tiến trình điều trị và chỉ định y tế
- Thống kê và báo cáo hồ sơ y tế
- Tích hợp với dịch vụ thuốc cho việc kê đơn

**Logic Nghiệp Vụ**: Hồ sơ được tạo từ lịch hẹn hoàn thành và lưu trữ toàn bộ thông tin điều trị. Kết nối với kho thuốc để quản lý đơn thuốc hiệu quả.

### Base URL: `http://localhost:3010/api/records`

#### 8.1 Get All Records
- **GET** `/`
- **Headers**: Authorization Bearer token
- **Query Parameters**: `page`, `limit`, `status`, `patientId`, `dentistId`

#### 8.2 Search Records
- **GET** `/search`
- **Headers**: Authorization Bearer token
- **Query Parameters**: `q`, `page`, `limit`

#### 8.3 Get Statistics
- **GET** `/statistics`
- **Headers**: Authorization Bearer token
- **Roles**: admin, manager
- **Query Parameters**: `startDate`, `endDate`

#### 8.4 Get Records by Patient
- **GET** `/patient/:patientId`
- **Headers**: Authorization Bearer token

#### 8.5 Get Records by Dentist
- **GET** `/dentist/:dentistId`
- **Headers**: Authorization Bearer token

#### 8.6 Get Pending Records
- **GET** `/status/pending`
- **Headers**: Authorization Bearer token
- **Roles**: dentist, admin, manager

#### 8.7 Get Record by Code
- **GET** `/code/:code`
- **Headers**: Authorization Bearer token

#### 8.8 Get Record by ID
- **GET** `/:id`
- **Headers**: Authorization Bearer token

#### 8.9 Create Record
- **POST** `/`
- **Headers**: Authorization Bearer token
- **Roles**: dentist, admin, manager
- **Body**:
```json
{
  "patientId": "patient_id",
  "appointmentId": "appointment_id",
  "diagnosis": "Dental caries",
  "symptoms": "Tooth pain",
  "treatmentPlan": "Filling",
  "notes": "Patient has sensitivity"
}
```

#### 8.10 Update Record Status
- **PATCH** `/:id/status`
- **Headers**: Authorization Bearer token
- **Roles**: dentist, admin, manager
- **Body**:
```json
{
  "status": "completed",
  "notes": "Treatment completed successfully"
}
```

#### 8.11 Add Prescription
- **POST** `/:id/prescription`
- **Headers**: Authorization Bearer token
- **Roles**: dentist, admin, manager
- **Body**:
```json
{
  "medications": [
    {
      "medicineId": "medicine_id",
      "dosage": "1 tablet twice daily",
      "duration": "7 days",
      "instructions": "Take after meals"
    }
  ]
}
```

#### 8.12 Update Treatment Indication
- **PATCH** `/:id/indications/:indicationId`
- **Headers**: Authorization Bearer token
- **Roles**: dentist, admin, manager
- **Body**:
```json
{
  "indication": "Updated treatment indication",
  "progress": 75
}
```

#### 8.13 Complete Record
- **PATCH** `/:id/complete`
- **Headers**: Authorization Bearer token
- **Roles**: dentist, admin, manager

#### 8.14 Update Record
- **PUT** `/:id`
- **Headers**: Authorization Bearer token
- **Roles**: dentist, admin, manager
- **Body**: Same as create

#### 8.15 Delete Record
- **DELETE** `/:id`
- **Headers**: Authorization Bearer token
- **Roles**: admin, manager

---

## 9. Dịch Vụ Thuốc (Port 3009)
**Mục Đích Nghiệp Vụ**: Quản lý kho thuốc và dược phẩm với theo dõi tồn kho, cảnh báo hết hạn và tích hợp kê đơn

**Trách Nhiệm Chính**:
- Quản lý danh mục thuốc với thông tin chi tiết và giá cả
- Theo dõi tồn kho với cảnh báo khi sắp hết hàng
- Quản lý ngày hết hạn và thông tin nhà sản xuất
- Cập nhật kho hàng loạt và theo dõi xuất nhập
- Báo cáo tồn kho và thống kê sử dụng thuốc
- Tích hợp với hệ thống kê đơn từ hồ sơ y tế

**Logic Nghiệp Vụ**: Thuốc được quản lý với mức tồn kho tối thiểu và cảnh báo tự động. Tích hợp với việc kê đơn để đảm bảo có đủ thuốc cho điều trị.

### Base URL: `http://localhost:3009/api/medicines`

### Public Endpoints

#### 9.1 Get All Medicines (Public)
- **GET** `/`
- **Query Parameters**: `page`, `limit`, `category`, `status`

#### 9.2 Search Medicines (Public)
- **GET** `/search`
- **Query Parameters**: `q`, `page`, `limit`

#### 9.3 Get Low Stock Medicines (Public)
- **GET** `/low-stock`

#### 9.4 Get Out of Stock Medicines (Public)
- **GET** `/out-of-stock`

#### 9.5 Get Stock Report (Public)
- **GET** `/stock-report`

#### 9.6 Get Medicine by ID (Public)
- **GET** `/:id`

### Protected Endpoints

#### 9.7 Create Medicine
- **POST** `/`
- **Headers**: Authorization Bearer token
- **Body**:
```json
{
  "name": "Amoxicillin",
  "description": "Antibiotic medication",
  "category": "Antibiotics",
  "manufacturer": "PharmaCorp",
  "price": 50000,
  "unit": "tablet",
  "stockQuantity": 100,
  "minStockLevel": 10,
  "expiryDate": "2025-12-31",
  "isActive": true
}
```

#### 9.8 Update Medicine
- **PUT** `/:id`
- **Headers**: Authorization Bearer token
- **Body**: Same as create

#### 9.9 Toggle Medicine Status
- **PATCH** `/:id/toggle`
- **Headers**: Authorization Bearer token

#### 9.10 Delete Medicine
- **DELETE** `/:id`
- **Headers**: Authorization Bearer token

#### 9.11 Update Stock
- **PATCH** `/:id/stock`
- **Headers**: Authorization Bearer token
- **Body**:
```json
{
  "quantity": 50,
  "operation": "add",
  "reason": "New stock arrived"
}
```

#### 9.12 Bulk Update Stock
- **PATCH** `/bulk/stock`
- **Headers**: Authorization Bearer token
- **Body**:
```json
{
  "updates": [
    {
      "medicineId": "medicine_id_1",
      "quantity": 20,
      "operation": "add"
    },
    {
      "medicineId": "medicine_id_2",
      "quantity": 10,
      "operation": "subtract"
    }
  ],
  "reason": "Bulk stock update"
}
```

---

## Testing Workflow

### 1. Authentication Flow
1. Register new user with OTP verification
2. Login to get JWT token
3. Use token for all protected endpoints

### 2. Basic CRUD Testing Order
1. **Auth Service**: Register → Login → Get Profile
2. **Room Service**: Create Room → Get Rooms → Create Subroom
3. **Service Service**: Create Service → Create Add-on → Get Services
4. **Schedule Service**: Generate Quarter → Get Available Slots
5. **Appointment Service**: Create Appointment → Get Appointments
6. **Payment Service**: Create Payment → Handle Webhook
7. **Invoice Service**: Create Invoice → Finalize Invoice
8. **Record Service**: Create Record → Add Prescription
9. **Medicine Service**: Create Medicine → Update Stock

### 3. Postman Environment Variables
Set up the following variables:
- `base_url_auth`: `http://localhost:3001`
- `base_url_room`: `http://localhost:3002`
- `base_url_service`: `http://localhost:3003`
- `base_url_schedule`: `http://localhost:3004`
- `base_url_appointment`: `http://localhost:3006`
- `base_url_payment`: `http://localhost:3007`
- `base_url_invoice`: `http://localhost:3008`
- `base_url_record`: `http://localhost:3010`
- `base_url_medicine`: `http://localhost:3009`
- `jwt_token`: (set after login)

### 4. Common Headers
For all protected routes:
```
Authorization: Bearer {{jwt_token}}
Content-Type: application/json
```

### 5. Error Handling
All services return errors in format:
```json
{
  "success": false,
  "message": "Error description",
  "error": "Detailed error information"
}
```

### 6. Success Response Format
All services return success responses in format:
```json
{
  "success": true,
  "message": "Success message",
  "data": { ... }
}
```

---

## Notes
- Ensure all services are running before testing
- Test in the recommended order for data dependencies
- Use proper role-based tokens for restricted endpoints
- Check service logs for detailed error information
- Some endpoints may require existing data (users, rooms, services, etc.)