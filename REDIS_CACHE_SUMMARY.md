# 📦 REDIS CACHE - HỆ THỐNG SMILE DENTAL

## � TỔNG QUAN

### Thông tin cơ bản
- **Redis Package**: redis (Node.js)
- **Kết nối**: `localhost:6379` (dev), cần config password khi production
- **Số lượng**: 10 services sử dụng Redis
- **Mục đích**: Tăng tốc độ truy vấn, giảm tải database, lưu dữ liệu tạm thời

### Cách hoạt động
- **Permanent Cache**: Không tự xóa, chỉ xóa khi data thay đổi (users, rooms, services)
- **Temporary Cache**: Tự động xóa sau TTL (query results, stats, OTP)
- **Two-tier Cache**: Memory (60s) + Redis (schedule-service)

---

## � DANH SÁCH CACHE

## 📂 DANH SÁCH CACHE

### 1. AUTH-SERVICE (Xác thực & Người dùng)

#### 🔹 Cache danh sách người dùng
**Tên:** `users_cache`  
**Lưu gì:** Danh sách tất cả users (bác sĩ, y tá, lễ tân, admin, bệnh nhân)  
**Thời gian sống:** Vĩnh viễn (không tự xóa)  
**Tại sao:** Các service khác (schedule, appointment) cần lấy thông tin user nhanh, không cần gọi API  
**Cập nhật khi:** Tạo/sửa/xóa user  

**Tên:** `dentists_public`  
**Lưu gì:** Danh sách bác sĩ công khai (cho bệnh nhân xem)  
**Thời gian sống:** 1 giờ  
**Tại sao:** Hiển thị danh sách bác sĩ khi bệnh nhân đặt lịch  
**Cập nhật khi:** Có bác sĩ mới hoặc thông tin thay đổi  

#### 🔹 Cache OTP (Mã xác thực)
**Tên:** `otp:register:{email}`  
**Lưu gì:** Mã OTP đăng ký (6 số)  
**Thời gian sống:** 5 phút  
**Tại sao:** Xác thực email khi đăng ký tài khoản  

**Tên:** `otp:reset:{email}`  
**Lưu gì:** Mã OTP quên mật khẩu (6 số)  
**Thời gian sống:** 5 phút  
**Tại sao:** Xác thực email khi reset password  

**Tên:** `otp:register:verified:{email}`  
**Lưu gì:** Đánh dấu đã xác thực OTP  
**Thời gian sống:** 10 phút  
**Tại sao:** Cho phép hoàn tất đăng ký sau khi verify OTP  

---

### 2. ROOM-SERVICE (Phòng khám)

**Tên:** `rooms_cache`  
**Lưu gì:** Danh sách tất cả phòng khám + buồng con (subrooms)  
**Thời gian sống:** Vĩnh viễn  
**Tại sao:** Schedule-service cần biết phòng nào để tạo lịch, appointment-service cần hiển thị tên phòng  
**Cập nhật khi:** Tạo/sửa/xóa phòng hoặc buồng con  

**Ví dụ dữ liệu:**
```
Phòng 1 (có buồng con)
  ├─ Buồng 1 (active)
  └─ Buồng 2 (inactive)

Phòng 2 (không có buồng con)
  └─ Tối đa: 1 bác sĩ, 1 y tá
```

---

### 3. SERVICE-SERVICE (Dịch vụ nha khoa)

**Tên:** `services_cache`  
**Lưu gì:** Danh sách tất cả dịch vụ (khám tổng quát, nhổ răng, trám răng...)  
**Thời gian sống:** Vĩnh viễn  
**Tại sao:** Appointment-service cần lấy thông tin dịch vụ khi tạo lịch hẹn  
**Cập nhật khi:** Tạo/sửa/xóa dịch vụ  

---

### 4. SCHEDULE-SERVICE (Lịch làm việc)

#### 🔹 Cache cấu hình hệ thống
**Tên:** `schedule_config_cache`  
**Lưu gì:** Cấu hình ca làm việc (ca sáng, chiều, tối), thời gian mỗi slot, giới hạn bệnh nhân  
**Thời gian sống:** Vĩnh viễn  
**Tại sao:** FE cần lấy config để hiển thị form tạo lịch  
**Cập nhật khi:** Admin thay đổi cấu hình ca làm việc  

