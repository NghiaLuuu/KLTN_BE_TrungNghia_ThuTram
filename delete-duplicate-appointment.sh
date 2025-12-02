#!/bin/bash

# Script để xóa appointment bị duplicate
# Chạy trên VPS

echo "🔍 Tìm và xóa appointment AP000001-03122025"
echo "=========================================="

# 1. Vào MongoDB container
docker exec -it dental_mongodb mongosh -u admin -p password123 --authenticationDatabase admin

# 2. Sau khi vào mongosh, chạy các lệnh sau:
# use dental_clinic_appointment
# db.appointments.find({ appointmentCode: "AP000001-03122025" })
# db.appointments.deleteOne({ appointmentCode: "AP000001-03122025" })
