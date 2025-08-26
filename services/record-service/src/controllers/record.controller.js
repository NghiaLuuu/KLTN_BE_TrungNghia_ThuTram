const service = require("../services/record.service");

exports.create = async (req, res) => {
  try {
    const record = await service.createRecord(req.body);
    res.json(record);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.update = async (req, res) => {
  try {
    const record = await service.updateRecord(req.params.id, req.body);
    res.json(record);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.complete = async (req, res) => {
  try {
    const record = await service.completeRecord(req.params.id);
    res.json(record);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.search = async (req, res) => {
  try {
    const records = await service.searchRecords(req.query);
    res.json(records);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};