**Ví dụ:**
```
Ca sáng: 08:00 - 12:00
Ca chiều: 13:00 - 17:00
Mỗi slot: 30 phút
Tối đa: 3 bệnh nhân/slot
```

**Tên:** `holiday_config_cache`  
**Lưu gì:** Danh sách ngày nghỉ lễ (Tết, 30/4, 1/5...)  
**Thời gian sống:** Vĩnh viễn  
**Tại sao:** Không tạo lịch vào ngày nghỉ lễ  
**Cập nhật khi:** Admin thêm/sửa/xóa ngày nghỉ  

#### 🔹 Cache 2 tầng (Memory + Redis)
Schedule-service dùng kỹ thuật đặc biệt:
1. **Tầng 1 - Memory**: Lưu trong RAM 60 giây (cực nhanh)
2. **Tầng 2 - Redis**: Lấy từ `users_cache` và `rooms_cache`
3. **Tầng 3 - Database**: Nếu Redis không có (fallback)

**Lợi ích:** Giảm 90% số lần đọc Redis, tăng tốc độ xử lý

#### 🔹 Cache lịch phòng/user (Calendar)
**Tên:** `room_calendar:{roomId}:{subRoomId}:{viewType}:{startDate}:{page}:{limit}:{futureOnly}`  
**Lưu gì:** Lịch làm việc của phòng theo ngày/tuần/tháng (kèm số lượng appointment)  
**Thời gian sống:** 1 giờ (3600 giây)  
**Tại sao:** Trang calendar được xem nhiều, cache giúp tăng tốc độ load  
**API:** `GET /api/slots/room/:roomId/calendar`  

**Ví dụ key:**
- `room_calendar:room123:main:day:2024-12-20:0:10:false`
- `room_calendar:room123:subroom1:week:2024-12-20:1:10:true`

**Xóa cache khi:** Update/disable/delete slots của phòng đó

---

### 5. PAYMENT-SERVICE (Thanh toán)

#### 🔹 Cache thông tin thanh toán
**Tên:** `payment:{id}`  
**Lưu gì:** Chi tiết 1 payment  
**Thời gian sống:** 5 phút  

**Tên:** `payment:patient:{patientId}`  
**Lưu gì:** Lịch sử thanh toán của 1 bệnh nhân  
**Thời gian sống:** 5 phút  

**Tên:** `payment:list:{filters}`  
**Lưu gì:** Kết quả tìm kiếm/lọc payments  
**Thời gian sống:** 10 phút  

#### 🔹 Cache thống kê
**Tên:** `payment:stats:monthly:{date}`  
**Lưu gì:** Doanh thu tháng (dashboard admin)  
**Thời gian sống:** 1 giờ  

**Tên:** `payment:stats:daily:{date}`  
**Lưu gì:** Doanh thu ngày  
**Thời gian sống:** 30 phút  

#### 🔹 Cache VNPay (Thanh toán online)
**Tên:** `payment:temp:{orderId}`  
**Lưu gì:** Thông tin thanh toán tạm (chờ VNPay xác nhận)  
**Thời gian sống:** 15 phút  
**Tại sao:** Khi user chuyển sang VNPay, lưu tạm, đợi callback  

**Tên:** `payment:vnpay:{orderId}`  
**Lưu gì:** Ánh xạ orderId của VNPay → paymentId trong DB  
**Thời gian sống:** 30 phút  
**Tại sao:** Khi VNPay callback, tìm payment nào tương ứng  

**Tên:** `payment:role:{orderId}`  
**Lưu gì:** Vai trò người thanh toán (bệnh nhân/admin/lễ tân)  
**Thời gian sống:** 30 phút  
**Tại sao:** Phân quyền khi xử lý callback  

**Tên:** `appointment_hold:{key}`  
**Lưu gì:** Giữ chỗ appointment trong khi chờ thanh toán  
**Thời gian sống:** 10 phút  
**Tại sao:** Tránh bị người khác book slot trong lúc đang thanh toán  

---

