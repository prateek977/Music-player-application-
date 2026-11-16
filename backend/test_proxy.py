#!/usr/bin/env python3
"""
Diagnostic Utility: yt-dlp Rotating HTTP Proxy Tester
=====================================================
Purpose:
  Fetches a fresh public HTTP proxy list and tests whether yt-dlp can successfully
  extract audio streams through randomized proxy endpoints to mitigate geo-blocking
  or rate-limiting.

Workflow:
  1. Downloads raw HTTP proxies from TheSpeedX proxy repository.
  2. Shuffles list and tests the first 15 candidates sequentially.
  3. Attempts audio extraction for a reference YouTube video.
  4. Exits on first successful stream resolution.

Usage:
  python test_proxy.py
"""

import random
import urllib.request
import yt_dlp

print("Fetching proxies...")
# Fetch public HTTP proxy pool
req = urllib.request.urlopen("https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt")
proxies = req.read().decode('utf-8').splitlines()
random.shuffle(proxies)

# Test top 15 randomized proxy candidates
for p in proxies[:15]:
    proxy_url = f"http://{p}"
    print(f"Testing {proxy_url}...")
    try:
        # Configure yt-dlp with proxy and multi-client fallback strategies
        ydl_opts = {
            'format': 'bestaudio',
            'proxy': proxy_url,
            'quiet': True,
            'socket_timeout': 5,
            'extractor_args': {'youtube': {'player_client': ['android', 'web']}}
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info('https://www.youtube.com/watch?v=JGwWNGJdvx8', download=False)
            print("SUCCESS! URL:", info['url'][:50])
            break
    except Exception as e:
        print("Failed:", str(e)[:100])
