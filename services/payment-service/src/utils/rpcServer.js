// rpcServer.js (Payment Service)
// Máy chủ RPC cho Payment Service - xử lý các cuộc gọi RPC từ các service khác
const amqp = require('amqplib');
const paymentService = require('../services/payment.service'); // dùng service thay vì repo

async function startRpcServer() {
  const connection = await amqp.connect(process.env.RABBITMQ_URL);
  const channel = await connection.createChannel();

  const queue = 'payment_rpc_queue'; // ✅ ĐÃ ĐỔI: Sử dụng queue riêng cho RPC

  // ❌ ĐÃ XÓA: Không xóa queue - gây mất tin nhắn!
  // Các tin nhắn gửi trước khi consumer bắt đầu sẽ bị mất
  
  await channel.assertQueue(queue, { durable: true });

  console.log(`✅ RPC server ready on: ${queue}`);

  channel.consume(queue, async (msg) => {
    if (!msg) return;

    let response;
    try {
      const { action, payload } = JSON.parse(msg.content.toString());

      switch (action) {
        case 'createTemporaryPayment':
          try {
            response = await paymentService.createTemporaryPayment(payload);
          } catch (err) {
            console.error('Tạo thanh toán tạm thất bại:', err);
            response = { error: err.message };
          }
          break;

        case 'confirmPayment':
          try {
            response = await paymentService.confirmPaymentRPC(payload);
          } catch (err) {
            console.error('Xác nhận thanh toán thất bại:', err);
            response = { error: err.message };
          }
          break;

        case 'getPaymentById':
          try {
            console.log('🔍 [RPC Server] Nhận getPaymentById:', payload);
            if (!payload.id) {
              response = { error: 'paymentId là bắt buộc' };
              break;
            }
            const startTime = Date.now();
            response = await paymentService.getPaymentByIdRPC(payload);
            console.log(`✅ [RPC Server] getPaymentById hoàn tất trong ${Date.now() - startTime}ms:`, response ? 'Thành công' : 'Không tìm thấy');
          } catch (err) {
            console.error('❌ [RPC Server] getPaymentById thất bại:', err.message);
            response = { error: err.message };
          }
          break;
          case 'createPayment':
            try {
              response = await paymentService.createPaymentStaff(payload);
            } catch (err) {
              console.error('Tạo thanh toán thất bại:', err);
              response = { error: err.message };
            }
            break;
          case 'updateAppointmentCode':
            try {
              console.log('✅ RPC nhận được updateAppointmentCode payload:', payload); // 🔹 Thêm log debug

              const { paymentId, appointmentCode } = payload; 
              if (!paymentId || !appointmentCode) {
                response = { error: 'paymentId và appointmentCode là bắt buộc' };
                break;
              }

              response = await paymentService.updateAppointmentCode(paymentId, appointmentCode);
              console.log('✅ Đã cập nhật AppointmentCode thành công cho paymentId:', paymentId);

            } catch (err) {
              console.error('Cập nhật appointmentCode thất bại:', err);
              response = { error: err.message };
            }
            break;


        default:
          response = { error: `Unknown action: ${action}` };
      }

    } catch (err) {
      console.error('Lỗi RPC server:', err);
      response = { error: err.message };
    }

    // Gửi trả an toàn
    try {
      if (msg.properties.replyTo) {
        const payloadToSend = response
          ? JSON.stringify(response)
          : JSON.stringify({ error: 'Không có phản hồi' });

        channel.sendToQueue(
          msg.properties.replyTo,
          Buffer.from(payloadToSend),
          { correlationId: msg.properties.correlationId }
        );
      } else {
        console.warn('Tin nhắn RPC không có replyTo, không thể gửi phản hồi');
      }
    } catch (err) {
      console.error('Gửi phản hồi RPC thất bại:', err);
    }

    channel.ack(msg);
  });
}

module.exports = startRpcServer;
