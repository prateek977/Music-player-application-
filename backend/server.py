# pyrefly: ignore [missing-import]
from flask import Flask, jsonify, request
from flask_cors import CORS
import yt_dlp
import logging
import os
import random
import string
from datetime import datetime
import time
import requests
from auth import require_auth, verify_supabase_token
import user_db
from recommender import (
    get_next_recommendations,
    get_similar_songs,
    get_home_sections,
    insert_listening_event,
    upsert_user_song_stats,
)

# Set up static folder pointing to the React production build if it exists
base_dir = os.path.dirname(os.path.abspath(__file__))
dist_folder = os.path.join(base_dir, '..', 'listenup-web', 'dist')
if not os.path.exists(dist_folder):
    dist_folder = os.path.join(base_dir, 'static')

import sys

app = Flask(__name__, static_folder=dist_folder, static_url_path='')
CORS(app)  # Enable CORS for clients

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@app.route('/')
def index():
    """Serve the React frontend in production (SPA deep-link support)"""
    try:
        return app.send_static_file('index.html')
    except Exception:
        return "ListenUp Web: Run 'npm run build' inside listenup-web to build the frontend.", 200

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({"status": "ok", "service": "yt-dlp-server"})

@app.route('/api/search', methods=['GET'])
def search():
    """Search YouTube for videos/songs using yt-dlp flat extraction"""
    query = request.args.get('q', '')
    if not query:
        return jsonify([])

    try:
        logger.info(f"Searching YouTube for: {query}")

        ydl_opts = {
            'extract_flat': 'in_playlist',
            'quiet': True,
            'no_warnings': True,
        }

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            # Query up to 50 results to account for filtered items
            info = ydl.extract_info(f"ytsearch50:{query}", download=False)
            entries = info.get('entries', [])

            results = []
            for entry in entries:
                if not entry:
                    continue
                video_id = entry.get('id')
                if not video_id:
                    continue

                # Format duration and filter out shorts (<1m) and mashups/mixes (>10m)
                duration = entry.get('duration') or 0
                if duration < 60 or duration > 600:
                    continue

                # Fallback thumbnail if missing
                thumbnail = f"https://i.ytimg.com/vi/{video_id}/mqdefault.jpg"
                thumbnails = entry.get('thumbnails', [])
                if thumbnails:
                    thumbnail = thumbnails[-1].get('url') or thumbnails[0].get('url') or thumbnail

                results.append({
                    "id": video_id,
                    "title": entry.get('title') or "Unknown Title",
                    "artist": entry.get('uploader') or "Unknown Artist",
                    "thumbnailUrl": thumbnail,
                    "duration": int(duration),
                    "viewCount": entry.get('view_count') or 0
                })

            # Return max 20 results
            results = results[:20]
            logger.info(f"Found {len(results)} search results for query: {query}")
            return jsonify(results)
    except Exception as e:
        logger.error(f"Search error for query '{query}': {str(e)}")
        return jsonify({"error": str(e)}), 500

# Simple in-memory cache for browse results (avoids hammering yt-dlp on page load)
import time as _time
_browse_cache = {}
_CACHE_TTL = 600  # 10 minutes

BROWSE_CATEGORIES = {
    "trending": "latest trending hit songs india official music video",
    "sad": "sad emotional heartbreak songs hindi official video",
    "bollywood": "latest bollywood songs official video",
    "hollywood": "popular english songs official video",
    "lofi": "lofi chill single track hindi",
    "pop": "top pop songs india official music video",
    "romantic": "romantic songs hindi official video",
    "party": "party dance songs hindi official video"
}

