# Dental Clinic Microservices - Docker Management
.PHONY: help build up down restart logs clean prune health status infrastructure services all

# Default target
help: ## Show this help message
	@echo "🦷 Dental Clinic Microservices - Docker Management"
	@echo ""
	@echo "Available commands:"
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# Infrastructure services only
infrastructure: ## Start only infrastructure services (MongoDB, Redis, RabbitMQ)
	@echo "🚀 Starting infrastructure services..."
	docker-compose up -d mongodb redis rabbitmq
	@echo "✅ Infrastructure services started!"
	@echo "📊 Access URLs:"
	@echo "  - MongoDB: mongodb://localhost:27017"
	@echo "  - Redis: redis://localhost:6379"
	@echo "  - RabbitMQ Management: http://localhost:15672 (admin/rabbitmq123)"

# Build all services
build: ## Build all Docker images
	@echo "🔨 Building all services..."
	docker-compose build --parallel
	@echo "✅ All services built successfully!"

# Start all services
up: ## Start all services
	@echo "🚀 Starting all services..."
	docker-compose up -d
	@echo "✅ All services started!"
	@make status

# Start all services with logs
up-logs: ## Start all services and show logs
	@echo "🚀 Starting all services with logs..."
	docker-compose up

# Stop all services
down: ## Stop all services
	@echo "🛑 Stopping all services..."
	docker-compose down
	@echo "✅ All services stopped!"

# Restart all services
restart: ## Restart all services
	@echo "🔄 Restarting all services..."
	docker-compose restart
	@echo "✅ All services restarted!"

# Show logs
logs: ## Show logs for all services
	docker-compose logs -f

# Show logs for specific service
logs-%: ## Show logs for specific service (e.g., make logs-auth-service)
	docker-compose logs -f $*

# Health check
health: ## Check health of all services
	@echo "🩺 Checking service health..."
	@docker-compose ps
	@echo ""
	@echo "🔍 Testing service endpoints..."
	@curl -s http://localhost:3001/health > /dev/null && echo "✅ Auth Service (3001)" || echo "❌ Auth Service (3001)"
	@curl -s http://localhost:3002/health > /dev/null && echo "✅ Room Service (3002)" || echo "❌ Room Service (3002)"
	@curl -s http://localhost:3003/health > /dev/null && echo "✅ Service Service (3003)" || echo "❌ Service Service (3003)"
	@curl -s http://localhost:3005/health > /dev/null && echo "✅ Schedule Service (3005)" || echo "❌ Schedule Service (3005)"
	@curl -s http://localhost:3006/health > /dev/null && echo "✅ Appointment Service (3006)" || echo "❌ Appointment Service (3006)"
	@curl -s http://localhost:3007/health > /dev/null && echo "✅ Payment Service (3007)" || echo "❌ Payment Service (3007)"
	@curl -s http://localhost:3008/health > /dev/null && echo "✅ Invoice Service (3008)" || echo "❌ Invoice Service (3008)"
	@curl -s http://localhost:3009/health > /dev/null && echo "✅ Medicine Service (3009)" || echo "❌ Medicine Service (3009)"
	@curl -s http://localhost:3010/health > /dev/null && echo "✅ Record Service (3010)" || echo "❌ Record Service (3010)"
	@curl -s http://localhost:3011/health > /dev/null && echo "✅ Statistic Service (3011)" || echo "❌ Statistic Service (3011)"
	@curl -s http://localhost:3012/health > /dev/null && echo "✅ Chat Service (3012)" || echo "❌ Chat Service (3012)"
	@curl -s http://localhost:3013/health > /dev/null && echo "✅ Chatbot Service (3013)" || echo "❌ Chatbot Service (3013)"

# Show status
status: ## Show running containers status
	@echo "📊 Container Status:"
	@docker-compose ps --format "table {{.Name}}\t{{.State}}\t{{.Ports}}"
	@echo ""
	@echo "🌐 Service URLs:"
	@echo "  - Auth Service: http://localhost:3001"
	@echo "  - Room Service: http://localhost:3002"  
	@echo "  - Service Service: http://localhost:3003"
	@echo "  - Schedule Service: http://localhost:3005"
	@echo "  - Appointment Service: http://localhost:3006"
	@echo "  - Payment Service: http://localhost:3007"
	@echo "  - Invoice Service: http://localhost:3008"
	@echo "  - Medicine Service: http://localhost:3009"
	@echo "  - Record Service: http://localhost:3010"
	@echo "  - Statistic Service: http://localhost:3011"
	@echo "  - Chat Service: http://localhost:3012"
	@echo "  - Chatbot Service: http://localhost:3013"
	@echo ""
	@echo "🔧 Management URLs:"
	@echo "  - RabbitMQ Management: http://localhost:15672"
	@echo "  - MongoDB: mongodb://localhost:27017"
	@echo "  - Redis: redis://localhost:6379"

