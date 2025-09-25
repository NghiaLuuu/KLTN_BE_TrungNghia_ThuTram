# HasBeenUsed Implementation Summary

## Overview
Đã thêm trường `hasBeenUsed` vào các model để ngăn việc xóa những entity đã được sử dụng trong hệ thống.

## Changes Made

### 1. Auth Service - User Model
**File**: `services/auth-service/src/models/user.model.js`
- ✅ Thêm trường `hasBeenUsed: Boolean, default: false, index: true`

**File**: `services/auth-service/src/repositories/user.repository.js`
- ✅ Thêm hàm `markUserAsUsed(userId)` để cập nhật hasBeenUsed = true

**File**: `services/auth-service/src/services/user.service.js`
- ✅ Cập nhật hàm `deleteUser()` để kiểm tra `hasBeenUsed` trước khi xóa
- ✅ Nếu hasBeenUsed = true → chỉ cho phép soft delete
- ✅ Nếu hasBeenUsed = false → cho phép hard delete

### 2. Room Service - Room Model
**File**: `services/room-service/src/models/room.model.js`
- ✅ Thêm trường `hasBeenUsed: Boolean, default: false, index: true` cho Room schema
- ✅ Thêm trường `hasBeenUsed: Boolean, default: false` cho SubRoom schema

**File**: `services/room-service/src/repositories/room.repository.js`
- ✅ Thêm hàm `markRoomAsUsed(roomId)` để cập nhật hasBeenUsed = true cho room
- ✅ Thêm hàm `markSubRoomAsUsed(roomId, subRoomId)` để cập nhật hasBeenUsed = true cho subroom

**File**: `services/room-service/src/services/room.service.js`
- ✅ Cập nhật hàm `deleteRoom()` để kiểm tra `hasBeenUsed` trước khi xóa
- ✅ Cập nhật hàm `deleteSubRoom()` để kiểm tra `hasBeenUsed` trước khi xóa
- ✅ Kiểm tra cả room và tất cả subRooms trước khi cho phép xóa

### 3. Service Service - Service Model
**File**: `services/service-service/src/models/service.model.js`
- ✅ Thêm trường `hasBeenUsed: Boolean, default: false, index: true` cho Service schema
- ✅ Thêm trường `hasBeenUsed: Boolean, default: false` cho ServiceAddOn schema

**File**: `services/service-service/src/repositories/service.repository.js`
- ✅ Thêm hàm `markServiceAsUsed(serviceId)` để cập nhật hasBeenUsed = true cho service
- ✅ Thêm hàm `markServiceAddOnAsUsed(serviceId, addOnId)` để cập nhật hasBeenUsed = true cho serviceAddOn
- ✅ Cập nhật hàm `deleteService()` và `deleteServiceAddOn()` để thực sự xóa thay vì throw error

**File**: `services/service-service/src/services/service.service.js`
- ✅ Cập nhật hàm `deleteService()` để kiểm tra `hasBeenUsed` trước khi xóa
- ✅ Cập nhật hàm `deleteServiceAddOn()` để kiểm tra `hasBeenUsed` trước khi xóa
- ✅ Kiểm tra không được xóa hết serviceAddOns (phải có ít nhất 1)

### 4. Schedule Service - Integration
**File**: `services/schedule-service/src/services/slot.service.js`
- ✅ Thêm hàm `isUserAlreadyUsed()` để kiểm tra Redis cache trước khi gửi message
- ✅ Thêm hàm `markEntitiesAsUsed()` với cache optimization để đánh dấu các entity đã được sử dụng
- ✅ Gọi `markEntitiesAsUsed()` trong hàm `assignStaffToSlots()` sau khi phân công thành công
- ✅ Gọi `markEntitiesAsUsed()` trong hàm `updateSlotStaff()` sau khi cập nhật thành công
- ✅ **Cache Optimization**: Kiểm tra `user.hasBeenUsed` trong Redis cache trước khi gửi RabbitMQ message

## Business Logic

### Deletion Rules
1. **User (Staff)**:
   - hasBeenUsed = false → Hard delete (xóa hoàn toàn)
   - hasBeenUsed = true → Soft delete (isActive = false)

2. **Room/SubRoom**:
   - hasBeenUsed = false → Cho phép xóa
   - hasBeenUsed = true → Không cho phép xóa (throw error)

3. **Service/ServiceAddOn**:
   - hasBeenUsed = false → Cho phép xóa
   - hasBeenUsed = true → Không cho phép xóa (throw error)
   - ServiceAddOn: Không được xóa hết (phải có ít nhất 1)

### Usage Tracking
- Khi nhân viên được phân công vào slot → `markUserAsUsed(userId)`
- Khi phòng/subRoom được sử dụng trong slot → `markRoomAsUsed(roomId)` / `markSubRoomAsUsed(roomId, subRoomId)`
- Khi service/serviceAddOn được sử dụng trong appointment → `markServiceAsUsed(serviceId)` / `markServiceAddOnAsUsed(serviceId, addOnId)`

## TODO - Next Steps

### 1. RabbitMQ Communication - ✅ COMPLETED
Đã implement RabbitMQ communication thực tế:

**Schedule Service**:
- ✅ Tạo `rabbitClient.js` để publish messages
- ✅ Cập nhật `markEntitiesAsUsed()` để gửi RabbitMQ messages thay vì console.log
- ✅ Gửi messages đến `auth_queue` và `room_queue` khi staff được phân công

**Auth Service**:
- ✅ Đã có RPC server `user.rpc.js` 
- ✅ Thêm action `markUserAsUsed` để xử lý messages từ schedule-service
- ✅ Tự động cập nhật `user.hasBeenUsed = true` khi nhận message
- ✅ **Cache Refresh**: Tự động refresh `users_cache` sau khi cập nhật hasBeenUsed

**Room Service**:
- ✅ Tạo RPC server `room.rpc.js` với actions `markRoomAsUsed` và `markSubRoomAsUsed`
- ✅ Cập nhật `index.js` để khởi động RPC server
- ✅ Tự động cập nhật `room.hasBeenUsed = true` khi nhận message

**Message Flow**:
```javascript
// Schedule service sends:
await publishToQueue('auth_queue', {
  action: 'markUserAsUsed',
  payload: { userId: dentistId }
});

await publishToQueue('room_queue', {
  action: 'markRoomAsUsed', 
  payload: { roomId }
});
```

### 2. Service Usage Tracking
Cần thêm logic cập nhật `hasBeenUsed` cho service khi:
- Service được sử dụng trong appointment
- ServiceAddOn được chọn trong appointment

### 3. Database Migration
Các trường `hasBeenUsed` mới được thêm với `default: false`. Có thể cần migration để:
- Đánh dấu các entity cũ đã được sử dụng dựa trên dữ liệu hiện có
- Cập nhật index cho performance

## Testing
- ✅ Kiểm tra delete operations với hasBeenUsed = false/true
- ✅ Kiểm tra staff assignment triggers markEntitiesAsUsed
- ✅ Kiểm tra RabbitMQ communication (đã implement)
- ⏳ Kiểm tra service usage tracking (sau khi implement)

## Security & Performance
- Thêm index cho trường `hasBeenUsed` để tối ưu query
- Validation để đảm bảo hasBeenUsed chỉ có thể chuyển từ false → true, không được đảo ngược
- Rate limiting cho các API delete để tránh abuse