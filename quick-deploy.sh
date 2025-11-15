#!/bin/bash

# Script tự động deploy lên VPS
# Sử dụng: ./quick-deploy.sh

set -e

echo "🚀 Dental Clinic - Quick Deploy Script"
echo "======================================"

# Màu sắc
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Cấu hình
VPS_IP="194.233.75.21"
VPS_USER="root"  # Thay đổi nếu cần
PROJECT_PATH="~/dental-clinic"

echo -e "${YELLOW}📋 Kiểm tra kết nối VPS...${NC}"
if ssh -o ConnectTimeout=5 $VPS_USER@$VPS_IP "echo 'Connected'" > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Kết nối thành công!${NC}"
else
    echo -e "${RED}❌ Không thể kết nối đến VPS. Kiểm tra SSH key hoặc IP.${NC}"
    exit 1
fi

echo -e "${YELLOW}📦 Đang deploy...${NC}"

ssh $VPS_USER@$VPS_IP << 'ENDSSH'
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
ENDSSH

echo -e "${GREEN}✅ Deployment completed successfully!${NC}"
echo -e "${GREEN}🌐 Your API is available at: https://be.smilecare.io.vn${NC}"
