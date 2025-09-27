# PowerShell script to update Redis client configuration in all services
$services = @(
    "auth-service", "room-service", "schedule-service", "appointment-service", 
    "payment-service", "invoice-service", "medicine-service", 
    "record-service", "service-service", "statistic-service", 
    "chat-service", "chatbot-service"
)

Write-Host "🔧 Updating Redis client configuration in all services..." -ForegroundColor Yellow

foreach ($service in $services) {
    $redisClientPath = "c:\Users\ADMINS\Downloads\BE_KLTN_TrungNghia_ThuTram\services\$service\src\utils\redis.client.js"
    
    if (Test-Path $redisClientPath) {
        Write-Host "Processing $service..." -ForegroundColor Cyan
        
        $content = Get-Content $redisClientPath -Raw
        
        # Replace Redis client configuration with password support
        $newRedisConfig = @'
const redis = require('redis');

// Debug environment variables
console.log('🔍 Debug Redis Env:');
console.log('   REDIS_URL:', process.env.REDIS_URL);
console.log('   REDIS_HOST:', process.env.REDIS_HOST);
console.log('   REDIS_PORT:', process.env.REDIS_PORT);
console.log('   REDIS_PASSWORD:', process.env.REDIS_PASSWORD ? '***' : 'NOT SET');

// Use REDIS_URL if available, otherwise fallback to host/port with password
const redisConfig = {
  url: process.env.REDIS_URL || `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`,
};

// Add password if provided
if (process.env.REDIS_PASSWORD) {
  redisConfig.password = process.env.REDIS_PASSWORD;
}

console.log('🔧 SERVICE_NAME - Redis Config:', {
  url: redisConfig.url,
  hasPassword: !!redisConfig.password
});

const redisClient = redis.createClient(redisConfig);
'@
        
        # Replace SERVICE_NAME with actual service name
        $newRedisConfig = $newRedisConfig -replace "SERVICE_NAME", $service
        
        # Replace the Redis configuration part
        if ($content -match "const redis = require\('redis'\);[\s\S]*?const redisClient = redis\.createClient\([^;]+\);") {
            $content = $content -replace "const redis = require\('redis'\);[\s\S]*?const redisClient = redis\.createClient\([^;]+\);", $newRedisConfig
        }
        
        # Write back to file
        [System.IO.File]::WriteAllText($redisClientPath, $content, [System.Text.Encoding]::UTF8)
        
        Write-Host "✅ Updated $service Redis client" -ForegroundColor Green
    } else {
        Write-Host "⚠️ $redisClientPath not found" -ForegroundColor Yellow
    }
}

Write-Host "`n🎉 All Redis clients updated!" -ForegroundColor Green