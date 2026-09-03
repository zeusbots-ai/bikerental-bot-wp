#!/bin/bash
set -e

# Railway provides PORT dynamically
APP_PORT=${PORT:-8000}
BRIDGE_PORT=${BRIDGE_PORT:-3001}

echo "================================================================"
echo "🚀 Starting CUAP Hostel Bike Rental Application"
echo "   FastAPI Port : $APP_PORT"
echo "   Bridge Port  : $BRIDGE_PORT"
echo "   Session Path : ${SESSION_DATA_PATH:-./data/session}"
echo "   Media Path   : ${MEDIA_STORAGE_PATH:-./data/media}"
echo "================================================================"

# Ensure directories exist
mkdir -p "${SESSION_DATA_PATH:-/data/session}"
mkdir -p "${MEDIA_STORAGE_PATH:-/data/media}"

# Trap termination signals to stop background bridge
cleanup() {
    echo "Caught shutdown signal. Stopping services..."
    if [ -n "$BRIDGE_PID" ]; then
        kill -TERM "$BRIDGE_PID" 2>/dev/null || true
    fi
    exit 0
}
trap cleanup SIGINT SIGTERM

# Start Node.js WhatsApp Web bridge in the background
echo "[Init] Launching WhatsApp Web Bridge on port $BRIDGE_PORT..."
cd /app/bridge
BRIDGE_PORT=$BRIDGE_PORT node server.js &
BRIDGE_PID=$!
cd /app

# Give bridge a few seconds to initialize
sleep 3

# Start Python FastAPI server in the foreground
echo "[Init] Launching FastAPI on 0.0.0.0:$APP_PORT..."
exec uvicorn app.main:app --host 0.0.0.0 --port "$APP_PORT"
