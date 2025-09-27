# Dental Clinic Microservices - Production Management Script for Windows
# PowerShell equivalent of Makefile for Windows environments

param(
    [Parameter(Position=0)]
    [string]$Command = "help",
    
    [Parameter(Position=1)]
    [string]$Service = "",
    
    [Parameter(Position=2)]
    [int]$Replicas = 1,
    
    [switch]$Detailed,
    [switch]$Alert,
    [switch]$Force
)

# Color functions for better output
function Write-Success($message) { Write-Host "✅ $message" -ForegroundColor Green }
function Write-Error($message) { Write-Host "❌ $message" -ForegroundColor Red }
function Write-Warning($message) { Write-Host "⚠️  $message" -ForegroundColor Yellow }
function Write-Info($message) { Write-Host "ℹ️  $message" -ForegroundColor Cyan }

# Check if Docker is running
function Test-Docker {
    try {
        docker info | Out-Null
        return $true
    } catch {
        Write-Error "Docker is not running. Please start Docker Desktop."
        return $false
    }
}

# Check if file exists
function Test-FileExists($path) {
    if (Test-Path $path) {
        return $true
    } else {
        Write-Error "File not found: $path"
        return $false
    }
}

# Production deployment functions
function Start-ProductionServices {
    Write-Info "🌟 Starting production deployment..."
    
    # Check prerequisites
    if (-not (Test-FileExists ".env")) {
        Write-Error ".env file not found! Please create it first."
        return
    }
    
    if (-not (Test-FileExists "nginx\ssl\fullchain.pem")) {
        Write-Warning "SSL certificate not found! Place certificates in nginx\ssl\"
        Write-Info "Services will start but HTTPS won't work properly."
    }
    
    try {
        docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
        Write-Success "Production services started"
        Write-Info "📋 Run './docker-prod.ps1 health-check' to verify all services"
    } catch {
        Write-Error "Failed to start production services: $_"
    }
}

function Stop-ProductionServices {
    Write-Info "🛑 Stopping production services..."
    try {
        docker-compose -f docker-compose.yml -f docker-compose.prod.yml down
        Write-Success "Production services stopped"
    } catch {
        Write-Error "Failed to stop production services: $_"
    }
}

function Show-ProductionLogs {
    docker-compose -f docker-compose.yml -f docker-compose.prod.yml logs -f
}

function Show-ProductionStatus {
    Write-Info "📊 Production Container Status:"
    docker-compose -f docker-compose.yml -f docker-compose.prod.yml ps
}

# Health check function
function Test-ServiceHealth {
    param([bool]$DetailedMode = $false, [bool]$AlertMode = $false)
    
    Write-Info "🩺 Checking service health..."
    
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
    
    $failedServices = @()
    $allHealthy = $true
    
    # Check infrastructure
    Write-Host "`nInfrastructure Services:" -ForegroundColor Yellow
    Write-Host "----------------------" -ForegroundColor Yellow
    
    # MongoDB
    Write-Host -NoNewline "MongoDB: "
    try {
        $result = docker exec dental_mongodb mongosh --eval "db.adminCommand('ismaster')" 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Success "Healthy"
        } else {
            Write-Error "Failed"
            $failedServices += "MongoDB"
            $allHealthy = $false
        }
    } catch {
        Write-Error "Failed"
        $failedServices += "MongoDB"
        $allHealthy = $false
    }
    
    # Redis
    Write-Host -NoNewline "Redis: "
    try {
        $result = docker exec dental_redis redis-cli ping 2>&1
        if ($result -eq "PONG") {
            Write-Success "Healthy"
        } else {
            Write-Error "Failed"
            $failedServices += "Redis"
            $allHealthy = $false
        }
    } catch {
        Write-Error "Failed"
        $failedServices += "Redis"
        $allHealthy = $false
    }
    
    # RabbitMQ
    Write-Host -NoNewline "RabbitMQ: "
    try {
        $result = docker exec dental_rabbitmq rabbitmqctl status 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Success "Healthy"
        } else {
            Write-Error "Failed"
            $failedServices += "RabbitMQ"
            $allHealthy = $false
        }
    } catch {
        Write-Error "Failed"
        $failedServices += "RabbitMQ"
        $allHealthy = $false
    }
    
    # Check microservices
    Write-Host "`nMicroservices:" -ForegroundColor Yellow
    Write-Host "-------------" -ForegroundColor Yellow
    
    foreach ($service in $services) {
        Write-Host -NoNewline "$($service.Name): "
        
        # Check if container is running
        $containerName = "dental_" + ($service.Name.Split()[0].ToLower() + "-service")
        $containerRunning = docker ps --format "table {{.Names}}" | Select-String $containerName
        
        if ($containerRunning) {
            # Test health endpoint
            try {
                $response = Invoke-WebRequest -Uri "http://localhost:$($service.Port)/health" -TimeoutSec 5 -UseBasicParsing
                if ($response.StatusCode -eq 200) {
                    Write-Success "Healthy"
                } else {
                    Write-Warning "Container running but health check failed"
                    $failedServices += $service.Name
                    $allHealthy = $false
                }
            } catch {
                Write-Warning "Container running but not responding"
                $failedServices += $service.Name
                $allHealthy = $false
            }
        } else {
            Write-Error "Container not running"
            $failedServices += $service.Name
            $allHealthy = $false
        }
    }
    
    # Summary
    Write-Host "`n=======================================" -ForegroundColor Cyan
    if ($allHealthy) {
        Write-Success "All systems operational"
    } else {
        Write-Error "Issues detected with: $($failedServices -join ', ')"
        
        # Send alert if requested
        if ($AlertMode) {
            Write-Info "Sending alerts..."
            # Add webhook/email notification logic here
        }
    }
    Write-Host "=======================================" -ForegroundColor Cyan
    
    return $allHealthy
}

