const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const { canViewStaff, canViewPatients, canUpdateUser } = require('../middlewares/role.middleware');
const multer = require('multer');

const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    // Support both images (for avatars and certificates) and PDFs (for certificates)
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (JPEG, PNG, WebP) and PDF files are allowed'), false);
    }
  }
});

// Staff & Patient management (specific routes MUST come before /:id)
router.post('/create-staff', authMiddleware, userController.createStaff); // 🆕 Nhiệm vụ 1.2: Create staff without OTP
router.get('/all-staff', userController.getAllStaff); // Supports search via query params
router.get('/all-patient', authMiddleware, canViewPatients, userController.getAllPatients); // Supports search via query params

// 🆕 Get all users cache (for schedule-service to get emails)
router.get('/cache/all', userController.getAllUsersCache);

// 🆕 Get users by IDs (for statistics enrichment)
router.post('/by-ids', userController.getUsersByIds);

// 🆕 Reset password về mặc định
router.post('/:id/reset-password', authMiddleware, userController.resetUserPasswordToDefault);


// Profile & User detail routes (dynamic routes MUST come after specific routes)
router.get('/:id', userController.getUserById); // Handles both profile & user by ID
router.put('/:id', authMiddleware, canUpdateUser, userController.updateUser);

// File uploads
router.put('/avatar/:id', authMiddleware, upload.single('avatar'), userController.uploadAvatar);

// 🆕 Batch-Only Certificate Management API (PUT)
// Batch Create: { name0, name1, ..., certificateNotes?, action: 'batch-create' } + frontImages + backImages (optional)
// Batch Update: { certificateId0, certificateId1, ..., name0?, name1?, ..., certificateNotes?, action: 'batch-update' } + frontImages (optional) + backImages (optional)  
// Batch Delete: { certificateId0, certificateId1, ..., action: 'batch-delete' }
// Note: Certificate names must be unique per user
// Custom multer for certificates with flexible field handling
const certificateUpload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (JPEG, PNG, WebP) are allowed'), false);
    }
  }
});

router.put('/:id/certificates', authMiddleware, certificateUpload.any(), userController.manageCertificate);

// Public & User management
router.get('/public/dentists', userController.getDentistsForPatients);
router.delete('/:id', authMiddleware, userController.deleteUser);
router.patch('/:id/toggle-status', authMiddleware, userController.toggleUserStatus);

module.exports = router;
