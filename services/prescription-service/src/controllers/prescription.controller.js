const prescriptionService = require("../services/prescription.service");

class PrescriptionController {
  async create(req, res) {
    try {
      if (!req.user || !["admin", "nurse", "dentist"].includes(req.user.role)) {
        return res.status(403).json({ error: "Forbidden: Only admin, nurse, or dentist can create prescription" });
      }

      const p = await prescriptionService.createPrescription(req.body);
      res.json(p);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }

  async view(req, res) {
    const p = await prescriptionService.viewPrescription(req.params.id);
    res.json(p);
  }

  async search(req, res) {
    const filter = {};
    if (req.query.patientId) filter.patientId = req.query.patientId;
    if (req.query.doctorId) filter.doctorId = req.query.doctorId;

    const list = await prescriptionService.searchPrescription(filter);
    res.json(list);
  }

  async update(req, res) {
    try {
      if (!req.user || !["admin", "nurse", "dentist"].includes(req.user.role)) {
        return res.status(403).json({ error: "Forbidden: Only admin, nurse, or dentist can update prescription" });
      }

      const p = await prescriptionService.updatePrescription(req.params.id, req.body);
      res.json(p);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }
}

module.exports = new PrescriptionController();
