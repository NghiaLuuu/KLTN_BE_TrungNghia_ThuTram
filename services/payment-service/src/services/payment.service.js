const paymentRepository = require('../repositories/payment.repository');
const { PaymentStatus } = require('../models/payment.model');
const redis = require('../utils/redis.client');
const rpcClient = require('../utils/rpcClient');

class PaymentService {
  // 🔹 Tạo payment thật trong DB
  async createPayment({ amount, method }) {
    const validMethods = ['cash', 'momo', 'zalo', 'vnpay', 'bank_transfer'];
    const paymentMethod = validMethods.includes(method) ? method : 'vnpay';

    return await paymentRepository.create({
      amount,
      method: paymentMethod,
      status: PaymentStatus.COMPLETED,
      paymentTime: new Date(),
    });
  }

  // 🔹 Confirm payment thật trong DB
  async confirmPayment(id) {
    return await paymentRepository.update(id, {
      status: PaymentStatus.COMPLETED,
      paymentTime: new Date(),
    });
  }

  async listPayments(filter) {
    return await paymentRepository.find(filter);
  }

  async getPaymentById(id) {
    return await paymentRepository.findById(id);
  }

  // 🔹 RPC: tạo payment tạm trong Redis
  async createTemporaryPayment(payload) {
    const { appointmentHoldKey, amount, method } = payload;

    if (!appointmentHoldKey) {
      throw new Error('appointmentHoldKey is required');
    }

    const tempPaymentId = `payment:temp:${appointmentHoldKey}`;
    const validMethods = ['cash', 'momo', 'zalo', 'vnpay', 'bank_transfer'];
    const paymentMethod = validMethods.includes(method) ? method : 'vnpay';

    const data = {
      tempPaymentId,
      appointmentHoldKey,
      amount,
      method: paymentMethod,
      status: PaymentStatus.PENDING,
      createdAt: new Date(),
    };

    await redis.setEx(tempPaymentId, 600, JSON.stringify(data));

    return data;
  }

  // 🔹 RPC: confirm payment (từ Redis -> DB + notify Appointment Service)
  async confirmPaymentRPC(payload) {
    if (!payload || !payload.id) throw new Error('Payment ID is required');

    // Nếu là payment tạm trong Redis
    if (payload.id.startsWith('payment:temp:')) {
      const raw = await redis.get(payload.id);
      if (!raw) throw new Error('Temporary payment not found or expired');

      const tempData = JSON.parse(raw);

      // 1️⃣ Tạo payment thật trong DB
      const savedPayment = await this.createPayment({
        amount: tempData.amount,
        method: tempData.method
      });

      // 2️⃣ Xoá payment tạm trong Redis
      await redis.del(payload.id);

      // 3️⃣ Update appointment tạm trong Redis thành confirmed
      if (tempData.appointmentHoldKey) {
        const appointmentRaw = await redis.get(tempData.appointmentHoldKey);
        if (appointmentRaw) {
          const appointmentData = JSON.parse(appointmentRaw);
          appointmentData.status = 'confirmed';
          await redis.setEx(
            tempData.appointmentHoldKey,
            600,
            JSON.stringify(appointmentData)
          );
          console.log(`✅ Temporary appointment updated to confirmed in Redis for holdKey ${tempData.appointmentHoldKey}`);
        }

        // 4️⃣ Gửi RPC sang Appointment Service để tạo appointment thật
        try {
          await rpcClient.request('appointment_queue', {
            action: 'confirmAppointmentWithPayment',
            payload: {
              holdKey: String(tempData.appointmentHoldKey),
              paymentId: String(savedPayment._id)
            }
          });
          console.log(`✅ Appointment creation triggered for holdKey ${tempData.appointmentHoldKey}`);
        } catch (err) {
          console.error(`❌ Failed to notify Appointment Service:`, err.message);
        }
      }

      return savedPayment;
    }

    // Nếu là payment thật trong DB
    return this.confirmPayment(payload.id);
  }

  // 🔹 RPC: get payment by id (tạm hoặc thật)
  async getPaymentByIdRPC(payload) {
    if (!payload.id) throw new Error('Payment ID is required');

    if (payload.id.startsWith('payment:temp:')) {
      const raw = await redis.get(payload.id);
      return raw ? JSON.parse(raw) : null;
    }

    return this.getPaymentById(payload.id);
  }
}

module.exports = new PaymentService();
