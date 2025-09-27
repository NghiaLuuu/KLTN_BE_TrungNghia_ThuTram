# 🦷 Dental Clinic Microservices - Docker Management Script
# PowerShell script for Windows environments

param(
    [string]$Command = "help",
    [string]$Service = "",
    [int]$Replicas = 1
)

# Colors for output
function Write-ColorOutput($ForegroundColor) {
    $fc = $host.UI.RawUI.ForegroundColor
    $host.UI.RawUI.ForegroundColor = $ForegroundColor
    if ($args) {
        Write-Output $args
    } else {
        $input | Write-Output
    }
    $host.UI.RawUI.ForegroundColor = $fc
}

function Show-Help {
    Write-ColorOutput Cyan "🦷 Dental Clinic Microservices - Docker Management"
    Write-Host ""
    Write-Host "Usage: .\docker.ps1 [command] [options]"
    Write-Host ""
    Write-ColorOutput Yellow "Infrastructure Commands:"
    Write-Host "  infrastructure    - Start only infrastructure services (MongoDB, Redis, RabbitMQ)"
    Write-Host "  quick            - Quick start with infrastructure only"
    Write-Host ""
    Write-ColorOutput Yellow "Build & Deployment Commands:"
    Write-Host "  build            - Build all Docker images"
    Write-Host "  up               - Start all services"
    Write-Host "  up-logs          - Start all services and show logs"
    Write-Host "  down             - Stop all services"
    Write-Host "  restart          - Restart all services"
    Write-Host "  prod             - Full production deployment (build + start)"
    Write-Host "  all              - Build, start all services and show status"
    Write-Host ""
    Write-ColorOutput Yellow "Monitoring & Management:"
    Write-Host "  status           - Show running containers status"
    Write-Host "  health           - Check health of all services"
    Write-Host "  logs             - Show logs for all services"
    Write-Host "  logs [service]   - Show logs for specific service"
    Write-Host ""
    Write-ColorOutput Yellow "Maintenance Commands:"
    Write-Host "  clean            - Remove stopped containers and unused images"
    Write-Host "  clean-all        - Remove everything including volumes (⚠️ DATA LOSS!)"
    Write-Host "  prune            - Remove unused Docker resources"
    Write-Host "  rebuild [service] - Rebuild specific service"
    Write-Host ""
    Write-ColorOutput Yellow "Development Commands:"
    Write-Host "  dev              - Start development environment (infrastructure + core services)"
    Write-Host "  env-check        - Check environment configuration"
    Write-Host "  db-backup        - Backup MongoDB data"
    Write-Host ""
    Write-ColorOutput Green "Examples:"
    Write-Host "  .\docker.ps1 infrastructure  # Start only MongoDB, Redis, RabbitMQ"
    Write-Host "  .\docker.ps1 build           # Build all images"
    Write-Host "  .\docker.ps1 up              # Start all services"
    Write-Host "  .\docker.ps1 logs auth-service # Show auth service logs"
    Write-Host "  .\docker.ps1 rebuild auth-service # Rebuild auth service"
}

function Start-Infrastructure {
    Write-ColorOutput Green "🚀 Starting infrastructure services..."
    docker-compose up -d mongodb redis rabbitmq
    
    if ($LASTEXITCODE -eq 0) {
        Write-ColorOutput Green "✅ Infrastructure services started!"
        Write-Host ""
        Write-ColorOutput Cyan "📊 Access URLs:"
        Write-Host "  - MongoDB: mongodb://localhost:27017"
        Write-Host "  - Redis: redis://localhost:6379"
        Write-Host "  - RabbitMQ Management: http://localhost:15672 (admin/rabbitmq123)"
    } else {
        Write-ColorOutput Red "❌ Failed to start infrastructure services"
    }
}

function Build-Services {
    Write-ColorOutput Green "🔨 Building all services..."
    docker-compose build --parallel
    
    if ($LASTEXITCODE -eq 0) {
        Write-ColorOutput Green "✅ All services built successfully!"
    } else {
        Write-ColorOutput Red "❌ Build failed"
    }
}