@app.route('/api/browse', methods=['GET'])
def browse():
    """Return curated songs for a category using predefined searches"""
    category = request.args.get('category', 'trending').lower()

    if category not in BROWSE_CATEGORIES:
        return jsonify({"error": f"Unknown category: {category}", "available": list(BROWSE_CATEGORIES.keys())}), 400

    # Check cache
    cache_key = category
    now = _time.time()
    if cache_key in _browse_cache:
        cached_data, cached_at = _browse_cache[cache_key]
        if now - cached_at < _CACHE_TTL:
            logger.info(f"Returning cached browse results for: {category}")
            return jsonify(cached_data)

    query = BROWSE_CATEGORIES[category]
    try:
        logger.info(f"Browsing category '{category}' with query: {query}")

        ydl_opts = {
            'extract_flat': 'in_playlist',
            'quiet': True,
            'no_warnings': True,
        }

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            # Query 50 results to account for filtered mashups
            info = ydl.extract_info(f"ytsearch50:{query}", download=False)
            entries = info.get('entries', [])

            results = []
            for entry in entries:
                if not entry:
                    continue
                video_id = entry.get('id')
                if not video_id:
                    continue

                duration = entry.get('duration') or 0
                if duration < 60 or duration > 600:
                    continue

                thumbnail = f"https://i.ytimg.com/vi/{video_id}/mqdefault.jpg"
                thumbnails = entry.get('thumbnails', [])
                if thumbnails:
                    thumbnail = thumbnails[-1].get('url') or thumbnails[0].get('url') or thumbnail

                results.append({
                    "id": video_id,
                    "title": entry.get('title') or "Unknown Title",
                    "artist": entry.get('uploader') or "Unknown Artist",
                    "thumbnailUrl": thumbnail,
                    "duration": int(duration),
                    "viewCount": entry.get('view_count') or 0
                })

            # Limit to 20 results and cache
            results = results[:20]
            _browse_cache[cache_key] = (results, now)
            logger.info(f"Browse '{category}': found {len(results)} results")
            return jsonify(results)
    except Exception as e:
        logger.error(f"Browse error for category '{category}': {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/categories', methods=['GET'])
def categories():
    """Return the list of available browse categories"""
    return jsonify(list(BROWSE_CATEGORIES.keys()))

# Initialize user database
try:
    user_db.init_db()
    logger.info("Initialized local persistent user database (user_data.db)")
except Exception as _db_init_err:
    logger.warning("Failed initializing user_db: %s", _db_init_err)

# ── Deezer Artist Discovery Configuration & In-Memory Cache ──────────────────
_ARTIST_SEARCH_CACHE: dict[str, tuple[float, dict]] = {}
_ARTIST_CACHE_TTL = 900.0  # 15 minutes TTL
_ARTIST_CACHE_MAX = 300

# Authentic popular artist discovery seeds - starting with the exact 10 artists from the design image
DEFAULT_DISCOVERY_ARTIST_NAMES = [
    "Arijit Singh",
    "Pritam",
    "Vishal Mishra",
    "Amit Trivedi",
    "Shreya Ghoshal",
    "Darshan Raval",
    "AP Dhillon",
    "King",
    "Anuv Jain",
    "Ritviz",
    "Diljit Dosanjh",
    "A. R. Rahman",
    "Sonu Nigam",
    "Sunidhi Chauhan",
    "Ayushmann Khurrana",
    "Jubin Nautiyal",
    "Taylor Swift",
    "The Weeknd",
    "Coldplay",
    "Ed Sheeran"
]

def _clean_artist_image(url: str | None) -> str | None:
    """Sanitize Deezer image URLs and filter out Deezer's blank placeholder hashes."""
    if not url or not isinstance(url, str):
        return None
    url = url.strip()
    if not url.startswith("http"):
        return None
    # Deezer returns an empty hash with double-slash like '/images/artist//250x250...' when no image exists
    if "/images/artist//" in url:
        return None
    return url

def _normalize_deezer_artist(raw: dict) -> dict:
    """Normalize Deezer API artist payload into ListenUp's canonical contract."""
    artist_id = str(raw.get("id") or "")
    name = (raw.get("name") or "Unknown Artist").strip()
    picture_small = _clean_artist_image(raw.get("picture_small") or raw.get("picture"))
    picture_medium = _clean_artist_image(raw.get("picture_medium"))
    picture_big = _clean_artist_image(raw.get("picture_big") or raw.get("picture_xl"))
    link = raw.get("link") or (f"https://www.deezer.com/artist/{artist_id}" if artist_id else "")
    fan_count = int(raw.get("nb_fan") or 0)
    album_count = int(raw.get("nb_album") or 0)

    # Preferred image fallback chain
    default_image = picture_medium or picture_big or picture_small or ""

    return {
        "id": artist_id,
        "name": name,
        "image": default_image,
        "imageMedium": picture_medium or default_image,
        "imageLarge": picture_big or default_image,
        "deezerUrl": link,
        "provider": "deezer",
        "fanCount": fan_count,
        "albumCount": album_count,
    }

@app.route('/api/artists/search', methods=['GET'])
def search_artists():
    """
    Search music artists via Deezer public API proxy.
    Query parameters:
        q: Artist name or query (e.g. 'arijit'). If empty or missing, returns curated popular discovery artists.
        limit: Max results to return (default 20, min 1, max 50).
        index: Pagination offset index (default 0, min 0).
    """
    query = (request.args.get('q') or '').strip()
    try:
        limit = max(1, min(int(request.args.get('limit', 20)), 50))
    except (ValueError, TypeError):
        limit = 20

    try:
        index = max(0, int(request.args.get('index', 0)))
    except (ValueError, TypeError):
        index = 0

    cache_key = f"{query.lower()}:{limit}:{index}"
    now = time.time()

    # Check in-memory TTL cache
    if cache_key in _ARTIST_SEARCH_CACHE:
        cached_time, cached_data = _ARTIST_SEARCH_CACHE[cache_key]
        if now - cached_time < _ARTIST_CACHE_TTL:
            return jsonify(cached_data)

    try:
        if query:
            deezer_url = "https://api.deezer.com/search/artist"
            resp = requests.get(
                deezer_url,
                params={"q": query, "limit": limit, "index": index},
                headers={"User-Agent": "ListenUp/1.0"},
                timeout=5.0
            )

            if resp.status_code != 200:
                logger.warning("Deezer artist search returned HTTP %s for query '%s'", resp.status_code, query)
                return jsonify({
                    "artists": [],
                    "total": 0,
                    "hasMore": False,
                    "nextIndex": None,
                    "provider": "deezer",
                    "error": f"Deezer API returned HTTP {resp.status_code}"
                }), 502

            payload = resp.json()
            if "error" in payload:
                err_msg = payload["error"].get("message", "Unknown Deezer error")
                logger.warning("Deezer API error response: %s", err_msg)
                return jsonify({
                    "artists": [],
                    "total": 0,
                    "hasMore": False,
                    "nextIndex": None,
                    "provider": "deezer",
                    "error": err_msg
                }), 200

            raw_data = payload.get("data", []) or []
            total = int(payload.get("total", len(raw_data)))
            artists = [_normalize_deezer_artist(item) for item in raw_data if item and item.get("id")]
            has_more = (index + len(artists)) < total and bool(payload.get("next"))
            next_index = index + len(artists) if has_more else None

            response_data = {
                "artists": artists,
                "total": total,
                "hasMore": has_more,
                "nextIndex": next_index,
                "provider": "deezer",
                "query": query
            }
        else:
            # When query is empty, provide paginated discovery slice from default popular artists
            slice_names = DEFAULT_DISCOVERY_ARTIST_NAMES[index : index + limit]
            artists = []
            for name in slice_names:
                single_key = f"single:{name.lower()}"
                if single_key in _ARTIST_SEARCH_CACHE and (now - _ARTIST_SEARCH_CACHE[single_key][0] < _ARTIST_CACHE_TTL):
                    artists.append(_ARTIST_SEARCH_CACHE[single_key][1])
                    continue

                try:
                    r = requests.get(
                        "https://api.deezer.com/search/artist",
                        params={"q": name, "limit": 1},
                        headers={"User-Agent": "ListenUp/1.0"},
                        timeout=3.0
                    )
                    if r.status_code == 200:
                        d = r.json().get("data", [])
                        if d and d[0].get("id"):
                            norm = _normalize_deezer_artist(d[0])
                            artists.append(norm)
                            _ARTIST_SEARCH_CACHE[single_key] = (now, norm)
                except Exception as ex:
                    logger.debug("Failed fetching default discovery artist '%s': %s", name, ex)

            total = len(DEFAULT_DISCOVERY_ARTIST_NAMES)
            has_more = (index + len(slice_names)) < total
            next_index = index + len(slice_names) if has_more else None

            response_data = {
                "artists": artists,
                "total": total,
                "hasMore": has_more,
                "nextIndex": next_index,
                "provider": "deezer",
                "query": ""
            }

        # Cache response with max size control
        if len(_ARTIST_SEARCH_CACHE) > _ARTIST_CACHE_MAX:
            oldest_key = min(_ARTIST_SEARCH_CACHE.keys(), key=lambda k: _ARTIST_SEARCH_CACHE[k][0])
            _ARTIST_SEARCH_CACHE.pop(oldest_key, None)
        _ARTIST_SEARCH_CACHE[cache_key] = (now, response_data)

        return jsonify(response_data)

    except requests.exceptions.Timeout:
        logger.error("Deezer artist search timed out for query '%s'", query)
        return jsonify({
            "artists": [],
            "total": 0,
            "hasMore": False,
            "nextIndex": None,
            "provider": "deezer",
            "error": "Deezer search request timed out"
        }), 504
    except Exception as exc:
        logger.error("Deezer artist search unexpected error: %s", exc)
        return jsonify({
            "artists": [],
            "total": 0,
            "hasMore": False,
            "nextIndex": None,
            "provider": "deezer",
            "error": "Failed to search artists"
        }), 500

@app.route('/stream/<video_id>', methods=['GET'])
@app.route('/api/stream/<video_id>', methods=['GET'])
def get_stream(video_id):
    """
    Extract audio stream URL for a YouTube video
    Returns JSON with stream URL and metadata
    """
    try:
        logger.info(f"Extracting stream for video: {video_id}")

        url = f"https://www.youtube.com/watch?v={video_id}"

        ydl_opts = {
            'format': 'bestaudio/best',
            'quiet': True,
            'no_warnings': True,
            'extract_flat': False,
        }

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)

            # Get the best audio format
            formats = info.get('formats', [])
            audio_formats = [f for f in formats if f.get('acodec') != 'none' and f.get('vcodec') == 'none']

            if not audio_formats:
                # Fallback to any format with audio
                audio_formats = [f for f in formats if f.get('acodec') != 'none']

            if not audio_formats:
                logger.error(f"No audio formats found for {video_id}")
                return jsonify({"error": "No audio stream available"}), 404

            # Get best quality audio
            best_audio = max(audio_formats, key=lambda x: x.get('abr', 0) or x.get('tbr', 0))

            stream_url = best_audio.get('url')

            if not stream_url:
                logger.error(f"No stream URL found for {video_id}")
                return jsonify({"error": "Stream URL not available"}), 404

            response = {
                "video_id": video_id,
                "stream_url": stream_url,
                "title": info.get('title', 'Unknown'),
                "duration": info.get('duration', 0),
                "format": best_audio.get('ext', 'unknown'),
                "quality": f"{best_audio.get('abr', 0)}kbps"
            }

            logger.info(f"Successfully extracted stream for {video_id}")
            return jsonify(response)

    except Exception as e:
        logger.error(f"Error extracting stream for {video_id}: {str(e)}")
        return jsonify({"error": str(e)}), 500

