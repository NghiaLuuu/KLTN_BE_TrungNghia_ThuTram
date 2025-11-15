#!/bin/bash
# Script tự động cài đặt và cấu hình Nginx

echo "🔧 Setting up Nginx reverse proxy..."

# Copy nginx config
sudo cp /root/dental-clinic/nginx/dental-clinic.conf /etc/nginx/sites-available/dental-clinic

# Enable site
sudo ln -sf /etc/nginx/sites-available/dental-clinic /etc/nginx/sites-enabled/

# Remove default site if exists
sudo rm -f /etc/nginx/sites-enabled/default

# Test nginx config
if sudo nginx -t; then
    echo "✅ Nginx configuration is valid"
    sudo systemctl reload nginx
    echo "✅ Nginx reloaded successfully"
else
    echo "❌ Nginx configuration error"
    exit 1
fi

echo "✅ Nginx setup completed!"
