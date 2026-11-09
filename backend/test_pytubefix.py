import sys
from pytubefix import YouTube

try:
    url = "https://www.youtube.com/watch?v=JGwWNGJdvx8"
    yt = YouTube(url, client='WEB')
    audio_stream = yt.streams.get_audio_only()
    print("SUCCESS")
    print(audio_stream.url)
except Exception as e:
    print(f"FAILED: {e}")
