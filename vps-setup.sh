#!/bin/bash

# Script setup VPS lần đầu
# Chạy trên VPS: curl -sSL https://raw.githubusercontent.com/YOUR_USERNAME/YOUR_REPO/main/vps-setup.sh | bash

set -e

echo "🚀 Dental Clinic VPS Setup"
echo "========================="

# Màu sắc
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${YELLOW}📦 Updating system...${NC}"
sudo apt update && sudo apt upgrade -y

echo -e "${YELLOW}🐳 Installing Docker...${NC}"
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    sudo usermod -aG docker $USER
    echo -e "${GREEN}✅ Docker installed${NC}"
else
    echo -e "${GREEN}✅ Docker already installed${NC}"
fi

echo -e "${YELLOW}📦 Installing Docker Compose...${NC}"
if ! command -v docker-compose &> /dev/null; then
    sudo curl -L "https://github.com/docker/compose/releases/download/v2.24.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose
    echo -e "${GREEN}✅ Docker Compose installed${NC}"
else
    echo -e "${GREEN}✅ Docker Compose already installed${NC}"
fi

echo -e "${YELLOW}📦 Installing Git...${NC}"
if ! command -v git &> /dev/null; then
    sudo apt install -y git
    echo -e "${GREEN}✅ Git installed${NC}"
else
    echo -e "${GREEN}✅ Git already installed${NC}"
fi

echo -e "${YELLOW}🌐 Installing Nginx...${NC}"
if ! command -v nginx &> /dev/null; then
    sudo apt install -y nginx
    sudo systemctl enable nginx
    echo -e "${GREEN}✅ Nginx installed${NC}"
else
    echo -e "${GREEN}✅ Nginx already installed${NC}"
fi

echo -e "${YELLOW}🔒 Installing Certbot for SSL...${NC}"
if ! command -v certbot &> /dev/null; then
    sudo apt install -y certbot python3-certbot-nginx
    echo -e "${GREEN}✅ Certbot installed${NC}"
else
    echo -e "${GREEN}✅ Certbot already installed${NC}"
fi

echo -e "${YELLOW}🔥 Setting up Firewall (UFW)...${NC}"
if command -v ufw &> /dev/null; then
    sudo ufw allow 22/tcp      # SSH
    sudo ufw allow 80/tcp      # HTTP
    sudo ufw allow 443/tcp     # HTTPS
    echo "y" | sudo ufw enable
    echo -e "${GREEN}✅ Firewall configured${NC}"
fi

echo -e "${YELLOW}🔑 Setting up SSH directory...${NC}"
mkdir -p ~/.ssh
chmod 700 ~/.ssh
touch ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys

echo -e "${YELLOW}📂 Creating project directory...${NC}"
mkdir -p ~/dental-clinic

echo ""
echo -e "${GREEN}✅ VPS Setup Complete!${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Generate SSH key for GitHub Actions:"
echo "   ssh-keygen -t ed25519 -C 'github-actions' -f ~/.ssh/github_actions -N ''"
echo ""
echo "2. Add public key to authorized_keys:"
echo "   cat ~/.ssh/github_actions.pub >> ~/.ssh/authorized_keys"
echo ""
echo "3. Copy private key to GitHub Secrets (SSH_PRIVATE_KEY):"
echo "   cat ~/.ssh/github_actions"
echo ""
echo "4. Clone your repository:"
echo "   cd ~/dental-clinic"
echo "   git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git ."
echo ""
echo "5. Setup environment variables:"
echo "   cd ~/dental-clinic/docker"
echo "   cp .env.example .env"
echo "   nano .env"
echo ""
echo "6. Start services:"
echo "   docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build"
echo ""
echo -e "${GREEN}🎉 Ready to deploy!${NC}"
