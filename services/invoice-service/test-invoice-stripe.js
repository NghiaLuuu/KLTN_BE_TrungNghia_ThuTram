/**
 * Test script: Create invoice from Stripe payment with deposit
 * 
 * This script simulates Stripe payment flow with deposit:
 * 1. Mock a Stripe payment with recordId and depositAmount
 * 2. Mock a record with main service (serviceAddOnPrice = 500k) + additional services
 * 3. Call createInvoiceFromPayment
 * 4. Verify invoice details show ORIGINAL unitPrice (500k) with deposit as discount
 */

require('dotenv').config();
const mongoose = require('mongoose');
const invoiceService = require('./src/services/invoice.service');

// Mock RPC Client
class MockRPCClient {
  async call(service, action, params) {
    console.log(`📞 [Mock RPC] ${service}.${action}`, params);
    
    if (service === 'appointment-service' && action === 'getAppointmentById') {
      return {
        _id: params.id,
        patientId: new mongoose.Types.ObjectId(),
        status: 'completed',
        patientInfo: {
          name: 'Nguyễn Văn Test',
          phone: '0123456789'
        }
      };
    }
    
    if (service === 'record-service' && action === 'getRecordById') {
      // Mock record with MAIN service having serviceAddOnPrice
      return {
        _id: params.id,
        recordCode: 'REC-STRIPE-001',
        patientId: new mongoose.Types.ObjectId(),
        appointmentId: new mongoose.Types.ObjectId(),
        type: 'treatment',
        // ⭐ MAIN SERVICE
        serviceId: new mongoose.Types.ObjectId(),
        serviceName: 'Khám tổng quát',
        serviceAddOnId: 'addon-main-002',
        serviceAddOnName: 'Khám và tư vấn chuyên sâu',
        serviceAddOnUnit: 'Lần',
        servicePrice: 200000, // ❌ Giá base (KHÔNG dùng)
        serviceAddOnPrice: 500000, // ✅ Giá addon thực tế (phải lấy cái này)
        quantity: 1,
        depositPaid: 200000, // Đã cọc 200k
        totalCost: 2000000,
        // ⭐ ADDITIONAL SERVICES
        additionalServices: [
          {
            serviceId: new mongoose.Types.ObjectId(),
            serviceName: 'Nhổ răng khôn',
            serviceType: 'treatment',
            serviceAddOnId: 'addon-003',
            serviceAddOnName: 'Nhổ răng khôn độ khó 2',
            serviceAddOnUnit: 'Răng',
            price: 1500000,
            quantity: 1,
            totalPrice: 1500000,
            notes: 'Răng số 8'
          }
        ],
        status: 'completed'
      };
    }
    
    return null;
  }
}