# Backup functions
function Start-Backup {
    param([string]$BackupType = "daily")
    
    Write-Info "💾 Creating $BackupType backup..."
    
    if (Test-FileExists "backup.sh") {
        # Convert to PowerShell equivalent or use WSL
        Write-Info "Running backup script..."
        if (Get-Command wsl -ErrorAction SilentlyContinue) {
            wsl chmod +x backup.sh; wsl ./backup.sh $BackupType
        } else {
            Write-Warning "WSL not available. Please run backup manually."
        }
    } else {
        Write-Error "backup.sh not found"
    }
}

# SSL setup function
function Setup-SSL {
    Write-Info "🔐 Setting up SSL certificates..."
    Write-Warning "Make sure to update your domain in nginx\nginx.conf first!"
    
    if (-not (Test-Path "nginx\ssl")) {
        New-Item -ItemType Directory -Path "nginx\ssl" -Force
    }
    
    Write-Info "For Let's Encrypt, run:"
    Write-Host "docker run --rm -v ${PWD}\nginx\ssl:/etc/letsencrypt/live/yourdomain.com certbot/certbot certonly --standalone -d yourdomain.com -d www.yourdomain.com" -ForegroundColor Green
}

# Network diagnostics
function Test-NetworkConnectivity {
    Write-Info "🌐 Checking network connectivity..."
    
    $tests = @(
        @{Service="Auth"; Container="dental_auth_service"; Target="mongodb"; Port=27017},
        @{Service="Payment"; Container="dental_payment_service"; Target="redis"; Port=6379},
        @{Service="Schedule"; Container="dental_schedule_service"; Target="rabbitmq"; Port=5672}
    )
    
    foreach ($test in $tests) {
        Write-Host -NoNewline "$($test.Service) → $($test.Target): "
        try {
            $result = docker exec $test.Container nc -z $test.Target $test.Port 2>&1
            if ($LASTEXITCODE -eq 0) {
                Write-Success "Connected"
            } else {
                Write-Error "Failed"
            }
        } catch {
            Write-Error "Failed"
        }
    }
}

# Performance monitoring
function Show-Performance {
    Write-Info "📈 Performance Metrics:"
    docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}\t{{.BlockIO}}"
}

