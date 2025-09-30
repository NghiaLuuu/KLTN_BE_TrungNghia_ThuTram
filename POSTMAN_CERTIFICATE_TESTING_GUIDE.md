/**
 * 📋 POSTMAN TESTING GUIDE FOR CERTIFICATE BATCH OPERATIONS
 * ========================================================
 */

// ================================================================
// 🚀 BATCH-CREATE - Tạo 2 chứng chỉ mới
// ================================================================

/*
Method: PUT
URL: http://localhost:3001/api/users/68d9f8bab5a75931c6cd0d7d/certificates

Headers:
- Authorization: Bearer YOUR_JWT_TOKEN

Body (form-data):
┌─────────────────┬─────────────────────────────────────────┬──────────┐
│ Key             │ Value                                   │ Type     │
├─────────────────┼─────────────────────────────────────────┼──────────┤
│ action          │ batch-create                            │ Text     │
│ name0           │ Chứng chỉ Nha khoa Thẩm mỹ             │ Text     │
│ name1           │ Chứng chỉ Phẫu thuật Nha khoa          │ Text     │
│ certificateNotes│ Batch tạo 2 chứng chỉ cho Dr. ABC     │ Text     │
│ frontImages     │ [Select cert1_front.jpg]                │ File     │
│ frontImages     │ [Select cert2_front.jpg]                │ File     │
│ backImages      │ [Select cert1_back.jpg]                 │ File     │
│ backImages      │ [Select cert2_back.jpg]                 │ File     │
└─────────────────┴─────────────────────────────────────────┴──────────┘

⚠️ Lưu ý: 
- Chọn key "frontImages" lần 1, upload file cert1_front.jpg
- Chọn key "frontImages" lần 2, upload file cert2_front.jpg
- Tương tự với backImages
*/

// ================================================================
// 🔄 BATCH-UPDATE - Cập nhật 2 chứng chỉ hiện có
// ================================================================

/*
Method: PUT
URL: http://localhost:3001/api/users/68d9f8bab5a75931c6cd0d7d/certificates

Headers:
- Authorization: Bearer YOUR_JWT_TOKEN

Body (form-data):
┌─────────────────┬──────────────────────────────────────────────┬──────────┐
│ Key             │ Value                                        │ Type     │
├─────────────────┼──────────────────────────────────────────────┼──────────┤
│ action          │ batch-update                                 │ Text     │
│ certificateId0  │ cert_68d9f8bab5a75931c6cd0d7d_1727...        │ Text     │
│ certificateId1  │ cert_68d9f8bab5a75931c6cd0d7d_1727...        │ Text     │
│ name0           │ Chứng chỉ Nha khoa Thẩm mỹ - Cập nhật       │ Text     │
│ name1           │ Chứng chỉ Phẫu thuật Nha khoa - Cập nhật    │ Text     │
│ certificateNotes│ Cập nhật thông tin chứng chỉ                │ Text     │
│ isVerified      │ true                                         │ Text     │
│ frontImages     │ [Select new_cert1_front.jpg] (optional)     │ File     │
│ frontImages     │ [Select new_cert2_front.jpg] (optional)     │ File     │
│ backImages      │ [Select new_cert1_back.jpg] (optional)      │ File     │
│ backImages      │ [Select new_cert2_back.jpg] (optional)      │ File     │
└─────────────────┴──────────────────────────────────────────────┴──────────┘

⚠️ Quan trọng:
- certificateId0 tương ứng với frontImages[0] và backImages[0]
- certificateId1 tương ứng với frontImages[1] và backImages[1]
- name0, name1 là optional (chỉ cần nếu muốn đổi tên)
- Files là optional (chỉ cần nếu muốn thay ảnh)
*/

// ================================================================
// 🗑️ BATCH-DELETE - Xóa 2 chứng chỉ
// ================================================================