async function testStripeInvoiceCreation() {
  try {
    console.log('🟣 Starting Stripe Invoice Creation Test...\n');

    // Connect to MongoDB
    console.log('📡 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://admin:password123@localhost:27017/dental_clinic_invoice?authSource=admin');
    console.log('✅ MongoDB connected\n');

    // Mock RPC client
    invoiceService.rpcClient = new MockRPCClient();

    // Mock Stripe payment (giống real case từ payment-service)
    const mockPayment = {
      _id: new mongoose.Types.ObjectId(),
      paymentCode: 'STRIPE-TEST-001',
      recordId: new mongoose.Types.ObjectId(),
      appointmentId: new mongoose.Types.ObjectId(),
      patientId: new mongoose.Types.ObjectId(),
      type: 'payment',
      method: 'stripe',
      status: 'completed',
      originalAmount: 2000000,  // 🔥 Tổng tiền gốc (500k main + 1.5M additional)
      depositAmount: 200000,    // 🔥 Đã cọc 200k (từ lần trước)
      discountAmount: 0,        // Không có discount thực sự
      taxAmount: 0,
      finalAmount: 1800000,     // 🔥 Còn phải trả: 2M - 200k = 1.8M
      paidAmount: 1800000,      // 🔥 Số tiền khách trả qua Stripe
      amount: 1800000,
      paymentMethod: 'stripe',
      externalTransactionId: 'pi_stripe_20251129001',
      processedBy: new mongoose.Types.ObjectId(),
      processedByName: 'Stripe Gateway',
      completedAt: new Date(),
      gatewayResponse: {
        responseCode: '00',
        responseMessage: 'Success',
        transactionId: 'pi_stripe_20251129001',
        additionalData: {
          sessionId: 'cs_test_123',
          paymentIntentId: 'pi_stripe_20251129001',
          paymentStatus: 'paid'
        }
      }
    };

    console.log('💳 Mock Stripe Payment:', {
      paymentCode: mockPayment.paymentCode,
      method: mockPayment.method,
      recordId: mockPayment.recordId.toString(),
      originalAmount: mockPayment.originalAmount.toLocaleString('vi-VN') + ' VNĐ (Total service cost)',
      depositAmount: mockPayment.depositAmount.toLocaleString('vi-VN') + ' VNĐ (Previously paid deposit)',
      finalAmount: mockPayment.finalAmount.toLocaleString('vi-VN') + ' VNĐ (Remaining to pay)',
      paidAmount: mockPayment.paidAmount.toLocaleString('vi-VN') + ' VNĐ (Paid via Stripe)',
      status: mockPayment.status,
      note: '⚠️ Main service: serviceAddOnPrice = 500k (NOT servicePrice = 200k)'
    });
    console.log('\n');

    // Create invoice from payment
    console.log('📝 Creating invoice from Stripe payment...\n');
    const invoice = await invoiceService.createInvoiceFromPayment(mockPayment);

    console.log('\n✅ Invoice created successfully!');
    console.log('📄 Invoice ID:', invoice._id.toString());
    console.log('📄 Invoice Number:', invoice.invoiceNumber);
    console.log('💰 Invoice Total Amount:', invoice.totalAmount.toLocaleString('vi-VN'), 'VNĐ');
    console.log('\n');

    // Get invoice with details
    console.log('🔍 Fetching invoice details...\n');
    const invoiceWithDetails = await invoiceService.getInvoiceById(invoice._id, false);

    console.log('📦 Invoice Details:');
    console.log('==========================================');
    
    if (invoiceWithDetails.details && invoiceWithDetails.details.length > 0) {
      invoiceWithDetails.details.forEach((detail, index) => {
        console.log(`\n${index + 1}. ${detail.serviceInfo.name}`);
        if (detail.serviceInfo.description) {
          console.log(`   Description: ${detail.serviceInfo.description}`);
        }
        console.log(`   Unit Price: ${detail.unitPrice.toLocaleString('vi-VN')} VNĐ`);
        console.log(`   Quantity: ${detail.quantity}`);
        console.log(`   Discount: ${detail.discountAmount.toLocaleString('vi-VN')} VNĐ`);
        console.log(`   Total Price: ${detail.totalPrice.toLocaleString('vi-VN')} VNĐ`);
        if (detail.notes) {
          console.log(`   Notes: ${detail.notes}`);
        }
      });
      
      console.log('==========================================\n');

      // 🔥 CRITICAL TEST: Verify main service unitPrice is ORIGINAL (500k), not after deposit (300k)
      console.log('🧪 CRITICAL TEST: Main Service Pricing');
      console.log('==========================================');
      const mainService = invoiceWithDetails.details[0]; // First service is main service
      
      const expectedUnitPrice = 500000; // serviceAddOnPrice
      const expectedDiscount = 200000;  // depositAmount
      const expectedTotalPrice = 300000; // 500k - 200k
      
      console.log('Expected:');
      console.log(`  - Unit Price: ${expectedUnitPrice.toLocaleString('vi-VN')} VNĐ (serviceAddOnPrice)`);
      console.log(`  - Discount: ${expectedDiscount.toLocaleString('vi-VN')} VNĐ (deposit)`);
      console.log(`  - Total Price: ${expectedTotalPrice.toLocaleString('vi-VN')} VNĐ`);
      console.log('');
      console.log('Actual:');
      console.log(`  - Unit Price: ${mainService.unitPrice.toLocaleString('vi-VN')} VNĐ`);
      console.log(`  - Discount: ${mainService.discountAmount.toLocaleString('vi-VN')} VNĐ`);
      console.log(`  - Total Price: ${mainService.totalPrice.toLocaleString('vi-VN')} VNĐ`);
      console.log('');
      
      // Verify unit price is ORIGINAL (500k), NOT after deposit (300k)
      if (mainService.unitPrice === expectedUnitPrice) {
        console.log('✅ PASS: Main service unitPrice is ORIGINAL price (500k)');
      } else {
        console.log('❌ FAIL: Main service unitPrice is WRONG!');
        console.log(`   Expected: ${expectedUnitPrice.toLocaleString('vi-VN')} VNĐ (serviceAddOnPrice)`);
        console.log(`   Got: ${mainService.unitPrice.toLocaleString('vi-VN')} VNĐ`);
        if (mainService.unitPrice === 300000) {
          console.log('   ⚠️ ERROR: Using price AFTER deposit instead of ORIGINAL price!');
        } else if (mainService.unitPrice === 200000) {
          console.log('   ⚠️ ERROR: Using servicePrice instead of serviceAddOnPrice!');
        }
      }
      
      // Verify discount is deposit amount
      if (mainService.discountAmount === expectedDiscount) {
        console.log('✅ PASS: Main service discount is deposit amount (200k)');
      } else {
        console.log('❌ FAIL: Main service discount is WRONG!');
        console.log(`   Expected: ${expectedDiscount.toLocaleString('vi-VN')} VNĐ`);
        console.log(`   Got: ${mainService.discountAmount.toLocaleString('vi-VN')} VNĐ`);
      }
      
      // Verify total price after discount
      if (mainService.totalPrice === expectedTotalPrice) {
        console.log('✅ PASS: Main service totalPrice is correct (500k - 200k = 300k)');
      } else {
        console.log('❌ FAIL: Main service totalPrice is WRONG!');
        console.log(`   Expected: ${expectedTotalPrice.toLocaleString('vi-VN')} VNĐ`);
        console.log(`   Got: ${mainService.totalPrice.toLocaleString('vi-VN')} VNĐ`);
      }
      
      console.log('==========================================\n');
      
      // Verify invoice amounts
      console.log('💰 Invoice Amount Verification:');
      const expectedSubtotal = 2000000; // 500k + 1.5M (original prices)
      const expectedTotal = 1800000;    // 2M - 200k deposit
      
      if (invoiceWithDetails.subtotal === expectedSubtotal) {
        console.log(`✅ PASS: Subtotal is ${expectedSubtotal.toLocaleString('vi-VN')} VNĐ (original total)`);
      } else {
        console.log(`❌ FAIL: Subtotal mismatch! Expected ${expectedSubtotal.toLocaleString('vi-VN')}, got ${invoiceWithDetails.subtotal.toLocaleString('vi-VN')}`);
      }
      
      if (invoiceWithDetails.totalAmount === expectedTotal) {
        console.log(`✅ PASS: TotalAmount is ${expectedTotal.toLocaleString('vi-VN')} VNĐ (after deposit)`);
      } else {
        console.log(`❌ FAIL: TotalAmount mismatch! Expected ${expectedTotal.toLocaleString('vi-VN')}, got ${invoiceWithDetails.totalAmount.toLocaleString('vi-VN')}`);
      }
      
    } else {
      console.log('❌ FAIL: No invoice details found!');
    }

    console.log('\n🎉 Stripe Test completed!');

  } catch (error) {
    console.error('\n❌ Test failed with error:');
    console.error(error.message);
    console.error(error.stack);
  } finally {
    await mongoose.connection.close();
    console.log('\n📡 MongoDB connection closed');
    process.exit(0);
  }
}

// Run test
testStripeInvoiceCreation();
