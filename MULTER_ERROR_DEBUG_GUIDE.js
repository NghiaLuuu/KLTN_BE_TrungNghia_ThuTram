/**
 * 🚨 DEBUG GUIDE: MulterError Troubleshooting
 * ==========================================
 * 
 * Nếu vẫn gặp MulterError, hãy check các điều sau:
 */

// ================================================================
// ✅ ĐÚNG - BATCH-UPDATE FIELDS
// ================================================================

/*
Postman Body (form-data):

Key                 | Value                                    | Type
--------------------|------------------------------------------|--------
action              | batch-update                             | Text
certificateId0      | cert_68d9f8bab5a75931c6cd0d7d_...        | Text  
certificateId1      | cert_68d9f8bab5a75931c6cd0d7d_...        | Text
name0               | Tên mới chứng chỉ 1                      | Text
name1               | Tên mới chứng chỉ 2                      | Text
certificateNotes    | Cập nhật batch                           | Text
isVerified          | true                                     | Text
frontImages         | [Select File 1]                          | File
frontImages         | [Select File 2]                          | File
backImages          | [Select File 3]                          | File
backImages          | [Select File 4]                          | File
*/

// ================================================================
// ❌ SAI - NHỮNG FIELD NÀY SẼ GÂY LỖI
// ================================================================

/*
❌ Không sử dụng:
- frontImage (single, chỉ dùng frontImages)
- backImage (single, chỉ dùng backImages)  
- certificate (không dùng)
- image (không dùng)
- files (không dùng)

❌ Không sử dụng array notation trong key:
- name[0] (sai, dùng name0)
- certificateId[0] (sai, dùng certificateId0)
- frontImages[0] (sai, chọn key frontImages nhiều lần)
*/

// ================================================================
// 🔧 STEP-BY-STEP POSTMAN SETUP
// ================================================================

/*
1. Method: PUT
2. URL: http://localhost:3001/api/users/68d9f8bab5a75931c6cd0d7d/certificates
3. Headers: Authorization: Bearer YOUR_TOKEN
4. Body: form-data

5. Add text fields (Key-Value):
   action → batch-update
   certificateId0 → cert_68d9f8bab5a75931c6cd0d7d_1727747891234_abc12345_0
   certificateId1 → cert_68d9f8bab5a75931c6cd0d7d_1727747891234_def67890_1
   
6. Add file fields (Key-File):
   Key: frontImages, Value: Select File 1
   Key: frontImages, Value: Select File 2
   Key: backImages, Value: Select File 3  
   Key: backImages, Value: Select File 4

7. Send request
*/

// ================================================================
// 🐛 DEBUGGING STEPS
// ================================================================

/*
Nếu vẫn lỗi:

1. **Kiểm tra Console Output:**
   Server sẽ log debug info khi nhận request:
   ```
   🔍 Certificate Action Debug: {
     action: 'batch-update',
     filesArray: [...],
     filesCount: 4
   }
   ```

2. **Kiểm tra Field Names:**
   - Đảm bảo chỉ dùng: action, certificateId0, certificateId1, name0, name1, certificateNotes, isVerified
   - Đảm bảo files chỉ dùng: frontImages, backImages

3. **Test đơn giản:**
   Thử batch-delete trước (không cần files):
   ```
   action: batch-delete
   certificateId0: cert_...
   certificateId1: cert_...
   ```

4. **Kiểm tra Content-Type:**
   Đảm bảo Postman tự động set Content-Type: multipart/form-data
*/

// ================================================================
// 🔄 ALTERNATIVE: CURL COMMAND  
// ================================================================

/*
Nếu Postman vẫn lỗi, thử curl:

curl -X PUT "http://localhost:3001/api/users/68d9f8bab5a75931c6cd0d7d/certificates" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "action=batch-update" \
  -F "certificateId0=cert_68d9f8bab5a75931c6cd0d7d_1727747891234_abc12345_0" \
  -F "certificateId1=cert_68d9f8bab5a75931c6cd0d7d_1727747891234_def67890_1" \
  -F "name0=Tên mới 1" \
  -F "name1=Tên mới 2" \
  -F "frontImages=@/path/to/file1.jpg" \
  -F "frontImages=@/path/to/file2.jpg"
*/

module.exports = {
  validFields: ['action', 'certificateId0', 'certificateId1', 'name0', 'name1', 'certificateNotes', 'isVerified'],
  validFileFields: ['frontImages', 'backImages'],
  invalidFields: ['frontImage', 'backImage', 'certificate', 'image', 'files']
};