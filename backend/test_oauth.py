from pytubefix import YouTube

def test_oauth():
    try:
        yt = YouTube('https://www.youtube.com/watch?v=JGwWNGJdvx8', use_oauth=True, allow_oauth_cache=True)
        stream = yt.streams.get_audio_only()
        print("SUCCESS:", stream.url)
    except Exception as e:
        print("FAILED:", e)

test_oauth()
