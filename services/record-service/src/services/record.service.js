const RecordModel = require("../models/record.model");

// 🔹 Tạo record mới
exports.createRecord = async (data) => {
  console.log("📥 Creating record with data:", data);

  const {
    appointmentId,
    patientId,
    patientInfo,
    bookedBy,
    dentistId,
    preferredDentistId,
    serviceId,
    type,
    notes
  } = data;

  // 🔹 Xác định patientId / patientInfo
  // 🔹 Xác định patientId / patientInfo từ payload
let finalPatientId = null;
let finalPatientInfo = null;

// Nếu patientInfo có trong payload → staff đặt hộ
  if (patientInfo) {
    const { name, phone, birthYear } = patientInfo;
    if (!name || !phone || !birthYear) {
      throw new Error("patientInfo không hợp lệ (thiếu name, phone hoặc birthYear)");
    }
    finalPatientInfo = patientInfo;
  }
  // Nếu bookedBy có → patient tự đặt
  else if (bookedBy) {
    finalPatientId = bookedBy;
  }
  // Nếu appointment gửi patientId (hiếm dùng) → ưu tiên
  else if (patientId) {
    finalPatientId = patientId;
  }
  // Không có thông tin hợp lệ → lỗi
  else {
    throw new Error("Cần có patientId hoặc patientInfo");
  }



  // 🔹 Xác định dentistId
  const finalDentistId = dentistId || preferredDentistId;
  if (!finalDentistId) {
    throw new Error("dentistId không được để trống");
  }

  // 🔹 Tạo record mới
  const record = new RecordModel({
    appointmentId: appointmentId || null,
    patientId: finalPatientId,
    patientInfo: finalPatientInfo,
    dentistId: finalDentistId,
    serviceId,
    type,
    notes: notes || ""
  });

  await record.save();
  console.log("✅ Record saved:", record);
  return record;
};

// 🔹 Cập nhật record
exports.updateRecord = async (id, updateData) => {
  return await RecordModel.findByIdAndUpdate(id, updateData, { new: true });
};

// 🔹 Complete record (status = done)
exports.completeRecord = async (id) => {
  return await RecordModel.findByIdAndUpdate(id, { status: "done" }, { new: true });
};

// 🔹 Lấy record theo id
exports.getRecordById = async (id) => {
  return await RecordModel.findById(id);
};

// 🔹 Search record
exports.searchRecords = async (filter) => {
  return await RecordModel.find(filter || {});
};