# ─── Authenticated & Personalized Recommendation Endpoints ──────────

@app.route('/api/auth/verify', methods=['GET'])
@require_auth
def verify_authenticated_user():
    """Verify Supabase JWT token and return verified user claims"""
    user = getattr(request, 'user', {})
    return jsonify({
        "status": "authenticated",
        "user_id": user.get('sub') or user.get('id'),
        "email": user.get('email'),
        "role": user.get('role', 'authenticated')
    })

def get_request_user_id():
    """Extract authenticated user ID from Authorization header or explicit param/body."""
    auth_header = request.headers.get('Authorization', '')
    if auth_header.startswith('Bearer '):
        token = auth_header.split(' ', 1)[1].strip()
        payload, err = verify_supabase_token(token)
        if payload and (payload.get('sub') or payload.get('id')):
            return payload.get('sub') or payload.get('id')
    # Fallback to explicit userId param if client authenticated via Supabase JS client
    user_id = request.args.get('userId')
    if not user_id and request.is_json and request.json:
        user_id = request.json.get('userId')
    if user_id and str(user_id).lower() not in ('guest', 'anonymous', 'null', 'undefined', ''):
        return str(user_id)
    return None

# ── User Preferences Endpoints (Persistent Database) ──────────────────────────

@app.route('/api/user/preferences', methods=['GET', 'POST'])
def handle_user_preferences():
    user_id = get_request_user_id()
    if not user_id:
        return jsonify({"error": "Authentication required. Guest users cannot persist preferences."}), 401

    if request.method == 'GET':
        prefs = user_db.get_user_preferences(user_id)
        return jsonify({"success": True, "preferences": prefs})

    if request.method == 'POST':
        body = request.get_json() or {}
        prefs = body.get('preferences') or body
        cleaned = {
            'genres': prefs.get('genres', []),
            'artists': prefs.get('artists', []),
            'languages': prefs.get('languages', []),
            'moods': prefs.get('moods', []),
            'activities': prefs.get('activities', []),
            'explicit_content_preference': prefs.get('explicit_content_preference', True)
        }
        saved = user_db.save_user_preferences(user_id, cleaned)
        return jsonify({"success": True, "preferences": saved})

