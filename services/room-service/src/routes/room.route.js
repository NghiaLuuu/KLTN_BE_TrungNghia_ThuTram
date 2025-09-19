const express = require('express');
const router = express.Router();
const roomController = require('../controllers/room.controller');
const authMiddleware = require('../middlewares/auth.middleware');

// Có thể thêm check role (nếu cần) ở đây
router.post('/', authMiddleware, roomController.createRoom);
router.put('/:id', authMiddleware, roomController.updateRoom);
router.delete('/:id', authMiddleware, roomController.deleteRoom);

// SubRoom management routes
router.post('/:roomId/subrooms', authMiddleware, roomController.addSubRoom);
router.delete('/:roomId/subrooms/:subRoomId', authMiddleware, roomController.deleteSubRoom);
router.patch('/:roomId/subrooms/:subRoomId/toggle', authMiddleware, roomController.toggleSubRoomStatus);

// Room routes (đặt sau subroom routes để tránh conflict)
router.patch('/:id/toggle', authMiddleware, roomController.toggleStatus);

router.get('/', roomController.listRooms);
router.get('/search', roomController.searchRoom);
router.get('/subroom/:subRoomId', roomController.getSubRoomById);
router.get('/:roomId', roomController.getRoomById);
module.exports = router;
