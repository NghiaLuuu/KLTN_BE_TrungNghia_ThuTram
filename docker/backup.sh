#!/bin/bash

# Production Backup Script for Dental Clinic System
# Usage: ./backup.sh [backup_type]
# backup_type: daily, weekly, monthly (default: daily)

set -e

# Configuration
BACKUP_TYPE="${1:-daily}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_DIR="/backup/dental-clinic"
DOCKER_COMPOSE_PATH="/path/to/your/docker-compose.yml"

# MongoDB Settings
MONGO_CONTAINER="dental_mongodb"
MONGO_DB="dental_clinic_db"

# Redis Settings
REDIS_CONTAINER="dental_redis"

# Backup retention (days)
DAILY_RETENTION=7
WEEKLY_RETENTION=30
MONTHLY_RETENTION=365

echo "=== Starting $BACKUP_TYPE backup at $(date) ==="

# Create backup directory
mkdir -p "$BACKUP_DIR/$BACKUP_TYPE"

# 1. MongoDB Backup
echo "Backing up MongoDB..."
docker exec $MONGO_CONTAINER mongodump \
  --db $MONGO_DB \
  --out /tmp/backup_$TIMESTAMP

# Copy backup from container
docker cp $MONGO_CONTAINER:/tmp/backup_$TIMESTAMP "$BACKUP_DIR/$BACKUP_TYPE/mongodb_$TIMESTAMP"

# Cleanup container backup
docker exec $MONGO_CONTAINER rm -rf /tmp/backup_$TIMESTAMP

# 2. Redis Backup
echo "Backing up Redis..."
docker exec $REDIS_CONTAINER redis-cli BGSAVE
sleep 5  # Wait for background save to complete

# Copy Redis dump
docker cp $REDIS_CONTAINER:/data/dump.rdb "$BACKUP_DIR/$BACKUP_TYPE/redis_dump_$TIMESTAMP.rdb"

# 3. Application Configuration Backup
echo "Backing up application configurations..."
tar -czf "$BACKUP_DIR/$BACKUP_TYPE/config_$TIMESTAMP.tar.gz" \
  -C "$(dirname $DOCKER_COMPOSE_PATH)" \
  docker-compose.yml \
  docker-compose.prod.yml \
  .env \
  nginx/nginx.conf \
  docker/ || true

# 4. Volume Backup (if using named volumes)
echo "Backing up Docker volumes..."
docker run --rm -v dental-clinic_mongodb_data:/data -v "$BACKUP_DIR/$BACKUP_TYPE":/backup \
  alpine tar czf /backup/volumes_mongodb_$TIMESTAMP.tar.gz -C /data .

docker run --rm -v dental-clinic_redis_data:/data -v "$BACKUP_DIR/$BACKUP_TYPE":/backup \
  alpine tar czf /backup/volumes_redis_$TIMESTAMP.tar.gz -C /data .

# 5. Create backup summary
cat > "$BACKUP_DIR/$BACKUP_TYPE/backup_summary_$TIMESTAMP.txt" << EOF
Backup Summary
==============
Timestamp: $(date)
Type: $BACKUP_TYPE
MongoDB: mongodb_$TIMESTAMP/
Redis: redis_dump_$TIMESTAMP.rdb
Config: config_$TIMESTAMP.tar.gz
Volumes: volumes_*_$TIMESTAMP.tar.gz

To restore:
1. Stop all services: docker-compose down
2. Restore MongoDB: mongorestore --db $MONGO_DB mongodb_$TIMESTAMP/$MONGO_DB/
3. Restore Redis: cp redis_dump_$TIMESTAMP.rdb /path/to/redis/dump.rdb
4. Restore Config: tar -xzf config_$TIMESTAMP.tar.gz
5. Restore Volumes: tar -xzf volumes_*_$TIMESTAMP.tar.gz to appropriate locations
6. Start services: docker-compose up -d
EOF

# 6. Cleanup old backups based on retention policy
case $BACKUP_TYPE in
  "daily")
    RETENTION=$DAILY_RETENTION
    ;;
  "weekly")
    RETENTION=$WEEKLY_RETENTION
    ;;
  "monthly")
    RETENTION=$MONTHLY_RETENTION
    ;;
esac

echo "Cleaning up backups older than $RETENTION days..."
find "$BACKUP_DIR/$BACKUP_TYPE" -type f -mtime +$RETENTION -delete || true

# 7. Compress backup directory
cd "$BACKUP_DIR/$BACKUP_TYPE"
tar -czf "dental_backup_${BACKUP_TYPE}_${TIMESTAMP}.tar.gz" \
  mongodb_$TIMESTAMP/ \
  redis_dump_$TIMESTAMP.rdb \
  config_$TIMESTAMP.tar.gz \
  volumes_*_$TIMESTAMP.tar.gz \
  backup_summary_$TIMESTAMP.txt

# Remove individual files after compression
rm -rf mongodb_$TIMESTAMP/ \
  redis_dump_$TIMESTAMP.rdb \
  config_$TIMESTAMP.tar.gz \
  volumes_*_$TIMESTAMP.tar.gz \
  backup_summary_$TIMESTAMP.txt

echo "=== Backup completed successfully ==="
echo "Backup file: $BACKUP_DIR/$BACKUP_TYPE/dental_backup_${BACKUP_TYPE}_${TIMESTAMP}.tar.gz"

# Optional: Upload to cloud storage (uncomment and configure)
# aws s3 cp "$BACKUP_DIR/$BACKUP_TYPE/dental_backup_${BACKUP_TYPE}_${TIMESTAMP}.tar.gz" \
#   s3://your-backup-bucket/dental-clinic/

# Send notification (uncomment and configure)
# curl -X POST -H 'Content-type: application/json' \
#   --data "{\"text\":\"Dental Clinic $BACKUP_TYPE backup completed successfully\"}" \
#   YOUR_SLACK_WEBHOOK_URL