# ── User Playlists Endpoints (Persistent Database) ───────────────────────────

@app.route('/api/user/playlists', methods=['GET', 'POST'])
def handle_user_playlists():
    user_id = get_request_user_id()
    if not user_id:
        return jsonify({"error": "Authentication required. Guest users cannot persist playlists."}), 401

    if request.method == 'GET':
        playlists = user_db.get_user_playlists(user_id)
        return jsonify({"success": True, "playlists": playlists})

    if request.method == 'POST':
        body = request.get_json() or {}
        name = (body.get('name') or 'My Playlist').strip()
        cover_url = body.get('cover_url') or body.get('coverUrl')
        songs = body.get('songs') or []
        created = user_db.create_user_playlist(user_id, name, cover_url, songs)
        return jsonify({"success": True, "playlist": created})

@app.route('/api/user/playlists/<playlist_id>', methods=['PUT', 'DELETE'])
def handle_single_user_playlist(playlist_id):
    user_id = get_request_user_id()
    if not user_id:
        return jsonify({"error": "Authentication required."}), 401

    if request.method == 'DELETE':
        success = user_db.delete_user_playlist(playlist_id, user_id)
        return jsonify({"success": success})

    if request.method == 'PUT':
        body = request.get_json() or {}
        updated = user_db.update_user_playlist(
            playlist_id,
            user_id,
            name=body.get('name'),
            songs=body.get('songs'),
            cover_url=body.get('cover_url') or body.get('coverUrl')
        )
        if not updated:
            return jsonify({"error": "Playlist not found or access denied"}), 404
        return jsonify({"success": True, "playlist": updated})

