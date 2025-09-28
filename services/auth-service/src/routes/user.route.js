const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const multer = require('multer');

const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Chỉ chấp nhận file ảnh (JPG, PNG, WEBP)'), false);
    }
  }
});

// Profile routes
router.get('/profile', authMiddleware, userController.getProfile);
router.put('/profile', authMiddleware, userController.updateProfile);

// Admin management routes
router.put('/update/:id', authMiddleware, userController.updateProfileByAdmin);
router.get('/by-role', authMiddleware, userController.getUsersByRole);
router.get('/all-staff', authMiddleware, userController.getAllStaff);
router.get('/staff/search', authMiddleware, userController.searchStaff);
router.get('/:id', authMiddleware, userController.getUserById);

// Batch operations
router.post('/staff/batch', userController.getStaffByIds);

// Avatar upload
router.put('/avatar/:id', authMiddleware, upload.single('avatar'), userController.uploadAvatar);

// 🆕 CERTIFICATE ROUTES (chỉ upload ảnh)
router.post('/:id/certificates', authMiddleware, upload.single('certificate'), userController.uploadCertificate);
router.post('/:id/certificates/batch', authMiddleware, upload.array('certificates', 5), userController.uploadMultipleCertificates);
router.delete('/:userId/certificates/:certificateId', authMiddleware, userController.deleteCertificate);
router.patch('/:userId/certificates/:certificateId/verify', authMiddleware, userController.verifyCertificate);
router.patch('/:userId/certificates/:certificateId/notes', authMiddleware, userController.updateCertificateNotes);

// PUBLIC API - Get dentists for patient booking (no auth required)
router.get('/public/dentists', userController.getDentistsForPatients);

// 🔹 DELETE user (only if not used in system)
router.delete('/:id', authMiddleware, userController.deleteUser);

// 🔹 TOGGLE user status (active ⇄ inactive) - no body required
router.patch('/:id/toggle-status', authMiddleware, userController.toggleUserStatus);

module.exports = router;
