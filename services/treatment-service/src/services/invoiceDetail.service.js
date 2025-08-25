const invoiceDetailRepo = require("../repositories/invoiceDetail.repository");

class InvoiceDetailService {
  async createDetail(data) {
    return await invoiceDetailRepo.create(data);
  }

  async updateDetail(id, data) {
    return await invoiceDetailRepo.update(id, data);
  }

  async getDetailsByInvoice(invoiceId) {
    return await invoiceDetailRepo.findByInvoice(invoiceId);
  }

  async getDetailById(id) {
    return await invoiceDetailRepo.findById(id);
  }
}

module.exports = new InvoiceDetailService();
