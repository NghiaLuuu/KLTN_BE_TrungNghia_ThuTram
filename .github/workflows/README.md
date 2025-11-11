# GitHub Actions CI/CD Setup

## 📋 Prerequisites

1. Windows Server với Docker installed
2. SSH access tới server
3. Git installed trên server
4. Repository đã clone trên server

## 🔑 GitHub Secrets Configuration

Vào repository settings → Secrets and variables → Actions → New repository secret

Thêm các secrets sau:

### 1. SSH_PRIVATE_KEY
```bash
# Trên máy local (Windows), tạo SSH key pair
ssh-keygen -t rsa -b 4096 -C "github-actions@yourdomain.com"
# Lưu vào: C:\Users\YourUser\.ssh\github_actions

# Copy PRIVATE key content
type C:\Users\YourUser\.ssh\github_actions
# Paste vào GitHub Secret: SSH_PRIVATE_KEY
```

### 2. SERVER_HOST
```
Your server IP or domain
Example: 123.45.67.89 hoặc server.yourdomain.com
```

### 3. SERVER_USER
```
Administrator hoặc tên user trên Windows Server
Example: Administrator
```

### 4. SERVER_PATH
```
Đường dẫn đến project trên server
Example: C:/inetpub/dental-clinic
```

## 📝 Server Setup

### 1. Setup SSH trên Windows Server

```powershell
# Install OpenSSH Server (nếu chưa có)
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0

# Start SSH service
Start-Service sshd
Set-Service -Name sshd -StartupType 'Automatic'

# Configure firewall
New-NetFirewallRule -Name sshd -DisplayName 'OpenSSH Server (sshd)' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22
```

### 2. Add SSH Public Key

```powershell
# Trên server, tạo folder .ssh
mkdir C:\Users\Administrator\.ssh

# Tạo file authorized_keys
New-Item C:\Users\Administrator\.ssh\authorized_keys

# Paste PUBLIC key từ máy local vào file này
notepad C:\Users\Administrator\.ssh\authorized_keys
```

### 3. Clone Repository trên Server

```powershell
# Tạo folder
mkdir C:\inetpub
cd C:\inetpub

# Clone repository
git clone https://github.com/your-username/dental-clinic.git
cd dental-clinic

# Tạo file .env từ template
cd docker
Copy-Item .env.example .env
notepad .env  # Cập nhật các giá trị production
```

### 4. Setup Git Credentials (nếu private repo)

```powershell
# Trên server
git config --global credential.helper store
git pull  # Nhập username/password lần đầu
```

## 🚀 Deploy Workflow

### Automatic Deployment
```bash
# Từ máy local, push code lên main branch
git add .
git commit -m "Deploy to production"
git push origin main

# GitHub Actions sẽ tự động:
# 1. SSH vào server
# 2. Pull latest code
# 3. Build Docker images
# 4. Restart containers
# 5. Run health checks
```

### Manual Deployment
Vào GitHub repo → Actions → Deploy to Production → Run workflow

## 📊 Monitor Deployment

### View Logs
GitHub repo → Actions → Click vào deployment run → Xem logs

### Check on Server
```powershell
# SSH vào server
ssh Administrator@your-server-ip

# Check Docker containers
cd C:\inetpub\dental-clinic\docker
docker-compose -f docker-compose.yml -f docker-compose.prod.yml ps

# View logs
docker-compose -f docker-compose.yml -f docker-compose.prod.yml logs -f

# Health check
curl http://localhost:3001/health
```

## 🔧 Troubleshooting

### Issue: SSH Connection Failed
```bash
# Check SSH service trên server
Get-Service sshd

# Check firewall
Get-NetFirewallRule -Name sshd

# Test SSH từ local
ssh Administrator@your-server-ip
```

### Issue: Git Pull Failed
```bash
# Trên server, check git status
cd C:\inetpub\dental-clinic
git status
git pull origin main
```

### Issue: Docker Build Failed
```bash
# Check Docker service
Get-Service docker

# Check logs
docker-compose -f docker-compose.yml -f docker-compose.prod.yml logs
```

### Issue: Health Check Failed
```bash
# Check individual services
curl http://localhost:3001/health  # Auth
curl http://localhost:3007/health  # Payment
curl http://localhost:3012/health  # Chat

# Check container status
docker ps

# Restart failed service
docker-compose -f docker-compose.yml -f docker-compose.prod.yml restart auth-service
```

## 🎯 Best Practices

1. **Test locally first**
   ```bash
   # Test Docker build
   docker-compose -f docker-compose.yml -f docker-compose.prod.yml build
   
   # Test deployment
   docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
   ```

2. **Use branches**
   - `develop` → Development/Staging
   - `main/master` → Production (auto-deploy)

3. **Backup before deploy**
   ```powershell
   # Backup database
   docker exec dental_mongodb mongodump --out /backup
   ```

4. **Monitor logs**
   ```powershell
   # Real-time logs
   docker-compose -f docker-compose.yml -f docker-compose.prod.yml logs -f
   ```

## 📞 Support

Nếu gặp vấn đề:
1. Check GitHub Actions logs
2. SSH vào server check Docker logs
3. Verify .env configuration
4. Check firewall/network settings

---

**Status**: Ready for deployment 🚀
