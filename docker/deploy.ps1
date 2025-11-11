# 🦷 Dental Clinic - Simple Production Deployment
# Lightweight deployment script for CI/CD environments

param([string]$Action = "help")

function Show-Help {
    Write-Host "🦷 Dental Clinic - Production Deployment" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Usage: .\deploy.ps1 [command]" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Commands:"
    Write-Host "  start      - Build and start all services"
    Write-Host "  stop       - Stop all services"
    Write-Host "  restart    - Restart all services"
    Write-Host "  logs       - Show logs (follow mode)"
    Write-Host "  status     - Show container status"
    Write-Host "  health     - Check service health"
    Write-Host "  update     - Pull latest images and restart"
    Write-Host ""
    Write-Host "Examples:"
    Write-Host "  .\deploy.ps1 start"
    Write-Host "  .\deploy.ps1 health"
}

function Start-Services {
    Write-Host "🚀 Starting production services..." -ForegroundColor Green
    docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Services started successfully!" -ForegroundColor Green
        Show-Status
    } else {
        Write-Host "❌ Failed to start services" -ForegroundColor Red
    }
}

function Stop-Services {
    Write-Host "🛑 Stopping services..." -ForegroundColor Yellow
    docker-compose -f docker-compose.yml -f docker-compose.prod.yml down
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Services stopped" -ForegroundColor Green
    } else {
        Write-Host "❌ Failed to stop services" -ForegroundColor Red
    }
}

function Restart-Services {
    Write-Host "🔄 Restarting services..." -ForegroundColor Yellow
    docker-compose -f docker-compose.yml -f docker-compose.prod.yml restart
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Services restarted" -ForegroundColor Green
    } else {
        Write-Host "❌ Failed to restart services" -ForegroundColor Red
    }
}

function Show-Logs {
    Write-Host "📋 Showing logs (Ctrl+C to exit)..." -ForegroundColor Cyan
    docker-compose -f docker-compose.yml -f docker-compose.prod.yml logs -f --tail=100
}

function Show-Status {
    Write-Host ""
    Write-Host "📊 Container Status:" -ForegroundColor Cyan
    docker-compose -f docker-compose.yml -f docker-compose.prod.yml ps
    Write-Host ""
}

function Test-Health {
    Write-Host "🩺 Checking service health..." -ForegroundColor Cyan
    Write-Host ""
    
    # Check container status
    docker-compose -f docker-compose.yml -f docker-compose.prod.yml ps --format "table {{.Name}}\t{{.State}}\t{{.Status}}"
    
    Write-Host ""
    Write-Host "🔍 Testing service endpoints..." -ForegroundColor Cyan
    
    $services = @{
        3001 = "Auth"
        3002 = "Room"
        3003 = "Service"
        3005 = "Schedule"
        3006 = "Appointment"
        3007 = "Payment"
        3008 = "Invoice"
        3009 = "Medicine"
        3010 = "Record"
        3011 = "Statistic"
        3012 = "Chat"
        3013 = "Chatbot"
    }
    
    foreach ($port in $services.Keys | Sort-Object) {
        try {
            $response = Invoke-WebRequest -Uri "http://localhost:$port/health" -TimeoutSec 3 -ErrorAction Stop
            if ($response.StatusCode -eq 200) {
                Write-Host "✅ $($services[$port]) Service (port $port)" -ForegroundColor Green
            } else {
                Write-Host "⚠️  $($services[$port]) Service (port $port) - Status: $($response.StatusCode)" -ForegroundColor Yellow
            }
        } catch {
            Write-Host "❌ $($services[$port]) Service (port $port) - Not responding" -ForegroundColor Red
        }
    }
    
    Write-Host ""
    Write-Host "🔧 Infrastructure:" -ForegroundColor Cyan
    
    # Check MongoDB
    try {
        docker exec dental_mongodb mongosh --quiet --eval "db.adminCommand('ping')" | Out-Null
        Write-Host "✅ MongoDB" -ForegroundColor Green
    } catch {
        Write-Host "❌ MongoDB" -ForegroundColor Red
    }
    
    # Check Redis
    try {
        docker exec dental_redis redis-cli ping | Out-Null
        Write-Host "✅ Redis" -ForegroundColor Green
    } catch {
        Write-Host "❌ Redis" -ForegroundColor Red
    }
    
    # Check RabbitMQ
    try {
        docker exec dental_rabbitmq rabbitmq-diagnostics -q ping | Out-Null
        Write-Host "✅ RabbitMQ" -ForegroundColor Green
    } catch {
        Write-Host "❌ RabbitMQ" -ForegroundColor Red
    }
}

function Update-Services {
    Write-Host "🔄 Pulling latest images and updating..." -ForegroundColor Cyan
    
    # Pull latest images
    docker-compose -f docker-compose.yml -f docker-compose.prod.yml pull
    
    # Rebuild and restart
    docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Services updated successfully!" -ForegroundColor Green
        Test-Health
    } else {
        Write-Host "❌ Update failed" -ForegroundColor Red
    }
}

# Main command processing
switch ($Action.ToLower()) {
    "start" { Start-Services }
    "stop" { Stop-Services }
    "restart" { Restart-Services }
    "logs" { Show-Logs }
    "status" { Show-Status }
    "health" { Test-Health }
    "update" { Update-Services }
    "help" { Show-Help }
    default {
        Write-Host "❌ Unknown command: $Action" -ForegroundColor Red
        Write-Host ""
        Show-Help
    }
}
