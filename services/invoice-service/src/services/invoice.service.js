const invoiceRepo = require("../repositories/invoice.repository");

class InvoiceService {
  async createInvoice(data) {
    return await invoiceRepo.create(data);
  }

  async updateInvoice(id, data) {
    return await invoiceRepo.update(id, data);
  }

 

  async searchInvoices(filter) {
    return await invoiceRepo.search(filter);
  }

  async getInvoiceById(id) {
    return await invoiceRepo.findById(id);
  }
}

module.exports = new InvoiceService();
