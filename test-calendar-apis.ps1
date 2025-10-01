# 🧪 Test Calendar APIs với cURL

# Base URL
$BASE_URL = "http://localhost:5006/api/slots"

# Test IDs
$ROOM_ID = "68dd31c43df7b61e7b509e61"
$DENTIST_ID = "68dd337f327b922b6119b902"
$NURSE_ID = "68dd338d327b922b6119b90d"

Write-Host "🚀 TESTING CALENDAR APIs WITH PAGINATION & HISTORICAL DATA" -ForegroundColor Green
Write-Host "Base URL: $BASE_URL" -ForegroundColor Cyan

Write-Host "`n=== 🏥 ROOM CALENDAR TESTS ===" -ForegroundColor Yellow

# Test 1: Room Calendar - Current Week
Write-Host "`n1. Room Calendar - Current Week (page=1):" -ForegroundColor White
curl -s "$BASE_URL/room/$ROOM_ID/calendar?viewType=week&page=1&limit=2" | ConvertFrom-Json | ConvertTo-Json -Depth 3

# Test 2: Room Calendar - Past Week  
Write-Host "`n2. Room Calendar - Past Week (page=-1):" -ForegroundColor White
curl -s "$BASE_URL/room/$ROOM_ID/calendar?viewType=week&page=-1&limit=2" | ConvertFrom-Json | ConvertTo-Json -Depth 3

Write-Host "`n=== 🦷 DENTIST CALENDAR TESTS ===" -ForegroundColor Yellow

# Test 3: Dentist Calendar - Current Days
Write-Host "`n3. Dentist Calendar - Current Days (page=1):" -ForegroundColor White  
curl -s "$BASE_URL/dentist/$DENTIST_ID/calendar?viewType=day&page=1&limit=3" | ConvertFrom-Json | ConvertTo-Json -Depth 3

# Test 4: Dentist Calendar - Past Days
Write-Host "`n4. Dentist Calendar - Past Days (page=-1):" -ForegroundColor White
curl -s "$BASE_URL/dentist/$DENTIST_ID/calendar?viewType=day&page=-1&limit=3" | ConvertFrom-Json | ConvertTo-Json -Depth 3

Write-Host "`n=== 💉 NURSE CALENDAR TESTS ===" -ForegroundColor Yellow

# Test 5: Nurse Calendar - Current Month
Write-Host "`n5. Nurse Calendar - Current Month (page=1):" -ForegroundColor White
curl -s "$BASE_URL/nurse/$NURSE_ID/calendar?viewType=month&page=1&limit=1" | ConvertFrom-Json | ConvertTo-Json -Depth 3

# Test 6: Nurse Calendar - Past Month
Write-Host "`n6. Nurse Calendar - Past Month (page=-1):" -ForegroundColor White  
curl -s "$BASE_URL/nurse/$NURSE_ID/calendar?viewType=month&page=-1&limit=1" | ConvertFrom-Json | ConvertTo-Json -Depth 3

Write-Host "`n✨ All tests completed!" -ForegroundColor Green

Write-Host "`n📋 API Usage Examples:" -ForegroundColor Cyan
Write-Host @"
🏥 Room Calendar:
GET $BASE_URL/room/$ROOM_ID/calendar?viewType=week&page=1&limit=2

🦷 Dentist Calendar:  
GET $BASE_URL/dentist/$DENTIST_ID/calendar?viewType=day&page=-1&limit=5

💉 Nurse Calendar:
GET $BASE_URL/nurse/$NURSE_ID/calendar?viewType=month&page=2&limit=1

📅 Pagination Examples:
- page=1: Hiện tại (chu kỳ 0 → limit-1)  
- page=2: Tương lai (chu kỳ limit → 2*limit-1)
- page=-1: Quá khứ gần (chu kỳ -limit → -1)
- page=-2: Quá khứ xa (chu kỳ -2*limit → -limit-1)

🔍 ViewType Options:
- day: Theo ngày
- week: Theo tuần (Thứ 2 - Chủ nhật)
- month: Theo tháng
"@ -ForegroundColor White