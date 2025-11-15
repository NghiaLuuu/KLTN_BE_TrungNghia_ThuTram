const amqp = require("amqplib");
const invoiceService = require("../services/invoice.service");
const invoiceDetailService = require("../services/invoiceDetail.service");

class InvoiceRPCServer {
  constructor() {
    this.connection = null;
    this.channel = null;
    this.isConnected = false;
  }

  async start() {
    try {
      const rabbitmqUrl = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
      
      this.connection = await amqp.connect(rabbitmqUrl);
      this.channel = await this.connection.createChannel();

      const queueName = 'invoice-service_rpc_queue';

      try {
        await this.channel.deleteQueue(queueName);
        console.log(`♻️ Refreshing RabbitMQ queue ${queueName} before asserting`);
      } catch (err) {
        if (err?.code !== 404) {
          console.warn(`⚠️ Could not delete queue ${queueName} during refresh:`, err.message || err);
        }
      }

      await this.channel.assertQueue(queueName, { durable: true });

      // Set prefetch to handle one message at a time
      this.channel.prefetch(1);

      console.log(`✅ Invoice RPC Server listening on queue: ${queueName}`);

      await this.channel.consume(queueName, async (msg) => {
        if (msg) {
          await this.handleMessage(msg);
        }
      });

      this.connection.on('error', (err) => {
        console.error('❌ RPC Server connection error:', err.message);
        this.isConnected = false;
      });

      this.connection.on('close', () => {
        console.log('🔌 RPC Server connection closed');
        this.isConnected = false;
      });

      this.isConnected = true;
      return true;
    } catch (error) {
      console.error('❌ Failed to start Invoice RPC Server:', error);
      this.isConnected = false;
      return false;
    }
  }

