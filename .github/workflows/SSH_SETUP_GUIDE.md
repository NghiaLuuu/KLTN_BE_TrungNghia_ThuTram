# SSH Key Setup for GitHub Actions CI/CD

## 📋 Tổng quan

Setup SSH để GitHub Actions có thể tự động SSH vào Windows Server và deploy Docker containers.

---

## 🔑 BƯỚC 1: Tạo SSH Key Pair (Trên máy local)

### Windows PowerShell

```powershell
# Mở PowerShell
cd ~

# Tạo SSH key pair
ssh-keygen -t rsa -b 4096 -C "github-actions-deploy"

# Khi được hỏi "Enter file in which to save the key"
# Nhập: github_actions_deploy
# (Hoặc nhấn Enter để dùng tên mặc định)

# Khi được hỏi passphrase: Nhấn Enter 2 lần (bỏ trống)
```

**Kết quả:**
- 🔑 Private key: `~/.ssh/github_actions_deploy` (hoặc `id_rsa`)
- 🔓 Public key: `~/.ssh/github_actions_deploy.pub` (hoặc `id_rsa.pub`)

### Xem nội dung keys

```powershell
# Xem PRIVATE key (sẽ copy vào GitHub Secrets)
type ~/.ssh/github_actions_deploy
# Output: -----BEGIN RSA PRIVATE KEY----- ...

# Xem PUBLIC key (sẽ thêm vào server)
type ~/.ssh/github_actions_deploy.pub
# Output: ssh-rsa AAAAB3NzaC1yc2E... github-actions-deploy
```

---

## 🖥️ BƯỚC 2: Setup SSH Server trên Windows Server

### 2.1. Install OpenSSH Server

```powershell
# Kiểm tra xem đã có chưa
Get-WindowsCapability -Online | Where-Object Name -like 'OpenSSH.Server*'

# Nếu chưa có (State: NotPresent), cài đặt:
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0

# Kết quả mong đợi:
# Path          :
# Online        : True
# RestartNeeded : False
```

### 2.2. Start SSH Service

```powershell
# Start service
Start-Service sshd

# Set service tự động khởi động
Set-Service -Name sshd -StartupType 'Automatic'

# Kiểm tra status
Get-Service sshd
# Status phải là: Running
```

### 2.3. Configure Firewall

```powershell
# Mở port 22 cho SSH
New-NetFirewallRule -Name sshd -DisplayName 'OpenSSH Server (sshd)' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22

# Kiểm tra rule
Get-NetFirewallRule -Name sshd
```

### 2.4. Thêm Public Key vào Server

```powershell
# Tạo folder .ssh nếu chưa có
mkdir C:\Users\Administrator\.ssh -Force

# Tạo file authorized_keys
New-Item -ItemType File -Path C:\Users\Administrator\.ssh\authorized_keys -Force

# Mở file để paste public key
notepad C:\Users\Administrator\.ssh\authorized_keys
```

**Trong notepad:**
- Paste nội dung PUBLIC key từ máy local (`github_actions_deploy.pub`)
- Format: `ssh-rsa AAAAB3NzaC1yc2E... github-actions-deploy`
- Lưu file (Ctrl+S)

### 2.5. Set Permissions cho authorized_keys

```powershell
# Xóa inheritance và set quyền chỉ cho Administrator
icacls C:\Users\Administrator\.ssh\authorized_keys /inheritance:r
icacls C:\Users\Administrator\.ssh\authorized_keys /grant:r "Administrator:(R)"

# Xóa quyền của SYSTEM (nếu có)
icacls C:\Users\Administrator\.ssh\authorized_keys /remove "NT AUTHORITY\SYSTEM"

# Kiểm tra permissions
icacls C:\Users\Administrator\.ssh\authorized_keys
# Chỉ có Administrator:(R)
```

### 2.6. Configure SSH Server (Optional nhưng recommended)

```powershell
# Mở file config
notepad C:\ProgramData\ssh\sshd_config
```

**Thêm/sửa các dòng sau:**
```
PubkeyAuthentication yes
PasswordAuthentication no
PermitRootLogin no
StrictModes yes
```

**Restart SSH service để apply config:**
```powershell
Restart-Service sshd
```

---

## 🔒 BƯỚC 3: Setup GitHub Secrets

### 3.1. Vào GitHub Repository

1. Mở repository trên GitHub
2. Click **Settings** (tab trên cùng)
3. Sidebar bên trái: **Secrets and variables** → **Actions**
4. Click **New repository secret**

### 3.2. Thêm SSH_PRIVATE_KEY

**Name:** `SSH_PRIVATE_KEY`

**Value:** Copy toàn bộ nội dung PRIVATE key từ máy local:

```powershell
# Trên máy local
type ~/.ssh/github_actions_deploy
```

Copy từ `-----BEGIN RSA PRIVATE KEY-----` đến `-----END RSA PRIVATE KEY-----` (bao gồm cả 2 dòng này)

**Click:** Add secret

### 3.3. Thêm SERVER_HOST

**Name:** `SERVER_HOST`

**Value:** IP address hoặc domain của Windows Server

Ví dụ:
- `123.45.67.89`
- `server.yourdomain.com`

**Click:** Add secret

### 3.4. Thêm SERVER_USER

**Name:** `SERVER_USER`

**Value:** `Administrator` (hoặc username Windows của bạn)

**Click:** Add secret

### 3.5. Thêm SERVER_PATH

**Name:** `SERVER_PATH`

