#!/bin/bash

# Health Check and Monitoring Script for Dental Clinic System
# Usage: ./health-check.sh [--detailed] [--alert]

set -e

DETAILED_MODE=false
ALERT_MODE=false
TIMESTAMP=$(date +"%Y-%m-%d %H:%M:%S")
LOG_FILE="/var/log/dental-clinic/health-check.log"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --detailed)
      DETAILED_MODE=true
      shift
      ;;
    --alert)
      ALERT_MODE=true
      shift
      ;;
    *)
      echo "Usage: $0 [--detailed] [--alert]"
      exit 1
      ;;
  esac
done

# Create log directory
mkdir -p "$(dirname "$LOG_FILE")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo "[$TIMESTAMP] $1" | tee -a "$LOG_FILE"
}

# Status tracking
FAILED_SERVICES=()
ALL_HEALTHY=true

echo "======================================="
echo "Dental Clinic System Health Check"
echo "======================================="
log "Starting health check at $TIMESTAMP"

# 1. Check Docker daemon
echo -n "Docker daemon: "
if docker info >/dev/null 2>&1; then
    echo -e "${GREEN}✓ Running${NC}"
else
    echo -e "${RED}✗ Not running${NC}"
    log "ERROR: Docker daemon not running"
    ALL_HEALTHY=false
fi

# 2. Check infrastructure services
echo
echo "Infrastructure Services:"
echo "-----------------------"

