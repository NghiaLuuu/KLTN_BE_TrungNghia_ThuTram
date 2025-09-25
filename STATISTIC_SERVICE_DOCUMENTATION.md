# 📊 Statistic Service Documentation

## Tổng Quan
Service quản lý thống kê và phân tích dữ liệu cho hệ thống quản lý phòng khám nha khoa.

## 🎯 Chức Năng Chính

### 1. Dashboard Tổng Quan
- KPI chính của phòng khám
- So sánh với kỳ trước
- Xu hướng theo thời gian

### 2. Thống Kê Lịch Hẹn
- Số lượng lịch hẹn theo trạng thái
- Tỷ lệ hoàn thành
- Phân bố theo kênh đặt lịch
- Hiệu suất theo nha sĩ

### 3. Thống Kê Doanh Thu
- Doanh thu theo thời gian
- Phân tích theo dịch vụ
- Tình trạng thanh toán
- So sánh kỳ trước

### 4. Thống Kê Bệnh Nhân
- Bệnh nhân mới/tái khám
- Phân bố theo giới tính, độ tuổi
- Tỷ lệ tái khám

### 5. Thống Kê Nhân Viên
- Hiệu suất làm việc
- Phân bổ công việc
- Tỷ lệ sử dụng lịch trình

### 6. Thống Kê Dịch Vụ
- Dịch vụ phổ biến nhất
- Giá trị trung bình
- Xu hướng sử dụng

## 🚀 API Endpoints

### Dashboard
```
GET /api/statistics/dashboard?timeframe=month
```

### Appointment Statistics  
```
GET /api/statistics/appointments?period=month&status=all&dentistId=xxx
```

### Revenue Statistics
```
GET /api/statistics/revenue?period=month&groupBy=day&compareWithPrevious=true
```

### Patient Statistics
```
GET /api/statistics/patients?period=month&ageGroup=all&gender=all
```

### Staff Statistics
```
GET /api/statistics/staff?role=all&includeInactive=false
```

### Service Statistics
```
GET /api/statistics/services?period=month&serviceType=all&limit=20
```

### Dentist Performance
```
GET /api/statistics/dentists?period=month&dentistId=xxx
```

### Schedule Utilization
```
GET /api/statistics/schedule?period=month&roomId=xxx
```

## 🔐 Authentication & Authorization

### Roles & Permissions
- **Admin/Manager**: Toàn bộ thống kê
- **Dentist/Receptionist**: Thống kê cơ bản (trừ doanh thu và nhân viên)
- **Patient**: Không có quyền truy cập

### Headers Required
```
Authorization: Bearer <jwt_token>
```

## 📊 Response Format

### Success Response
```json
{
  "success": true,
  "message": "Lấy thống kê thành công",
  "data": {
    "period": {
      "startDate": "2024-01-01",
      "endDate": "2024-01-31"
    },
    "summary": {},
    "trends": [],
    "details": {}
  }
}
```

### Error Response
```json
{
  "success": false,
  "message": "Lỗi khi lấy thống kê",
  "errors": []
}
```

## 🎛️ Query Parameters

### Common Parameters
- `startDate`: Ngày bắt đầu (ISO 8601)
- `endDate`: Ngày kết thúc (ISO 8601) 
- `period`: day/week/month/quarter/year
- `timeframe`: today/week/month/quarter/year

### Specific Filters
- `dentistId`: ID nha sĩ cụ thể
- `status`: Trạng thái lịch hẹn
- `serviceType`: Loại dịch vụ
- `ageGroup`: Nhóm tuổi (child/teen/adult/senior)
- `gender`: Giới tính (male/female/other)
- `role`: Vai trò nhân viên
- `groupBy`: Nhóm theo (day/week/month)
- `limit`: Giới hạn kết quả

## 🔧 Technical Implementation

### Architecture
- **Express.js** server
- **MongoDB** for data persistence
- **Redis** for caching
- **RabbitMQ** for service communication
- **JWT** authentication

### Service Communication
- Kết nối với appointment-service
- Kết nối với invoice-service  
- Kết nối với payment-service
- Kết nối với auth-service
- Kết nối với schedule-service

### Caching Strategy
- Cache thống kê 30 phút (1800s)
- Cache dashboard 15 phút (900s)
- Cache nhân viên 1 giờ (3600s)

### Error Handling
- Graceful degradation khi service offline
- Fallback data khi không có dữ liệu
- Comprehensive error logging

## 🛠️ Development

### Environment Variables
```env
NODE_ENV=development
PORT=3010
MONGO_URI=mongodb://localhost:27017/dental_clinic
REDIS_URL=redis://localhost:6379
RABBITMQ_URL=amqp://localhost:5672
ACCESS_TOKEN_SECRET=your_secret
```

### Installation
```bash
npm install
npm start
```

### Testing
```bash
node test-statistic-apis.js
```

## 📈 Performance Features

### Optimization
- Redis caching cho tất cả thống kê
- Batch requests đến các service
- Lazy loading cho dữ liệu lớn
- Pagination cho danh sách dài

### Monitoring
- Health check endpoint
- Performance metrics
- Error tracking
- Cache hit rates

## 🔮 Future Enhancements

### Planned Features
- Real-time statistics với WebSocket
- Export PDF/Excel reports
- Advanced data visualization
- Machine learning predictions
- Custom dashboard widgets
- Automated reports qua email

### Scalability
- Horizontal scaling với cluster
- Database read replicas
- Distributed caching
- Load balancing

---

**Version**: 1.0.0  
**Last Updated**: December 2024  
**Service Port**: 3010