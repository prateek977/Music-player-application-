#!/bin/bash

# ==============================================================================
# ListenUp Stream Server Startup Script
# ==============================================================================
# Usage:
#   chmod +x start_server.sh
#   ./start_server.sh
#
# Description:
#   Navigates to the backend directory, activates the local Python virtual environment,
#   and launches the Flask streaming server (server.py) listening on PORT (default 5001).
# ==============================================================================

set -e

# Change directory to the location of this script
cd "$(dirname "$0")"

echo "=================================================="
echo "🎵 Starting yt-dlp Stream Server"
echo "=================================================="
echo ""

# Activate virtual environment if present
if [ -d "venv" ]; then
    echo "Activating virtual environment (venv)..."
    source venv/bin/activate
fi

# Launch the primary Flask application server
python server.py