  async handleMessage(msg) {
    let response = { success: false, result: null, error: null };

    try {
      const { method, params } = JSON.parse(msg.content.toString());
      console.log(`📥 RPC received: ${method}`, params);

      switch (method) {
        // ============ INVOICE OPERATIONS ============
        case 'createInvoice':
          response.result = await invoiceService.createInvoice(params.invoiceData, params.userId);
          response.success = true;
          break;

        case 'getInvoice':
          response.result = await invoiceService.getInvoiceById(params.invoiceId, params.useCache);
          response.success = true;
          break;

        case 'updateInvoice':
          response.result = await invoiceService.updateInvoice(params.invoiceId, params.updateData, params.userId);
          response.success = true;
          break;

        case 'finalizeInvoice':
          response.result = await invoiceService.finalizeInvoice(params.invoiceId, params.userId);
          response.success = true;
          break;

        case 'cancelInvoice':
          response.result = await invoiceService.cancelInvoice(params.invoiceId, params.cancelReason, params.userId);
          response.success = true;
          break;

        // ============ PAYMENT INTEGRATION ============
        case 'createInvoiceFromPayment':
          // Chỉ tạo invoice khi payment thành công
          if (params.paymentData.status !== 'completed') {
            response.error = 'Chỉ tạo hóa đơn khi thanh toán thành công';
            break;
          }
          response.result = await invoiceService.createInvoiceFromPayment(params.paymentData);
          response.success = true;
          break;

        case 'handlePaymentSuccess':
          response.result = await invoiceService.handlePaymentSuccess(params.paymentData);
          response.success = true;
          break;

        case 'getInvoicesForPayment':
          // Lấy danh sách invoice chờ thanh toán cho một appointment
          const pendingInvoices = await invoiceService.getInvoices({
            appointmentId: params.appointmentId,
            status: ['draft', 'pending', 'partial_paid']
          });
          response.result = pendingInvoices;
          response.success = true;
          break;

        // ============ APPOINTMENT INTEGRATION ============
        case 'createInvoiceFromAppointment':
          try {
            const { appointmentData, userId } = params;

            // Validate appointment data
            if (!appointmentData.patientId || !appointmentData._id) {
              response.error = 'Dữ liệu cuộc hẹn không hợp lệ';
              break;
            }

            // Create draft invoice for appointment
            const invoiceData = {
              appointmentId: appointmentData._id,
              patientId: appointmentData.patientId,
              patientInfo: appointmentData.patientInfo,
              type: 'appointment',
              status: 'draft', // Tạo nháp trước, chờ thanh toán mới finalize
              notes: `Hóa đơn cho cuộc hẹn ${appointmentData.appointmentCode || appointmentData._id}`
            };

            // Add services if provided
            if (appointmentData.services && appointmentData.services.length > 0) {
              invoiceData.details = appointmentData.services.map(service => ({
                serviceId: service.serviceId,
                quantity: service.quantity || 1,
                unitPrice: service.price || 0,
                notes: service.notes
              }));
            }

            const invoice = await invoiceService.createInvoice(invoiceData, userId || 'system');
            response.result = invoice;
            response.success = true;
          } catch (error) {
            response.error = error.message;
          }
          break;

        // ============ INVOICE DETAILS OPERATIONS ============
        case 'createInvoiceDetail':
          response.result = await invoiceDetailService.createDetail(params.detailData, params.userId);
          response.success = true;
          break;

        case 'getInvoiceDetails':
          response.result = await invoiceDetailService.getDetailsByInvoice(params.invoiceId, params.options);
          response.success = true;
          break;

        case 'updateInvoiceDetail':
          response.result = await invoiceDetailService.updateDetail(params.detailId, params.updateData, params.userId);
          response.success = true;
          break;

        // ============ STATISTICS & REPORTING ============
        case 'getInvoiceStatistics':
          response.result = await invoiceService.getInvoiceStatistics(
            params.startDate,
            params.endDate,
            params.groupBy
          );
          response.success = true;
          break;

        case 'getRevenueStatistics':
          response.result = await invoiceService.getRevenueStats(
            params.startDate,
            params.endDate,
            params.groupBy,
            params.dentistId,
            params.serviceId
          );
          response.success = true;
          break;

        case 'getDashboardData':
          response.result = await invoiceService.getDashboardData();
          response.success = true;
          break;

        case 'getServiceStatistics':
          response.result = await invoiceDetailService.getServiceStatistics(
            params.startDate,
            params.endDate
          );
          response.success = true;
          break;

        // ============ SEARCH OPERATIONS ============
        case 'searchInvoices':
          response.result = await invoiceService.searchInvoices(params.searchTerm, params.options);
          response.success = true;
          break;

        case 'getInvoicesByPatient':
          const patientInvoices = await invoiceService.getInvoices({
            patientId: params.patientId,
            status: params.status
          }, params.options);
          response.result = patientInvoices;
          response.success = true;
          break;

        case 'getInvoicesByPhone':
          const phoneInvoices = await invoiceService.getInvoices({
            phone: params.phone,
            status: params.status
          }, params.options);
          response.result = phoneInvoices;
          response.success = true;
          break;

        // ============ HEALTH CHECK ============
        case 'healthCheck':
          response.result = {
            service: 'invoice-service',
            status: 'healthy',
            timestamp: new Date().toISOString()
          };
          response.success = true;
          break;

        case 'ping':
          response.result = {
            message: 'pong',
            timestamp: new Date().toISOString()
          };
          response.success = true;
          break;

        default:
          response.error = `Unknown method: ${method}`;
          break;
      }

    } catch (error) {
      console.error('❌ RPC handling error:', error);
      response.error = error.message;
    }

    // Send response
    try {
      this.channel.sendToQueue(
        msg.properties.replyTo,
        Buffer.from(JSON.stringify(response)),
        { correlationId: msg.properties.correlationId }
      );
      
      this.channel.ack(msg);
      console.log(`📤 RPC response sent for correlation: ${msg.properties.correlationId}`);
    } catch (error) {
      console.error('❌ Error sending RPC response:', error);
      this.channel.nack(msg, false, false);
    }
  }

  async stop() {
    try {
      if (this.channel) {
        await this.channel.close();
      }
      if (this.connection) {
        await this.connection.close();
      }
      this.isConnected = false;
      console.log('✅ Invoice RPC Server stopped gracefully');
    } catch (error) {
      console.error('❌ Error stopping Invoice RPC Server:', error);
    }
  }

  getStatus() {
    return {
      connected: this.isConnected,
      service: 'invoice-service',
      timestamp: new Date().toISOString()
    };
  }
}

// Create singleton instance
const invoiceRPCServer = new InvoiceRPCServer();

// Export function to start the server
async function startRpcServer() {
  try {
    const success = await invoiceRPCServer.start();
    if (success) {
      console.log('✅ Invoice RPC Server started successfully');
    } else {
      console.error('❌ Failed to start Invoice RPC Server');
    }
    return success;
  } catch (error) {
    console.error('❌ Error starting RPC Server:', error);
    return false;
  }
}

module.exports = startRpcServer;