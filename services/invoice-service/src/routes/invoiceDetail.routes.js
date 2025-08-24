const express = require("express");
const router = express.Router();
const invoiceDetailController = require("../controllers/invoiceDetail.controller");

router.post("/", invoiceDetailController.createDetail);
router.put("/:id", invoiceDetailController.updateDetail);
router.get("/invoice/:invoiceId", invoiceDetailController.getDetailsByInvoice);
router.get("/:id", invoiceDetailController.getDetailById);

module.exports = router;