# Clean unused containers and images
clean: ## Remove stopped containers and unused images
	@echo "🧹 Cleaning up Docker resources..."
	docker-compose down --remove-orphans
	docker system prune -f
	@echo "✅ Cleanup completed!"

# Full cleanup including volumes
clean-all: ## Remove everything including volumes (⚠️  DATA LOSS!)
	@echo "⚠️  WARNING: This will delete all data in volumes!"
	@read -p "Are you sure? (y/N): " confirm && [ "$$confirm" = "y" ]
	docker-compose down -v --remove-orphans
	docker system prune -a -f --volumes
	@echo "✅ Full cleanup completed!"

# Docker system prune
prune: ## Remove unused Docker resources
	@echo "🧹 Pruning unused Docker resources..."
	docker system prune -f
	@echo "✅ Prune completed!"

# Rebuild specific service
rebuild-%: ## Rebuild specific service (e.g., make rebuild-auth-service)
	@echo "🔨 Rebuilding $* service..."
	docker-compose build --no-cache $*
	docker-compose up -d $*
	@echo "✅ $* service rebuilt and restarted!"

# Scale specific service
scale-%: ## Scale service (e.g., make scale-auth-service REPLICAS=3)
	@echo "📈 Scaling $* service to $(REPLICAS) replicas..."
	docker-compose up -d --scale $*=$(REPLICAS) $*
	@echo "✅ $* service scaled to $(REPLICAS) replicas!"

# Database operations
db-backup: ## Backup MongoDB data
	@echo "💾 Backing up MongoDB..."
	docker exec dental_mongodb mongodump --out /tmp/backup --authenticationDatabase admin -u admin -p password123
	docker cp dental_mongodb:/tmp/backup ./backup_$(shell date +%Y%m%d_%H%M%S)
	@echo "✅ Database backup completed!"

# Development helpers
dev: ## Start infrastructure + core services for development
	@echo "🚀 Starting development environment..."
	docker-compose up -d mongodb redis rabbitmq auth-service room-service schedule-service
	@echo "✅ Development environment ready!"

# Production deployment
prod: build up ## Full production deployment (build + start all)
	@echo "🌟 Production deployment completed!"
	@make status

# Quick start for testing
quick: infrastructure ## Quick start with infrastructure only
	@echo "⚡ Quick start completed - infrastructure ready!"
	
# All services startup
all: build up status ## Build, start all services and show status

# Environment check
env-check: ## Check environment configuration
	@echo "🔍 Checking environment configuration..."
	@[ -f .env ] && echo "✅ .env file exists" || echo "❌ .env file missing"
	@docker --version && echo "✅ Docker available" || echo "❌ Docker not found"
	@docker-compose --version && echo "✅ Docker Compose available" || echo "❌ Docker Compose not found"

# Production deployment commands
prod-up: ## Start services in production mode with security
	@echo "🌟 Starting production deployment..."
	@[ -f .env ] || (echo "❌ .env file not found! Please create it first." && exit 1)
	@[ -f nginx/ssl/fullchain.pem ] || (echo "⚠️  SSL certificate not found! Place certificates in nginx/ssl/" && exit 1)
	docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
	@echo "✅ Production services started"
	@echo "📋 Run 'make health-check' to verify all services"

prod-down: ## Stop production services
	@echo "🛑 Stopping production services..."
	docker-compose -f docker-compose.yml -f docker-compose.prod.yml down
	@echo "✅ Production services stopped"

prod-logs: ## Show production logs
	docker-compose -f docker-compose.yml -f docker-compose.prod.yml logs -f

prod-status: ## Show production container status
	@echo "📊 Production Container Status:"
	docker-compose -f docker-compose.yml -f docker-compose.prod.yml ps --format "table {{.Name}}\t{{.State}}\t{{.Ports}}"

prod-restart: ## Restart production services
	@echo "🔄 Restarting production services..."
	docker-compose -f docker-compose.yml -f docker-compose.prod.yml restart
	@echo "✅ Production services restarted"

# Advanced health monitoring
health-check: ## Detailed health monitoring with logging
	@echo "🩺 Running detailed health check..."
	@[ -f health-check.sh ] && (chmod +x health-check.sh && ./health-check.sh --detailed) || echo "❌ health-check.sh not found"