function Start-AllServices {
    Write-ColorOutput Green "🚀 Starting all services..."
    docker-compose up -d
    
    if ($LASTEXITCODE -eq 0) {
        Write-ColorOutput Green "✅ All services started!"
        Show-Status
    } else {
        Write-ColorOutput Red "❌ Failed to start services"
    }
}

function Start-WithLogs {
    Write-ColorOutput Green "🚀 Starting all services with logs..."
    docker-compose up
}

function Stop-AllServices {
    Write-ColorOutput Yellow "🛑 Stopping all services..."
    docker-compose down
    
    if ($LASTEXITCODE -eq 0) {
        Write-ColorOutput Green "✅ All services stopped!"
    } else {
        Write-ColorOutput Red "❌ Failed to stop services"
    }
}

function Restart-AllServices {
    Write-ColorOutput Yellow "🔄 Restarting all services..."
    docker-compose restart
    
    if ($LASTEXITCODE -eq 0) {
        Write-ColorOutput Green "✅ All services restarted!"
    } else {
        Write-ColorOutput Red "❌ Failed to restart services"
    }
}

function Show-Logs {
    param([string]$ServiceName = "")
    
    if ($ServiceName) {
        Write-ColorOutput Cyan "📋 Showing logs for $ServiceName..."
        docker-compose logs -f $ServiceName
    } else {
        Write-ColorOutput Cyan "📋 Showing logs for all services..."
        docker-compose logs -f
    }
}

function Show-Status {
    Write-ColorOutput Cyan "📊 Container Status:"
    docker-compose ps --format "table {{.Name}}\t{{.State}}\t{{.Ports}}"
    
    Write-Host ""
    Write-ColorOutput Cyan "🌐 Service URLs:"
    Write-Host "  - Auth Service: http://localhost:3001"
    Write-Host "  - Room Service: http://localhost:3002"
    Write-Host "  - Service Service: http://localhost:3003"
    Write-Host "  - Schedule Service: http://localhost:3005"
    Write-Host "  - Appointment Service: http://localhost:3006"
    Write-Host "  - Payment Service: http://localhost:3007"
    Write-Host "  - Invoice Service: http://localhost:3008"
    Write-Host "  - Medicine Service: http://localhost:3009"
    Write-Host "  - Record Service: http://localhost:3010"
    Write-Host "  - Statistic Service: http://localhost:3011"
    Write-Host "  - Chat Service: http://localhost:3012"
    Write-Host "  - Chatbot Service: http://localhost:3013"
    
    Write-Host ""
    Write-ColorOutput Cyan "🔧 Management URLs:"
    Write-Host "  - RabbitMQ Management: http://localhost:15672"
    Write-Host "  - MongoDB: mongodb://localhost:27017"
    Write-Host "  - Redis: redis://localhost:6379"
}

function Test-Health {
    Write-ColorOutput Cyan "🩺 Checking service health..."
    docker-compose ps
    
    Write-Host ""
    Write-ColorOutput Cyan "🔍 Testing service endpoints..."
    
    $services = @(
        @{Name="Auth Service"; Port=3001},
        @{Name="Room Service"; Port=3002},
        @{Name="Service Service"; Port=3003},
        @{Name="Schedule Service"; Port=3005},
        @{Name="Appointment Service"; Port=3006},
        @{Name="Payment Service"; Port=3007},
        @{Name="Invoice Service"; Port=3008},
        @{Name="Medicine Service"; Port=3009},
        @{Name="Record Service"; Port=3010},
        @{Name="Statistic Service"; Port=3011},
        @{Name="Chat Service"; Port=3012},
        @{Name="Chatbot Service"; Port=3013}
    )
    
    foreach ($service in $services) {
        try {
            $response = Invoke-WebRequest -Uri "http://localhost:$($service.Port)/health" -TimeoutSec 5 -ErrorAction Stop
            if ($response.StatusCode -eq 200) {
                Write-ColorOutput Green "✅ $($service.Name) ($($service.Port))"
            } else {
                Write-ColorOutput Red "❌ $($service.Name) ($($service.Port))"
            }
        } catch {
            Write-ColorOutput Red "❌ $($service.Name) ($($service.Port))"
        }
    }
}

