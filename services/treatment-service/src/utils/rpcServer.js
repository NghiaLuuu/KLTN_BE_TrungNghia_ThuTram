const amqp = require("amqplib");
const redis = require("../utils/redis.client"); // dùng redis thay cho mongoose
const invoiceService = require("../services/invoice.service");
const invoiceDetailService = require("../services/invoiceDetail.service");

const SERVICE_CACHE_KEY = "services_cache";

async function startInvoiceRpcServer() {
  const connection = await amqp.connect(process.env.RABBITMQ_URL);
  const channel = await connection.createChannel();

  const queue = "invoice_queue";
  await channel.assertQueue(queue, { durable: false });

  console.log(`✅ Invoice RPC server listening on queue: ${queue}`);

  channel.consume(queue, async (msg) => {
    if (!msg) return;

    let response;
    try {
      const { action, payload } = JSON.parse(msg.content.toString());

      switch (action) {
        case "createInvoiceFromAppointment":
          try {
            const { patientId, appointmentId, services, method, notes } = payload;

            if (!patientId || !Array.isArray(services) || services.length === 0) {
              response = { error: "Invalid payload: patientId & services required" };
              break;
            }

            let totalAmount = 0;
            const details = [];

            // Tạo trước invoice rỗng
            const invoice = await invoiceService.createInvoice({
              patientId,
              appointmentId,
              amount: 0,
              method: method || "cash",
              notes,
            });

            // Lấy cache services từ Redis
            let cached = await redis.get(SERVICE_CACHE_KEY);
            if (!cached) {
              response = { error: "Service cache is empty. Please refresh service cache." };
              break;
            }
            const serviceCache = JSON.parse(cached);

            for (const item of services) {
              const service = serviceCache.find(s => String(s._id) === String(item.serviceId));
              if (!service) {
                console.warn(`⚠️ Service not found in cache: ${item.serviceId}`);
                continue;
              }

              const quantity = item.quantity || 1;
              const unitPrice = service.price;
              const totalPrice = unitPrice * quantity;

              totalAmount += totalPrice;

              const detail = await invoiceDetailService.createDetail({
                invoiceId: invoice._id,
                serviceId: service._id,
                unitPrice,
                quantity,
                totalPrice,
                note: item.note || service.name,
              });

              details.push(detail);
            }

            // Cập nhật lại tổng tiền vào invoice
            const updatedInvoice = await invoiceService.updateInvoice(invoice._id, { amount: totalAmount });

            response = { invoice: updatedInvoice, details };
          } catch (err) {
            console.error("❌ Failed to create invoice from appointment:", err);
            response = { error: err.message };
          }
          break;

        case "getInvoiceById":
          try {
            if (!payload.id) {
              response = { error: "invoiceId is required" };
              break;
            }
            const invoice = await invoiceService.getInvoiceById(payload.id);
            const details = await invoiceDetailService.getDetailsByInvoice(payload.id);
            response = { invoice, details };
          } catch (err) {
            console.error("❌ Failed to getInvoiceById:", err);
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

    // Trả kết quả cho service gọi
    try {
      if (msg.properties.replyTo) {
        channel.sendToQueue(
          msg.properties.replyTo,
          Buffer.from(JSON.stringify(response || { error: "No response" })),
          { correlationId: msg.properties.correlationId }
        );
      }
    } catch (err) {
      console.error("❌ Failed to send RPC response:", err);
    }

    channel.ack(msg);
  });
}

module.exports = startInvoiceRpcServer;