health-alert: ## Health check with alert notifications
	@echo "🚨 Running health check with alerts..."
	@[ -f health-check.sh ] && (chmod +x health-check.sh && ./health-check.sh --detailed --alert) || echo "❌ health-check.sh not found"

# Backup operations
backup-daily: ## Create daily backup
	@echo "💾 Creating daily backup..."
	@[ -f backup.sh ] && (chmod +x backup.sh && ./backup.sh daily) || echo "❌ backup.sh not found"

backup-weekly: ## Create weekly backup
	@echo "💾 Creating weekly backup..."
	@[ -f backup.sh ] && (chmod +x backup.sh && ./backup.sh weekly) || echo "❌ backup.sh not found"

backup-monthly: ## Create monthly backup
	@echo "💾 Creating monthly backup..."
	@[ -f backup.sh ] && (chmod +x backup.sh && ./backup.sh monthly) || echo "❌ backup.sh not found"

# SSL Certificate management
ssl-setup: ## Setup SSL certificates (Let's Encrypt)
	@echo "🔐 Setting up SSL certificates..."
	@echo "⚠️  Make sure to update your domain in nginx/nginx.conf first!"
	@mkdir -p nginx/ssl
	@echo "📋 Run: docker run --rm -v $(PWD)/nginx/ssl:/etc/letsencrypt/live/yourdomain.com certbot/certbot certonly --standalone -d yourdomain.com -d www.yourdomain.com"

ssl-renew: ## Renew SSL certificates
	@echo "🔄 Renewing SSL certificates..."
	docker run --rm -v $(PWD)/nginx/ssl:/etc/letsencrypt certbot/certbot renew

# Security operations
security-audit: ## Run security audit
	@echo "🔒 Running security audit..."
	@echo "📊 Checking for exposed ports..."
	@netstat -tuln | grep -E "(3001|3002|3003|3005|3006|3007|3008|3009|3010|3011|3012|3013|27017|6379|5672|15672)" || echo "No exposed ports found"
	@echo "🔍 Checking Docker security..."
	@docker run --rm -v /var/run/docker.sock:/var/run/docker.sock aquasec/trivy image $(shell docker images --format "{{.Repository}}:{{.Tag}}" | head -1) || echo "Trivy not available"

# Database operations
db-restore: ## Restore MongoDB from backup
	@echo "⚠️  This will restore MongoDB from backup. All current data will be lost!"
	@read -p "Continue? (y/N): " confirm && [ "$$confirm" = "y" ]
	@echo "📁 Available backups:"
	@ls -la backup_* 2>/dev/null || echo "No backups found"
	@read -p "Enter backup directory name: " backup_dir && \
	docker exec dental_mongodb mongorestore --db dental_clinic_db --drop /backup/$$backup_dir

# Monitoring setup
monitoring-setup: ## Setup monitoring stack (Prometheus + Grafana)
	@echo "📊 Setting up monitoring stack..."
	@mkdir -p monitoring/prometheus monitoring/grafana
	@echo "⚠️  Monitoring stack setup requires additional configuration"
	@echo "📋 Please refer to monitoring documentation"

# Network diagnostics
network-check: ## Check inter-service network connectivity
	@echo "🌐 Checking network connectivity..."
	@docker exec dental_auth_service nc -z mongodb 27017 && echo "✅ Auth → MongoDB" || echo "❌ Auth → MongoDB"
	@docker exec dental_payment_service nc -z redis 6379 && echo "✅ Payment → Redis" || echo "❌ Payment → Redis"
	@docker exec dental_schedule_service nc -z rabbitmq 5672 && echo "✅ Schedule → RabbitMQ" || echo "❌ Schedule → RabbitMQ"

# Performance monitoring
perf-monitor: ## Show performance metrics
	@echo "📈 Performance Metrics:"
	@docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}\t{{.BlockIO}}"

# Log management
logs-rotate: ## Rotate and compress logs
	@echo "📜 Rotating logs..."
	@docker-compose logs --no-color > logs/dental-clinic-$(shell date +%Y%m%d).log 2>&1
	@gzip logs/dental-clinic-$(shell date +%Y%m%d).log
	@echo "✅ Logs rotated and compressed"

logs-clean: ## Clean old log files
	@echo "🧹 Cleaning old logs..."
	@find logs/ -name "*.log.gz" -mtime +30 -delete 2>/dev/null || echo "No old logs to clean"
	@echo "✅ Old logs cleaned"
