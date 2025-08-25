const medicineService = require("../services/medicine.service");

class MedicineController {
  async create(req, res) {
    try {
      if (!req.user || !["admin", "manager"].includes(req.user.role)) {
        return res.status(403).json({ error: "Forbidden: Only admin or manager can create medicine" });
      }

      const med = await medicineService.addMedicine(req.body);
      res.json(med);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }

  async list(req, res) {
    const meds = await medicineService.listMedicines();
    res.json(meds);
  }

  async search(req, res) {
    const { q } = req.query;
    const meds = await medicineService.searchMedicine(q || "");
    res.json(meds);
  }

  async update(req, res) {
    try {
      if (!req.user || !["admin", "manager"].includes(req.user.role)) {
        return res.status(403).json({ error: "Forbidden: Only admin or manager can update medicine" });
      }

      const med = await medicineService.updateMedicine(req.params.id, req.body);
      res.json(med);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }
}

module.exports = new MedicineController();
