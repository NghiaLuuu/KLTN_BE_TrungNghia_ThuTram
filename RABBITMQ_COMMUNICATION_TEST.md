# RabbitMQ Communication Test - OPTIMIZED

## Performance Optimization
✅ **Cache Check**: Schedule service kiểm tra Redis `users_cache` trước khi gửi RabbitMQ message
✅ **Skip Unnecessary Updates**: Nếu `user.hasBeenUsed = true` trong cache → skip gửi message
✅ **Auto Cache Refresh**: Auth service tự động refresh cache sau khi cập nhật database

## Test Both APIs

### API 1: Assign Staff (Original)
```bash
curl -X POST "http://localhost:3003/api/slots/assign-staff" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "roomId": "ROOM_ID_HERE",
    "quarter": 1,
    "year": 2025,
    "shifts": ["Ca Sáng"],
    "dentistIds": ["DENTIST_ID_HERE"],
    "nurseIds": ["NURSE_ID_HERE"]
  }'
```

### API 2: Update Slot Staff (New Support)
```bash
curl -X PATCH "http://localhost:3003/api/slots/staff" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "slotIds": ["SLOT_ID_1", "SLOT_ID_2"],
    "dentistId": "DENTIST_ID_HERE",
    "nurseId": "NURSE_ID_HERE"
  }'
```

## Expected RabbitMQ Flow

1. **Schedule Service** calls `markEntitiesAsUsed()`
2. **Schedule Service** publishes to `auth_queue`:
   ```json
   {
     "action": "markUserAsUsed",
     "payload": { "userId": "dentistId" }
   }
   ```
3. **Auth Service** RPC server receives message
4. **Auth Service** calls `userRepo.markUserAsUsed(userId)`
5. **Auth Service** updates `user.hasBeenUsed = true`

## Expected Optimized Logs

### Schedule Service (First Time):
```
📤 Sent markUserAsUsed message for dentist 67abc123...
📤 Sent markUserAsUsed message for nurse 67def456...
📤 Sent markRoomAsUsed message for room 67ghi789...
```

### Schedule Service (Second Time - Same Users):
```
⚡ Skipping dentist 67abc123... - already marked as used in cache
⚡ Skipping nurse 67def456... - already marked as used in cache
📤 Sent markRoomAsUsed message for room 67ghi789...
```

### Auth Service:
```
✅ Marked user 67abc123... as hasBeenUsed = true
♻️ Refreshed users cache after marking user 67abc123... as used
✅ Marked user 67def456... as hasBeenUsed = true  
♻️ Refreshed users cache after marking user 67def456... as used
```

### Room Service:
```
✅ Marked room 67ghi789... as hasBeenUsed = true
```

## Verify Database Changes

```javascript
// Check user hasBeenUsed status
db.users.findOne({_id: ObjectId("USER_ID")}, {hasBeenUsed: 1, fullName: 1})

// Check room hasBeenUsed status  
db.rooms.findOne({_id: ObjectId("ROOM_ID")}, {hasBeenUsed: 1, name: 1})
```

## Troubleshooting

1. **RabbitMQ not running**: Make sure RabbitMQ server is started
2. **Connection errors**: Check RABBITMQ_URL in .env files
3. **Message not received**: Check queue names match (auth_queue, room_queue)
4. **Repository errors**: Verify markUserAsUsed/markRoomAsUsed functions exist