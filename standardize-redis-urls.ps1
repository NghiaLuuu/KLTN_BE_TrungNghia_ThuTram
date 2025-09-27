# PowerShell script to fix Redis URL format inconsistency across all services
$services = @(
    "room-service", "schedule-service", "appointment-service", 
    "payment-service", "invoice-service", "medicine-service", 
    "record-service", "service-service", "statistic-service", 
    "chat-service", "chatbot-service"
)

Write-Host "🔧 Standardizing Redis URL format in all service .env files..." -ForegroundColor Yellow
Write-Host "Target format: redis://:redis123@localhost:6379" -ForegroundColor Cyan

foreach ($service in $services) {
    $envPath = "c:\Users\ADMINS\Downloads\BE_KLTN_TrungNghia_ThuTram\services\$service\.env"
    
    if (Test-Path $envPath) {
        Write-Host "Processing $service..." -ForegroundColor Cyan
        
        $content = Get-Content $envPath -Raw
        
        # Fix Redis URL format - add password to URL
        $content = $content -replace "REDIS_URL=redis://localhost:6379", "REDIS_URL=redis://:redis123@localhost:6379"
        
        # Write back to file
        [System.IO.File]::WriteAllText($envPath, $content, [System.Text.Encoding]::UTF8)
        
        Write-Host "✅ Updated $service .env with password in Redis URL" -ForegroundColor Green
    } else {
        Write-Host "❌ $envPath not found" -ForegroundColor Red
    }
}

Write-Host "`n🎉 All Redis URLs standardized!" -ForegroundColor Green
Write-Host "All services now use: redis://:redis123@localhost:6379" -ForegroundColor Yellow