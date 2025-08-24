const mongoose = require("mongoose");

const InvoiceSchema = new mongoose.Schema({
  patientId: { type: mongoose.Schema.Types.ObjectId, required: true },
  appointmentId: { type: mongoose.Schema.Types.ObjectId, required: true }, 
  amount: { type: Number, required: true },
  method: { 
    type: String, 
    enum: ["cash", "momo", "zalo", "vnpay", "bank_transfer"], 
    default: "cash" 
  },
  notes: { type: String },
}, { timestamps: true });

module.exports = mongoose.model("Invoice", InvoiceSchema);
