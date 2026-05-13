#!/usr/bin/env bash
# Simple Cloudflare Tunnel expose for localhost:20128

set -euo pipefail

TUNNEL_NAME="9router"
HOSTNAME="llm.duyna.online"
LOCAL_URL="http://127.0.0.1:20128"
CONFIG_DIR="$HOME/.cloudflared"
CONFIG_FILE="$CONFIG_DIR/${TUNNEL_NAME}.yml"

# Verify service is running
if ! curl -s "$LOCAL_URL" > /dev/null 2>&1; then
  echo "ERROR: Service not running on $LOCAL_URL"
  echo "Start it first: npm start"
  exit 1
fi

# Ensure standalone static files are in place (needed if running via standalone/server.js)
STATIC_SRC="$(dirname "$0")/.next/static"
STATIC_DST="$(dirname "$0")/.next/standalone/.next/static"
if [ -d "$STATIC_SRC" ] && [ ! -d "$STATIC_DST" ]; then
  echo "Copying static files to standalone dir..."
  cp -r "$STATIC_SRC" "$STATIC_DST"
fi

# Install cloudflared if needed
if ! command -v cloudflared >/dev/null 2>&1; then
  echo "Installing cloudflared..."
  brew install cloudflared
fi

# Login to Cloudflare
if [ ! -f "$CONFIG_DIR/cert.pem" ]; then
  echo "Logging in to Cloudflare..."
  cloudflared tunnel login
fi

# Create tunnel if doesn't exist
if ! cloudflared tunnel list 2>/dev/null | awk '{print $2}' | grep -qx "$TUNNEL_NAME"; then
  echo "Creating tunnel: $TUNNEL_NAME"
  cloudflared tunnel create "$TUNNEL_NAME"
fi

# Get tunnel ID
TUNNEL_ID=$(cloudflared tunnel list | awk -v n="$TUNNEL_NAME" '$2==n {print $1}')
CRED_FILE="$CONFIG_DIR/${TUNNEL_ID}.json"

# Create config file
cat > "$CONFIG_FILE" <<EOF
tunnel: ${TUNNEL_ID}
credentials-file: ${CRED_FILE}

ingress:
  - hostname: ${HOSTNAME}
    service: ${LOCAL_URL}
  - service: http_status:404
EOF

# Setup DNS routing - force override via API if needed
echo "Setting up DNS..."
if ! cloudflared tunnel route dns "$TUNNEL_NAME" "$HOSTNAME" 2>&1 | grep -q "Added CNAME\|route to this tunnel"; then
  echo "DNS conflict detected, resolving via Cloudflare API..."
  CREDS=$(cat "$CONFIG_DIR/cert.pem" | grep -v "ARGO TUNNEL TOKEN" | tr -d '\n' | base64 -d 2>/dev/null)
  ZONE_ID=$(echo "$CREDS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['zoneID'])")
  API_TOKEN=$(echo "$CREDS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['apiToken'])")
  RECORD_ID=$(curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records?name=${HOSTNAME}" \
    -H "Authorization: Bearer $API_TOKEN" | python3 -c "import sys,json; r=json.load(sys.stdin); recs=r.get('result',[]); print(recs[0]['id'] if recs else '')")
  if [ -n "$RECORD_ID" ]; then
    curl -s -X DELETE "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records/$RECORD_ID" \
      -H "Authorization: Bearer $API_TOKEN" > /dev/null
    echo "Removed conflicting DNS record"
  fi
  cloudflared tunnel route dns "$TUNNEL_NAME" "$HOSTNAME" || { echo "ERROR: Failed to set DNS route"; exit 1; }
fi
echo "DNS OK: $HOSTNAME -> $TUNNEL_NAME"

# Start tunnel
echo ""
echo "=========================================="
echo "✅ Tunnel ready!"
echo "=========================================="
echo "Public:  https://${HOSTNAME}"
echo "Local:   ${LOCAL_URL}"
echo "=========================================="
echo ""

exec cloudflared tunnel --config "$CONFIG_FILE" run "$TUNNEL_NAME"
