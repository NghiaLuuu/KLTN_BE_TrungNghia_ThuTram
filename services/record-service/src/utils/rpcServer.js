const amqp = require("amqplib");
const recordService = require("../services/record.service");

async function startRecordRpcServer() {
  const connection = await amqp.connect(process.env.RABBITMQ_URL);
  const channel = await connection.createChannel();

  const queue = "record_rpc_queue"; // ⭐ Đổi từ record_queue sang record_rpc_queue

  // ⭐ Chỉ khai báo queue, không xóa nó (consumer đang sử dụng)
  await channel.assertQueue(queue, { durable: true });

  console.log(`✅ Record RPC server listening on queue: ${queue}`);

  channel.consume(queue, async (msg) => {
    if (!msg) return;

    let response;
    try {
      const { action, payload } = JSON.parse(msg.content.toString());

      try {
        switch (action) {
          case "createRecord":
            response = await handleCreateRecord(payload);
            break;

          case "getRecordById":
            response = await handleGetRecordById(payload);
            break;

          case "updateRecord":
            response = await handleUpdateRecord(payload);
            break;

          case "completeRecord":
            response = await handleCompleteRecord(payload);
            break;

          case "searchRecords":
            response = await handleSearchRecords(payload);
            break;

          case "getRecordsByIds":
            response = await handleGetRecordsByIds(payload);
            break;

          default:
            response = { error: `Unknown action: ${action}` };
        }
      } catch (err) {
        console.error(`❌ Error handling action ${action}:`, err);
        response = { error: err.message };
      }

    } catch (err) {
      console.error("❌ RPC server parse error:", err);
      response = { error: err.message };
    }

    if (msg.properties.replyTo) {
      channel.sendToQueue(
        msg.properties.replyTo,
        Buffer.from(JSON.stringify(response)),
        { correlationId: msg.properties.correlationId }
      );
    }

    channel.ack(msg);
  });
}

module.exports = startRecordRpcServer;

// ------------------- Các hàm xử lý -------------------
async function handleCreateRecord(payload) {
  const record = await recordService.createRecord(payload);
  return { record };
}

async function handleGetRecordById(payload) {
  if (!payload.id) throw new Error("recordId is required");
  const record = await recordService.getRecordById(payload.id);
  
  // 🔥 DEBUG: Ghi log đầy đủ dữ liệu hồ sơ được trả về qua RPC
  console.log('📤 [RPC Server] Returning record data:', {
    _id: record._id,
    recordCode: record.recordCode,
    serviceName: record.serviceName,
    serviceAddOnId: record.serviceAddOnId,
    serviceAddOnName: record.serviceAddOnName,
    servicePrice: record.servicePrice,
    serviceAddOnPrice: record.serviceAddOnPrice,
    totalCost: record.totalCost,
    depositPaid: record.depositPaid,
    additionalServicesCount: record.additionalServices?.length || 0
  });
  
  return { record };
}

async function handleUpdateRecord(payload) {
  const { id, updateData } = payload;
  if (!id) throw new Error("recordId is required");
  const record = await recordService.updateRecord(id, updateData);
  return { record };
}

async function handleCompleteRecord(payload) {
  const { id } = payload;
  if (!id) throw new Error("recordId is required");
  const record = await recordService.completeRecord(id);
  return { record };
}

async function handleSearchRecords(payload) {
  const filter = payload || {};
  const records = await recordService.searchRecords(filter);
  return { records };
}

// 🔥 SỬa: Thêm handler để lấy nhiều records theo IDs (dùng cho thống kê doanh thu)
async function handleGetRecordsByIds(payload) {
  if (!payload.ids || !Array.isArray(payload.ids)) {
    throw new Error("ids array is required");
  }
  
  const mongoose = require('mongoose');
  const Record = require('../models/record.model');
  
  // Convert string IDs to ObjectIds
  const objectIds = payload.ids
    .filter(id => mongoose.Types.ObjectId.isValid(id))
    .map(id => new mongoose.Types.ObjectId(id));
  
  if (objectIds.length === 0) {
    return { records: [] }; // 🔥 SỬa: Trả về object { records: [] } để consistent với extractResult
  }
  
  const records = await Record.find({ 
    _id: { $in: objectIds },
    isActive: true
  }).select('_id dentistId dentistName patientId patientName').lean();
  
  console.log(`📤 [RPC Server] getRecordsByIds: Found ${records.length}/${payload.ids.length} records`);
  
  return { records }; // 🔥 SỬa: Trả về object { records: [...] } để consistent với extractResult
}