function Clean-Docker {
    Write-ColorOutput Yellow "🧹 Cleaning up Docker resources..."
    docker-compose down --remove-orphans
    docker system prune -f
    
    if ($LASTEXITCODE -eq 0) {
        Write-ColorOutput Green "✅ Cleanup completed!"
    } else {
        Write-ColorOutput Red "❌ Cleanup failed"
    }
}

function Clean-All {
    Write-ColorOutput Red "⚠️ WARNING: This will delete all data in volumes!"
    $confirm = Read-Host "Are you sure? (y/N)"
    
    if ($confirm -eq "y" -or $confirm -eq "Y") {
        docker-compose down -v --remove-orphans
        docker system prune -a -f --volumes
        Write-ColorOutput Green "✅ Full cleanup completed!"
    } else {
        Write-ColorOutput Yellow "Operation cancelled."
    }
}

function Start-Development {
    Write-ColorOutput Green "🚀 Starting development environment..."
    docker-compose up -d mongodb redis rabbitmq auth-service room-service schedule-service
    
    if ($LASTEXITCODE -eq 0) {
        Write-ColorOutput Green "✅ Development environment ready!"
    } else {
        Write-ColorOutput Red "❌ Failed to start development environment"
    }
}

function Rebuild-Service {
    param([string]$ServiceName)
    
    if (-not $ServiceName) {
        Write-ColorOutput Red "❌ Please specify a service name"
        return
    }
    
    Write-ColorOutput Yellow "🔨 Rebuilding $ServiceName service..."
    docker-compose build --no-cache $ServiceName
    docker-compose up -d $ServiceName
    
    if ($LASTEXITCODE -eq 0) {
        Write-ColorOutput Green "✅ $ServiceName service rebuilt and restarted!"
    } else {
        Write-ColorOutput Red "❌ Failed to rebuild $ServiceName"
    }
}

function Check-Environment {
    Write-ColorOutput Cyan "🔍 Checking environment configuration..."
    
    # Check if .env file exists
    if (Test-Path ".env") {
        Write-ColorOutput Green "✅ .env file exists"
    } else {
        Write-ColorOutput Red "❌ .env file missing"
    }
    
    # Check Docker
    try {
        $dockerVersion = docker --version
        Write-ColorOutput Green "✅ Docker available: $dockerVersion"
    } catch {
        Write-ColorOutput Red "❌ Docker not found"
    }
    
    # Check Docker Compose
    try {
        $composeVersion = docker-compose --version
        Write-ColorOutput Green "✅ Docker Compose available: $composeVersion"
    } catch {
        Write-ColorOutput Red "❌ Docker Compose not found"
    }
}

function Backup-Database {
    Write-ColorOutput Cyan "💾 Backing up MongoDB..."
    
    $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
    $backupDir = "backup_$timestamp"
    
    docker exec dental_mongodb mongodump --out /tmp/backup --authenticationDatabase admin -u admin -p password123
    docker cp dental_mongodb:/tmp/backup ./$backupDir
    
    if ($LASTEXITCODE -eq 0) {
        Write-ColorOutput Green "✅ Database backup completed in $backupDir"
    } else {
        Write-ColorOutput Red "❌ Database backup failed"
    }
}

# Main command processing
switch ($Command.ToLower()) {
    "help" { Show-Help }
    "infrastructure" { Start-Infrastructure }
    "quick" { Start-Infrastructure }
    "build" { Build-Services }
    "up" { Start-AllServices }
    "up-logs" { Start-WithLogs }
    "down" { Stop-AllServices }
    "restart" { Restart-AllServices }
    "logs" { Show-Logs -ServiceName $Service }
    "status" { Show-Status }
    "health" { Test-Health }
    "clean" { Clean-Docker }
    "clean-all" { Clean-All }
    "prune" { docker system prune -f }
    "dev" { Start-Development }
    "prod" { 
        Build-Services
        Start-AllServices
    }
    "all" {
        Build-Services
        Start-AllServices
        Show-Status
    }
    "rebuild" { Rebuild-Service -ServiceName $Service }
    "env-check" { Check-Environment }
    "db-backup" { Backup-Database }
    default {
        Write-ColorOutput Red "❌ Unknown command: $Command"
        Write-Host ""
        Show-Help
    }
}
