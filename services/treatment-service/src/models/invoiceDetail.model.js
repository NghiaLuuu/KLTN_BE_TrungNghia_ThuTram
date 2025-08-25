const mongoose = require("mongoose");

const InvoiceDetailSchema = new mongoose.Schema({
  invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: "Invoice", required: true },
  serviceId: { type: mongoose.Schema.Types.ObjectId},
  unitPrice: { type: Number, required: true },
  quantity: { type: Number, default: 1 },
  totalPrice: { type: Number, required: true },
  note: { type: String }
}, { timestamps: true });

module.exports = mongoose.model("InvoiceDetail", InvoiceDetailSchema);
