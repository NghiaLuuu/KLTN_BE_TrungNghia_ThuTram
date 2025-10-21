const amqp = require("amqplib");
const recordService = require("../services/record.service");

async function startRecordRpcServer() {
  const connection = await amqp.connect(process.env.RABBITMQ_URL);
  const channel = await connection.createChannel();

  const queue = "record_rpc_queue"; // ⭐ Changed from record_queue to record_rpc_queue

  // ⭐ Just assert queue, don't delete it (consumer is using it)
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

// ------------------- Handlers -------------------
async function handleCreateRecord(payload) {
  const record = await recordService.createRecord(payload);
  return { record };
}

async function handleGetRecordById(payload) {
  if (!payload.id) throw new Error("recordId is required");
  const record = await recordService.getRecordById(payload.id);
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
