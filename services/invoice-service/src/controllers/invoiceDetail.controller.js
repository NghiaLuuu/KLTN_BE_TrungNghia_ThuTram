const invoiceDetailService = require("../services/invoiceDetail.service");

class InvoiceDetailController {
  async createDetail(req, res) {
    try {
      const detail = await invoiceDetailService.createDetail(req.body);
      res.status(201).json(detail);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }

  async updateDetail(req, res) {
    try {
      const detail = await invoiceDetailService.updateDetail(req.params.id, req.body);
      res.json(detail);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }

  async getDetailsByInvoice(req, res) {
    try {
      const details = await invoiceDetailService.getDetailsByInvoice(req.params.invoiceId);
      res.json(details);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }

  async getDetailById(req, res) {
    try {
      const detail = await invoiceDetailService.getDetailById(req.params.id);
      res.json(detail);
    } catch (err) {
      res.status(404).json({ error: "Detail not found" });
    }
  }
}

module.exports = new InvoiceDetailController();
