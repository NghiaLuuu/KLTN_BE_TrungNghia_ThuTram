const { getChannel } = require('./rabbitmq.client');
const appointmentRepo = require('../repositories/appointment.repository');

const RPC_QUEUE = 'appointment-service_rpc_queue';

async function startRpcServer() {
  try {
    const channel = getChannel();
    if (!channel) {
      throw new Error('RabbitMQ channel not available');
    }

    // Refresh queue before asserting
    try {
      await channel.deleteQueue(RPC_QUEUE);
      console.log(`♻️ Refreshing RabbitMQ queue ${RPC_QUEUE} before asserting`);
    } catch (err) {
      if (err?.code !== 404) {
        console.warn(`⚠️ Could not delete queue ${RPC_QUEUE}:`, err.message);
      }
    }

    await channel.assertQueue(RPC_QUEUE, { durable: true });
    await channel.prefetch(1);

    console.log(`✅ Appointment RPC Server listening on: ${RPC_QUEUE}`);

    channel.consume(RPC_QUEUE, async (msg) => {
      if (!msg) return;

      const startTime = Date.now();
      let response = { success: false };

      try {
        const request = JSON.parse(msg.content.toString());
        const { method, params } = request;

        console.log(`🔍 [RPC Server] Received ${method}:`, params);

        switch (method) {
          case 'getAppointment':
          case 'getAppointmentById':
            if (!params.id) {
              response = { success: false, error: 'Missing appointment ID' };
              break;
            }
            const appointment = await appointmentRepo.findById(params.id);
            if (!appointment) {
              response = { success: false, error: 'Appointment not found' };
            } else {
              response = { 
                success: true, 
                data: appointment.toObject ? appointment.toObject() : appointment 
              };
            }
            break;

          case 'getAppointmentByCode':
            if (!params.code) {
              response = { success: false, error: 'Missing appointment code' };
              break;
            }
            const appointmentByCode = await appointmentRepo.findByCode(params.code);
            if (!appointmentByCode) {
              response = { success: false, error: 'Appointment not found' };
            } else {
              response = { 
                success: true, 
                data: appointmentByCode.toObject ? appointmentByCode.toObject() : appointmentByCode 
              };
            }
            break;

          case 'updateInvoiceId':
            if (!params.appointmentId || !params.invoiceId) {
              response = { success: false, error: 'Missing appointmentId or invoiceId' };
              break;
            }
            const updated = await appointmentRepo.updateInvoiceId(params.appointmentId, params.invoiceId);
            response = { success: true, data: updated };
            break;

          case 'updateStatus':
            if (!params.id || !params.status) {
              response = { success: false, error: 'Missing id or status' };
              break;
            }
            const statusUpdated = await appointmentRepo.updateStatus(
              params.id, 
              params.status, 
              params.additionalData || {}
            );
            response = { success: true, data: statusUpdated };
            break;

          default:
            response = { success: false, error: `Unknown method: ${method}` };
        }

        const duration = Date.now() - startTime;
        console.log(`✅ [RPC Server] ${method} completed in ${duration}ms:`, 
          response.success ? 'Success' : response.error);

      } catch (error) {
        console.error('❌ [RPC Server] Error:', error);
        response = { 
          success: false, 
          error: error.message || 'Internal server error' 
        };
      }

      // Send response
      channel.sendToQueue(
        msg.properties.replyTo,
        Buffer.from(JSON.stringify(response)),
        { correlationId: msg.properties.correlationId }
      );

      channel.ack(msg);
    });

    console.log('✅ Appointment RPC Server started successfully');
  } catch (error) {
    console.error('❌ Failed to start Appointment RPC Server:', error);
    throw error;
  }
}

module.exports = startRpcServer;