# MongoDB
echo -n "MongoDB: "
if docker exec dental_mongodb mongosh --eval "db.adminCommand('ismaster')" >/dev/null 2>&1; then
    echo -e "${GREEN}✓ Healthy${NC}"
    if [ "$DETAILED_MODE" = true ]; then
        MONGO_STATUS=$(docker exec dental_mongodb mongosh --quiet --eval "
            var status = db.serverStatus();
            print('Connections: ' + status.connections.current + '/' + status.connections.available);
            print('Uptime: ' + Math.floor(status.uptime/3600) + 'h ' + Math.floor((status.uptime%3600)/60) + 'm');
        ")
        echo "    $MONGO_STATUS"
    fi
else
    echo -e "${RED}✗ Failed${NC}"
    FAILED_SERVICES+=("MongoDB")
    ALL_HEALTHY=false
fi

# Redis
echo -n "Redis: "
if docker exec dental_redis redis-cli ping | grep -q "PONG"; then
    echo -e "${GREEN}✓ Healthy${NC}"
    if [ "$DETAILED_MODE" = true ]; then
        REDIS_INFO=$(docker exec dental_redis redis-cli info server | grep "uptime_in_seconds\|redis_version" | head -2)
        echo "    $REDIS_INFO"
    fi
else
    echo -e "${RED}✗ Failed${NC}"
    FAILED_SERVICES+=("Redis")
    ALL_HEALTHY=false
fi

# RabbitMQ
echo -n "RabbitMQ: "
if docker exec dental_rabbitmq rabbitmqctl status >/dev/null 2>&1; then
    echo -e "${GREEN}✓ Healthy${NC}"
    if [ "$DETAILED_MODE" = true ]; then
        RABBIT_STATUS=$(docker exec dental_rabbitmq rabbitmqctl list_queues name messages 2>/dev/null | head -5)
        echo "    Top queues: $RABBIT_STATUS"
    fi
else
    echo -e "${RED}✗ Failed${NC}"
    FAILED_SERVICES+=("RabbitMQ")
    ALL_HEALTHY=false
fi

# 3. Check microservices
echo
echo "Microservices:"
echo "-------------"

SERVICES=(
    "auth-service:3001"
    "room-service:3002"
    "service-service:3003"
    "schedule-service:3005"
    "appointment-service:3006"
    "payment-service:3007"
    "invoice-service:3008"
    "medicine-service:3009"
    "record-service:3010"
    "statistic-service:3011"
    "chat-service:3012"
    "chatbot-service:3013"
)

for service in "${SERVICES[@]}"; do
    SERVICE_NAME=$(echo $service | cut -d: -f1)
    PORT=$(echo $service | cut -d: -f2)
    
    echo -n "$SERVICE_NAME: "
    
    # Check if container is running
    if docker ps --format "table {{.Names}}" | grep -q "dental_${SERVICE_NAME//-/_}"; then
        # Check health endpoint
        if curl -sf "http://localhost:$PORT/health" >/dev/null 2>&1; then
            echo -e "${GREEN}✓ Healthy${NC}"
            if [ "$DETAILED_MODE" = true ]; then
                RESPONSE_TIME=$(curl -w "%{time_total}" -o /dev/null -s "http://localhost:$PORT/health" 2>/dev/null || echo "N/A")
                echo "    Response time: ${RESPONSE_TIME}s"
            fi
        else
            echo -e "${YELLOW}⚠ Container running but health check failed${NC}"
            FAILED_SERVICES+=("$SERVICE_NAME")
            ALL_HEALTHY=false
        fi
    else
        echo -e "${RED}✗ Container not running${NC}"
        FAILED_SERVICES+=("$SERVICE_NAME")
        ALL_HEALTHY=false
    fi
done

# 4. Check Nginx (if running)
echo
echo -n "Nginx Reverse Proxy: "
if docker ps --format "table {{.Names}}" | grep -q "dental_nginx"; then
    if curl -sf "http://localhost/health" >/dev/null 2>&1; then
        echo -e "${GREEN}✓ Healthy${NC}"
    else
        echo -e "${YELLOW}⚠ Container running but not responding${NC}"
        FAILED_SERVICES+=("Nginx")
    fi
else
    echo -e "${YELLOW}⚠ Not configured${NC}"
fi

# 5. System resource check
if [ "$DETAILED_MODE" = true ]; then
    echo
    echo "System Resources:"
    echo "----------------"
    
    # Memory usage
    MEM_USAGE=$(free | grep Mem | awk '{printf "%.1f%%", ($3/$2)*100}')
    echo "Memory usage: $MEM_USAGE"
    
    # Disk usage
    DISK_USAGE=$(df -h / | awk 'NR==2{print $5}')
    echo "Disk usage: $DISK_USAGE"
    
    # CPU load
    CPU_LOAD=$(uptime | awk -F'load average:' '{print $2}')
    echo "CPU load: $CPU_LOAD"
    
    # Docker stats
    echo
    echo "Top 5 containers by memory usage:"
    docker stats --no-stream --format "table {{.Container}}\t{{.MemUsage}}\t{{.CPUPerc}}" | head -6
fi

# 6. Network connectivity check
if [ "$DETAILED_MODE" = true ]; then
    echo
    echo "Network Connectivity:"
    echo "--------------------"
    
    # Check inter-service communication
    echo -n "Auth → MongoDB: "
    if docker exec dental_auth_service nc -z mongodb 27017 2>/dev/null; then
        echo -e "${GREEN}✓${NC}"
    else
        echo -e "${RED}✗${NC}"
    fi
    
    echo -n "Payment → Redis: "
    if docker exec dental_payment_service nc -z redis 6379 2>/dev/null; then
        echo -e "${GREEN}✓${NC}"
    else
        echo -e "${RED}✗${NC}"
    fi
fi

# 7. Summary
echo
echo "======================================="
if [ "$ALL_HEALTHY" = true ]; then
    echo -e "${GREEN}✓ All systems operational${NC}"
    log "Health check passed - all systems operational"
    EXIT_CODE=0
else
    echo -e "${RED}✗ Issues detected with: ${FAILED_SERVICES[*]}${NC}"
    log "Health check failed - issues with: ${FAILED_SERVICES[*]}"
    EXIT_CODE=1
    
    # Send alert if requested
    if [ "$ALERT_MODE" = true ]; then
        # Webhook notification (customize URL)
        curl -X POST -H 'Content-type: application/json' \
            --data "{\"text\":\"🚨 Dental Clinic System Alert: Issues detected with ${FAILED_SERVICES[*]} at $TIMESTAMP\"}" \
            "${WEBHOOK_URL:-http://localhost/webhook}" >/dev/null 2>&1 || true
        
        # Email notification (requires mailutils)
        echo "Health check failed at $TIMESTAMP. Issues with: ${FAILED_SERVICES[*]}" | \
            mail -s "Dental Clinic System Alert" "${ALERT_EMAIL:-admin@yourdomain.com}" 2>/dev/null || true
    fi
fi

echo "Log file: $LOG_FILE"
echo "======================================="

exit $EXIT_CODE