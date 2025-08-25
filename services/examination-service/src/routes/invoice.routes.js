const express = require("express");
const router = express.Router();
const invoiceController = require("../controllers/invoice.controller");

router.post("/", invoiceController.createInvoice);
router.put("/:id", invoiceController.updateInvoice);
router.get("/", invoiceController.searchInvoices);
router.get("/:id", invoiceController.getInvoiceById);

module.exports = router;
