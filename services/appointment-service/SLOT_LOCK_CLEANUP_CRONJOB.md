# Slot Lock Cleanup Cronjob Implementation

## **Vấn đề:**
Khi user reserve slots nhưng không thanh toán trong 15 phút:
- Redis TTL tự động xóa `temp_reservation` và `temp_slot_lock` keys ✅
- **Nhưng slots trong MongoDB vẫn `status='locked'` mãi mãi** ❌
- Nếu restart service hoặc clear Redis → Slots bị locked vĩnh viễn

## **Giải pháp:**
Thêm cronjob cleanup expired slot locks

### **1. Appointment Service - Cronjob**
File: `src/utils/cronJobs.js`

**Thêm function:**
```javascript
function startCleanupExpiredLocksCron() {
  cron.schedule('*/5 * * * *', async () => {
    // Run every 5 minutes
    
    // 1. Get all locked slots from schedule-service
    const response = await axios.get(`${scheduleServiceUrl}/api/slot/locked`);
    
    // 2. Filter expired slots (locked > 15 minutes ago)
    const expiredSlots = lockedSlots.filter(slot => 
      slot.lockedAt && new Date(slot.lockedAt) < fifteenMinutesAgo
    );
    
    // 3. Unlock expired slots via bulk-update API
    await axios.put(`${scheduleServiceUrl}/api/slot/bulk-update`, {
      slotIds: expiredSlots.map(s => s._id),
      updates: {
        status: 'available',
        lockedAt: null,
        lockedBy: null
      }
    });
  });
}
```

**Enable trong `startAllCronJobs()`:**
```javascript
function startAllCronJobs() {
  startAutoProgressCron();
  startAutoCompleteCron();
  startCleanupExpiredLocksCron(); // ✅ NEW
  console.log('✅ All cron jobs started');
}
```

**Enable trong `src/index.js`:**
```javascript
// ✅ Start cron jobs: auto-progress, auto-complete, cleanup expired locks
startAllCronJobs();
```

### **2. Schedule Service - API Get Locked Slots**
File: `src/controllers/slot.controller.js`

**Thêm controller:**
```javascript
exports.getLockedSlots = async (req, res) => {
  try {
    const lockedSlots = await Slot.find({ status: 'locked' })
      .select('_id roomId subRoomId dentistIds date startTime endTime lockedAt lockedBy')
      .lean();

    return res.status(200).json({
      success: true,
      count: lockedSlots.length,
      slots: lockedSlots
    });
  } catch (error) {
    console.error('[slotController] getLockedSlots error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error getting locked slots: ' + error.message
    });
  }
};
```

**Thêm route:**
File: `src/routes/slot.route.js`
```javascript
// 🆕 Get locked slots (for appointment-service cleanup cronjob)
router.get('/locked', slotController.getLockedSlots);
```

## **Kết quả:**
✅ Mỗi 5 phút, cronjob tự động:
1. Lấy danh sách slots có `status='locked'`
2. Filter slots locked > 15 phút
3. Unlock về `status='available'`

✅ Giải quyết vấn đề slots bị locked vĩnh viễn khi:
- User không thanh toán
- Redis TTL expired
- Service restart
- Clear Redis cache

## **Testing:**
1. Reserve slots → Kiểm tra DB: `status='locked'`
2. Đợi 15 phút hoặc clear Redis
3. Đợi cronjob chạy (max 5 phút)
4. Kiểm tra DB: `status='available'` ✅

## **Log Output:**
```
🔍 [Cron] Checking for expired slot locks...
⚠️ [Cron] Found 3 expired slot locks
✅ [Cron] Unlocked 3 expired slots: [slotId1, slotId2, slotId3]
```

## **Files Changed:**
1. ✅ `appointment-service/src/utils/cronJobs.js` - Added cleanup function
2. ✅ `appointment-service/src/index.js` - Enabled cronjobs
3. ✅ `schedule-service/src/controllers/slot.controller.js` - Added getLockedSlots
4. ✅ `schedule-service/src/routes/slot.route.js` - Added GET /locked route
