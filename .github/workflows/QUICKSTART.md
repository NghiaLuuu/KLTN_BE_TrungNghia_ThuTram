# GitHub Actions Quick Setup Guide

## 🎯 Quick Start (5 phút)

### Bước 1: Tạo SSH Key trên máy local

```powershell
# Windows PowerShell
cd ~
ssh-keygen -t rsa -b 4096 -f github_actions_key
# Nhấn Enter để skip passphrase

# View private key (copy toàn bộ nội dung)
type github_actions_key

# View public key
type github_actions_key.pub
```

### Bước 2: Setup trên GitHub

1. Vào repository → **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret**
3. Thêm các secrets:

| Secret Name | Value | Ví dụ |
|------------|-------|-------|
| SSH_PRIVATE_KEY | Nội dung file `github_actions_key` | `-----BEGIN RSA PRIVATE KEY-----...` |
| SERVER_HOST | IP hoặc domain server | `123.45.67.89` |
| SERVER_USER | Username Windows Server | `Administrator` |
| SERVER_PATH | Đường dẫn project trên server | `C:/inetpub/dental-clinic` |

### Bước 3: Setup trên Windows Server

```powershell
# 1. Install OpenSSH (nếu chưa có)
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
Start-Service sshd
Set-Service -Name sshd -StartupType 'Automatic'

# 2. Tạo folder .ssh
mkdir C:\Users\Administrator\.ssh

# 3. Thêm public key
notepad C:\Users\Administrator\.ssh\authorized_keys
# Paste nội dung file github_actions_key.pub vào đây

# 4. Clone repository
cd C:\inetpub
git clone https://github.com/your-username/your-repo.git dental-clinic
cd dental-clinic\docker

# 5. Tạo file .env
Copy-Item .env.example .env
notepad .env  # Cập nhật domain và credentials production
```

### Bước 4: Test Deployment

```bash
# Từ máy local
git add .
git commit -m "Test CI/CD"
git push origin main

# GitHub Actions sẽ tự động deploy!
```

## 📊 Kiểm tra Deployment

### Xem trên GitHub
- Vào **Actions** tab
- Click vào workflow run mới nhất
- Xem logs real-time

### Xem trên Server
```powershell
ssh Administrator@your-server-ip

cd C:\inetpub\dental-clinic\docker
docker-compose -f docker-compose.yml -f docker-compose.prod.yml ps
docker-compose -f docker-compose.yml -f docker-compose.prod.yml logs -f
```

## 🔧 Troubleshooting

### ❌ SSH Connection Failed
```powershell
# Trên server, check SSH service
Get-Service sshd

# Restart SSH
Restart-Service sshd

# Test từ local
ssh Administrator@your-server-ip
```

### ❌ Permission Denied
```powershell
# Trên server, check authorized_keys
icacls C:\Users\Administrator\.ssh\authorized_keys
# Phải có permission cho Administrator

# Fix permissions
icacls C:\Users\Administrator\.ssh\authorized_keys /inheritance:r /grant:r "Administrator:(R)"
```

### ❌ Docker Build Failed
```powershell
# Trên server
cd C:\inetpub\dental-clinic\docker
docker-compose -f docker-compose.yml -f docker-compose.prod.yml logs
docker system prune -f  # Clean up
```

## 🎉 Success!

Khi deployment thành công, bạn sẽ thấy:
- ✅ Green checkmark trên GitHub Actions
- ✅ Services running trên server
- ✅ Website accessible tại domain của bạn

---

**Thời gian setup**: ~5-10 phút  
**Auto deploy**: Mỗi khi push lên main branch
