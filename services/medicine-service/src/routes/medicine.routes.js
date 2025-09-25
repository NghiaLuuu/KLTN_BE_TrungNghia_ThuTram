const express = require("express");
const router = express.Router();
const medicineCtrl = require("../controllers/medicine.controller");
const authMiddleware = require("../middlewares/auth.middleware");
const validationErrorHandler = require("../middlewares/validation.middleware");
const {
  createMedicineValidation,
  updateMedicineValidation,
  medicineIdValidation,
  listMedicinesValidation,
  searchMedicineValidation
} = require("../validations/medicine.validation");

// Public routes
router.get("/", listMedicinesValidation, validationErrorHandler, medicineCtrl.list);
router.get("/search", searchMedicineValidation, validationErrorHandler, medicineCtrl.search);
router.get("/:id", medicineIdValidation, validationErrorHandler, medicineCtrl.getById);

// Protected routes (require authentication)
router.post("/", authMiddleware, createMedicineValidation, validationErrorHandler, medicineCtrl.create);
router.put("/:id", authMiddleware, updateMedicineValidation, validationErrorHandler, medicineCtrl.update);
router.patch("/:id/toggle", authMiddleware, medicineIdValidation, validationErrorHandler, medicineCtrl.toggleStatus);
router.delete("/:id", authMiddleware, medicineIdValidation, validationErrorHandler, medicineCtrl.delete);

module.exports = router;
