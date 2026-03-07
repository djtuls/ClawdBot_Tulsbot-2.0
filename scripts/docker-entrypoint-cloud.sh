#!/bin/sh
# Bootstrap/merge cloud config for Fly.io and container deployments with OPENCLAW_STATE_DIR=/data.
# - If config missing: copy cloud config.
# - If config exists: merge workspace, channels, and plugins from cloud (fixes /Users paths + overrides plugins).
set -e
DATA_DIR="${OPENCLAW_STATE_DIR:-/data}"
CONFIG_PATH="$DATA_DIR/openclaw.json"
CLOUD_CONFIG="${CLOUD_CONFIG_PATH:-/app/openclaw.cloud.json}"
if [ ! -f "$CLOUD_CONFIG" ]; then
  exec "$@"
fi
if [ ! -f "$CONFIG_PATH" ]; then
  cp "$CLOUD_CONFIG" "$CONFIG_PATH"
  echo "Bootstrap: copied cloud config to $CONFIG_PATH"
else
  # Merge cloud overrides so Mac paths in persisted config don't break cloud.
  # Merges: agents.defaults.workspace, channels (full replace), plugins (full replace).
  CONFIG_PATH="$CONFIG_PATH" CLOUD_CONFIG="$CLOUD_CONFIG" node -e "
    const fs = require('fs');
    const cfgPath = process.env.CONFIG_PATH;
    const cloudPath = process.env.CLOUD_CONFIG;
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    const cloud = JSON.parse(fs.readFileSync(cloudPath, 'utf8'));
    if (cloud.agents?.defaults?.workspace) {
      cfg.agents = cfg.agents || {};
      cfg.agents.defaults = { ...cfg.agents.defaults, workspace: cloud.agents.defaults.workspace };
    }
    if (cloud.gateway !== undefined) {
      cfg.gateway = { ...cfg.gateway, ...cloud.gateway };
      // Remove any keys that openclaw rejects (e.g. future-facing groundwork keys)
      delete cfg.gateway.bridge;
    }
    if (cloud.channels) cfg.channels = { ...cfg.channels, ...cloud.channels };
    if (cloud.plugins !== undefined) {
      cfg.plugins = cfg.plugins || {};
      if (cloud.plugins.slots !== undefined) cfg.plugins.slots = cloud.plugins.slots;
      if (cloud.plugins.load !== undefined) cfg.plugins.load = cloud.plugins.load; else delete cfg.plugins.load;
      cfg.plugins.entries = cloud.plugins.entries || {};
    }
    // Inject telegram webhook secret from env (keeps secret out of config files)
    const webhookSecret = process.env.OPENCLAW_TELEGRAM_WEBHOOK_SECRET;
    if (webhookSecret && cfg.channels?.telegram?.webhookUrl) {
      cfg.channels.telegram.webhookSecret = webhookSecret;
    }
    // Inject telegram bot token from env if not already set
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (botToken && cfg.channels?.telegram && !cfg.channels.telegram.botToken) {
      cfg.channels.telegram.botToken = botToken;
    }
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  " && echo "Bootstrap: merged cloud overrides into $CONFIG_PATH"
fi

# Start Tailscale if auth key is provided.
# --tun=userspace-networking: required in containers (no kernel TUN module).
# --socks5-server / --outbound-http-proxy-listen: expose a local proxy so
#   outbound TCP to 100.x.x.x is routed through the Tailscale tunnel
#   (userspace mode does not inject kernel routes, so a proxy is required).
if [ -n "$TAILSCALE_AUTH_KEY" ]; then
  tailscaled --state=/data/tailscale.state --socket=/var/run/tailscale.sock \
    --tun=userspace-networking \
    --socks5-server=localhost:1055 \
    --outbound-http-proxy-listen=localhost:1055 &
  sleep 2
  tailscale --socket=/var/run/tailscale.sock up \
    --authkey="$TAILSCALE_AUTH_KEY" \
    --hostname="clawdbot-tulsbot" \
    --accept-routes \
    --timeout=15s || echo "[entrypoint] Tailscale auth failed — continuing without Tailscale"
  echo "[entrypoint] Tailscale SOCKS5/HTTP proxy available at localhost:1055"
fi

exec "$@"
