/**
 * 🧪 CERTIFICATE BATCH OPERATIONS - TEST BODIES
 * ================================================
 * 
 * Endpoint: PUT /api/users/{userId}/certificates
 * Headers: 
 *   - Authorization: Bearer {token}
 *   - Content-Type: multipart/form-data
 */

// ================================================================
// 🆕 BATCH-CREATE CERTIFICATES
// ================================================================

/*
📝 Body Type: multipart/form-data

✅ Tạo 2 chứng chỉ mới:
*/
const batchCreateBody = {
  // Action
  action: 'batch-create',
  
  // Certificate names (required)
  name0: 'Chứng chỉ Nha khoa Thẩm mỹ',
  name1: 'Chứng chỉ Phẫu thuật Nha khoa',
  
  // Optional notes
  certificateNotes: 'Batch tạo 2 chứng chỉ cho nha sĩ Nguyễn Văn A',
  
  // Files (multipart)
  // frontImages[0]: file1.jpg (required)
  // frontImages[1]: file2.jpg (required)  
  // backImages[0]: file1_back.jpg (optional)
  // backImages[1]: file2_back.jpg (optional)
};

/*
📤 Postman/Insomnia setup:
- Method: PUT
- URL: http://localhost:3001/api/users/6507f1f4e1b2c3d4e5f6a789/certificates
- Body type: form-data
- Fields:
  * action: batch-create
  * name0: Chứng chỉ Nha khoa Thẩm mỹ  
  * name1: Chứng chỉ Phẫu thuật Nha khoa
  * certificateNotes: Batch tạo 2 chứng chỉ cho nha sĩ
  * frontImages: [Select File 1]    <-- Chọn nhiều file cùng key này
  * frontImages: [Select File 2]    <-- Chọn nhiều file cùng key này
  * backImages: [Select File 3] (optional)
  * backImages: [Select File 4] (optional)
*/


// ================================================================
// 🔄 BATCH-UPDATE CERTIFICATES  
// ================================================================

/*
📝 Body Type: multipart/form-data

✅ Cập nhật 2 chứng chỉ hiện có:
*/
const batchUpdateBody = {
  // Action
  action: 'batch-update',
  
  // Certificate IDs to update (required)
  certificateId0: 'cert_6507f1f4e1b2c3d4e5f6a789_1727747891234_abc12345_0',
  certificateId1: 'cert_6507f1f4e1b2c3d4e5f6a789_1727747891234_def67890_1',
  
  // New names (optional - chỉ update nếu muốn đổi tên)
  name0: 'Chứng chỉ Nha khoa Thẩm mỹ - Cập nhật',
  name1: 'Chứng chỉ Phẫu thuật Nha khoa - Cập nhật',
  
  // Optional notes  
  certificateNotes: 'Cập nhật thông tin 2 chứng chỉ',
  
  // Optional verification (chỉ admin/manager)
  isVerified: true,
  
  // Files (multipart) - optional, chỉ upload nếu muốn thay ảnh
  // frontImages[0]: new_file1.jpg (optional)
  // frontImages[1]: new_file2.jpg (optional)
  // backImages[0]: new_file1_back.jpg (optional) 
  // backImages[1]: new_file2_back.jpg (optional)
};

/*
📤 Postman/Insomnia setup:
- Method: PUT
- URL: http://localhost:3001/api/users/6507f1f4e1b2c3d4e5f6a789/certificates
- Body type: form-data
- Fields:
  * action: batch-update
  * certificateId0: cert_6507f1f4e1b2c3d4e5f6a789_1727747891234_abc12345_0
  * certificateId1: cert_6507f1f4e1b2c3d4e5f6a789_1727747891234_def67890_1
  * name0: Chứng chỉ Nha khoa Thẩm mỹ - Cập nhật (optional)
  * name1: Chứng chỉ Phẫu thuật Nha khoa - Cập nhật (optional)
  * certificateNotes: Cập nhật thông tin 2 chứng chỉ
  * isVerified: true
  * frontImages: [Select New File 1] (optional - nếu muốn thay ảnh)
  * frontImages: [Select New File 2] (optional - nếu muốn thay ảnh) 
  * backImages: [Select New File 3] (optional)
  * backImages: [Select New File 4] (optional)
  
  ⚠️ QUAN TRỌNG: 
  - Các file frontImages/backImages phải tương ứng với thứ tự certificateId
  - frontImages[0] tương ứng với certificateId0
  - frontImages[1] tương ứng với certificateId1
*/


// ================================================================
// 🗑️ BATCH-DELETE CERTIFICATES
// ================================================================

/*
📝 Body Type: multipart/form-data (hoặc application/x-www-form-urlencoded)

✅ Xóa 2 chứng chỉ:
*/
const batchDeleteBody = {
  // Action
  action: 'batch-delete',
  
  // Certificate IDs to delete (required)
  certificateId0: 'cert_6507f1f4e1b2c3d4e5f6a789_1727747891234_abc12345_0',
  certificateId1: 'cert_6507f1f4e1b2c3d4e5f6a789_1727747891234_def67890_1',
  
  // Không cần trường khác
};

/*
📤 Postman/Insomnia setup:
- Method: PUT  
- URL: http://localhost:3001/api/users/6507f1f4e1b2c3d4e5f6a789/certificates
- Body type: form-data (or x-www-form-urlencoded)
- Fields:
  * action: batch-delete
  * certificateId0: cert_6507f1f4e1b2c3d4e5f6a789_1727747891234_abc12345_0
  * certificateId1: cert_6507f1f4e1b2c3d4e5f6a789_1727747891234_def67890_1
*/


