/**
 * Test script: Create invoice from payment with record services
 * 
 * This script tests the full flow:
 * 1. Mock a payment with recordId
 * 2. Mock a record with additionalServices
 * 3. Call createInvoiceFromPayment
 * 4. Verify invoice details are created correctly with proper prices
 */

require('dotenv').config();
const mongoose = require('mongoose');
const invoiceService = require('./src/services/invoice.service');

// Mock RPC Client
class MockRPCClient {
  async call(service, action, params) {
    console.log(`📞 [Mock RPC] ${service}.${action}`, params);
    
    if (service === 'appointment-service' && action === 'getAppointmentById') {
      // Mock appointment
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
      // Mock record with MAIN service + additionalServices
      return {
        _id: params.id,
        recordCode: 'REC-TEST-001',
        patientId: new mongoose.Types.ObjectId(),
        appointmentId: new mongoose.Types.ObjectId(),
        type: 'treatment',
        // ⭐ MAIN SERVICE (dịch vụ chính)
        serviceId: new mongoose.Types.ObjectId(),
        serviceName: 'Nhổ răng khôn',
        serviceAddOnId: 'addon-main',
        serviceAddOnName: 'Răng số 8',
        serviceAddOnUnit: 'Răng',
        servicePrice: 800000, // Giá cơ bản
        serviceAddOnPrice: 2000000, // Giá addon (giá thực tế tính)
        quantity: 1,
        totalCost: 5500000,
        // ⭐ ADDITIONAL SERVICES (dịch vụ bổ sung)
        additionalServices: [
          {
            serviceId: new mongoose.Types.ObjectId(),
            serviceName: 'Hàn răng',
            serviceType: 'treatment',
            serviceAddOnId: 'addon-001',
            serviceAddOnName: 'Răng số 1',
            serviceAddOnUnit: 'Răng',
            price: 500000, // Unit price
            quantity: 2,
            totalPrice: 1000000, // 500k x 2
            notes: 'Hàn composite'
          },
          {
            serviceId: new mongoose.Types.ObjectId(),
            serviceName: 'Điều trị tủy',
            serviceType: 'treatment',
            serviceAddOnId: 'addon-002',
            serviceAddOnName: 'Răng số 6',
            serviceAddOnUnit: 'Răng',
            price: 1500000, // Unit price
            quantity: 1,
            totalPrice: 1500000,
            notes: 'Điều trị tủy răng hàm'
          },
          {
            serviceId: new mongoose.Types.ObjectId(),
            serviceName: 'Vệ sinh răng miệng',
            serviceType: 'exam',
            price: 300000,
            quantity: 1,
            totalPrice: 300000,
            notes: 'Vệ sinh toàn bộ'
          },
          {
            serviceId: new mongoose.Types.ObjectId(),
            serviceName: 'Làm răng sứ',
            serviceType: 'treatment',
            serviceAddOnId: 'addon-003',
            serviceAddOnName: 'Răng số 7',
            serviceAddOnUnit: 'Cái',
            price: 2700000, // Unit price
            quantity: 1,
            totalPrice: 2700000,
            notes: 'Răng sứ Titan'
          }
        ],
        status: 'completed'
      };
    }
    
    return null;
  }
}

