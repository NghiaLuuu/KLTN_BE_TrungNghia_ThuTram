# Setup CI/CD với SSH Key cho Server Instance

## 📋 Thông tin Server

- **User**: `luutrungnghia1901`
- **Instance**: `instance-20251108-095524`
- **SSH Key**: Đã có sẵn

## 🔑 Bước 1: Lấy SSH Private Key

### Trên máy local (Windows):

```powershell
# Tìm file SSH private key (thường ở)
# Option 1: Default location
type C:\Users\ADMINS\.ssh\id_rsa

# Option 2: Custom location (nếu bạn lưu riêng)
type C:\path\to\your\private_key

# Option 3: Nếu dùng PuTTY (file .ppk)
# Cần convert sang OpenSSH format bằng PuTTYgen
```

**Copy toàn bộ nội dung** từ `-----BEGIN ... KEY-----` đến `-----END ... KEY-----`

## 🔧 Bước 2: Setup GitHub Secrets

1. Vào repository trên GitHub: https://github.com/NghiaLuuu/KLTN_BE_TrungNghia_ThuTram
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Thêm 3 secrets sau:

### Secret 1: SSH_PRIVATE_KEY
```
Name: SSH_PRIVATE_KEY
Value: [Paste toàn bộ nội dung SSH private key]

Example:
-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAABlwAAAAdzc2gtcn
... (nhiều dòng) ...
-----END OPENSSH PRIVATE KEY-----
```

### Secret 2: SERVER_HOST
```
Name: SERVER_HOST
Value: [IP của server instance]

Example: 34.123.45.67
hoặc: instance-20251108-095524.compute.googleapis.com
```

### Secret 3: SERVER_USER
```
Name: SERVER_USER
Value: luutrungnghia1901
```

## 🖥️ Bước 3: Setup trên Server

### SSH vào server:

```bash
# Từ máy local
ssh luutrungnghia1901@YOUR_SERVER_IP
```

### Install Docker & Docker Compose:

```bash
# Update system
sudo apt update
sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Add user to docker group
sudo usermod -aG docker luutrungnghia1901

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Verify installation
docker --version
docker-compose --version

# Logout and login again for group changes
exit
ssh luutrungnghia1901@YOUR_SERVER_IP
```

### Install Git:

```bash
sudo apt install git -y
git --version
```

### Clone Repository lần đầu:

```bash
# Clone repo
cd ~
git clone https://github.com/NghiaLuuu/KLTN_BE_TrungNghia_ThuTram.git dental-clinic
cd dental-clinic

# Verify
ls -la
```

### Setup .env file:

```bash
# Navigate to docker folder
cd ~/dental-clinic/docker

# Create .env from template
cp .env.example .env

# Edit .env với nano hoặc vi
nano .env

# Update các giá trị:
# - FRONTEND_URL=http://YOUR_SERVER_IP:5173
# - CORS_ORIGIN=http://YOUR_SERVER_IP:5173
# - VNPAY_RETURN_URL=http://YOUR_SERVER_IP/api/payments/return/vnpay
# - NODE_ENV=production
# (Hoặc dùng domain nếu có)

# Save: Ctrl+X, Y, Enter
```

### Test Docker build lần đầu:

```bash
cd ~/dental-clinic/docker

# Build images
docker-compose -f docker-compose.yml -f docker-compose.prod.yml build

# Start services
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# Check status
docker-compose -f docker-compose.yml -f docker-compose.prod.yml ps

# Check logs
docker-compose -f docker-compose.yml -f docker-compose.prod.yml logs -f
```

## 🚀 Bước 4: Test CI/CD

### Từ máy local:

```bash
# Make a small change
echo "# Test CI/CD" >> README.md

# Commit and push
git add .
git commit -m "Test CI/CD deployment"
git push origin main
```

### Kiểm tra trên GitHub:

1. Vào **Actions** tab
2. Xem workflow "Deploy to Production Server"
3. Check logs real-time

### Kiểm tra trên Server:

```bash
# SSH vào server
ssh luutrungnghia1901@YOUR_SERVER_IP

# Check containers
cd ~/dental-clinic/docker
docker-compose -f docker-compose.yml -f docker-compose.prod.yml ps

# Check logs
docker-compose -f docker-compose.yml -f docker-compose.prod.yml logs -f

# Health check
curl http://localhost:3001/health
curl http://localhost:3007/health
curl http://localhost:3012/health
```

## 🔥 Firewall Setup (Quan trọng!)

```bash
# Allow SSH
sudo ufw allow 22/tcp

# Allow HTTP/HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Allow service ports (nếu cần truy cập trực tiếp)
sudo ufw allow 3001:3013/tcp

# Enable firewall
sudo ufw enable
sudo ufw status
```

## 🌐 Access Application

### Development (Internal):
```
http://YOUR_SERVER_IP:3001  # Auth service
http://YOUR_SERVER_IP:3007  # Payment service
http://YOUR_SERVER_IP:5173  # Frontend (if deployed)
```

### Production (với domain):
```
https://yourdomain.com
```

## 📊 Monitoring

### View Docker logs:
```bash
cd ~/dental-clinic/docker
docker-compose -f docker-compose.yml -f docker-compose.prod.yml logs -f
```

### View specific service:
```bash
docker-compose -f docker-compose.yml -f docker-compose.prod.yml logs -f auth-service
```

### Check resource usage:
```bash
docker stats
```

### Restart services:
```bash
docker-compose -f docker-compose.yml -f docker-compose.prod.yml restart
```

## 🔧 Troubleshooting

### Issue: Permission denied (publickey)
```bash
# Check SSH key on server
ls -la ~/.ssh/
cat ~/.ssh/authorized_keys

# Fix permissions
chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys
```

### Issue: Docker permission denied
```bash
# Add user to docker group
sudo usermod -aG docker $USER

# Logout and login again
exit
```

### Issue: Port already in use
```bash
# Check what's using the port
sudo lsof -i :3001

# Kill the process
sudo kill -9 <PID>
```

### Issue: Out of disk space
```bash
# Clean Docker
docker system prune -a -f
docker volume prune -f

# Check disk usage
df -h
```

## ✅ Checklist

- [ ] SSH private key added to GitHub Secrets
- [ ] SERVER_HOST added to GitHub Secrets  
- [ ] SERVER_USER added to GitHub Secrets
- [ ] Docker installed on server
- [ ] Docker Compose installed on server
- [ ] Git installed on server
- [ ] Repository cloned to ~/dental-clinic
- [ ] .env file created and configured
- [ ] Firewall configured
- [ ] Test deployment successful
- [ ] Health checks passing

## 🎯 Summary

**Server**: `luutrungnghia1901@instance-20251108-095524`  
**Project Path**: `~/dental-clinic`  
**Deploy Branch**: `main`  
**Auto Deploy**: ✅ Enabled

**Workflow**: 
```
Push to main → GitHub Actions → SSH to server → Pull code → Docker build → Deploy → Health check
```

---

🎉 **CI/CD Setup Complete!** Bây giờ mỗi khi bạn push code lên main branch, server sẽ tự động deploy!