// ================================================================
// 🔍 CURL EXAMPLES  
// ================================================================

/*
🌟 BATCH CREATE (with files):
```bash
curl -X PUT "http://localhost:3001/api/users/6507f1f4e1b2c3d4e5f6a789/certificates" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F "action=batch-create" \
  -F "name0=Chứng chỉ Nha khoa Thẩm mỹ" \
  -F "name1=Chứng chỉ Phẫu thuật Nha khoa" \
  -F "certificateNotes=Batch tạo 2 chứng chỉ" \
  -F "frontImages=@/path/to/cert1_front.jpg" \
  -F "frontImages=@/path/to/cert2_front.jpg" \
  -F "backImages=@/path/to/cert1_back.jpg" \
  -F "backImages=@/path/to/cert2_back.jpg"
```

🔄 BATCH UPDATE:
```bash
curl -X PUT "http://localhost:3001/api/users/6507f1f4e1b2c3d4e5f6a789/certificates" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F "action=batch-update" \
  -F "certificateId0=cert_6507f1f4e1b2c3d4e5f6a789_1727747891234_abc12345_0" \
  -F "certificateId1=cert_6507f1f4e1b2c3d4e5f6a789_1727747891234_def67890_1" \
  -F "name0=Tên mới chứng chỉ 1" \
  -F "name1=Tên mới chứng chỉ 2" \
  -F "isVerified=true"
```

🗑️ BATCH DELETE:
```bash
curl -X PUT "http://localhost:3001/api/users/6507f1f4e1b2c3d4e5f6a789/certificates" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F "action=batch-delete" \
  -F "certificateId0=cert_6507f1f4e1b2c3d4e5f6a789_1727747891234_abc12345_0" \
  -F "certificateId1=cert_6507f1f4e1b2c3d4e5f6a789_1727747891234_def67890_1"
```
*/


// ================================================================
// 📋 RESPONSE EXAMPLES
// ================================================================

/*
✅ SUCCESS Response (All actions):
{
  "success": true,
  "message": "Tạo nhiều chứng chỉ thành công", // or "Cập nhật nhiều chứng chỉ thành công" or "Xóa nhiều chứng chỉ thành công"
  "data": {
    "_id": "6507f1f4e1b2c3d4e5f6a789",
    "fullName": "Dr. Nguyễn Văn A",
    "role": "dentist",
    "certificates": [
      {
        "certificateId": "cert_6507f1f4e1b2c3d4e5f6a789_1727747891234_abc12345_0",
        "name": "Chứng chỉ Nha khoa Thẩm mỹ",
        "frontImage": "https://kltntrungnghiathutram.s3.ap-southeast-1.amazonaws.com/avatars/uuid-cert1_front.jpg",
        "backImage": "https://kltntrungnghiathutram.s3.ap-southeast-1.amazonaws.com/avatars/uuid-cert1_back.jpg",
        "isVerified": false,
        "verifiedBy": null,
        "createdAt": "2024-09-30T10:30:00.000Z",
        "updatedAt": "2024-09-30T10:30:00.000Z"
      },
      // ... more certificates
    ],
    "certificateNotes": "Batch tạo 2 chứng chỉ cho nha sĩ"
  }
}

❌ ERROR Response Examples:
{
  "success": false,
  "message": "Chứng chỉ 'Chứng chỉ Nha khoa Thẩm mỹ' đã tồn tại. Vui lòng chọn tên khác."
}

{
  "success": false,  
  "message": "Ảnh chứng chỉ 'certificate.jpg' có thể đã tồn tại trong hệ thống. Vui lòng sử dụng ảnh khác."
}

{
  "success": false,
  "message": "Không tìm thấy chứng chỉ cert_123_456_789 để cập nhật"
}
*/


// ================================================================
// 💡 NOTES & TIPS
// ================================================================

/*
🔥 IMPORTANT NOTES:

1. **File Upload**: 
   - Sử dụng multipart/form-data khi có file
   - frontImages và backImages là arrays (chọn nhiều file cùng key)
   - Mỗi chứng chỉ cần ít nhất frontImage
   - Thứ tự file phải tương ứng với thứ tự name và certificateId

2. **Naming Convention**:
   - name0, name1, name2, ... cho tên chứng chỉ
   - certificateId0, certificateId1, ... cho ID chứng chỉ
   - frontImages[0] tương ứng name0/certificateId0

3. **Postman File Upload**:
   - Chọn key "frontImages", chọn file 1
   - Chọn key "frontImages" lần nữa, chọn file 2
   - Tương tự với backImages

4. **Permissions**:
   - Chỉ admin/manager có thể quản lý chứng chỉ
   - User chỉ có thể quản lý chứng chỉ của chính mình

5. **Validation**:
   - Tên chứng chỉ không được trùng trong cùng user
   - Ảnh không được trùng giữa các dentist (check filename)
   - File size tối đa 5MB
   - Chỉ chấp nhận JPG, PNG, WEBP

6. **URL Structure**:
   - Tất cả ảnh sẽ được lưu trong folder 'avatars' trên S3
   - URL format: https://bucket.s3.region.amazonaws.com/avatars/uuid-filename.ext
*/

module.exports = {
  batchCreateBody,
  batchUpdateBody, 
  batchDeleteBody
};