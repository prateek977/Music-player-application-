#!/usr/bin/env python3
"""
Diagnostic Utility: pytubefix Search Spike
==========================================
Purpose:
  A standalone diagnostic script to evaluate the pytubefix library's search capability
  as an alternative search extraction engine for YouTube video metadata.

Usage:
  python test_search.py

Prerequisites:
  pip install pytubefix
"""

from pytubefix import Search

# Execute a test search query against YouTube
search_query = "Drake"
s = Search(search_query)

# Display the total count of discovered video objects and the first result's title
print("Found", len(s.videos))
if s.videos:
    print(s.videos[0].title)
