const invoiceService = require("../services/invoice.service");

class InvoiceController {
  async createInvoice(req, res) {
    try {
      const invoice = await invoiceService.createInvoice(req.body);
      res.status(201).json(invoice);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }

  async updateInvoice(req, res) {
    try {
      const invoice = await invoiceService.updateInvoice(req.params.id, req.body);
      res.json(invoice);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }



  async searchInvoices(req, res) {
    try {
      const invoices = await invoiceService.searchInvoices(req.query);
      res.json(invoices);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }

  async getInvoiceById(req, res) {
    try {
      const invoice = await invoiceService.getInvoiceById(req.params.id);
      res.json(invoice);
    } catch (err) {
      res.status(404).json({ error: "Invoice not found" });
    }
  }
}

module.exports = new InvoiceController();