### 6. RECORD-SERVICE (Hồ sơ bệnh án)

**Tên:** `records:list:{filters}`  
**Lưu gì:** Kết quả tìm kiếm hồ sơ  
**Thời gian sống:** 5 phút  

**Tên:** `records:dentist:{dentistId}`  
**Lưu gì:** Danh sách hồ sơ của 1 bác sĩ  
**Thời gian sống:** 5 phút  

**Tên:** `records:patient:{patientId}`  
**Lưu gì:** Lịch sử khám của 1 bệnh nhân  
**Thời gian sống:** 5 phút  

**Tên:** `records:pending`  
**Lưu gì:** Hồ sơ đang chờ xử lý  
**Thời gian sống:** 2.5 phút (ngắn vì thay đổi liên tục)  

**Tên:** `records:stats:*`  
**Lưu gì:** Thống kê hồ sơ (dashboard)  
**Thời gian sống:** 10 phút  

---

### 7. INVOICE-SERVICE (Hóa đơn)

**Tên:** `invoice:{id}`  
**Lưu gì:** Chi tiết 1 hóa đơn  
**Thời gian sống:** 5 phút  

**Tên:** `invoices:{filters}`  
**Lưu gì:** Kết quả tìm kiếm hóa đơn  
**Thời gian sống:** 1 phút (ngắn vì hay thay đổi)  

**Tên:** `invoice:stats:monthly:{params}`  
**Lưu gì:** Thống kê hóa đơn tháng  
**Thời gian sống:** 30 phút  

**Tên:** `invoice:stats:quarterly:{params}`  
**Lưu gì:** Thống kê hóa đơn quý  
**Thời gian sống:** 30 phút  

**Tên:** `invoice:dashboard`  
**Lưu gì:** Dữ liệu tổng hợp cho dashboard  
**Thời gian sống:** 5 phút  

---

### 8. MEDICINE-SERVICE (Thuốc)

**Tên:** `medicines:{filters}`  
**Lưu gì:** Danh sách thuốc theo điều kiện lọc  
**Thời gian sống:** 5 phút  
**Tại sao:** Tìm kiếm thuốc nhanh hơn  
**Cập nhật khi:** Tạo/sửa/xóa thuốc → xóa tất cả cache `medicines:*`  

---

### 9. STATISTIC-SERVICE (Thống kê)

**Tên:** `stats:{type}:{params}`  
**Lưu gì:** Các loại thống kê tổng quát  
**Thời gian sống:** 1 giờ (mặc định)  
**Tại sao:** Thống kê nặng, ít thay đổi, cache lâu để giảm tải DB  

**Ví dụ key:**
- `stats:revenue:month:1|year:2024`
- `stats:appointments:dentist:123|month:2`

---

### 10. APPOINTMENT-SERVICE (Lịch hẹn)

**Đặc biệt:** Service này không có cache riêng, chỉ **đọc** cache từ các service khác:
- Đọc `users_cache` từ auth-service
- Đọc `rooms_cache` từ room-service  
- Đọc `services_cache` từ service-service

---

## ⏱️ THỜI GIAN SỐNG (TTL)

### Vĩnh viễn (không tự xóa)
- `users_cache` - Danh sách users
- `rooms_cache` - Danh sách phòng
- `services_cache` - Danh sách dịch vụ
- `schedule_config_cache` - Cấu hình ca làm việc
- `holiday_config_cache` - Danh sách ngày nghỉ

### Ngắn (< 5 phút)
- `records:pending` - 2.5 phút
- `invoices:*` - 1 phút
- `otp:*` - 5 phút
- `payment:*` - 5 phút
- `medicines:*` - 5 phút

### Trung bình (5-30 phút)
- `payment:temp:*` - 15 phút
- `payment:vnpay:*` - 30 phút
- `invoice:stats:*` - 30 phút

### Dài (> 30 phút)
- `payment:stats:*` - 1 giờ
- `stats:*` - 1 giờ
- `dentists_public` - 1 giờ
- `room_calendar:*` - 1 giờ (3600 giây)
- `dentist_calendar:*` - 1 giờ (nếu có, tương tự room_calendar)
- `nurse_calendar:*` - 1 giờ (nếu có, tương tự room_calendar)