# ── User Favorites Endpoints (Persistent Database) ───────────────────────────

@app.route('/api/user/favorites', methods=['GET', 'POST'])
def handle_user_favorites():
    user_id = get_request_user_id()
    if not user_id:
        return jsonify({"error": "Authentication required. Guest users cannot persist favorites."}), 401

    if request.method == 'GET':
        favorites = user_db.get_user_favorites(user_id)
        return jsonify({"success": True, "favorites": favorites})

    if request.method == 'POST':
        body = request.get_json() or {}
        song = body.get('song') or body
        saved = user_db.add_user_favorite(user_id, song)
        return jsonify({"success": True, "song": saved})

@app.route('/api/user/favorites/<song_id>', methods=['DELETE'])
def handle_remove_user_favorite(song_id):
    user_id = get_request_user_id()
    if not user_id:
        return jsonify({"error": "Authentication required."}), 401

    success = user_db.remove_user_favorite(user_id, song_id)
    return jsonify({"success": success})


_personalized_cache = {}

@app.route('/api/recommendations/personalized', methods=['POST'])
def get_personalized_recommendations():
    """
    Generate personalized recommendations based on user's saved preferences
    (favorite artists, preferred genres, languages, and listening moods)
    """
    try:
        body = request.get_json() or {}
        raw_artists = body.get('artists', [])
        artists = [a if isinstance(a, str) else a.get('name', '') for a in raw_artists]
        artists = [a.strip() for a in artists if a and a.strip()]
        genres = [g if isinstance(g, str) else g.get('name', '') for g in body.get('genres', [])]
        genres = [g.strip() for g in genres if g and g.strip()]
        languages = body.get('languages', [])
        moods = body.get('moods', [])

        cache_key = f"{','.join(sorted(artists[:3]))}:{','.join(sorted(genres[:3]))}:{','.join(sorted(moods[:2]))}"
        now = _time.time()
        if cache_key in _personalized_cache:
            data, timestamp = _personalized_cache[cache_key]
            if now - timestamp < _CACHE_TTL:
                return jsonify(data)

        ydl_opts = {
            'extract_flat': 'in_playlist',
            'quiet': True,
            'no_warnings': True,
        }

        artist_sections = []
        # Fetch top tracks for up to 3 favorite artists
        for artist_name in artists[:3]:
            if not artist_name:
                continue
            query = f"{artist_name} best songs official hit video"
            try:
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    info = ydl.extract_info(f"ytsearch10:{query}", download=False)
                    entries = info.get('entries', [])
                    songs = []
                    for entry in entries:
                        if not entry or not entry.get('id'):
                            continue
                        dur = entry.get('duration') or 0
                        if dur < 60 or dur > 600:
                            continue
                        vid_id = entry.get('id')
                        thumb = f"https://i.ytimg.com/vi/{vid_id}/mqdefault.jpg"
                        thumbnails = entry.get('thumbnails', [])
                        if thumbnails:
                            thumb = thumbnails[-1].get('url') or thumb
                        songs.append({
                            "id": vid_id,
                            "title": entry.get('title') or f"Song by {artist_name}",
                            "artist": entry.get('uploader') or artist_name,
                            "thumbnailUrl": thumb,
                            "duration": int(dur),
                            "viewCount": entry.get('view_count') or 0
                        })
                    if songs:
                        artist_sections.append({
                            "artistName": artist_name,
                            "songs": songs[:10]
                        })
            except Exception as ex:
                logger.warning(f"Error fetching tracks for artist {artist_name}: {ex}")

        # Fetch tailored mix for user's favorite genre/mood
        genre_mix = []
        primary_genre = genres[0] if genres else "Bollywood"
        primary_lang = languages[0] if languages else "Hindi"
        primary_mood = moods[0] if moods else "Chill"
        mix_query = f"{primary_genre} {primary_mood} songs {primary_lang} official"
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(f"ytsearch10:{mix_query}", download=False)
                for entry in (info.get('entries', []) or []):
                    if not entry or not entry.get('id'):
                        continue
                    dur = entry.get('duration') or 0
                    if dur < 60 or dur > 600:
                        continue
                    vid_id = entry.get('id')
                    thumb = f"https://i.ytimg.com/vi/{vid_id}/mqdefault.jpg"
                    genre_mix.append({
                        "id": vid_id,
                        "title": entry.get('title') or "Curated Track",
                        "artist": entry.get('uploader') or "Featured Artist",
                        "thumbnailUrl": thumb,
                        "duration": int(dur)
                    })
        except Exception as ex:
            logger.warning(f"Error fetching mix recommendations: {ex}")

        result = {
            "artistSections": artist_sections,
            "tailoredMix": {
                "title": f"Your {primary_genre} & {primary_mood} Mix",
                "badge": "For Your Taste",
                "songs": genre_mix[:10]
            }
        }
        _personalized_cache[cache_key] = (result, now)
        return jsonify(result)
    except Exception as e:
        logger.error(f"Error generating personalized recommendations: {str(e)}")
        return jsonify({"artistSections": [], "tailoredMix": None, "error": str(e)}), 500

