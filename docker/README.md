# 🦷 Dental Clinic Microservices - Docker Setup

## Overview
Complete Docker setup for Dental Clinic management system with 12 microservices + infrastructure.

## Architecture
```
🏗️ Infrastructure:
├── MongoDB (Database)
├── Redis (Cache)
├── RabbitMQ (Message Queue)

🚀 Microservices:
├── auth-service      (3001) - Authentication & User Management
├── room-service      (3002) - Room & SubRoom Management
├── service-service   (3003) - Services & Treatments
├── schedule-service  (3005) - Schedule & Slot Management
├── appointment-service (3006) - Appointment Booking
├── payment-service   (3007) - Payment Processing
├── invoice-service   (3008) - Invoice Management
├── medicine-service  (3009) - Medicine Management
├── record-service    (3010) - Medical Records
├── statistic-service (3011) - Analytics & Statistics
├── chat-service      (3012) - Real-time Chat
└── chatbot-service   (3013) - AI Chatbot

🔗 Infrastructure Ports:
├── MongoDB:    27017
├── Redis:      6379
├── RabbitMQ:   5672 (AMQP), 15672 (Management UI)

📝 Note: Services run on sequential ports 3001-3013
```

## Quick Start

### Windows (PowerShell)
```powershell
# Navigate to docker directory
cd docker

# Start all services
.\docker.ps1 start

# Check health
.\docker.ps1 health

# View logs
.\docker.ps1 logs-f

# Stop services
.\docker.ps1 stop
```

### Linux/Mac (Make)
```bash
# Navigate to docker directory
cd docker

# Start all services
make start

# Check health
make health

# View logs
make logs-f

# Stop services
make stop
```

## Setup Instructions

### 1. Prerequisites
- Docker Desktop installed
- At least 6GB RAM available
- Ports 3001-3013, 27017, 6379, 5672, 15672 available

### 2. Environment Configuration
```bash
# Copy environment template
cp .env.example .env

# Edit .env with your configuration
nano .env  # or use your preferred editor
```

### 3. Build & Start Services
```bash
# Method 1: PowerShell (Windows)
.\docker.ps1 build
.\docker.ps1 start

# Method 2: Make (Linux/Mac/WSL)
make build
make start

# Method 3: Direct Docker Compose
docker-compose up -d --build
```

## Service URLs

### Infrastructure Management
- **RabbitMQ Management**: http://localhost:15672 (admin/rabbitmq123)
- **MongoDB**: mongodb://localhost:27017
- **Redis**: redis://localhost:6379

### Individual Services (Health Endpoints)
- **Auth Service**: http://localhost:3001/health
- **Room Service**: http://localhost:3002/health
- **Service Service**: http://localhost:3003/health
- **Schedule Service**: http://localhost:3005/health
- **Appointment Service**: http://localhost:3006/health
- **Payment Service**: http://localhost:3007/health
- **Invoice Service**: http://localhost:3008/health
- **Medicine Service**: http://localhost:3009/health
- **Record Service**: http://localhost:3010/health
- **Statistic Service**: http://localhost:3011/health
- **Chat Service**: http://localhost:3012/health
- **Chatbot Service**: http://localhost:3013/health

## Common Commands

### Development
```bash
# Build specific service
docker-compose build auth-service

# Restart specific service
docker-compose restart auth-service

# View logs for specific service
docker-compose logs -f auth-service

# Execute into container
docker exec -it dental_auth_service sh

# Scale service (if needed)
docker-compose up -d --scale auth-service=2
```

### Database Access
```bash
# MongoDB
docker exec -it dental_mongodb mongosh -u admin -p password123

# Redis
docker exec -it dental_redis redis-cli

# RabbitMQ Management UI
# Open: http://localhost:15672
# Login: admin/password123
```

### Monitoring
```bash
# Show running containers
docker-compose ps

# Show resource usage
docker stats

# Show logs from all services
docker-compose logs

# Follow logs in real-time
docker-compose logs -f
```

## Troubleshooting

### Common Issues

**Port Already in Use**
```bash
# Check which process is using the port
netstat -ano | findstr :3001  # Windows (or any port 3001-3013)
lsof -i :3001                 # Mac/Linux

# Kill the process or change port in docker-compose.yml
# Current port range: 3001-3013 for microservices
```

