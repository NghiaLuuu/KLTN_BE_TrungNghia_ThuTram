# 🦷 Dental Clinic System - Production Deployment Guide

Complete guide for deploying the Dental Clinic microservices system to production environment.

## 📋 Table of Contents
1. [Prerequisites](#prerequisites)
2. [Quick Start](#quick-start)
3. [Production Configuration](#production-configuration)
4. [Security Setup](#security-setup)
5. [Deployment Steps](#deployment-steps)
6. [Monitoring & Maintenance](#monitoring--maintenance)
7. [Backup & Recovery](#backup--recovery)
8. [Troubleshooting](#troubleshooting)

## 🔧 Prerequisites

### System Requirements
- **OS**: Ubuntu 20.04+ / CentOS 8+ / RHEL 8+
- **RAM**: Minimum 8GB (Recommended 16GB+)
- **CPU**: Minimum 4 cores (Recommended 8+ cores)
- **Disk**: Minimum 50GB SSD (Recommended 100GB+ SSD)
- **Network**: Static IP, Domain name configured

### Software Requirements
```bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Verify installations
docker --version
docker-compose --version
```

### Firewall Configuration
```bash
# Open required ports
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw allow 22/tcp    # SSH

# Block direct access to services (security)
sudo ufw deny 3001:3013/tcp
sudo ufw deny 27017/tcp
sudo ufw deny 6379/tcp
sudo ufw deny 5672/tcp
sudo ufw deny 15672/tcp
```

## ⚡ Quick Start

```bash
# Clone the repository
git clone <your-repository-url>
cd BE_KLTN_TrungNghia_ThuTram/docker

# Configure environment
cp .env.example .env
# Edit .env with your production values

# Setup SSL certificates
make ssl-setup

# Deploy to production
make prod-up

# Verify deployment
make health-check
```

## 🔐 Production Configuration

### 1. Environment Variables (.env)

**Critical settings to update:**

```env
# Domain Configuration
DOMAIN=yourdomain.com
API_URL=https://api.yourdomain.com
FRONTEND_URL=https://yourdomain.com

# Security
NODE_ENV=production
JWT_SECRET=your-super-secure-jwt-secret-256-bits
ENCRYPTION_KEY=your-32-character-encryption-key

# Database Security
MONGODB_ROOT_PASSWORD=your-secure-mongodb-password
REDIS_PASSWORD=your-secure-redis-password
RABBITMQ_DEFAULT_PASS=your-secure-rabbitmq-password

# CORS Configuration
CORS_ORIGIN=https://yourdomain.com,https://api.yourdomain.com

# Email Configuration (for notifications)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-specific-password

# Monitoring
WEBHOOK_URL=https://hooks.slack.com/your-webhook-url
ALERT_EMAIL=admin@yourdomain.com
```

### 2. SSL Certificate Setup

**Option A: Let's Encrypt (Recommended)**
```bash
# Setup domain in nginx/nginx.conf first
make ssl-setup

# Then run:
docker run --rm -v $(PWD)/nginx/ssl:/etc/letsencrypt/live/yourdomain.com \
  certbot/certbot certonly --standalone \
  -d yourdomain.com -d www.yourdomain.com \
  --email admin@yourdomain.com --agree-tos
```

**Option B: Custom Certificates**
```bash
# Place your certificates in nginx/ssl/
nginx/ssl/
├── fullchain.pem    # Full certificate chain
└── privkey.pem      # Private key
```

### 3. Nginx Configuration

Update domain in `nginx/nginx.conf`:
```nginx
server_name yourdomain.com www.yourdomain.com;
```

## 🚀 Deployment Steps

### Step 1: Initial Deployment
```bash
# 1. Environment check
make env-check

# 2. Build all services
make build

# 3. Start infrastructure first
make infrastructure

# 4. Wait for infrastructure to be ready
sleep 30

# 5. Deploy all services
make prod-up

# 6. Verify deployment
make health-check
```

### Step 2: Post-Deployment Verification
```bash
# Check all containers are running
make prod-status

# Test all service endpoints
make health

# Check logs for any errors
make prod-logs

# Test SSL certificate
curl -I https://yourdomain.com
```

### Step 3: Performance Optimization
```bash
# Monitor resource usage
make perf-monitor

# Adjust container resources if needed
# Edit docker-compose.prod.yml

# Restart with new settings
make prod-restart
```

## 🔒 Security Setup

### 1. Firewall Configuration
```bash
# Install and configure UFW
sudo ufw --force reset
sudo ufw default deny incoming
sudo ufw default allow outgoing

# Allow essential services
sudo ufw allow ssh
sudo ufw allow http
sudo ufw allow https

# Enable firewall
sudo ufw --force enable
sudo ufw status
```

### 2. Fail2Ban Setup
```bash
# Install Fail2Ban
sudo apt-get install fail2ban

# Configure jail for SSH
sudo nano /etc/fail2ban/jail.local
```

Add configuration:
```ini
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 5

[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
```

### 3. Security Audit
```bash
# Run security audit
make security-audit

# Check for vulnerabilities
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
  aquasec/trivy image your-image:tag
```

## 📊 Monitoring & Maintenance

### Health Monitoring
```bash
# Basic health check
make health

# Detailed health check with logging
make health-check

# Health check with alerts
make health-alert
```

### Log Management
```bash
# View real-time logs
make prod-logs

# Rotate logs
make logs-rotate

# Clean old logs
make logs-clean
```

### Performance Monitoring
```bash
# Show current performance metrics
make perf-monitor

# Network connectivity check
make network-check
```

### Automated Monitoring Setup

**Crontab Configuration:**
```bash
# Edit crontab
crontab -e

# Add monitoring jobs
# Health check every 5 minutes
*/5 * * * * cd /path/to/project/docker && make health-check >> /var/log/dental-health.log 2>&1

# Daily backup at 2 AM
0 2 * * * cd /path/to/project/docker && make backup-daily

# Weekly backup on Sunday at 3 AM
0 3 * * 0 cd /path/to/project/docker && make backup-weekly

# Monthly backup on 1st day at 4 AM
0 4 1 * * cd /path/to/project/docker && make backup-monthly

# SSL certificate renewal check (twice daily)
0 0,12 * * * cd /path/to/project/docker && make ssl-renew

# Log rotation (daily at 1 AM)
0 1 * * * cd /path/to/project/docker && make logs-rotate
```

## 💾 Backup & Recovery

### Automated Backups
```bash
# Daily backup
make backup-daily

# Weekly backup
make backup-weekly

# Monthly backup
make backup-monthly
```

### Manual Backup
```bash
# MongoDB only
make db-backup

# Complete system backup
./backup.sh daily
```

### Recovery Process
```bash
# 1. Stop services
make prod-down

# 2. Restore database
make db-restore

# 3. Restore configuration files
tar -xzf config_backup.tar.gz

# 4. Restart services
make prod-up

# 5. Verify recovery
make health-check
```

### Backup Storage Recommendations
- **Local**: Keep 7 daily, 4 weekly, 12 monthly backups
- **Remote**: Upload to cloud storage (AWS S3, Google Cloud, etc.)
- **Testing**: Regularly test backup restoration process

## 🔧 Troubleshooting

### Common Issues

**1. Services won't start**
```bash
# Check logs
make prod-logs

# Check individual service
docker-compose logs auth-service

# Restart specific service
docker-compose restart auth-service
```

**2. Database connection issues**
```bash
# Check MongoDB status
docker exec dental_mongodb mongosh --eval "db.adminCommand('ismaster')"

# Check Redis connectivity
docker exec dental_redis redis-cli ping

# Check network connectivity
make network-check
```

**3. SSL certificate issues**
```bash
# Check certificate validity
openssl x509 -in nginx/ssl/fullchain.pem -text -noout

# Renew certificate
make ssl-renew

# Test SSL configuration
curl -vI https://yourdomain.com
```

**4. Performance issues**
```bash
# Check resource usage
make perf-monitor

# Scale services if needed
docker-compose up -d --scale auth-service=2

# Check for memory leaks
docker stats --no-stream
```

### Emergency Procedures

**Service Recovery:**
```bash
# 1. Stop all services
make prod-down

# 2. Clean Docker system
docker system prune -f

# 3. Restore from backup
make db-restore

# 4. Restart services
make prod-up
```

**Rollback Deployment:**
```bash
# 1. Keep backup of current state
make backup-daily

# 2. Switch to previous version
git checkout previous-tag
make build
make prod-up

# 3. Verify rollback
make health-check
```

## 📞 Support & Maintenance

### Regular Maintenance Tasks
- **Daily**: Health checks, log monitoring
- **Weekly**: Performance review, security updates
- **Monthly**: Backup verification, capacity planning
- **Quarterly**: Security audit, dependency updates

### Monitoring Checklist
- [ ] All services are running
- [ ] SSL certificates are valid
- [ ] Disk space < 80%
- [ ] Memory usage < 85%
- [ ] CPU usage < 80%
- [ ] No critical errors in logs
- [ ] Backup jobs completed successfully

### Emergency Contacts
- System Administrator: [Your contact]
- Database Administrator: [Your contact]
- DevOps Team: [Your contact]
- 24/7 Support: [Your contact]

---

## 📚 Additional Resources

- [Docker Production Best Practices](https://docs.docker.com/develop/dev-best-practices/)
- [Nginx Security Configuration](https://nginx.org/en/docs/http/securing_http.html)
- [MongoDB Security Checklist](https://docs.mongodb.com/manual/administration/security-checklist/)
- [Redis Security Guide](https://redis.io/topics/security)

---

**Last Updated**: $(date +"%Y-%m-%d")
**Version**: 1.0.0