# ─────────────────────────────────────────────────────────────────────────────
#  RECOMMENDATION ENGINE ROUTES
#  All routes added by the recommendation feature — clearly grouped here.
# ─────────────────────────────────────────────────────────────────────────────

def _get_auth_token_and_user_id():
    """
    Extract the Supabase JWT from the Authorization header.
    Returns (token, user_id) or (None, None) if missing/invalid.
    Graceful: does not raise — missing auth just means guest mode.
    """
    auth_header = request.headers.get('Authorization', '')
    if not auth_header.startswith('Bearer '):
        return None, None
    token = auth_header.split('Bearer ', 1)[1].strip()
    if not token:
        return None, None
    try:
        claims, error = verify_supabase_token(token)
        if error or not claims:
            return token, None
        user_id = claims.get('sub') or claims.get('id')
        return token, user_id
    except Exception:
        return token, None


def _parse_preferences_from_body(body: dict) -> tuple[list, list, list]:
    """Parse genres, moods, artists from a request body dict."""
    raw_artists = body.get('artists', []) or []
    artists = [a if isinstance(a, str) else a.get('name', '') for a in raw_artists]
    artists = [a.strip() for a in artists if a and a.strip()]

    genres = [g.strip() for g in (body.get('genres', []) or []) if g and g.strip()]
    moods  = [m.strip() for m in (body.get('moods', [])  or []) if m and m.strip()]
    return genres, moods, artists


