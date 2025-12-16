/**
 * @author: TrungNghia
 * Tích hợp Cổng thanh toán Visa
 * Môi trường Sandbox để thử nghiệm
 */

const crypto = require('crypto');

class VisaGateway {
  constructor() {
    // Thông tin xác thực Visa Sandbox
    this.apiKey = process.env.VISA_API_KEY || 'test_visa_api_key_sandbox';
    this.apiSecret = process.env.VISA_SECRET_KEY || 'test_visa_secret_key_sandbox';
    this.merchantId = process.env.VISA_MERCHANT_ID || 'TEST_MERCHANT_123';
    this.sandboxMode = process.env.NODE_ENV !== 'production';
  }

  /**
   * Xử lý thanh toán Visa
   * Trong chế độ sandbox, giả lập xử lý thanh toán
   */
  async processPayment(paymentData) {
    try {
      const {
        amount,
        currency = 'VND',
        cardNumber,
        cardHolder,
        expiryMonth,
        expiryYear,
        cvv,
        orderRef,
        description
      } = paymentData;

      // Kiểm tra dữ liệu thẻ
      this.validateCardData(cardNumber, expiryMonth, expiryYear, cvv);

      if (this.sandboxMode) {
        // Chế độ sandbox - giả lập thanh toán
        return await this.simulateSandboxPayment({
          amount,
          currency,
          cardNumber,
          orderRef,
          description
        });
      } else {
        // Chế độ production - gọi API Visa thực
        return await this.processRealPayment(paymentData);
      }

    } catch (error) {
      console.error('Visa payment processing error:', error);
      throw error;
    }
  }

  /**
   * Kiểm tra dữ liệu thẻ
   */
  validateCardData(cardNumber, expiryMonth, expiryYear, cvv) {
    // Xóa khoảng trắng khỏi số thẻ
    const cleanCardNumber = cardNumber.replace(/\s/g, '');

    // Kiểm tra số thẻ (thuật toán Luhn)
    if (!this.isValidCardNumber(cleanCardNumber)) {
      throw new Error('Invalid card number');
    }

    // Kiểm tra ngày hết hạn
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear() % 100; // Lấy 2 chữ số cuối
    const currentMonth = currentDate.getMonth() + 1;
    
    const expMonth = parseInt(expiryMonth);
    const expYear = parseInt(expiryYear);

    if (expMonth < 1 || expMonth > 12) {
      throw new Error('Invalid expiry month');
    }

    if (expYear < currentYear || (expYear === currentYear && expMonth < currentMonth)) {
      throw new Error('Card has expired');
    }

    // Kiểm tra CVV
    if (!/^\d{3,4}$/.test(cvv)) {
      throw new Error('Invalid CVV');
    }
  }

  /**
   * Thuật toán Luhn để kiểm tra số thẻ
   */
  isValidCardNumber(cardNumber) {
    if (!/^\d{13,19}$/.test(cardNumber)) {
      return false;
    }

    let sum = 0;
    let isEven = false;

    for (let i = cardNumber.length - 1; i >= 0; i--) {
      let digit = parseInt(cardNumber[i]);

      if (isEven) {
        digit *= 2;
        if (digit > 9) {
          digit -= 9;
        }
      }

      sum += digit;
      isEven = !isEven;
    }

    return sum % 10 === 0;
  }

  /**
   * Giả lập thanh toán sandbox
   * Trả về thành công cho thẻ test, thất bại cho các thẻ khác
   */
  async simulateSandboxPayment(data) {
    const { amount, currency, cardNumber, orderRef, description } = data;
    
    // Giả lập độ trễ API (500ms - 2s)
    const delay = 500 + Math.random() * 1500;
    await new Promise(resolve => setTimeout(resolve, delay));

    const cleanCardNumber = cardNumber.replace(/\s/g, '');
    const transactionId = 'VSA' + Date.now() + Math.random().toString(36).substring(7).toUpperCase();
    const timestamp = new Date().toISOString();

    // Các số thẻ test
    const testCards = {
      '4111111111111111': { success: true, message: 'Payment successful' },
      '4000000000000002': { success: false, message: 'Card declined' },
      '4000000000000069': { success: false, message: 'Expired card' },
      '4000000000000127': { success: false, message: 'Insufficient funds' }
    };

    // Kiểm tra xem đây có phải thẻ test không
    const testResult = testCards[cleanCardNumber];
    
    if (testResult) {
      if (testResult.success) {
        // Phản hồi thành công
        return {
          success: true,
          transactionId,
          status: 'approved',
          amount,
          currency,
          orderRef,
          timestamp,
          authorizationCode: this.generateAuthCode(),
          cardLast4: cleanCardNumber.slice(-4),
          message: testResult.message,
          gateway: 'visa_sandbox'
        };
      } else {
        // Phản hồi thất bại
        return {
          success: false,
          transactionId,
          status: 'declined',
          amount,
          currency,
          orderRef,
          timestamp,
          errorCode: 'CARD_DECLINED',
          message: testResult.message,
          gateway: 'visa_sandbox'
        };
      }
    }

    // Mặc định: chấp nhận cho bất kỳ thẻ hợp lệ nào khác trong sandbox
    return {
      success: true,
      transactionId,
      status: 'approved',
      amount,
      currency,
      orderRef,
      timestamp,
      authorizationCode: this.generateAuthCode(),
      cardLast4: cleanCardNumber.slice(-4),
      message: 'Payment successful (sandbox)',
      gateway: 'visa_sandbox'
    };
  }

  /**
   * Tạo mã uỷ quyền
   */
  generateAuthCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  /**
   * Xử lý thanh toán Visa thực (Production)
   * TODO: Triển khai tích hợp API Visa thực
   */
  async processRealPayment(paymentData) {
    throw new Error('Production Visa payment not implemented yet');
  }

  /**
   * Xác minh chữ ký thanh toán
   */
  verifySignature(data, signature) {
    const dataString = JSON.stringify(data);
    const expectedSignature = crypto
      .createHmac('sha256', this.apiSecret)
      .update(dataString)
      .digest('hex');
    
    return signature === expectedSignature;
  }

  /**
   * Hoàn tiền thanh toán
   */
  async refundPayment(transactionId, amount, reason) {
    if (this.sandboxMode) {
      // Giả lập hoàn tiền
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      return {
        success: true,
        refundId: 'RFD' + Date.now(),
        transactionId,
        amount,
        status: 'refunded',
        timestamp: new Date().toISOString(),
        message: 'Refund successful (sandbox)'
      };
    } else {
      throw new Error('Production Visa refund not implemented yet');
    }
  }

  /**
   * Lấy trạng thái thanh toán
   */
  async getPaymentStatus(transactionId) {
    if (this.sandboxMode) {
      // Trong sandbox, giả định tất cả giao dịch đều được chấp nhận
      return {
        transactionId,
        status: 'approved',
        timestamp: new Date().toISOString()
      };
    } else {
      throw new Error('Production Visa status check not implemented yet');
    }
  }
}

module.exports = new VisaGateway();
