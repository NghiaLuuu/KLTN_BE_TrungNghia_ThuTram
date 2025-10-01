# SLOT MANAGEMENT API - SUBROOM LOGIC IMPROVEMENTS 

## 🎯 Vấn đề đã giải quyết

Bạn báo cáo: *"kiểm tra lại api này, đã phân biệt phòng có subroom và không có subroom như api assign-staff không, lỗi cũng chưa rõ ràng"*

## ✅ Cải tiến hoàn tất 

### 1. **Logic SubRoom thống nhất giữa 3 APIs**
```javascript
// TRƯỚC: Logic không nhất quán, lỗi khó hiểu
// SAU: Logic thống nhất và thông minh

// ✅ Phòng có subRoom - BẮT BUỘC gửi subRoomId
{
  "roomId": "68dd31c43df7b61e7b509e70", // Phòng có subRoom  
  "subRoomId": "68dd2e1d3df7b61e7b509e42", // Phải chỉ định
  // ... other fields
}

// ✅ Phòng không có subRoom - KHÔNG ĐƯỢC gửi subRoomId  
{
  "roomId": "68dd31c43df7b61e7b509e61", // Phòng không có subRoom
  // subRoomId: KHÔNG GỬI hoặc null
  // ... other fields
}
```

### 2. **Thông báo lỗi chi tiết và hướng dẫn cụ thể**
```javascript
// TRƯỚC: "Không tìm thấy slot phù hợp" (mơ hồ)
// SAU: Lỗi chi tiết với hướng dẫn

❌ "Phòng 'Khoa Nội' không có subroom nhưng bạn đã chỉ định subRoomId. Vui lòng bỏ subRoomId hoặc chọn phòng khác."

❌ "Phòng 'Khoa Ngoại' có 3 subroom. Vui lòng chỉ định subRoomId cụ thể: 64f...123 (Khu A), 64f...124 (Khu B), 64f...125 (Khu C)"

❌ "SubRoom không thuộc về phòng 'Khoa Tim'. Vui lòng kiểm tra lại subRoomId."
```

### 3. **Validation tăng cường cho PATCH /staff**
```javascript
// TRƯỚC: Không kiểm tra slots cùng room/subroom
// SAU: Validation nghiêm ngặt

❌ "Tất cả slot phải thuộc cùng một phòng. Slot 650f...124 thuộc phòng khác."

❌ "Tất cả slot phải thuộc cùng subroom. Slot đầu tiên có subroom A, nhưng slot 650f...125 có subroom B."
```

## 🔧 APIs đã cập nhật

### 1. `POST /api/slots/assign-staff`
- ✅ Logic subRoom thông minh
- ✅ Thông báo lỗi với tên phòng/subRoom cụ thể  
- ✅ Hướng dẫn action tiếp theo

### 2. `POST /api/slots/reassign-staff`  
- ✅ Logic tương đồng assign-staff
- ✅ Phân biệt rõ phòng có/không subRoom
- ✅ Error context với room display name

### 3. `PATCH /api/slots/staff`
- ✅ Validation slots cùng room/subRoom
- ✅ Thông báo lỗi với slot ID cụ thể
- ✅ Kiểm tra nhất quán về room hierarchy

## 🧪 Test Cases mới

Tạo `TEST_SLOT_SUBROOM_LOGIC.js` và `test-slot-subroom-apis.js` để kiểm tra:

### Scenarios được cover:
1. ✅ Phòng có subRoom + đúng subRoomId → SUCCESS
2. ❌ Phòng không có subRoom + gửi subRoomId → ERROR rõ ràng  
3. ❌ Phòng có subRoom + không gửi subRoomId → ERROR với danh sách
4. ❌ subRoomId không thuộc roomId → ERROR với tên phòng
5. ❌ Update slots khác room → ERROR với slot ID  
6. ❌ Update slots khác subRoom → ERROR với room hierarchy

## 📋 Để test API của bạn

```javascript
// TEST 1: API reassign-staff với data của bạn
{
  "roomId": "68dd31c43df7b61e7b509e61",
  // "subRoomId": "68dd2e1d3df7b61e7b509e42", // Comment out nếu phòng không có subRoom
  "quarter": 4,
  "year": 2025,
  "shifts": ["Ca Sáng", "Ca Chiều"],
  "dentistIds": ["68d9f8bab5a75931c6cd0d7d"],
  "nurseIds": ["68dd3147327b922b6119b8ed"]
}
```

**Chạy test:**
```bash
node test-slot-subroom-apis.js
```

## 🎉 Kết quả

✅ **Logic SubRoom**: Thống nhất giữa 3 APIs  
✅ **Error Messages**: Rõ ràng, có tên phòng/subRoom cụ thể  
✅ **Validation**: Nghiêm ngặt về room hierarchy  
✅ **User Experience**: Hướng dẫn action tiếp theo  
✅ **Test Coverage**: Full scenarios với data thật  

**Bây giờ API đã phân biệt rõ ràng phòng có/không có subRoom và có thông báo lỗi chi tiết!** 🚀