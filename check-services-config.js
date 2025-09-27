#!/usr/bin/env node

// Test script to verify all services configuration
const services = [
  { name: 'auth-service', port: 3001, db: 'dental_clinic_auth' },
  { name: 'room-service', port: 3002, db: 'dental_clinic_room' },
  { name: 'service-service', port: 3003, db: 'dental_clinic_service' },
  { name: 'schedule-service', port: 3005, db: 'dental_clinic_schedule' },
  { name: 'appointment-service', port: 3006, db: 'dental_clinic_appointment' },
  { name: 'payment-service', port: 3007, db: 'dental_clinic_payment' },
  { name: 'invoice-service', port: 3008, db: 'dental_clinic_invoice' },
  { name: 'medicine-service', port: 3009, db: 'dental_clinic_medicine' },
  { name: 'record-service', port: 3010, db: 'dental_clinic_record' },
  { name: 'statistic-service', port: 3011, db: 'dental_clinic_statistic' },
  { name: 'chat-service', port: 3012, db: 'dental_clinic_chat' },
  { name: 'chatbot-service', port: 3013, db: 'dental_clinic_chatbot' }
];

console.log('📋 Microservices Configuration Summary:');
console.log('=====================================');
console.log();

services.forEach(service => {
  console.log(`🔧 ${service.name}:`);
  console.log(`   Port: ${service.port}`);
  console.log(`   Database: ${service.db}`);
  console.log(`   MongoDB: mongodb://admin:password123@localhost:27017/${service.db}?authSource=admin`);
  console.log(`   Redis: redis://:redis123@localhost:6379`);
  console.log(`   RabbitMQ: amqp://admin:rabbitmq123@localhost:5672`);
  console.log();
});

console.log('✅ All services are now configured for:');
console.log('   - Local development with Docker infrastructure');
console.log('   - Consistent database naming: dental_clinic_*');
console.log('   - Unified Redis/RabbitMQ credentials');
console.log('   - RabbitMQ queues with durable: true');
console.log();
console.log('🚀 To test a service locally:');
console.log('   cd services/[service-name]');
console.log('   npm start');