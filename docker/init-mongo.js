// Initialize MongoDB databases for each service
db = db.getSiblingDB('dental_clinic_auth');
db.createUser({
  user: 'auth_user',
  pwd: 'auth_password',
  roles: [{ role: 'readWrite', db: 'dental_clinic_auth' }]
});

db = db.getSiblingDB('dental_clinic_room');
db.createUser({
  user: 'room_user',
  pwd: 'room_password',
  roles: [{ role: 'readWrite', db: 'dental_clinic_room' }]
});

db = db.getSiblingDB('dental_clinic_schedule');
db.createUser({
  user: 'schedule_user',
  pwd: 'schedule_password',
  roles: [{ role: 'readWrite', db: 'dental_clinic_schedule' }]
});

db = db.getSiblingDB('dental_clinic_appointment');
db.createUser({
  user: 'appointment_user',
  pwd: 'appointment_password',
  roles: [{ role: 'readWrite', db: 'dental_clinic_appointment' }]
});

db = db.getSiblingDB('dental_clinic_record');
db.createUser({
  user: 'record_user',
  pwd: 'record_password',
  roles: [{ role: 'readWrite', db: 'dental_clinic_record' }]
});

db = db.getSiblingDB('dental_clinic_medicine');
db.createUser({
  user: 'medicine_user',
  pwd: 'medicine_password',
  roles: [{ role: 'readWrite', db: 'dental_clinic_medicine' }]
});

db = db.getSiblingDB('dental_clinic_service');
db.createUser({
  user: 'service_user',
  pwd: 'service_password',
  roles: [{ role: 'readWrite', db: 'dental_clinic_service' }]
});

db = db.getSiblingDB('dental_clinic_invoice');
db.createUser({
  user: 'invoice_user',
  pwd: 'invoice_password',
  roles: [{ role: 'readWrite', db: 'dental_clinic_invoice' }]
});

db = db.getSiblingDB('dental_clinic_payment');
db.createUser({
  user: 'payment_user',
  pwd: 'payment_password',
  roles: [{ role: 'readWrite', db: 'dental_clinic_payment' }]
});

db = db.getSiblingDB('dental_clinic_statistic');
db.createUser({
  user: 'statistic_user',
  pwd: 'statistic_password',
  roles: [{ role: 'readWrite', db: 'dental_clinic_statistic' }]
});

db = db.getSiblingDB('dental_clinic_chat');
db.createUser({
  user: 'chat_user',
  pwd: 'chat_password',
  roles: [{ role: 'readWrite', db: 'dental_clinic_chat' }]
});

db = db.getSiblingDB('dental_clinic_chatbot');
db.createUser({
  user: 'chatbot_user',
  pwd: 'chatbot_password',
  roles: [{ role: 'readWrite', db: 'dental_clinic_chatbot' }]
});

print('✅ All databases and users created successfully!');