**Value:** Đường dẫn nơi clone repository trên server

Ví dụ: `C:/inetpub/dental-clinic`

**Click:** Add secret

### 3.6. (Optional) Thêm secrets cho Staging

Nếu có staging server riêng:
- `STAGING_SSH_KEY`
- `STAGING_HOST`
- `STAGING_USER`
- `STAGING_PATH`

---

## 📦 BƯỚC 4: Clone Repository trên Server

```powershell
# SSH vào server (test từ máy local trước)
ssh Administrator@your-server-ip

# Tạo folder
mkdir C:\inetpub

# Clone repository
cd C:\inetpub
git clone https://github.com/NghiaLuuu/KLTN_BE_TrungNghia_ThuTram.git dental-clinic

# Vào folder docker
cd dental-clinic\docker

# Tạo file .env từ template
Copy-Item .env.example .env

# Sửa .env với giá trị production
notepad .env
```

**Trong .env, thay đổi:**
- `FRONTEND_URL=https://yourdomain.com`
- `CORS_ORIGIN=https://yourdomain.com`
- `VNPAY_RETURN_URL=https://yourdomain.com/api/payments/return/vnpay`
- `NODE_ENV=production`
- Passwords (MongoDB, RabbitMQ)

---

## ✅ BƯỚC 5: Test SSH Connection

### Từ máy local, test SSH

```powershell
# Test basic connection
ssh Administrator@your-server-ip

# Nếu thành công, bạn sẽ vào được server
# Exit để thoát
exit
```

### Test với SSH key (như GitHub Actions sẽ làm)

```powershell
# Specify key file
ssh -i ~/.ssh/github_actions_deploy Administrator@your-server-ip

# Nếu thành công → Setup đúng!
```

### Test commands

```powershell
# Test command execution (giống GitHub Actions)
ssh Administrator@your-server-ip "cd C:/inetpub/dental-clinic && git status"

# Nếu thấy git status → Perfect!
```

---

## 🚀 BƯỚC 6: Test GitHub Actions Deployment

### 6.1. Commit và Push code

```bash
# Từ máy local
cd path/to/your/project

git add .
git commit -m "Test CI/CD deployment"
git push origin main
```

### 6.2. Xem deployment trên GitHub

1. Vào repository trên GitHub
2. Click tab **Actions**
3. Xem workflow **Deploy to Production** đang chạy
4. Click vào để xem logs real-time

### 6.3. Monitor trên Server

```powershell
# SSH vào server
ssh Administrator@your-server-ip

# Xem Docker containers
cd C:\inetpub\dental-clinic\docker
docker-compose -f docker-compose.yml -f docker-compose.prod.yml ps

# Xem logs
docker-compose -f docker-compose.yml -f docker-compose.prod.yml logs -f
```

---

## 🔧 Troubleshooting

### ❌ Problem: Permission denied (publickey)

```powershell
# Trên server, check permissions
icacls C:\Users\Administrator\.ssh\authorized_keys

# Fix: Remove all và set lại quyền
icacls C:\Users\Administrator\.ssh\authorized_keys /inheritance:r
icacls C:\Users\Administrator\.ssh\authorized_keys /grant:r "Administrator:(R)"

# Restart SSH service
Restart-Service sshd
```

### ❌ Problem: Host key verification failed

```powershell
# Trên máy local, xóa old host key
ssh-keygen -R your-server-ip

# Hoặc add vào known_hosts
ssh-keyscan -H your-server-ip >> ~/.ssh/known_hosts
```

### ❌ Problem: SSH works but git pull fails

```powershell
# Trên server, check git credentials
cd C:\inetpub\dental-clinic
git config --list

# Setup git credentials
git config --global credential.helper store
git pull  # Nhập username/token lần đầu
```

### ❌ Problem: Docker command not found

```powershell
# Add Docker to PATH
$env:Path += ";C:\Program Files\Docker\Docker\resources\bin"

# Hoặc add permanent
[Environment]::SetEnvironmentVariable("Path", $env:Path + ";C:\Program Files\Docker\Docker\resources\bin", "Machine")
```

---

## 📝 Checklist

- [ ] Tạo SSH key pair trên máy local
- [ ] Install OpenSSH Server trên Windows Server
- [ ] Start SSH service và set auto-start
- [ ] Configure firewall (port 22)
- [ ] Thêm public key vào authorized_keys
- [ ] Set permissions cho authorized_keys
- [ ] Thêm 4 GitHub Secrets
- [ ] Clone repository trên server
- [ ] Tạo và config file .env
- [ ] Test SSH connection từ local
- [ ] Test git pull trên server
- [ ] Push code và xem GitHub Actions deploy
- [ ] Verify services running trên server

---

## 🎯 Kết quả mong đợi

Sau khi setup xong:

1. **Push code lên GitHub main branch**
   ```bash
   git push origin main
   ```

2. **GitHub Actions tự động:**
   - ✅ SSH vào Windows Server
   - ✅ Git pull latest code
   - ✅ Build Docker images
   - ✅ Restart containers
   - ✅ Run health checks
   - ✅ Report success/failure

3. **Deployment thành công:**
   - Green checkmark trên GitHub Actions
   - Services running trên server
   - Website accessible

---

## 📞 Support

Nếu gặp vấn đề:

1. Check GitHub Actions logs
2. SSH vào server check Docker logs
3. Verify SSH connection manually
4. Check file permissions
5. Review .env configuration

**Setup time:** 10-15 phút  
**Auto deploy:** Mỗi khi push main branch
