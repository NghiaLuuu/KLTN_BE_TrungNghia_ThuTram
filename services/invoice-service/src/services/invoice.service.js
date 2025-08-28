const invoiceRepo = require("../repositories/invoice.repository");

class InvoiceService {
  async createInvoice(data) {
  const result = await invoiceRepo.create(data);
  console.log("✅ Invoice created:", result);
  return result;
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
