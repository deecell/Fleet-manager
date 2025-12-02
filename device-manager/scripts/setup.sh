#!/bin/bash
set -e

cd /opt/device-manager
/usr/bin/npm ci --ignore-scripts --production 2>&1 | tail -20
echo "Dependencies installed"

cat > /etc/systemd/system/device-manager.service << 'SVCEOF'
[Unit]
Description=Deecell Fleet Device Manager
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/device-manager
Environment=NODE_ENV=production
Environment=PORT=3001
ExecStart=/usr/bin/node app/index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SVCEOF

systemctl daemon-reload
systemctl enable device-manager
echo "Service configured"
