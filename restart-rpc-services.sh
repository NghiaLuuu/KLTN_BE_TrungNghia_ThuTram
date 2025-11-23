#!/bin/bash

# Quick restart script for RPC-related services
echo "🔄 Restarting auth-service and appointment-service..."

cd /root/BE_KLTN_TrungNghia_ThuTram/docker

# Restart only affected services
docker-compose restart auth-service
docker-compose restart appointment-service

echo "⏳ Waiting for services to start..."
sleep 10

echo "📊 Service status:"
docker-compose ps auth-service appointment-service

echo ""
echo "📝 Check logs:"
echo "  docker logs dental_auth_service --tail 50"
echo "  docker logs dental_appointment_service --tail 50"
