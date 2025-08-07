const express = require('express');
const router = express.Router();
const roomController = require('../controllers/room.controller');
const authMiddleware = require('../middlewares/auth.middleware');

// Có thể thêm check role (nếu cần) ở đây
router.post('/', authMiddleware, roomController.createRoom);
router.put('/:id', authMiddleware, roomController.updateRoom);
router.patch('/:id/toggle', authMiddleware, roomController.toggleStatus);
router.get('/', authMiddleware, roomController.listRooms);
router.get('/search', authMiddleware, roomController.searchRoom);

module.exports = router;
