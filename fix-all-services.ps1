# PowerShell script to standardize all service index.js files
$services = @(
    "room-service", "schedule-service", "appointment-service", 
    "payment-service", "invoice-service", "medicine-service", 
    "record-service", "service-service", "statistic-service", 
    "chat-service", "chatbot-service"
)

Write-Host "🔧 Standardizing all service index.js files..." -ForegroundColor Yellow

foreach ($service in $services) {
    $indexPath = "c:\Users\ADMINS\Downloads\BE_KLTN_TrungNghia_ThuTram\services\$service\src\index.js"
    
    if (Test-Path $indexPath) {
        Write-Host "Processing $service..." -ForegroundColor Cyan
        
        $content = Get-Content $indexPath -Raw
        
        # Remove duplicate dotenv imports and calls
        $content = $content -replace "const dotenv = require\('dotenv'\);\s*\n", ""
        $content = $content -replace "dotenv\.config\(\);\s*\n", ""
        $content = $content -replace "connectDB\(\);\s*\n", ""
        
        # Add standardized header
        $standardHeader = @"
// Load environment variables first
const dotenv = require('dotenv');
dotenv.config();

"@
        
        # Clean up and add standard imports
        $content = $standardHeader + $content.TrimStart()
        
        # Add connectDB call at appropriate place
        if ($content -match "const startRpcServer") {
            $content = $content -replace "(const startRpcServer[^;]+;)", "`$1`n`nconnectDB();"
        } elseif ($content -match "const express") {
            $content = $content -replace "(const express[^;]+;[^;]+;)", "`$1`n`nconnectDB();"
        }
        
        # Write back to file
        $content | Out-File -FilePath $indexPath -Encoding utf8 -NoNewline
        
        Write-Host "✅ Updated $service" -ForegroundColor Green
    } else {
        Write-Host "❌ $indexPath not found" -ForegroundColor Red
    }
}

Write-Host "`n🎉 All services standardized!" -ForegroundColor Green