---

## 🔄 CÁCH LÀM MỚI CACHE

### 1. Xóa ngay khi có thay đổi
Dùng cho: users, rooms, services
```
User mới được tạo → Xóa users_cache → Load lại từ DB
```

### 2. Để cache tự hết hạn
Dùng cho: query results, statistics
```
Tìm kiếm payment → Cache 5 phút → Tự xóa sau 5 phút
```

### 3. Cache 2 tầng (schedule-service)
```
Lần 1: Lấy từ Memory (60s)
Lần 2: Lấy từ Redis
Lần 3: Lấy từ Database
```

---

## 🎯 TẠI SAO DÙNG CACHE?

### Không cache
```
Bệnh nhân đặt lịch → Gọi API lấy danh sách bác sĩ → Database (100ms)
100 người đặt lịch → 100 lần query DB → Chậm, tốn tài nguyên
```

### Có cache
```
Lần 1: Load danh sách bác sĩ từ DB (100ms) → Lưu Redis
Lần 2-100: Lấy từ Redis (5ms) → Nhanh gấp 20 lần
```

### Lợi ích
✅ Tăng tốc độ: Giảm từ 100ms xuống 5ms  
✅ Giảm tải DB: Từ 100 queries → 1 query  
✅ Tiết kiệm tài nguyên: CPU, RAM, Network  
✅ Trải nghiệm tốt: Website phản hồi nhanh  

---

## ⚠️ LƯU Ý QUAN TRỌNG

### 1. Khi Deploy Production
- [ ] Đổi Redis connection: `localhost` → `production-redis-url`
- [ ] Bật password authentication cho Redis
- [ ] Check services khởi động đúng thứ tự:
  - ✅ Bước 1: auth-service, room-service, service-service (init cache)
  - ✅ Bước 2: Các service còn lại

### 2. Phụ thuộc giữa các services
```
schedule-service CẦN users_cache từ auth-service
                 CẦN rooms_cache từ room-service

appointment-service CẦN users_cache từ auth-service
                    CẦN rooms_cache từ room-service
                    CẦN services_cache từ service-service
```

**Nếu thiếu cache:** Services sẽ báo lỗi hoặc chạy chậm

### 3. Xóa cache khi maintenance
```powershell
# Vào Redis CLI
redis-cli

# Xóa tất cả cache (NGUY HIỂM - chỉ dùng khi maintenance)
FLUSHDB

# Xóa cache cụ thể
DEL users_cache
DEL rooms_cache
```

### 4. Dung lượng ước tính
- Cache vĩnh viễn: ~200 KB (nhẹ)
- Cache tạm thời: ~5-50 MB (phụ thuộc traffic)
- **Tổng:** Dưới 100 MB trong hầu hết trường hợp

---

## 📁 FILES QUAN TRỌNG

### Redis Client Setup
```
services/auth-service/src/utils/redis.client.js
services/room-service/src/utils/redis.client.js
services/service-service/src/utils/redis.client.js
... (10 services)
```

### Cache Logic
```
auth-service/src/services/user.service.js        → users_cache
auth-service/src/services/auth.service.js        → OTP caches
room-service/src/services/room.service.js        → rooms_cache
service-service/src/services/service.service.js  → services_cache
schedule-service/src/utils/cacheHelper.js        → Two-tier cache
payment-service/src/services/payment.service.js  → Payment caches
```

---

## 📊 MONITORING (Giám sát)

### Cần theo dõi
- ✅ Redis memory usage (dung lượng đã dùng)
- ✅ Cache hit/miss ratio (tỷ lệ truy cập cache thành công)
- ✅ Số lượng keys hiện tại
- ✅ Thời gian response của Redis

### Lệnh kiểm tra
```bash
# Xem thông tin Redis
redis-cli INFO

# Xem tất cả keys
redis-cli KEYS *

# Đếm số keys
redis-cli DBSIZE

# Xem memory usage
redis-cli INFO memory
```

---

**📅 Ngày tạo:** 20/12/2024  
**✍️ Tác giả:** AI Assistant  
**🎯 Mục đích:** Tài liệu cho deployment & maintenance

