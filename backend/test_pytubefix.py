#!/usr/bin/env python3
"""
Diagnostic Utility: pytubefix Direct Audio Stream Extraction
=============================================================
Purpose:
  Tests audio-only stream extraction using pytubefix configured with the 'WEB' client.
  Used to verify YouTube playback URL resolution and test if signature deciphering
  succeeds against current YouTube anti-bot protections.

Usage:
  python test_pytubefix.py
"""

import sys
from pytubefix import YouTube

try:
    # Test video URL for stream resolution
    url = "https://www.youtube.com/watch?v=JGwWNGJdvx8"

    # Instantiate YouTube object using standard WEB player client
    yt = YouTube(url, client='WEB')

    # Resolve highest quality audio-only stream
    audio_stream = yt.streams.get_audio_only()

    print("SUCCESS")
    print(audio_stream.url)
except Exception as e:
    # Print diagnostic failure trace if extraction or deciphering fails
    print(f"FAILED: {e}")
