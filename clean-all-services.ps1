# PowerShell script to properly clean up and standardize all service index.js files
$services = @(
    "auth-service", "room-service", "schedule-service", "appointment-service", 
    "payment-service", "invoice-service", "medicine-service", 
    "record-service", "service-service", "statistic-service", 
    "chat-service", "chatbot-service"
)

Write-Host "🔧 Cleaning and standardizing all service index.js files..." -ForegroundColor Yellow

foreach ($service in $services) {
    $indexPath = "c:\Users\ADMINS\Downloads\BE_KLTN_TrungNghia_ThuTram\services\$service\src\index.js"
    
    if (Test-Path $indexPath) {
        Write-Host "Processing $service..." -ForegroundColor Cyan
        
        $content = Get-Content $indexPath -Raw
        
        # Remove ALL existing dotenv lines and comments
        $content = $content -replace "// Load environment variables first\s*\n", ""
        $content = $content -replace "const dotenv = require\('dotenv'\);\s*\n", ""
        $content = $content -replace "dotenv\.config\(\);\s*\n", ""
        
        # Remove duplicate connectDB calls but keep imports
        $lines = $content -split "`n"
        $cleanLines = @()
        $connectDBSeen = $false
        
        foreach ($line in $lines) {
            if ($line.Trim() -eq "connectDB();" -and $connectDBSeen) {
                # Skip duplicate connectDB call
                continue
            } elseif ($line.Trim() -eq "connectDB();") {
                $connectDBSeen = $true
                $cleanLines += $line
            } else {
                $cleanLines += $line
            }
        }
        
        $content = $cleanLines -join "`n"
        
        # Add standardized header at the very beginning
        $standardHeader = @"
// Load environment variables first
const dotenv = require('dotenv');
dotenv.config();

"@
        
        # Clean up extra newlines and add header
        $content = $content.TrimStart()
        $content = $standardHeader + $content
        
        # Make sure connectDB is called after imports if not already present
        if ($content -notmatch "connectDB\(\);") {
            # Find the line with startRpcServer or similar and add connectDB before it
            if ($content -match "const startRpcServer") {
                $content = $content -replace "(const startRpcServer[^;]+;)", "connectDB();`n`n`$1"
            } elseif ($content -match "const startRPCServer") {
                $content = $content -replace "(const startRPCServer[^;]+;)", "connectDB();`n`n`$1"
            } else {
                # Find express app creation and add connectDB before it
                $content = $content -replace "(const app = express\(\);)", "connectDB();`n`n`$1"
            }
        }
        
        # Write back to file with proper encoding
        [System.IO.File]::WriteAllText($indexPath, $content, [System.Text.Encoding]::UTF8)
        
        Write-Host "✅ Updated $service" -ForegroundColor Green
    } else {
        Write-Host "❌ $indexPath not found" -ForegroundColor Red
    }
}

Write-Host "`n🎉 All services cleaned and standardized!" -ForegroundColor Green
Write-Host "Now you can test running services individually:" -ForegroundColor Yellow
Write-Host "cd services/auth-service && npm start" -ForegroundColor Cyan