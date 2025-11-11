# Docker Deployment for CI/CD

## Files trong folder này:

### ✅ REQUIRED (bắt buộc cho deployment)
- `docker-compose.yml` - Main configuration
- `docker-compose.prod.yml` - Production overrides
- `.env.example` - Environment template
- `init-mongo.js` - MongoDB initialization script

### 📦 OPTIONAL
- `.dockerignore` - Tối ưu Docker build (nên giữ)
- `deploy.ps1` - Helper script cho Windows (tùy chọn)

### ⚠️ LOCAL ONLY
- `.env` - **KHÔNG commit file này** (chứa thông tin nhạy cảm)

---

## Deployment Commands

### 1. Setup môi trường lần đầu
```powershell
# Tạo file .env từ template
Copy-Item .env.example .env

# Sửa các giá trị trong .env
notepad .env
```

### 2. Deploy Production
```powershell
# Build và start tất cả services
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

# Hoặc dùng helper script
.\deploy.ps1 start
```

### 3. Kiểm tra health
```powershell
# Xem status containers
docker-compose -f docker-compose.yml -f docker-compose.prod.yml ps

# Health check
.\deploy.ps1 health

# Hoặc manual
curl http://localhost:3001/health  # Auth service
curl http://localhost:3007/health  # Payment service
# ... các services khác (3001-3013)
```

### 4. Xem logs
```powershell
# All services
docker-compose -f docker-compose.yml -f docker-compose.prod.yml logs -f

# Specific service
docker-compose -f docker-compose.yml -f docker-compose.prod.yml logs -f auth-service

# Hoặc dùng helper
.\deploy.ps1 logs
```

### 5. Stop services
```powershell
docker-compose -f docker-compose.yml -f docker-compose.prod.yml down

# Hoặc
.\deploy.ps1 stop
```

---

## CI/CD với GitHub Actions

Tạo file `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: windows-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Deploy via SSH
        run: |
          ssh ${{ secrets.SERVER_USER }}@${{ secrets.SERVER_HOST }} `
            "cd C:\app\dental-clinic && `
             git pull origin main && `
             cd docker && `
             docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build"
```

---

## Services & Ports

- **3001** - auth-service
- **3002** - room-service
- **3003** - service-service
- **3005** - schedule-service
- **3006** - appointment-service
- **3007** - payment-service
- **3008** - invoice-service
- **3009** - medicine-service
- **3010** - record-service
- **3011** - statistic-service
- **3012** - chat-service
- **3013** - chatbot-service

**Infrastructure:**
- **27017** - MongoDB
- **6379** - Redis
- **5672** - RabbitMQ
- **15672** - RabbitMQ Management UI

---

## Checklist trước khi deploy

- [ ] Đã tạo `.env` và cập nhật passwords
- [ ] Đã test build locally
- [ ] Ports 3001-3013 không bị chiếm dụng
- [ ] Docker Desktop đang chạy
- [ ] Có đủ RAM (tối thiểu 6GB)
