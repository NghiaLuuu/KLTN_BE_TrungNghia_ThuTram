# PowerShell script to fix Redis URL format in all service .env files
$services = @(
    "auth-service", "room-service", "schedule-service", "appointment-service", 
    "payment-service", "invoice-service", "medicine-service", 
    "record-service", "service-service", "statistic-service", 
    "chat-service", "chatbot-service"
)

Write-Host "🔧 Fixing Redis URL format in all service .env files..." -ForegroundColor Yellow

foreach ($service in $services) {
    $envPath = "c:\Users\ADMINS\Downloads\BE_KLTN_TrungNghia_ThuTram\services\$service\.env"
    
    if (Test-Path $envPath) {
        Write-Host "Processing $service..." -ForegroundColor Cyan
        
        $content = Get-Content $envPath -Raw
        
        # Fix Redis URL format - remove the colon before password
        $content = $content -replace "REDIS_URL=redis://:redis123@localhost:6379", "REDIS_URL=redis://localhost:6379"
        $content = $content -replace "REDIS_PASSWORD=.*", "REDIS_PASSWORD=redis123"
        
        # Add Redis password if not exists
        if ($content -notmatch "REDIS_PASSWORD=") {
            $content = $content -replace "(REDIS_PORT=6379)", "`$1`nREDIS_PASSWORD=redis123"
        }
        
        # Write back to file
        [System.IO.File]::WriteAllText($envPath, $content, [System.Text.Encoding]::UTF8)
        
        Write-Host "✅ Updated $service .env" -ForegroundColor Green
    } else {
        Write-Host "❌ $envPath not found" -ForegroundColor Red
    }
}

Write-Host "`n🎉 All .env files updated!" -ForegroundColor Green