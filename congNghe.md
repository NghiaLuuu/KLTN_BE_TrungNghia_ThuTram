# Công Nghệ Sử Dụng trong Hệ Thống Quản Lý Phòng Khám Nha Khoa

## Backend & Runtime
- **Node.js** - Môi trường chạy JavaScript
- **Express.js** - Framework ứng dụng web
- **Docker** - Containerization platform

## Cơ Sở Dữ Liệu
- **MongoDB** - Cơ sở dữ liệu NoSQL
- **Mongoose** - ODM cho MongoDB
- **Redis** - In-memory database cho caching và pub/sub

## Xác Thực & Bảo Mật
- **JSON Web Token (JWT)** - Xác thực dựa trên token
- **bcrypt / bcryptjs** - Mã hóa mật khẩu
- **Helmet** - Bảo mật HTTP headers
- **express-rate-limit** - Giới hạn tốc độ request
- **Crypto** - Mã hóa cho payment signature

## Message Queue & Communication
- **RabbitMQ (amqplib)** - Message broker cho kiến trúc event-driven
- **Socket.IO** - Giao tiếp real-time hai chiều
- **RPC (Remote Procedure Call)** - Giao tiếp đồng bộ giữa các service

## Trí Tuệ Nhân Tạo
- **OpenAI API** - API cho GPT-4o
- **GPT-4 Vision** - Phân tích hình ảnh răng miệng

## Payment Gateway
- **Stripe** - Cổng thanh toán quốc tế
- **VNPay** - Cổng thanh toán Việt Nam (HMAC SHA512)

## Cloud Storage
- **AWS SDK** - Tích hợp Amazon S3 cho lưu trữ file

## Email & Messaging
- **Nodemailer** - Gửi email

## File Upload & Xử Lý Ảnh
- **Multer** - Xử lý multipart/form-data
- **Sharp** - Xử lý và tối ưu hình ảnh

## Validation
- **express-validator** - Kiểm tra validation request
- **Joi** - Schema validation

## HTTP & Middleware
- **Axios** - HTTP client
- **CORS** - Cross-Origin Resource Sharing
- **Compression** - Nén response
- **Body-Parser** - Parse request body
- **Form-data** - Tạo form data

## Quản Lý Thời Gian
- **Moment** - Thao tác với date/time
- **Moment-Timezone** - Hỗ trợ timezone
- **Day.js** - Thư viện date/time nhẹ

## Scheduled Tasks
- **node-cron** - Lập lịch tự động (cron jobs)

## Logging & Monitoring
- **Winston** - Thư viện logging
- **Morgan** - HTTP request logger

## Utilities
- **UUID** - Tạo unique identifier
- **Lodash** - Thư viện tiện ích JavaScript

## Configuration
- **dotenv** - Quản lý biến môi trường

## Development & Testing
- **Nodemon** - Auto-restart server khi develop
- **Jest** - Framework testing
- **Supertest** - HTTP testing
- **ESLint** - Code linting

## Kiến Trúc Hệ Thống
- **Microservices Architecture** - Kiến trúc hướng service
- **Event-Driven Architecture** - Kiến trúc hướng sự kiện
- **Repository Pattern** - Trừu tượng hóa data access layer
- **Service Layer Pattern** - Tách biệt business logic
- **MVC Pattern** - Model-View-Controller
- **Middleware Pattern** - Xử lý request/response chain
- **Pub/Sub Pattern** - Publisher/Subscriber
- **Observer Pattern** - Lắng nghe sự kiện
- **Gateway Pattern** - Trừu tượng hóa payment gateway
- **Cache-Aside Pattern** - Chiến lược caching với Redis

## Tính Năng Chính
- Hệ thống microservices với 7+ services độc lập
- Real-time updates với Socket.IO
- AI chatbot với GPT-4o và phân tích hình ảnh răng
- Đa cổng thanh toán (VNPay, Stripe, tiền mặt)
- Quản lý lịch hẹn tự động với cron jobs
- Caching thông minh với Redis
- Message queue với RabbitMQ
- RPC communication giữa các services
- Timezone handling cho Việt Nam (Asia/Ho_Chi_Minh)
- Rate limiting chống spam
- Tự động tạo invoice
- Statistics và analytics
- Health check và monitoring
