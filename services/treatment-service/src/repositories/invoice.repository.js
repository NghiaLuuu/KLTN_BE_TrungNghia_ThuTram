const Invoice = require("../models/invoice.model");

class InvoiceRepository {
  async create(data) {
    return await Invoice.create(data);
  }

  async update(id, data) {
    return await Invoice.findByIdAndUpdate(id, data, { new: true });
  }


  async findById(id) {
    return await Invoice.findById(id)
  }

  async search(filter) {
    return await Invoice.find(filter)
  }
}

module.exports = new InvoiceRepository();
