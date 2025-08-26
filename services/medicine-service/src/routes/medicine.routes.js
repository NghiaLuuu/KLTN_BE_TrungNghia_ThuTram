const express = require("express");
const router = express.Router();
const medicineCtrl = require("../controllers/medicine.controller");
const authMiddleware = require("../middlewares/auth.middleware");

router.post("/", authMiddleware, medicineCtrl.create);
router.get("/", medicineCtrl.list);
router.get("/search", medicineCtrl.search);
router.put("/:id", authMiddleware, medicineCtrl.update);


module.exports = router;
