import urllib.request
import yt_dlp
import random

print("Fetching proxies...")
req = urllib.request.urlopen("https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt")
proxies = req.read().decode('utf-8').splitlines()
random.shuffle(proxies)

for p in proxies[:15]:
    proxy_url = f"http://{p}"
    print(f"Testing {proxy_url}...")
    try:
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
