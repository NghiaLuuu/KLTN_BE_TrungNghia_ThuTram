const InvoiceDetail = require("../models/invoiceDetail.model");

class InvoiceDetailRepository {
  async create(data) {
    return await InvoiceDetail.create(data);
  }

  async update(id, data) {
    return await InvoiceDetail.findByIdAndUpdate(id, data, { new: true });
  }

  async findByInvoice(invoiceId) {
    return await InvoiceDetail.find({ invoiceId })
  }

  async findById(id) {
    return await InvoiceDetail.findById(id)
  }
}

module.exports = new InvoiceDetailRepository();
