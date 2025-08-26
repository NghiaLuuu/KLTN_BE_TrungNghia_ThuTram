const RecordModel = require("../models/record.model");
const repo = require("../repositories/record.repository");

exports.createRecord = async (data) => {
  console.log("📥 Creating record with data:", data);
  const record = new RecordModel(data);
  await record.save();
  console.log("✅ Record saved:", record);
  return record;
};

exports.updateRecord = async (id, updateData) => {
  return await repo.update(id, updateData);
};

exports.completeRecord = async (id) => {
  return await repo.update(id, { status: "done" });
};

exports.searchRecords = async (filter) => {
  return await repo.search(filter);
};
