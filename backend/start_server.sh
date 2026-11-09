#!/bin/bash

# Start yt-dlp Flask server for ListenUp app

cd "$(dirname "$0")"

echo "=================================================="
echo "🎵 Starting yt-dlp Stream Server"
echo "=================================================="
echo ""

# Activate virtual environment and start server
source venv/bin/activate
python server.py