**Out of Memory**
```bash
# Check Docker resource limits
docker system df
docker system prune -f

# Increase Docker Desktop memory limit to 6GB+
```

**Service Not Starting**
```bash
# Check service logs
docker-compose logs service-name

# Rebuild without cache
docker-compose build --no-cache service-name

# Check dependencies are running
docker-compose ps
```

**Database Connection Issues**
```bash
# Check MongoDB is running
docker exec dental_mongodb mongosh --eval "db.adminCommand('ismaster')"

# Check Redis is running
docker exec dental_redis redis-cli ping

# Check RabbitMQ is running
curl http://localhost:15672/api/overview
```

### Performance Optimization

**For Development:**
```yaml
# Add to docker-compose.override.yml
version: '3.8'
services:
  auth-service:
    volumes:
      - ../services/auth-service/src:/app/src
    environment:
      NODE_ENV: development
    command: npm run dev
```

**For Production:**
```bash
# Use production compose file
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

## Environment Variables

### Required Variables (.env)
```env
# MongoDB
MONGO_INITDB_ROOT_USERNAME=admin
MONGO_INITDB_ROOT_PASSWORD=your_secure_password

# RabbitMQ
RABBITMQ_DEFAULT_USER=admin
RABBITMQ_DEFAULT_PASS=your_secure_password

# JWT Secret
JWT_SECRET=your_super_secret_jwt_key

# CORS Origins
ALLOWED_ORIGINS=http://localhost:3000,http://yourdomain.com
```

## Health Checks

All services provide health check endpoints:
```bash
# Check all services
.\docker.ps1 health     # Windows
make health            # Linux/Mac

# Manual health check examples
curl http://localhost:3001/health  # Auth service
curl http://localhost:3007/health  # Payment service 
curl http://localhost:3013/health  # Chatbot service

# Test all services (ports 3001-3013)
for port in {3001..3003} 3005..3013; do curl -s http://localhost:$port/health; done
```

## Backup & Restore

### MongoDB Backup
```bash
docker exec dental_mongodb mongodump --uri="mongodb://admin:password@localhost:27017" --out=/backup
docker cp dental_mongodb:/backup ./mongodb_backup_$(date +%Y%m%d)
```

### Redis Backup
```bash
docker exec dental_redis redis-cli BGSAVE
docker cp dental_redis:/data/dump.rdb ./redis_backup_$(date +%Y%m%d).rdb
```

## Development Workflow

1. **Start Infrastructure Only**
   ```bash
   .\docker.ps1 infra  # Start MongoDB, Redis, RabbitMQ only
   ```

2. **Develop Individual Services**
   ```bash
   # Run service locally while infrastructure runs in Docker
   cd ../services/auth-service
   npm run dev
   ```

3. **Test Full System**
   ```bash
   .\docker.ps1 start  # Start all services
   .\docker.ps1 health # Check health
   ```

## Production Deployment

1. **Update Environment**
   ```bash
   cp .env.example .env.production
   # Edit with production values
   ```

2. **Deploy**
   ```bash
   docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
   ```

3. **Monitor**
   ```bash
   docker-compose logs -f
   ```

## Port Configuration Summary

**Updated Port Mapping (Sequential 3001-3013):**
- **3001**: auth-service
- **3002**: room-service  
- **3003**: service-service
- **3005**: schedule-service (skipped 3004)
- **3006**: appointment-service
- **3007**: payment-service
- **3008**: invoice-service
- **3009**: medicine-service
- **3010**: record-service
- **3011**: statistic-service
- **3012**: chat-service
- **3013**: chatbot-service

**Infrastructure Ports:**
- **27017**: MongoDB
- **6379**: Redis
- **5672**: RabbitMQ (AMQP)
- **15672**: RabbitMQ Management UI

## Support

For issues and questions:
- Check logs: `docker-compose logs service-name`
- Check service health: `curl http://localhost:PORT/health` (PORT: 3001-3013)
- Review environment configuration
- Ensure all required ports (3001-3013, 27017, 6379, 5672, 15672) are available
- Use `.\docker.ps1 health` or `make health` for comprehensive health checks