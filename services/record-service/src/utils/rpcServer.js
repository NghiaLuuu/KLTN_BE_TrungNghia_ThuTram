// rpc/record.rpc.js
const amqp = require("amqplib");
const recordService = require("../services/record.service");

async function startRecordRpcServer() {
  const connection = await amqp.connect(process.env.RABBITMQ_URL);
  const channel = await connection.createChannel();

  const queue = "record_queue";
  await channel.assertQueue(queue, { durable: false });

  console.log(`✅ Record RPC server listening on queue: ${queue}`);

  channel.consume(queue, async (msg) => {
    if (!msg) return;

    let response;
    try {
      const { action, payload } = JSON.parse(msg.content.toString());

      switch (action) {
        case "createRecord":
          try {
            const { appointmentId, patientId, dentistId, serviceId, type, notes } = payload;

            if (!patientId || !appointmentId) {
              response = { error: "patientId & appointmentId are required" };
              break;
            }

            // Gọi service tạo record
            const record = await recordService.createRecord({
              appointmentId,
              patientId,
              dentistId,
              serviceId,  // 🔑 đồng bộ tên field
              type,
              notes: notes || ""
            });

            response = { record };
          } catch (err) {
            console.error("❌ Failed to create record:", err);
            response = { error: err.message };
          }
          break;


        case "getRecordById":
          try {
            if (!payload.id) {
              response = { error: "recordId is required" };
              break;
            }
            const record = await recordService.getRecordById(payload.id);
            response = { record };
          } catch (err) {
            console.error("❌ Failed to getRecordById:", err);
            response = { error: err.message };
          }
          break;

        default:
          response = { error: `Unknown action: ${action}` };
      }
    } catch (err) {
      console.error("❌ RPC server error:", err);
      response = { error: err.message };
    }

    // Gửi response về cho client (appointment service)
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
