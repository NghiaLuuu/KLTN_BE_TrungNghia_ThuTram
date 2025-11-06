@echo off
echo ========================================
echo   RESTART APPOINTMENT-SERVICE
echo ========================================
echo.

echo 🔍 Finding appointment-service process...
for /f "tokens=2" %%i in ('tasklist /FI "IMAGENAME eq node.exe" /NH ^| findstr /C:"node.exe"') do (
    for /f "tokens=*" %%j in ('wmic process where "ProcessId=%%i" get CommandLine ^| findstr "appointment-service"') do (
        echo Found: %%j
        echo 🛑 Stopping PID: %%i
        taskkill /PID %%i /F >nul 2>&1
    )
)

echo.
echo ✅ Process stopped!
echo.
echo 👉 Now please run in appointment-service terminal:
echo    npm start
echo.
pause