/*
Method: PUT
URL: http://localhost:3001/api/users/68d9f8bab5a75931c6cd0d7d/certificates

Headers:
- Authorization: Bearer YOUR_JWT_TOKEN

Body (form-data):
┌─────────────────┬──────────────────────────────────────────────┬──────────┐
│ Key             │ Value                                        │ Type     │
├─────────────────┼──────────────────────────────────────────────┼──────────┤
│ action          │ batch-delete                                 │ Text     │
│ certificateId0  │ cert_68d9f8bab5a75931c6cd0d7d_1727...        │ Text     │
│ certificateId1  │ cert_68d9f8bab5a75931c6cd0d7d_1727...        │ Text     │
└─────────────────┴──────────────────────────────────────────────┴──────────┘

✅ Đơn giản nhất - chỉ cần action và certificateIds
*/

// ================================================================
// 🔍 COMMON ERRORS & SOLUTIONS
// ================================================================

/*
❌ MulterError: Unexpected field
→ Solution: Đảm bảo chỉ sử dụng keys: frontImages, backImages (không phải frontImage, backImage)

❌ "Số lượng ảnh mặt trước phải bằng số lượng tên chứng chỉ"
→ Solution: Đảm bảo number of frontImages = number of names (name0, name1, ...)

❌ "Phải có ít nhất 1 tên chứng chỉ"
→ Solution: Đảm bảo có name0, name1, ... trong form-data

❌ "Chỉ có thể [tạo/cập nhật/xóa] chứng chỉ của nha sĩ"
→ Solution: Đảm bảo userId trong URL là của một nha sĩ (role: 'dentist')

❌ "Chứng chỉ XXX không thuộc về nha sĩ YYY"
→ Solution: Kiểm tra lại certificateId có thuộc đúng dentist không

❌ "Không tìm thấy chứng chỉ XXX để cập nhật/xóa"
→ Solution: Kiểm tra lại certificateId có tồn tại trong certificates array không

❌ "Chứng chỉ 'XXX' đã tồn tại"
→ Solution: Sử dụng tên chứng chỉ khác (unique per user)

❌ "Ảnh chứng chỉ 'XXX' có thể đã tồn tại trong hệ thống"
→ Solution: Sử dụng file ảnh khác (unique filename across all dentists)
*/

// ================================================================
// 📋 STEP-BY-STEP POSTMAN SETUP
// ================================================================

/*
1️⃣ Tạo new request:
   - Method: PUT
   - URL: http://localhost:3001/api/users/68d9f8bab5a75931c6cd0d7d/certificates

2️⃣ Headers tab:
   - Add Authorization: Bearer YOUR_JWT_TOKEN

3️⃣ Body tab:
   - Select "form-data"
   - Click "Bulk Edit" to paste multiple rows quickly
   
4️⃣ For BATCH-CREATE, add these rows:
   action:batch-create
   name0:Chứng chỉ Nha khoa Thẩm mỹ
   name1:Chứng chỉ Phẫu thuật Nha khoa
   certificateNotes:Batch tạo 2 chứng chỉ
   
5️⃣ For files, use Key-Value mode:
   - Key: frontImages, Type: File, Value: Select file 1
   - Key: frontImages, Type: File, Value: Select file 2
   - Key: backImages, Type: File, Value: Select file 3 (optional)
   - Key: backImages, Type: File, Value: Select file 4 (optional)

6️⃣ Send request and check response
*/

// ================================================================
// 💡 TIPS & BEST PRACTICES
// ================================================================

/*
🔥 Performance Tips:
- Sử dụng ảnh có kích thước hợp lý (< 5MB)
- Batch create/update tối đa 10 chứng chỉ cùng lúc
- Đặt tên file rõ ràng để tránh duplicate

🛡️ Security Tips:
- Chỉ admin/manager có thể quản lý chứng chỉ
- Token JWT phải hợp lệ
- Validate file type (JPG, PNG, WEBP only)

📊 Testing Tips:
- Test từng action riêng lẻ trước
- Kiểm tra response data structure
- Verify URLs trong response có thể access được
- Test với các edge cases (no files, invalid IDs, etc.)
*/