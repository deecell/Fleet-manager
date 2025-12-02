#!/bin/bash
set -e
cd /opt/device-manager
sudo -u ubuntu /usr/bin/npm install --ignore-scripts --production
echo "Dependencies installed successfully"