async function testInvoiceCreation() {
  try {
    console.log('🚀 Starting invoice creation test...\n');

    // Connect to MongoDB
    console.log('📡 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://admin:password123@localhost:27017/dental_clinic_invoice?authSource=admin');
    console.log('✅ MongoDB connected\n');

    // Mock RPC client
    invoiceService.rpcClient = new MockRPCClient();

    // Mock payment data (giống real case: đã cọc 300k, còn phải trả 1.2M)
    const mockPayment = {
      _id: new mongoose.Types.ObjectId(),
      paymentCode: 'PAY-TEST-001',
      recordId: new mongoose.Types.ObjectId(),
      appointmentId: new mongoose.Types.ObjectId(),
      patientId: new mongoose.Types.ObjectId(),
      type: 'payment',
      method: 'cash',
      status: 'completed',
      originalAmount: 7500000, // 🔥 Tổng tiền dịch vụ gốc (2M + 1M + 1.5M + 300k + 2.7M)
      depositAmount: 300000,   // 🔥 Đã cọc 300k
      finalAmount: 7200000,    // 🔥 Còn phải trả: 7.5M - 300k = 7.2M
      paidAmount: 7200000,     // 🔥 Số tiền khách trả lần này
      amount: 7200000,         // 🔥 Fallback (dùng cho logic cũ)
      paymentMethod: 'cash',
      processedBy: new mongoose.Types.ObjectId(),
      processedByName: 'BS. Nguyễn Văn Test',
      completedAt: new Date()
    };

    console.log('💳 Mock Payment:', {
      paymentCode: mockPayment.paymentCode,
      recordId: mockPayment.recordId.toString(),
      originalAmount: mockPayment.originalAmount.toLocaleString('vi-VN') + ' VNĐ',
      depositAmount: mockPayment.depositAmount.toLocaleString('vi-VN') + ' VNĐ',
      finalAmount: mockPayment.finalAmount.toLocaleString('vi-VN') + ' VNĐ',
      paidAmount: mockPayment.paidAmount.toLocaleString('vi-VN') + ' VNĐ',
      status: mockPayment.status,
      note: 'Total: 7.5M (1 main: 2M + 4 additional: 5.5M), Deposit: 300k, Remaining: 7.2M'
    });
    console.log('\n');

    // Create invoice from payment
    console.log('📝 Creating invoice from payment...\n');
    const invoice = await invoiceService.createInvoiceFromPayment(mockPayment);

    console.log('\n✅ Invoice created successfully!');
    console.log('📄 Invoice ID:', invoice._id.toString());
    console.log('📄 Invoice Number:', invoice.invoiceNumber);
    console.log('💰 Total Amount:', invoice.totalAmount.toLocaleString('vi-VN'), 'VNĐ');
    console.log('\n');

    // Get invoice with details
    console.log('🔍 Fetching invoice details...\n');
    const invoiceWithDetails = await invoiceService.getInvoiceById(invoice._id, false);

    console.log('📦 Invoice Details:');
    console.log('==========================================');
    
    if (invoiceWithDetails.details && invoiceWithDetails.details.length > 0) {
      let calculatedTotal = 0;
      
      invoiceWithDetails.details.forEach((detail, index) => {
        console.log(`\n${index + 1}. ${detail.serviceInfo.name}`);
        console.log(`   Service Type: ${detail.serviceInfo.type}`);
        if (detail.serviceInfo.description) {
          console.log(`   Description: ${detail.serviceInfo.description}`);
        }
        if (detail.serviceInfo.unit) {
          console.log(`   Unit: ${detail.serviceInfo.unit}`);
        }
        console.log(`   Unit Price: ${detail.unitPrice.toLocaleString('vi-VN')} VNĐ`);
        console.log(`   Quantity: ${detail.quantity}`);
        console.log(`   Subtotal: ${detail.subtotal.toLocaleString('vi-VN')} VNĐ`);
        console.log(`   Total Price: ${detail.totalPrice.toLocaleString('vi-VN')} VNĐ`);
        if (detail.notes) {
          console.log(`   Notes: ${detail.notes}`);
        }
        
        calculatedTotal += detail.totalPrice;
      });
      
      console.log('==========================================');
      console.log(`📊 Total from details: ${calculatedTotal.toLocaleString('vi-VN')} VNĐ`);
      console.log(`💰 Invoice subtotal: ${invoiceWithDetails.subtotal.toLocaleString('vi-VN')} VNĐ`);
      console.log(`💰 Invoice totalAmount: ${invoiceWithDetails.totalAmount.toLocaleString('vi-VN')} VNĐ (after deposit)`);
      
      // Verify totals match
      if (calculatedTotal === invoiceWithDetails.subtotal) {
        console.log('✅ PASS: Details total matches subtotal!');
      } else {
        console.log('❌ FAIL: Details total mismatch with subtotal!');
        console.log(`   Expected: ${calculatedTotal.toLocaleString('vi-VN')} VNĐ`);
        console.log(`   Got: ${invoiceWithDetails.subtotal.toLocaleString('vi-VN')} VNĐ`);
      }
      
      // Verify deposit deduction
      const expectedDeposit = 300000;
      const actualDeposit = invoiceWithDetails.subtotal - invoiceWithDetails.totalAmount;
      if (actualDeposit === expectedDeposit) {
        console.log(`✅ PASS: Deposit correctly applied (${expectedDeposit.toLocaleString('vi-VN')} VNĐ)`);
      } else {
        console.log(`❌ FAIL: Deposit mismatch!`);
        console.log(`   Expected deposit: ${expectedDeposit.toLocaleString('vi-VN')} VNĐ`);
        console.log(`   Actual deposit: ${actualDeposit.toLocaleString('vi-VN')} VNĐ`);
      }
      
      // Verify all services are included (1 main + 4 additional)
      console.log('\n📋 Service Verification:');
      const expectedServices = 5; // 1 main + 4 additional
      if (invoiceWithDetails.details.length === expectedServices) {
        console.log(`✅ PASS: All ${expectedServices} services included (1 main + 4 additional)`);
      } else {
        console.log(`❌ FAIL: Expected ${expectedServices} services, got ${invoiceWithDetails.details.length}`);
      }
      
      // Verify prices (main service first, then additional)
      console.log('\n💵 Price Verification:');
      const expectedPrices = [2000000, 1000000, 1500000, 300000, 2700000]; // Main + 4 additional
      const actualPrices = invoiceWithDetails.details.map(d => d.totalPrice);
      
      let pricesMatch = true;
      expectedPrices.forEach((expected, idx) => {
        const actual = actualPrices[idx];
        if (actual === expected) {
          console.log(`   ✅ Service ${idx + 1}: ${expected.toLocaleString('vi-VN')} VNĐ`);
        } else {
          console.log(`   ❌ Service ${idx + 1}: Expected ${expected.toLocaleString('vi-VN')}, got ${actual.toLocaleString('vi-VN')}`);
          pricesMatch = false;
        }
      });
      
      if (pricesMatch) {
        console.log('✅ PASS: All prices match expected values!');
      } else {
        console.log('❌ FAIL: Some prices do not match!');
      }
      
    } else {
      console.log('❌ FAIL: No invoice details found!');
    }

    console.log('\n🎉 Test completed!');

  } catch (error) {
    console.error('\n❌ Test failed with error:');
    console.error(error.message);
    console.error(error.stack);
  } finally {
    // Cleanup: Close MongoDB connection
    await mongoose.connection.close();
    console.log('\n📡 MongoDB connection closed');
    process.exit(0);
  }
}

// Run test
testInvoiceCreation();
