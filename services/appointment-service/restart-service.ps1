# Restart appointment-service safely
# This script finds the appointment-service process and restarts it

Write-Host "🔍 Finding appointment-service process..." -ForegroundColor Cyan

# Find process by checking working directory or command line
$appointmentProcess = Get-WmiObject Win32_Process | Where-Object {
    $_.CommandLine -like "*appointment-service*" -and $_.Name -eq "node.exe"
} | Select-Object ProcessId, CommandLine

if ($appointmentProcess) {
    Write-Host "✅ Found appointment-service process(es):" -ForegroundColor Green
    $appointmentProcess | ForEach-Object {
        Write-Host "  PID: $($_.ProcessId)" -ForegroundColor Yellow
        Write-Host "  CMD: $($_.CommandLine)" -ForegroundColor Gray
    }
    
    Write-Host "`n🛑 Stopping process(es)..." -ForegroundColor Red
    $appointmentProcess | ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force
        Write-Host "  Stopped PID: $($_.ProcessId)" -ForegroundColor Green
    }
    
    Write-Host "`n✅ Process(es) stopped!" -ForegroundColor Green
    Write-Host "`n👉 Now run: npm run dev" -ForegroundColor Cyan
} else {
    Write-Host "❌ No appointment-service process found" -ForegroundColor Red
    Write-Host "The service may not be running or is running in a different way" -ForegroundColor Yellow
}

Write-Host "`n📝 To start appointment-service:" -ForegroundColor Cyan
Write-Host "  cd C:\Users\ADMINS\Downloads\KLTN\BE_KLTN_TrungNghia_ThuTram\services\appointment-service" -ForegroundColor White
Write-Host "  npm run dev" -ForegroundColor White
