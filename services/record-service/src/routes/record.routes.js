const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/record.controller");
const authMidleware = require("../middlewares/auth.middleware");

// Record (Exam + Treatment)
router.post("/records", ctrl.create);
router.put("/records/:id", authMidleware, ctrl.update); // gộp update
router.put("/records/:id/complete", ctrl.complete);
router.get("/records", ctrl.search);

module.exports = router;
