const express = require('express');
const router = express.Router();
const roomController = require('../controllers/room.controller');
const authMiddleware = require('../middlewares/auth.middleware');

// Có thể thêm check role (nếu cần) ở đây
router.post('/', authMiddleware, roomController.createRoom);
router.put('/:id', authMiddleware, roomController.updateRoom);
// Quan trọng: đặt subRoom trước
router.patch('/:roomId/subrooms/:subRoomId/toggle', authMiddleware, roomController.toggleSubRoomStatus);

// Sau đó mới tới toggle phòng chính
router.patch('/:id/toggle', authMiddleware, roomController.toggleStatus);

router.get('/', roomController.listRooms);
router.get('/search', roomController.searchRoom);
router.get('/subroom/:subRoomId', roomController.getSubRoomById);
router.get('/:roomId', roomController.getRoomById);
module.exports = router;
