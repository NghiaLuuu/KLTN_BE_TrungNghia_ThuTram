// payment.service.js
const crypto = require('crypto');
const paymentRepository = require('../repositories/payment.repository');
const { PaymentStatus } = require('../models/payment.model');
const redis = require('../utils/redis.client');
const rpcClient = require('../utils/rpcClient');
const { createMoMoPayment } = require('../utils/payment.gateway');

class PaymentService {
    async createPayment({ amount, method }) {
    const paymentMethod = method || 'momo';
    return paymentRepository.create({
      amount,
      method: paymentMethod,
      status: PaymentStatus.COMPLETED,
      paymentTime: new Date(),
    });
  }

  async confirmPayment(id) {
    return paymentRepository.update(id, {
      status: PaymentStatus.COMPLETED,
      paymentTime: new Date(),
    });
  }

  async listPayments(filter) { return paymentRepository.find(filter); }
  async getPaymentById(id) { return paymentRepository.findById(id); }

  // RPC: tạo payment tạm trong Redis
async createTemporaryPayment(payload) {
  const { appointmentHoldKey, amount } = payload;
  if (!appointmentHoldKey) throw new Error('appointmentHoldKey is required');

  const tempPaymentId = `payment:temp:${appointmentHoldKey}`;
  const paymentMethod = 'momo'; // mặc định 'momo'

  // Tạo orderId duy nhất
  const shortHash = crypto.createHash('sha256')
    .update(tempPaymentId)
    .digest('hex')
    .slice(0, 10);
  const orderId = `ORD${Date.now()}${shortHash}`.replace(/[^0-9a-zA-Z]/g, '').substring(0, 20);

  // Thời gian hiện tại
  const now = new Date();
  // Thời gian hết hạn 10 phút
  const expireAt = new Date(now.getTime() + 10 * 60 * 1000);

  const data = {
    tempPaymentId,
    appointmentHoldKey,
    amount: Math.round(Number(amount) || 0),
    method: paymentMethod,
    status: 'PENDING',
    createdAt: now,
    expireAt,      // thời gian hết hạn
    orderId
  };

  // Lưu tạm vào Redis với TTL 10 phút
  await redis.setEx(tempPaymentId, 600, JSON.stringify(data));

  // Luôn tạo MoMo payment URL nếu method = 'momo'
  if (paymentMethod === 'momo') {
    const extraData = tempPaymentId; // dùng mapping trong webhook
    try {
      const paymentResponse = await createMoMoPayment(orderId, data.amount, extraData);
      data.paymentUrl = paymentResponse.payUrl || paymentResponse.qrCodeUrl;
      data.requestId = paymentResponse.requestId; // optional, lưu để đối chiếu
    } catch (err) {
      console.error('❌ Failed to create MoMo payment URL:');
      console.error(err.response?.data || err);
      throw new Error('Cannot create MoMo payment link');
    }
  }

  console.log('Temporary payment created (MoMo):', data);
  return data;
}




  // RPC: confirm payment (từ Redis -> DB + notify Appointment Service)
  async confirmPaymentRPC(payload) {
  if (!payload || !payload.id) throw new Error('Payment ID is required');

  // 1️⃣ Nếu temp payment
  if (payload.id.startsWith('payment:temp:')) {
    const raw = await redis.get(payload.id);
    if (!raw) throw new Error('Temporary payment not found or expired');
    const tempData = JSON.parse(raw);

    const savedPayment = await this.createPayment({
      amount: tempData.amount,
      method: tempData.method
    });

    await redis.del(payload.id);

    // Xử lý appointment
    if (tempData.appointmentHoldKey) {
      const appointmentRaw = await redis.get(tempData.appointmentHoldKey);
      if (appointmentRaw) {
        const appointmentData = JSON.parse(appointmentRaw);
        appointmentData.status = 'confirmed';
        await redis.setEx(tempData.appointmentHoldKey, 600, JSON.stringify(appointmentData));
        console.log(`✅ Temporary appointment updated to confirmed in Redis for holdKey ${tempData.appointmentHoldKey}`);
      }

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
        console.error('❌ Failed to notify Appointment Service:', err.message);
      }
    }

    return savedPayment;
  }

  // 2️⃣ Nếu payload.id là ObjectId hợp lệ, confirm MongoDB Payment
  if (payload.id.match(/^[0-9a-fA-F]{24}$/)) {
    return this.confirmPayment(payload.id);
  }

  // 3️⃣ Nếu không phải temp payment và không phải ObjectId → lỗi hợp lệ
  throw new Error('Invalid Payment ID format');
}



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
