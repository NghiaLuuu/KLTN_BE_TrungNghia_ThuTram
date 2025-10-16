/**
 * @author: TrungNghia
 * Visa Payment Gateway Integration
 * Sandbox environment for testing
 */

const crypto = require('crypto');

class VisaGateway {
  constructor() {
    // Visa Sandbox credentials
    this.apiKey = process.env.VISA_API_KEY || 'test_visa_api_key_sandbox';
    this.apiSecret = process.env.VISA_SECRET_KEY || 'test_visa_secret_key_sandbox';
    this.merchantId = process.env.VISA_MERCHANT_ID || 'TEST_MERCHANT_123';
    this.sandboxMode = process.env.NODE_ENV !== 'production';
  }

  /**
   * Process Visa payment
   * In sandbox mode, this simulates payment processing
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

      // Validate card data
      this.validateCardData(cardNumber, expiryMonth, expiryYear, cvv);

      if (this.sandboxMode) {
        // Sandbox mode - simulate payment
        return await this.simulateSandboxPayment({
          amount,
          currency,
          cardNumber,
          orderRef,
          description
        });
      } else {
        // Production mode - real Visa API call
        return await this.processRealPayment(paymentData);
      }

    } catch (error) {
      console.error('Visa payment processing error:', error);
      throw error;
    }
  }

  /**
   * Validate card data
   */
  validateCardData(cardNumber, expiryMonth, expiryYear, cvv) {
    // Remove spaces from card number
    const cleanCardNumber = cardNumber.replace(/\s/g, '');

    // Validate card number (Luhn algorithm)
    if (!this.isValidCardNumber(cleanCardNumber)) {
      throw new Error('Invalid card number');
    }

    // Validate expiry date
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear() % 100; // Get last 2 digits
    const currentMonth = currentDate.getMonth() + 1;
    
    const expMonth = parseInt(expiryMonth);
    const expYear = parseInt(expiryYear);

    if (expMonth < 1 || expMonth > 12) {
      throw new Error('Invalid expiry month');
    }

    if (expYear < currentYear || (expYear === currentYear && expMonth < currentMonth)) {
      throw new Error('Card has expired');
    }

    // Validate CVV
    if (!/^\d{3,4}$/.test(cvv)) {
      throw new Error('Invalid CVV');
    }
  }

  /**
   * Luhn algorithm for card number validation
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
   * Simulate sandbox payment
   * Returns success for test cards, failure for others
   */
  async simulateSandboxPayment(data) {
    const { amount, currency, cardNumber, orderRef, description } = data;
    
    // Simulate API delay (500ms - 2s)
    const delay = 500 + Math.random() * 1500;
    await new Promise(resolve => setTimeout(resolve, delay));

    const cleanCardNumber = cardNumber.replace(/\s/g, '');
    const transactionId = 'VSA' + Date.now() + Math.random().toString(36).substring(7).toUpperCase();
    const timestamp = new Date().toISOString();

    // Test card numbers
    const testCards = {
      '4111111111111111': { success: true, message: 'Payment successful' },
      '4000000000000002': { success: false, message: 'Card declined' },
      '4000000000000069': { success: false, message: 'Expired card' },
      '4000000000000127': { success: false, message: 'Insufficient funds' }
    };

    // Check if it's a test card
    const testResult = testCards[cleanCardNumber];
    
    if (testResult) {
      if (testResult.success) {
        // Success response
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
        // Failure response
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

    // Default: approve for any other valid card in sandbox
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
   * Generate authorization code
   */
  generateAuthCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  /**
   * Process real Visa payment (Production)
   * TODO: Implement actual Visa API integration
   */
  async processRealPayment(paymentData) {
    throw new Error('Production Visa payment not implemented yet');
  }

  /**
   * Verify payment signature
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
   * Refund payment
   */
  async refundPayment(transactionId, amount, reason) {
    if (this.sandboxMode) {
      // Simulate refund
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
   * Get payment status
   */
  async getPaymentStatus(transactionId) {
    if (this.sandboxMode) {
      // In sandbox, assume all transactions are approved
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
