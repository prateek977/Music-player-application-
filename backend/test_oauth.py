#!/usr/bin/env python3
"""
Diagnostic Utility: pytubefix YouTube OAuth Flow Spike
======================================================
Purpose:
  Explores YouTube OAuth authentication with pytubefix (`use_oauth=True`,
  `allow_oauth_cache=True`) to bypass IP rate-limiting, IP-based bot detection,
  and age-gated video restrictions.

Usage:
  python test_oauth.py
"""

from pytubefix import YouTube


def test_oauth() -> None:
    """Attempt authenticated audio stream extraction via OAuth cache."""
    try:
        # Initialize video with OAuth flow enabled to test token caching
        yt = YouTube(
            'https://www.youtube.com/watch?v=JGwWNGJdvx8',
            use_oauth=True,
            allow_oauth_cache=True
        )
        stream = yt.streams.get_audio_only()
        print("SUCCESS:", stream.url)
    except Exception as e:
        print("FAILED:", e)


if __name__ == "__main__":
    test_oauth()
