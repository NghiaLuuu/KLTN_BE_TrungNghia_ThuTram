# Quick Deploy Script for PowerShell
# Sử dụng: .\quick-deploy.ps1

$VPS_IP = "194.233.75.21"
$VPS_USER = "root"  # Thay đổi nếu cần

Write-Host "🚀 Dental Clinic - Quick Deploy Script" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan

Write-Host "📋 Kiểm tra kết nối VPS..." -ForegroundColor Yellow
try {
    ssh -o ConnectTimeout=5 "$VPS_USER@$VPS_IP" "echo 'Connected'" | Out-Null
    Write-Host "✅ Kết nối thành công!" -ForegroundColor Green
} catch {
    Write-Host "❌ Không thể kết nối đến VPS. Kiểm tra SSH key hoặc IP." -ForegroundColor Red
    exit 1
}

Write-Host "📦 Đang deploy..." -ForegroundColor Yellow

$deployScript = @'
    set -e
    
    echo "📂 Navigating to project directory..."
    cd ~/dental-clinic || exit 1
    
    echo "🔄 Pulling latest code..."
    git pull origin main
    
    echo "🐳 Stopping existing containers..."
    cd docker
    docker-compose -f docker-compose.yml -f docker-compose.prod.yml down
    
    echo "🏗️ Building new images..."
    docker-compose -f docker-compose.yml -f docker-compose.prod.yml build --no-cache
    
    echo "🚀 Starting services..."
    docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
    
    echo "🧹 Cleaning up..."
    docker system prune -f
    
    echo "⏳ Waiting for services to start (30s)..."
    sleep 30
    
    echo "🩺 Running health checks..."
    failed=0
    
    for port in 3001 3007 3012; do
        if curl -f http://localhost:$port/health > /dev/null 2>&1; then
            echo "✅ Service on port $port is healthy"
        else
            echo "❌ Service on port $port failed"
            failed=$((failed + 1))
        fi
    done
    
    if [ $failed -eq 0 ]; then
        echo "✅ All services are running!"
    else
        echo "⚠️ Some services failed. Check logs."
        exit 1
    fi
    
    echo "📊 Container status:"
    docker-compose -f docker-compose.yml -f docker-compose.prod.yml ps
'@

ssh "$VPS_USER@$VPS_IP" $deployScript

Write-Host "✅ Deployment completed successfully!" -ForegroundColor Green
Write-Host "🌐 Your API is available at: https://be.smilecare.io.vn" -ForegroundColor Green
