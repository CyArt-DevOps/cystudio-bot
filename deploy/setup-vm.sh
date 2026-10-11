#!/usr/bin/env bash
# One-time VM setup for Studio Bot on a Debian/Ubuntu GCE instance.
# Usage (on the VM, from the folder containing studio-bot.zip):
#   bash setup-vm.sh
set -euo pipefail

APP_DIR=/opt/studio-bot
BOT_USER=studiobot

# Node.js 22 LTS (bot needs >= 20.11 for import.meta.dirname)
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  sudo apt-get update
  sudo apt-get install -y curl unzip ca-certificates
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
command -v unzip >/dev/null || sudo apt-get install -y unzip

# Dedicated non-login user
id "$BOT_USER" >/dev/null 2>&1 || sudo useradd --system --create-home --shell /usr/sbin/nologin "$BOT_USER"

# Unpack app (keeps existing data/ and .env on re-deploy)
sudo mkdir -p "$APP_DIR"
sudo unzip -o studio-bot.zip -d "$APP_DIR" \
  $( [ -f "$APP_DIR/data/xp.json" ] && echo "-x data/*" ) \
  $( [ -f "$APP_DIR/.env" ] && echo "-x .env" )
sudo chown -R "$BOT_USER:$BOT_USER" "$APP_DIR"
sudo chmod 600 "$APP_DIR/.env"

cd "$APP_DIR"
sudo -u "$BOT_USER" npm ci --omit=dev

# systemd service
sudo cp "$APP_DIR/deploy/studio-bot.service" /etc/systemd/system/studio-bot.service
sudo systemctl daemon-reload
sudo systemctl enable --now studio-bot
sudo systemctl restart studio-bot
sleep 3
sudo systemctl --no-pager status studio-bot | head -15
echo "Logs: sudo journalctl -u studio-bot -f"