# Help function
function Show-Help {
    Write-Host @"
🦷 Dental Clinic Microservices - Production Management (Windows)

Available commands:
  help                  - Show this help message
  
Development:
  build                 - Build all Docker images  
  up                    - Start all services in development mode
  down                  - Stop all services
  restart               - Restart all services
  logs [service]        - Show logs (all services or specific)
  status                - Show container status
  clean                 - Clean Docker resources
  
Production:
  prod-up               - Start services in production mode
  prod-down             - Stop production services  
  prod-logs             - Show production logs
  prod-status           - Show production status
  prod-restart          - Restart production services
  
Infrastructure:
  infra-up              - Start only infrastructure services
  infra-down            - Stop infrastructure services
  
Monitoring:
  health                - Quick health check
  health-check [-Detailed] [-Alert] - Detailed health monitoring
  network-check         - Check network connectivity
  perf-monitor          - Show performance metrics
  
Backup & Security:
  backup-daily          - Create daily backup
  backup-weekly         - Create weekly backup  
  backup-monthly        - Create monthly backup
  ssl-setup             - Setup SSL certificates
  security-audit        - Run security audit
  
Database:
  db-backup             - Backup MongoDB
  db-restore            - Restore MongoDB from backup

Examples:
  .\docker.ps1 prod-up
  .\docker.ps1 health-check -Detailed -Alert
  .\docker.ps1 logs auth-service
  .\docker.ps1 backup-daily

"@ -ForegroundColor Cyan
}

# Main command routing
if (-not (Test-Docker) -and $Command -ne "help") {
    exit 1
}

switch ($Command.ToLower()) {
    "help" { Show-Help }
    "build" { docker-compose build }
    "up" { docker-compose up -d; Show-Status }
    "down" { docker-compose down }
    "restart" { docker-compose restart }
    "logs" { 
        if ($Service) { 
            docker-compose logs -f $Service 
        } else { 
            docker-compose logs -f 
        }
    }
    "status" { docker-compose ps }
    "clean" { 
        docker-compose down --remove-orphans
        docker system prune -f
        Write-Success "Cleanup completed"
    }
    
    # Production commands
    "prod-up" { Start-ProductionServices }
    "prod-down" { Stop-ProductionServices }
    "prod-logs" { Show-ProductionLogs }
    "prod-status" { Show-ProductionStatus }
    "prod-restart" { 
        docker-compose -f docker-compose.yml -f docker-compose.prod.yml restart
        Write-Success "Production services restarted"
    }
    
    # Infrastructure
    "infra-up" { 
        docker-compose up -d mongodb redis rabbitmq
        Write-Success "Infrastructure services started"
    }
    "infra-down" { 
        docker-compose stop mongodb redis rabbitmq
        Write-Success "Infrastructure services stopped"
    }
    
    # Health and monitoring
    "health" { 
        Write-Info "🩺 Quick health check..."
        docker-compose ps
    }
    "health-check" { Test-ServiceHealth -DetailedMode $Detailed -AlertMode $Alert }
    "network-check" { Test-NetworkConnectivity }
    "perf-monitor" { Show-Performance }
    
    # Backup
    "backup-daily" { Start-Backup -BackupType "daily" }
    "backup-weekly" { Start-Backup -BackupType "weekly" }
    "backup-monthly" { Start-Backup -BackupType "monthly" }
    
    # SSL and Security
    "ssl-setup" { Setup-SSL }
    "security-audit" { 
        Write-Info "🔒 Running security audit..."
        Write-Info "Checking for exposed ports..."
        netstat -an | Select-String ":(3001|3002|3003|3005|3006|3007|3008|3009|3010|3011|3012|3013|27017|6379|5672|15672)"
    }
    
    # Database
    "db-backup" { 
        Write-Info "💾 Backing up MongoDB..."
        $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
        docker exec dental_mongodb mongodump --out /tmp/backup_$timestamp
        Write-Success "MongoDB backup created"
    }
    "db-restore" { 
        Write-Warning "This will restore MongoDB from backup. All current data will be lost!"
        $confirm = Read-Host "Continue? (y/N)"
        if ($confirm -eq "y" -or $confirm -eq "Y") {
            $backupDir = Read-Host "Enter backup directory name"
            docker exec dental_mongodb mongorestore --db dental_clinic_db --drop /backup/$backupDir
        }
    }
    
    default { 
        Write-Error "Unknown command: $Command"
        Write-Info "Run '.\docker.ps1 help' for available commands"
    }
}