@app.route('/api/listening-events', methods=['POST'])
def record_listening_event():
    """
    Record a single listening event for the recommendation engine.

    Request body (JSON):
        song_id        TEXT    required — YouTube video ID
        song_data      OBJECT  required — full song object {id, title, artist, ...}
        event_type     TEXT    required — one of:
                               'play_started' | 'play_completed' | 'song_skipped' |
                               'song_liked' | 'song_unliked' | 'playlist_added' |
                               'play_progress'
        listen_seconds FLOAT   optional — seconds listened before this event
        listen_fraction FLOAT  optional — fraction of song listened (0.0–1.0)
        metadata       OBJECT  optional — free-form extra data

    Auth: optional Bearer token — authenticated events are attributed to the user.
    Anonymous events are accepted but stored without a user_id (not used in scoring).

    Returns: {"ok": true} or {"error": "..."}
    """
    VALID_EVENT_TYPES = {
        'play_started', 'play_completed', 'song_skipped',
        'song_liked', 'song_unliked', 'playlist_added', 'play_progress',
    }
    try:
        body = request.get_json(silent=True) or {}

        song_id = (body.get('song_id') or '').strip()
        if not song_id:
            return jsonify({"error": "song_id is required"}), 400

        event_type = (body.get('event_type') or '').strip()
        if event_type not in VALID_EVENT_TYPES:
            return jsonify({
                "error": f"Invalid event_type. Must be one of: {sorted(VALID_EVENT_TYPES)}"
            }), 400

        song_data       = body.get('song_data') or {}
        listen_seconds  = body.get('listen_seconds')
        listen_fraction = body.get('listen_fraction')
        metadata        = body.get('metadata') or {}

        # Validate numerics
        if listen_seconds is not None:
            try:
                listen_seconds = float(listen_seconds)
            except (TypeError, ValueError):
                listen_seconds = None
        if listen_fraction is not None:
            try:
                listen_fraction = max(0.0, min(1.0, float(listen_fraction)))
            except (TypeError, ValueError):
                listen_fraction = None

        auth_token, user_id = _get_auth_token_and_user_id()

        # Fire-and-forget: insert raw event and update aggregated stats
        # Both operations are non-blocking best-effort — failures are logged, not re-raised
        insert_listening_event(
            user_id=user_id,
            song_id=song_id,
            song_data=song_data,
            event_type=event_type,
            listen_seconds=listen_seconds,
            listen_fraction=listen_fraction,
            metadata=metadata,
            auth_token=auth_token,
        )
        if user_id:
            upsert_user_song_stats(
                user_id=user_id,
                song_id=song_id,
                song_data=song_data,
                event_type=event_type,
                listen_seconds=listen_seconds,
                listen_fraction=listen_fraction,
                auth_token=auth_token,
            )

        return jsonify({"ok": True})

    except Exception as exc:
        logger.error("record_listening_event error: %s", exc)
        return jsonify({"error": "Internal server error"}), 500


@app.route('/api/recommendations/next', methods=['GET'])
def recommendations_next():
    """
    Get the next recommended songs for autoplay.

    Query parameters:
        current_song_id  TEXT    optional — ID of the song currently playing
        exclude_ids      TEXT    optional — comma-separated song IDs to exclude
        genres           TEXT    optional — comma-separated genre slugs
        moods            TEXT    optional — comma-separated mood strings
        artists          TEXT    optional — comma-separated artist names
        limit            INT     optional — max songs to return (default 5, max 10)

    Auth: optional Bearer token — authenticated requests use personal listening history.

    Returns:
        {"songs": [...], "has_personalisation": true/false}
    """
    try:
        auth_token, user_id = _get_auth_token_and_user_id()

        current_song_id = request.args.get('current_song_id', '').strip()
        exclude_raw     = request.args.get('exclude_ids', '')
        exclude_ids     = [e.strip() for e in exclude_raw.split(',') if e.strip()]
        if current_song_id:
            exclude_ids.append(current_song_id)

        genres  = [g.strip() for g in request.args.get('genres', '').split(',') if g.strip()]
        moods   = [m.strip() for m in request.args.get('moods', '').split(',') if m.strip()]
        artists = [a.strip() for a in request.args.get('artists', '').split(',') if a.strip()]

        try:
            limit = min(int(request.args.get('limit', 5)), 10)
        except (ValueError, TypeError):
            limit = 5

        # Build a minimal current_song dict if we have its ID
        current_song = None
        if current_song_id:
            current_song = {"id": current_song_id}

        songs = get_next_recommendations(
            user_id=user_id,
            user_genres=genres,
            user_moods=moods,
            user_artists=artists,
            current_song=current_song,
            exclude_ids=exclude_ids,
            limit=limit,
            auth_token=auth_token,
        )

        return jsonify({
            "songs": songs,
            "has_personalisation": bool(user_id and (genres or artists)),
        })

    except Exception as exc:
        logger.error("recommendations_next error: %s", exc)
        # Never crash the player — return empty list with a grace flag
        return jsonify({"songs": [], "has_personalisation": False, "error": "Recommendation service unavailable"}), 200


