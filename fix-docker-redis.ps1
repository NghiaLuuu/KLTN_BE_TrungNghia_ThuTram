# PowerShell script to remove Redis passwords from Docker Compose (except chat services)
Write-Host "🔧 Removing Redis passwords from Docker Compose..." -ForegroundColor Yellow

$filePath = "c:\Users\ADMINS\Downloads\BE_KLTN_TrungNghia_ThuTram\docker\docker-compose.yml"
$content = Get-Content $filePath -Raw

# List of services to fix (all except chat-service and chatbot-service)
$servicesToFix = @(
    'appointment-service',
    'record-service', 
    'medicine-service',
    'service-service',
    'invoice-service',
    'payment-service',
    'statistic-service'
)

foreach ($service in $servicesToFix) {
    Write-Host "Fixing $service..." -ForegroundColor Cyan
    
    # Replace Redis URL for this specific service
    $pattern = "(\s+- REDIS_URL=redis://):redis123(@redis:6379)"
    $replacement = '${1}${2}'
    $content = $content -replace $pattern, $replacement
}

# Write back to file
[System.IO.File]::WriteAllText($filePath, $content, [System.Text.Encoding]::UTF8)

Write-Host "✅ Fixed all Docker Compose Redis URLs (except chat services)" -ForegroundColor Green
Write-Host "Chat-service and chatbot-service still have Redis passwords as requested" -ForegroundColor Yellow