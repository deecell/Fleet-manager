#!/bin/bash
set -e

DB_URL="postgresql://deecell_admin:yDuUAs2pv4y12kS3@deecell-fleet-production-postgres.cn4qsw8g8yyx.us-east-2.rds.amazonaws.com:5432/deecell_fleet"

cat > /etc/systemd/system/device-manager.service << SVCEOF
[Unit]
Description=Deecell Fleet Device Manager
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/device-manager
Environment=NODE_ENV=production
Environment=PORT=3001
Environment="DATABASE_URL=${DB_URL}"
Environment=ENABLE_POLLING=true
Environment=ENABLE_BACKFILL=true
Environment=PGSSLMODE=no-verify
Environment=NODE_TLS_REJECT_UNAUTHORIZED=0
ExecStart=/usr/bin/node app/index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SVCEOF

systemctl daemon-reload
systemctl restart device-manager
sleep 3
systemctl status device-manager --no-pager
echo "Service restarted"
