# 📦 Hướng Dẫn Deploy Backend Dental Clinic

**VPS**: `194.233.75.21` | **Domain**: `be.smilecare.io.vn`

---

## 🚀 BƯỚC 1: Cài Đặt VPS (Linux)

SSH vào VPS và chạy:

```bash
ssh root@194.233.75.21

# Cài Docker + Docker Compose + Git + Nginx
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
sudo curl -L "https://github.com/docker/compose/releases/download/v2.24.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
sudo apt update && sudo apt install -y git nginx certbot python3-certbot-nginx

# Verify
docker --version && docker-compose --version
```

---

## 🔑 BƯỚC 2: Tạo SSH Key cho GitHub Actions

### 2.1. Đảm bảo bạn có thể SSH vào VPS

```bash
# Từ máy local, test SSH bằng password
ssh root@194.233.75.21
# Nhập password VPS của bạn
```

Nếu chưa được, contact nhà cung cấp VPS để lấy thông tin đăng nhập.

### 2.2. Tạo SSH Key trên VPS

Sau khi đã SSH vào VPS:

```bash
# Tạo key (không cần password)
ssh-keygen -t ed25519 -C "github-actions" -f ~/.ssh/github_actions -N ""

# Add public key vào authorized_keys
cat ~/.ssh/github_actions.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys

# Copy private key này (dùng cho GitHub Secret)
cat ~/.ssh/github_actions
# Copy toàn bộ output (bao gồm -----BEGIN ... -----END)
```

---

## 🔐 BƯỚC 3: Cấu Hình GitHub Secrets (cho CI/CD)

Vào: **GitHub Repo → Settings → Secrets and variables → Actions**

Thêm **3 secrets bắt buộc**:

```
SSH_PRIVATE_KEY = nội dung từ ~/.ssh/github_actions (copy từ bước 2)
SERVER_HOST = 194.233.75.21
SERVER_USER = root
```

**Lưu ý**: Các secrets khác (JWT, passwords) chỉ cần cấu hình trong file `.env` trên VPS (Bước 5)

---

## 📦 BƯỚC 4: Clone Project lên VPS

```bash
# Trên VPS
cd ~
git clone https://github.com/NghiaLuuu/KLTN_BE_TrungNghia_ThuTram.git
mv KLTN_BE_TrungNghia_ThuTram dental-clinic
cd dental-clinic

# Kiểm tra cấu trúc
ls -la
# Phải thấy: docker/, services/, .github/, etc.

# Kiểm tra thư mục docker
ls docker/
# Phải thấy: docker-compose.yml, docker-compose.prod.yml, .env.example
```

---

## ⚙️ BƯỚC 5: Cấu Hình .env cho Production

File `.env` đã có sẵn trong repo, nhưng cần cập nhật cho production:

```bash
cd ~/dental-clinic/docker
nano .env
```

**Tìm và sửa các dòng sau:**

```env
# 1. Đổi passwords mặc định (BẮT BUỘC - bảo mật)
MONGO_INITDB_ROOT_PASSWORD=password123  → Đổi thành password mạnh
RABBITMQ_DEFAULT_PASS=guest             → Đổi thành password mạnh

# 2. Cập nhật VNPAY return URL
VNPAY_RETURN_URL=https://yourdomain.com/api/payments/return/vnpay
→ Đổi thành: https://be.smilecare.io.vn/api/payments/return/vnpay

# 3. Cập nhật CORS cho domain production
ALLOWED_ORIGINS=https://yourdomain.com
→ Đổi thành: https://smilecare.io.vn,https://be.smilecare.io.vn

SOCKET_CORS_ORIGINS=https://yourdomain.com
→ Đổi thành: https://smilecare.io.vn
```

**Lưu file**: `Ctrl + O` → Enter → `Ctrl + X`

**Các config khác (JWT, Email, AWS, OpenAI) đã OK, giữ nguyên!**

---

## 🐳 BƯỚC 6: Chạy Docker

```bash
cd ~/dental-clinic/docker

# Start tất cả services
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

# Kiểm tra
docker-compose ps

# Xem logs
docker-compose logs -f
```

---

## 🌐 BƯỚC 7: Setup Nginx (Reverse Proxy)

Tạo config:

```bash
sudo nano /etc/nginx/sites-available/dental-clinic
```

Copy vào:

```nginx
server {
    listen 80;
    server_name be.smilecare.io.vn;
    client_max_body_size 100M;

    location /api/auth/ { proxy_pass http://127.0.0.1:3001/api/; }
    location /api/rooms/ { proxy_pass http://127.0.0.1:3002/api/; }
    location /api/services/ { proxy_pass http://127.0.0.1:3003/api/; }
    location /api/schedules/ { proxy_pass http://127.0.0.1:3005/api/; }
    location /api/appointments/ { proxy_pass http://127.0.0.1:3006/api/; }
    location /api/payments/ { proxy_pass http://127.0.0.1:3007/api/; }
    location /api/invoices/ { proxy_pass http://127.0.0.1:3008/api/; }
    location /api/medicines/ { proxy_pass http://127.0.0.1:3009/api/; }
    location /api/records/ { proxy_pass http://127.0.0.1:3010/api/; }
    location /api/statistics/ { proxy_pass http://127.0.0.1:3011/api/; }
    location /api/chat/ { proxy_pass http://127.0.0.1:3012/api/; }
    location /api/chatbot/ { proxy_pass http://127.0.0.1:3013/api/; }
    location /health { proxy_pass http://127.0.0.1:3001/health; }
}
```

Kích hoạt:

```bash
sudo ln -s /etc/nginx/sites-available/dental-clinic /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

---

## 🔒 BƯỚC 8: Setup SSL (HTTPS)

```bash
sudo certbot --nginx -d be.smilecare.io.vn
```

Chọn option **2** để auto redirect HTTP → HTTPS

---

## 🔥 BƯỚC 9: Setup Firewall

```bash
sudo ufw allow 22
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable
```

---

## ✅ BƯỚC 10: Test API

```bash
# Test health
curl https://be.smilecare.io.vn/health

# Xem containers
docker ps

# Xem logs
cd ~/dental-clinic/docker
docker-compose logs -f auth-service
```

---

## 🔄 Deploy Tự Động (CI/CD)

Sau khi setup xong, mỗi lần push code:

```bash
git add .
git commit -m "Update"
git push origin main
```

GitHub Actions tự động deploy! Xem tiến trình tại: **GitHub → Actions**

---

## 📊 Lệnh Hữu Ích

```bash
# Xem logs
docker-compose logs -f [service-name]

# Restart service
docker-compose restart [service-name]

# Rebuild & restart
docker-compose up -d --build [service-name]

# Stop all
docker-compose down

# Clean images
docker system prune -a
```

---

## 🆘 Troubleshooting

| Vấn đề | Giải pháp |
|--------|-----------|
| Service không start | `docker logs dental_[service]_service` |
| Port bị chiếm | `sudo netstat -tulpn \| grep :3001` |
| MongoDB lỗi | `docker logs dental_mongodb` |
| Nginx lỗi | `sudo nginx -t` |

---

## 🔐 Security Checklist

- ✅ Đổi passwords trong `.env`
- ✅ Enable UFW firewall
- ✅ Setup SSL certificate
- ✅ Disable root SSH login
- ✅ Setup fail2ban
- ✅ Backup MongoDB định kỳ

---

**🎉 Done! API của bạn: `https://be.smilecare.io.vn`**
