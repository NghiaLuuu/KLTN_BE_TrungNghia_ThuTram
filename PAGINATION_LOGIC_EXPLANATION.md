# 📊 Calendar Pagination Logic - Chi Tiết Giải Thích

## 🎯 Logic Phân Trang Hiện Tại

### Công Thức:
```javascript
if (page >= 1) {
  periodIndex = (page - 1) * limit + i;
} else {
  periodIndex = page * limit + i;
}
```

### Ví Dụ Cụ Thể với limit = 3:

#### **Positive Pages (Hiện tại & Tương lai):**
- **page = 1**: periodIndex = 0, 1, 2 
  - Chu kỳ: Hiện tại, +1, +2
- **page = 2**: periodIndex = 3, 4, 5
  - Chu kỳ: +3, +4, +5 
- **page = 3**: periodIndex = 6, 7, 8
  - Chu kỳ: +6, +7, +8

#### **Negative Pages (Quá khứ):**
- **page = -1**: periodIndex = -3, -2, -1
  - Chu kỳ: -3, -2, -1 (3 chu kỳ trước)
- **page = -2**: periodIndex = -6, -5, -4  
  - Chu kỳ: -6, -5, -4 (6 chu kỳ trước)

## 📅 Ví Dụ Thực Tế với ViewType = "week"

**Giả sử hôm nay là 2025-10-02 (Thứ 4)**

### page = 1, limit = 3:
- Tuần 0: 2025-09-30 → 2025-10-06 (tuần hiện tại)
- Tuần 1: 2025-10-07 → 2025-10-13 (tuần sau)  
- Tuần 2: 2025-10-14 → 2025-10-20 (2 tuần sau)

### page = 2, limit = 3:
- Tuần 3: 2025-10-21 → 2025-10-27 (3 tuần sau)
- Tuần 4: 2025-10-28 → 2025-11-03 (4 tuần sau)
- Tuần 5: 2025-11-04 → 2025-11-10 (5 tuần sau)

### page = -1, limit = 3:
- Tuần -3: 2025-09-09 → 2025-09-15 (3 tuần trước) 
- Tuần -2: 2025-09-16 → 2025-09-22 (2 tuần trước)
- Tuần -1: 2025-09-23 → 2025-09-29 (tuần trước)

## 💡 Kết Luận

**Bạn đúng khi nói page=2 không phải là "1 chu kỳ sau"!**

Với logic hiện tại:
- `page=1`: Bắt đầu từ chu kỳ hiện tại (0)
- `page=2`: Bắt đầu từ chu kỳ thứ `limit` (không phải chu kỳ 1)

**Nếu muốn page=2 là "1 chu kỳ sau", logic phải là:**
```javascript
// Logic mới (nếu muốn thay đổi):
periodIndex = (page - 1) + i;  // Không nhân với limit

// Với logic này:
// page=1: periodIndex = 0, 1, 2 (limit=3)
// page=2: periodIndex = 1, 2, 3 
// page=3: periodIndex = 2, 3, 4
```

**Nhưng logic hiện tại hợp lý cho pagination:**
- Mỗi page hiển thị `limit` chu kỳ không overlap
- page=2 hiển thị `limit` chu kỳ tiếp theo sau page=1
- Đây là pattern pagination chuẩn

## 🔄 Recommendation

**Giữ nguyên logic hiện tại** nhưng **cập nhật documentation** để rõ ràng:

```markdown
📅 Pagination Logic:
- page=1: Chu kỳ 0 → (limit-1) 
- page=2: Chu kỳ limit → (2*limit-1)
- page=3: Chu kỳ 2*limit → (3*limit-1)

Với limit=3:
- page=1: Chu kỳ 0,1,2 (hiện tại + 2 kỳ tới)
- page=2: Chu kỳ 3,4,5 (3 kỳ tiếp theo)
- page=3: Chu kỳ 6,7,8 (6 kỳ tiếp theo)

☝️ "page=2" không phải "1 chu kỳ sau" mà là "nhóm chu kỳ thứ 2"
```