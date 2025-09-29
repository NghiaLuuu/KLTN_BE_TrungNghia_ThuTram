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
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files allowed'), false);
    }
  }
});

// Staff & Patient management (specific routes MUST come before /:id)
router.get('/all-staff', authMiddleware, canViewStaff, userController.getAllStaff); // Supports search via query params
router.get('/all-patient', authMiddleware, canViewPatients, userController.getAllPatients); // Supports search via query params


// Profile & User detail routes (dynamic routes MUST come after specific routes)
router.get('/:id', authMiddleware, userController.getUserById); // Handles both profile & user by ID
router.put('/:id', authMiddleware, canUpdateUser, userController.updateUser);

// File uploads
router.put('/avatar/:id', authMiddleware, upload.single('avatar'), userController.uploadAvatar);
router.post('/:id/certificates', authMiddleware, upload.single('certificate'), userController.uploadCertificate);
router.post('/:id/certificates/batch', authMiddleware, upload.array('certificates', 5), userController.uploadMultipleCertificates);
router.delete('/:userId/certificates/:certificateId', authMiddleware, userController.deleteCertificate);
router.patch('/:userId/certificates/:certificateId/verify', authMiddleware, userController.verifyCertificate);
router.patch('/:userId/certificates/:certificateId/notes', authMiddleware, userController.updateCertificateNotes);

// Public & User management
router.get('/public/dentists', userController.getDentistsForPatients);
router.delete('/:id', authMiddleware, userController.deleteUser);
router.patch('/:id/toggle-status', authMiddleware, userController.toggleUserStatus);

module.exports = router;
