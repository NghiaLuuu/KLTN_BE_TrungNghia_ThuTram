const express = require("express");
const router = express.Router();
const prescriptionCtrl = require("../controllers/prescription.controller");
const authMiddleware = require("../middlewares/auth.middleware");

router.post("/", authMiddleware, prescriptionCtrl.create);
router.get("/", authMiddleware, prescriptionCtrl.search);
router.get("/:id", authMiddleware, prescriptionCtrl.view);
router.put("/:id", authMiddleware, prescriptionCtrl.update);

module.exports = router;