@app.route('/api/recommendations/home', methods=['GET', 'POST'])
def recommendations_home():
    """
    Get personalised home screen sections.

    Accepts body (POST) or query params (GET):
        genres   list/comma-string — user's preferred genres
        moods    list/comma-string — user's preferred moods
        artists  list/comma-string — user's favourite artists

    Auth: optional Bearer token.

    Returns:
        {
          "made_for_you": [...],
          "because_you": [{"artist": "...", "songs": [...]}, ...],
          "discover_more": [...],
          "has_personalisation": bool
        }
    """
    try:
        auth_token, user_id = _get_auth_token_and_user_id()

        if request.method == 'POST':
            body = request.get_json(silent=True) or {}
            genres, moods, artists = _parse_preferences_from_body(body)
        else:
            genres  = [g.strip() for g in request.args.get('genres', '').split(',') if g.strip()]
            moods   = [m.strip() for m in request.args.get('moods', '').split(',') if m.strip()]
            artists = [a.strip() for a in request.args.get('artists', '').split(',') if a.strip()]

        sections = get_home_sections(
            user_id=user_id,
            user_genres=genres,
            user_moods=moods,
            user_artists=artists,
            limit_per_section=10,
            auth_token=auth_token,
        )
        return jsonify(sections)

    except Exception as exc:
        logger.error("recommendations_home error: %s", exc)
        return jsonify({
            "made_for_you": [], "because_you": [], "discover_more": [],
            "has_personalisation": False
        }), 200


@app.route('/api/recommendations/similar/<song_id>', methods=['GET'])
def recommendations_similar(song_id: str):
    """
    Get songs similar to the given song.

    Path parameter:
        song_id — YouTube video ID of the reference song

    Query parameters:
        title    TEXT optional — title of the reference song
        artist   TEXT optional — artist of the reference song
        exclude_ids TEXT optional — comma-separated IDs to exclude
        limit    INT  optional — max results (default 8, max 15)

    Returns: {"songs": [...]}
    """
    try:
        auth_token, user_id = _get_auth_token_and_user_id()

        song_id = (song_id or '').strip()
        if not song_id:
            return jsonify({"error": "song_id is required"}), 400

        title   = request.args.get('title', '').strip()
        artist  = request.args.get('artist', '').strip()
        exclude_raw = request.args.get('exclude_ids', '')
        exclude_ids = [e.strip() for e in exclude_raw.split(',') if e.strip()]

        try:
            limit = min(int(request.args.get('limit', 8)), 15)
        except (ValueError, TypeError):
            limit = 8

        current_song = {"id": song_id, "title": title, "artist": artist}

        songs = get_similar_songs(
            current_song=current_song,
            user_id=user_id,
            exclude_ids=exclude_ids,
            limit=limit,
            auth_token=auth_token,
        )
        return jsonify({"songs": songs})

    except Exception as exc:
        logger.error("recommendations_similar error for song_id=%s: %s", song_id, exc)
        return jsonify({"songs": []}), 200


@app.route('/api/recommendations/feedback', methods=['POST'])
def recommendations_feedback():
    """
    Record explicit user feedback on a recommendation (thumbs up / thumbs down).
    This is stored as a listening event and updates user_song_stats accordingly.

    Request body (JSON):
        song_id    TEXT    required
        song_data  OBJECT  optional
        action     TEXT    required — 'liked' | 'disliked' | 'dismissed'

    Auth: recommended — anonymous feedback is accepted but not attributed.

    Returns: {"ok": true}
    """
    try:
        body = request.get_json(silent=True) or {}
        song_id   = (body.get('song_id') or '').strip()
        song_data = body.get('song_data') or {}
        action    = (body.get('action') or '').strip().lower()

        if not song_id:
            return jsonify({"error": "song_id is required"}), 400
        if action not in ('liked', 'disliked', 'dismissed'):
            return jsonify({"error": "action must be 'liked', 'disliked', or 'dismissed'"}), 400

        auth_token, user_id = _get_auth_token_and_user_id()

        event_type = {
            'liked':     'song_liked',
            'disliked':  'song_unliked',
            'dismissed': 'song_skipped',
        }[action]

        insert_listening_event(
            user_id=user_id,
            song_id=song_id,
            song_data=song_data,
            event_type=event_type,
            metadata={"source": "recommendation_feedback", "action": action},
            auth_token=auth_token,
        )
        if user_id:
            upsert_user_song_stats(
                user_id=user_id,
                song_id=song_id,
                song_data=song_data,
                event_type=event_type,
                listen_seconds=None,
                listen_fraction=None,
                auth_token=auth_token,
            )

        return jsonify({"ok": True})

    except Exception as exc:
        logger.error("recommendations_feedback error: %s", exc)
        return jsonify({"error": "Internal server error"}), 500


if __name__ == "__main__":
    print("=" * 50)
    print("🎵 ListenUp Server (with Music Rooms)")
    print("=" * 50)
    port = int(os.environ.get('PORT', 5001))
    print(f"Server running on port {port}")
    print("=" * 50)
    app.run(host='0.0.0.0', port=port, debug=False)
