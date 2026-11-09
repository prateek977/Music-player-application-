"""
ListenUp Recommendation Engine
===============================
A hybrid, explainable music recommendation system.

Approach:
  1. Content-based filtering  — artist/genre/mood text similarity
  2. User-behaviour signals   — play_count, skip_count, likes, recency
  3. Discovery diversification — prevent artist monopoly in results

This module is intentionally pure-Python with no ML framework dependencies.
The scoring is deterministic and configurable via SCORE_WEIGHTS.

All Supabase interaction is done via the REST API using the service-role key
(server-side only — never exposed to the frontend or Android client).

Usage:
    from recommender import get_next_recommendations, get_similar_songs
"""

from __future__ import annotations

import logging
import os
import re
import time
import math
from collections import defaultdict
from typing import Any

import requests

logger = logging.getLogger(__name__)

# ─── Configurable Scoring Weights ────────────────────────────────────────────
# Change these to tune the recommendation balance without touching other code.
SCORE_WEIGHTS = {
    "genre_mood_similarity":  0.30,   # Textual overlap with user's genre/mood prefs
    "artist_preference":      0.25,   # Match against user's favourite artists
    "listening_history":      0.20,   # Play count, like status, completion rate
    "audio_characteristics":  0.15,   # Duration fitness, view count (popularity proxy)
    "discovery":              0.10,   # Penalise artist over-representation in results
}
# Sanity check — weights must sum to 1.0
assert abs(sum(SCORE_WEIGHTS.values()) - 1.0) < 1e-9, "SCORE_WEIGHTS must sum to 1.0"

# ─── Penalty Configuration ────────────────────────────────────────────────────
RECENT_PLAY_WINDOW_SEC = 3600          # Songs played in last hour get heavy penalty
RECENT_PLAY_PENALTY    = 0.6           # Multiply score by this for recently played songs
SKIP_PENALTY_PER_SKIP  = 0.15         # Subtract this per skip (capped at 0.45)
MAX_SKIP_PENALTY       = 0.45         # Maximum cumulative skip penalty
LIKED_SONG_BOOST       = 0.25         # Additive boost for liked songs
ARTIST_DIVERSITY_CAP   = 2            # Max songs from the same artist in one result set

# ─── Candidate Fetch Configuration ───────────────────────────────────────────
MAX_CANDIDATES         = 40           # Max songs fetched from yt-dlp per recommendation call
RESULT_LIMIT_DEFAULT   = 10           # Default songs returned per recommendation request
CACHE_TTL_SEC          = 600          # 10-minute in-memory candidate cache

# Song duration sweet-spot (seconds)
DURATION_MIN_IDEAL     = 150          # 2.5 min
DURATION_MAX_IDEAL     = 360          # 6 min

# ─── Supabase Config (server-side only) ──────────────────────────────────────
_SUPABASE_URL      = os.environ.get("SUPABASE_URL", "").rstrip("/")
_SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")

# ─── In-memory candidate cache ───────────────────────────────────────────────
_candidate_cache: dict[str, tuple[list[dict], float]] = {}


# ═══════════════════════════════════════════════════════════════════════════════
#   SUPABASE HELPERS
# ═══════════════════════════════════════════════════════════════════════════════

def _supa_headers(auth_token: str | None = None) -> dict[str, str]:
    """Return headers for Supabase REST requests."""
    headers = {
        "apikey": _SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
    }
    if auth_token:
        headers["Authorization"] = f"Bearer {auth_token}"
    else:
        headers["Authorization"] = f"Bearer {_SUPABASE_ANON_KEY}"
    return headers


def fetch_user_song_stats(user_id: str, auth_token: str | None = None) -> list[dict]:
    """
    Fetch per-user per-song stats from Supabase.
    Returns list of user_song_stats rows, or empty list on failure.
    Never raises — recommendation failure must not crash the player.
    """
    if not _SUPABASE_URL or not user_id:
        return []
    try:
        url = (
            f"{_SUPABASE_URL}/rest/v1/user_song_stats"
            f"?user_id=eq.{user_id}&order=last_played_at.desc&limit=200"
        )
        resp = requests.get(url, headers=_supa_headers(auth_token), timeout=4)
        if resp.status_code == 200:
            return resp.json() or []
        logger.warning("user_song_stats fetch returned %s", resp.status_code)
    except Exception as exc:
        logger.warning("fetch_user_song_stats failed: %s", exc)
    return []


def upsert_user_song_stats(
    user_id: str,
    song_id: str,
    song_data: dict,
    event_type: str,
    listen_seconds: float | None,
    listen_fraction: float | None,
    auth_token: str | None = None,
) -> bool:
    """
    Atomically update user_song_stats for one event.
    Uses Supabase REST upsert with POST-merge semantics.
    Returns True on success, False on failure.
    """
    if not _SUPABASE_URL or not user_id:
        return False

    # Build the upsert payload depending on event type
    payload: dict[str, Any] = {
        "user_id": user_id,
        "song_id": song_id,
        "song_data": song_data,
        "last_played_at": "now()",
        "updated_at": "now()",
    }

    # We cannot do server-side increments through the REST upsert directly,
    # so we use a RPC approach — but to avoid adding a DB function dependency
    # we fetch+update in Python. This is acceptable for event rates <~10/sec.
    # For high-scale production, replace with a PostgreSQL function.
    try:
        url = f"{_SUPABASE_URL}/rest/v1/user_song_stats?user_id=eq.{user_id}&song_id=eq.{song_id}"
        existing_resp = requests.get(url, headers=_supa_headers(auth_token), timeout=3)
        existing: dict = {}
        if existing_resp.status_code == 200:
            rows = existing_resp.json()
            existing = rows[0] if rows else {}

        play_count        = existing.get("play_count", 0)
        skip_count        = existing.get("skip_count", 0)
        complete_count    = existing.get("complete_count", 0)
        total_listen_sec  = existing.get("total_listen_seconds", 0.0)
        is_liked          = existing.get("is_liked", False)
        playlist_add_count = existing.get("playlist_add_count", 0)

        # Safeguard listen_seconds against negative or runaway values (clamp to 0–300 sec delta per event)
        valid_delta = 0.0
        if listen_seconds is not None:
            try:
                valid_delta = max(0.0, min(float(listen_seconds), 300.0))
            except (ValueError, TypeError):
                valid_delta = 0.0

        if event_type == "play_started":
            play_count += 1
        elif event_type in ("play_completed", "play_progress"):
            complete_count += 1 if event_type == "play_completed" else 0
            total_listen_sec += valid_delta
        elif event_type == "song_skipped":
            skip_count += 1
            total_listen_sec += valid_delta
        elif event_type == "song_liked":
            is_liked = True
        elif event_type == "song_unliked":
            is_liked = False
        elif event_type == "playlist_added":
            playlist_add_count += 1

        total_listen_sec = round(total_listen_sec, 1)

        upsert_payload = {
            "user_id":               user_id,
            "song_id":               song_id,
            "song_data":             song_data,
            "play_count":            play_count,
            "skip_count":            skip_count,
            "complete_count":        complete_count,
            "total_listen_seconds":  total_listen_sec,
            "is_liked":              is_liked,
            "playlist_add_count":    playlist_add_count,
            "last_played_at":        "now()",
            "updated_at":            "now()",
        }
        if not existing:
            upsert_payload["first_played_at"] = "now()"

        upsert_url = f"{_SUPABASE_URL}/rest/v1/user_song_stats"
        headers = _supa_headers(auth_token)
        headers["Prefer"] = "resolution=merge-duplicates"
        upsert_resp = requests.post(upsert_url, json=upsert_payload, headers=headers, timeout=4)
        return upsert_resp.status_code in (200, 201, 204)

    except Exception as exc:
        logger.warning("upsert_user_song_stats failed: %s", exc)
        return False


def insert_listening_event(
    user_id: str | None,
    song_id: str,
    song_data: dict,
    event_type: str,
    listen_seconds: float | None = None,
    listen_fraction: float | None = None,
    metadata: dict | None = None,
    auth_token: str | None = None,
) -> bool:
    """Insert one raw listening event into the listening_events table."""
    if not _SUPABASE_URL or not user_id:
        # Zero guest persistence: Guest listening events are never persisted to Supabase
        return False
    try:
        payload = {
            "song_id":        song_id,
            "song_data":      song_data,
            "event_type":     event_type,
            "listen_seconds": listen_seconds,
            "listen_fraction": listen_fraction,
            "metadata":       metadata or {},
        }
        if user_id:
            payload["user_id"] = user_id

        url = f"{_SUPABASE_URL}/rest/v1/listening_events"
        resp = requests.post(url, json=payload, headers=_supa_headers(auth_token), timeout=4)
        return resp.status_code in (200, 201, 204)
    except Exception as exc:
        logger.warning("insert_listening_event failed: %s", exc)
        return False


# ═══════════════════════════════════════════════════════════════════════════════
#   TEXT HELPERS
# ═══════════════════════════════════════════════════════════════════════════════

def _normalise(text) -> str:
    """Lowercase + collapse whitespace."""
    if isinstance(text, dict):
        text = text.get("name") or ""
    return re.sub(r"\s+", " ", str(text or "").lower().strip())


def _token_overlap(a: str, b: str) -> float:
    """
    Jaccard-like token overlap between two strings.
    Returns 0.0–1.0.
    Short-circuits to 0 if either string is empty.
    """
    if not a or not b:
        return 0.0
    tokens_a = set(_normalise(a).split())
    tokens_b = set(_normalise(b).split())
    if not tokens_a or not tokens_b:
        return 0.0
    intersection = tokens_a & tokens_b
    union = tokens_a | tokens_b
    return len(intersection) / len(union)


# Genre/mood keyword taxonomy — maps slug → keywords present in song title/artist text
GENRE_KEYWORDS: dict[str, list[str]] = {
    "bollywood":     ["bollywood", "hindi", "filmy", "indian", "desi"],
    "hip-hop":       ["hip hop", "hiphop", "rap", "trap", "drill"],
    "rap":           ["rap", "rapper", "cypher", "bars"],
    "pop":           ["pop", "chart", "radio"],
    "rock":          ["rock", "band", "guitar", "punk", "metal"],
    "electronic-edm":["edm", "electronic", "dj", "remix", "club", "dance"],
    "lo-fi":         ["lofi", "lo-fi", "chill", "study", "beats"],
    "rnb-soul":      ["r&b", "soul", "smooth", "groove"],
    "classical":     ["classical", "orchestra", "symphony", "instrumental"],
    "jazz":          ["jazz", "blues", "swing"],
    "acoustic":      ["acoustic", "unplugged", "folk"],
    "punjabi":       ["punjabi", "bhangra", "jatt"],
    "devotional":    ["devotional", "bhajan", "mantra", "spiritual"],
}

MOOD_KEYWORDS: dict[str, list[str]] = {
    "happy":         ["happy", "upbeat", "joyful", "fun", "party", "celebration"],
    "sad":           ["sad", "heartbreak", "emotional", "tears", "lonely", "miss"],
    "chill":         ["chill", "lofi", "relax", "calm", "peaceful", "vibes"],
    "romantic":      ["romantic", "love", "romance", "pyar", "dil"],
    "energetic":     ["energetic", "pump", "workout", "gym", "power", "party"],
    "focus":         ["focus", "study", "concentration", "ambient", "instrumental"],
    "melancholic":   ["melancholic", "nostalgic", "bittersweet", "yearning"],
}


def _genre_score_for_song(song: dict, user_genres: list[str]) -> float:
    """
    Score 0.0–1.0: how well this song's title+artist text matches
    the user's selected genre keywords.
    Returns 0.0 if user has no genre preferences.
    """
    if not user_genres:
        return 0.5  # neutral when no prefs — don't penalise

    combined_text = _normalise(f"{song.get('title', '')} {song.get('artist', '')}")
    best = 0.0
    for genre_slug in user_genres:
        keywords = GENRE_KEYWORDS.get(genre_slug, [genre_slug.replace("-", " ")])
        for kw in keywords:
            if kw in combined_text:
                best = max(best, 0.8)
                break
        # Partial: genre name itself as token overlap
        best = max(best, _token_overlap(genre_slug.replace("-", " "), combined_text))
    return min(best, 1.0)


def _mood_score_for_song(song: dict, user_moods: list[str]) -> float:
    """Score 0.0–1.0: mood keyword overlap."""
    if not user_moods:
        return 0.5
    combined_text = _normalise(f"{song.get('title', '')} {song.get('artist', '')}")
    best = 0.0
    for mood in user_moods:
        keywords = MOOD_KEYWORDS.get(mood.lower(), [mood.lower()])
        for kw in keywords:
            if kw in combined_text:
                best = max(best, 0.9)
                break
        best = max(best, _token_overlap(mood.lower(), combined_text))
    return min(best, 1.0)


def _combined_genre_mood_score(song: dict, user_genres: list[str], user_moods: list[str]) -> float:
    """Weighted average of genre and mood scores."""
    g = _genre_score_for_song(song, user_genres)
    m = _mood_score_for_song(song, user_moods)
    # If both signals available: 60/40 split
    # If only one: use that one alone
    if user_genres and user_moods:
        return 0.6 * g + 0.4 * m
    if user_genres:
        return g
    if user_moods:
        return m
    return 0.5  # fully neutral


def _artist_preference_score(song: dict, user_artists: list[str]) -> float:
    """
    Score 0.0–1.0: how well the song's artist matches user's favourite artists.
    Exact match → 1.0. Partial match → proportional. No prefs → 0.5.
    """
    if not user_artists:
        return 0.5
    song_artist = _normalise(song.get("artist", ""))
    if not song_artist:
        return 0.3
    best = 0.0
    for pref_artist in user_artists:
        if isinstance(pref_artist, dict):
            pref_artist = pref_artist.get("name", "")
        pref_norm = _normalise(pref_artist)
        if pref_norm and pref_norm in song_artist:
            best = max(best, 1.0)
        elif pref_norm:
            best = max(best, _token_overlap(pref_norm, song_artist))
    return min(best, 1.0)


def _extract_artist_stats(stats_list: list[dict]) -> dict[str, dict]:
    """
    Aggregate user listening history across songs by normalized artist name.
    Returns mapping: artist_normalized -> {
        'plays': int,
        'skips': int,
        'completes': int,
        'likes': int,
        'listen_sec': float,
        'raw_name': str
    }
    """
    stats: dict[str, dict] = defaultdict(lambda: {
        "plays": 0, "skips": 0, "completes": 0, "likes": 0, "listen_sec": 0.0, "raw_name": ""
    })
    for row in stats_list or []:
        song_data = row.get("song_data") or {}
        raw_artist = (song_data.get("artist") or "").strip()
        norm_artist = _normalise(raw_artist)
        if not norm_artist or norm_artist in ("unknown artist", "unknown"):
            continue
        entry = stats[norm_artist]
        if not entry["raw_name"]:
            entry["raw_name"] = raw_artist
        entry["plays"] += row.get("play_count", 0)
        entry["skips"] += row.get("skip_count", 0)
        entry["completes"] += row.get("complete_count", 0)
        if row.get("is_liked"):
            entry["likes"] += 1
        try:
            entry["listen_sec"] += float(row.get("total_listen_seconds", 0.0))
        except (ValueError, TypeError):
            pass
    return stats


def _get_top_history_artists(artist_stats: dict[str, dict], limit: int = 3) -> list[str]:
    """
    Rank artists from user history by positive engagement affinity:
    affinity = likes*3.0 + completes*1.5 + plays*1.0 - skips*0.5 + min(listen_sec/180.0, 5.0)
    Returns list of artist display names.
    """
    ranked = []
    for norm_a, data in artist_stats.items():
        affinity = (
            data["likes"] * 3.0 +
            data["completes"] * 1.5 +
            data["plays"] * 1.0 -
            data["skips"] * 0.5 +
            min(data["listen_sec"] / 180.0, 5.0)
        )
        if affinity > 0.5:
            ranked.append((affinity, data["raw_name"] or norm_a))
    ranked.sort(key=lambda x: x[0], reverse=True)
    return [name for _, name in ranked[:limit]]


def _listening_history_score(song: dict, stats_by_song: dict[str, dict]) -> float:
    """
    Score 0.0–1.0 from the user's listening history for this song.
    Liked songs get a strong boost. Frequently played → moderate boost.
    Heavily skipped → penalty. Brand-new song (no history) → neutral 0.5.
    """
    song_id = song.get("id", "")
    stats = stats_by_song.get(song_id)
    if not stats:
        return 0.5  # no history → neutral

    play_count     = stats.get("play_count", 0)
    skip_count     = stats.get("skip_count", 0)
    complete_count = stats.get("complete_count", 0)
    is_liked       = stats.get("is_liked", False)
    pl_adds        = stats.get("playlist_add_count", 0)

    score = 0.5  # base

    # Positive signals
    if is_liked:
        score += LIKED_SONG_BOOST
    if play_count > 0:
        # Log-diminishing returns: 0.1 per doubling of plays, capped at 0.2
        score += min(0.2, 0.1 * math.log2(1 + play_count))
    if complete_count > 0:
        # Completion is a strong positive signal
        completion_rate = complete_count / max(play_count, 1)
        score += 0.1 * completion_rate
    if pl_adds > 0:
        score += min(0.1, 0.05 * pl_adds)

    # Skip penalty
    if skip_count > 0:
        penalty = min(MAX_SKIP_PENALTY, SKIP_PENALTY_PER_SKIP * skip_count)
        score -= penalty

    return max(0.0, min(1.0, score))


def _audio_characteristics_score(song: dict) -> float:
    """
    Score 0.0–1.0 based on audio characteristics.
    Since we only have YouTube metadata (duration, view_count),
    we use duration fitness and log-scaled popularity.
    """
    duration   = song.get("duration", 0) or 0
    view_count = song.get("viewCount", 0) or 0

    # Duration score: peaks at 3–4 min, falls off at extremes
    if DURATION_MIN_IDEAL <= duration <= DURATION_MAX_IDEAL:
        dur_score = 1.0
    elif duration < DURATION_MIN_IDEAL and duration > 0:
        dur_score = duration / DURATION_MIN_IDEAL
    elif duration > DURATION_MAX_IDEAL:
        # Longer songs get a gentle falloff, not a cliff
        excess = duration - DURATION_MAX_IDEAL
        dur_score = max(0.3, 1.0 - (excess / 600))
    else:
        dur_score = 0.3  # unknown duration

    # Popularity score: log-scale view count, normalised to ~0–1
    # 1M views → ~0.5; 10M → ~0.7; 100M → ~0.9
    if view_count > 0:
        pop_score = min(1.0, math.log10(view_count) / 8.0)
    else:
        pop_score = 0.2  # unknown views → slight penalty

    return 0.6 * dur_score + 0.4 * pop_score


def _discovery_score(song: dict, result_artist_counts: dict[str, int]) -> float:
    """
    Discovery score penalises over-representation of the same artist.
    First song from an artist → 1.0.
    Second → 0.5. Third+ → 0.1.
    """
    artist = _normalise(song.get("artist", "unknown"))
    count  = result_artist_counts.get(artist, 0)
    if count == 0:
        return 1.0
    if count == 1:
        return 0.5
    return 0.1  # strongly penalise artist monopoly


# ═══════════════════════════════════════════════════════════════════════════════
#   RECENCY PENALTY
# ═══════════════════════════════════════════════════════════════════════════════

def _recency_multiplier(song: dict, stats_by_song: dict[str, dict]) -> float:
    """
    Returns a multiplier ≤ 1.0 if the song was played very recently.
    Songs played in the last hour get RECENT_PLAY_PENALTY (0.6×).
    Songs never played → 1.0 (no penalty).
    """
    song_id = song.get("id", "")
    stats   = stats_by_song.get(song_id)
    if not stats or not stats.get("last_played_at"):
        return 1.0

    last_played_str = stats["last_played_at"]
    try:
        from datetime import datetime, timezone
        last_played = datetime.fromisoformat(last_played_str.replace("Z", "+00:00"))
        now         = datetime.now(timezone.utc)
        age_seconds = (now - last_played).total_seconds()
        if age_seconds < RECENT_PLAY_WINDOW_SEC:
            return RECENT_PLAY_PENALTY
    except Exception:
        pass  # malformed timestamp → no penalty
    return 1.0


# ═══════════════════════════════════════════════════════════════════════════════
#   MAIN SCORING FUNCTION
# ═══════════════════════════════════════════════════════════════════════════════

def score_candidate(
    song: dict,
    *,
    user_genres: list[str],
    user_moods:  list[str],
    user_artists: list[str],
    stats_by_song: dict[str, dict],
    result_artist_counts: dict[str, int],
    excluded_ids: set[str],
    artist_stats: dict[str, dict] | None = None,
) -> float | None:
    """
    Compute a composite recommendation score for one candidate song.
    Returns None if the song should be excluded entirely.
    Returns float 0.0–1.0+ (can exceed 1.0 before normalisation).
    """
    song_id = song.get("id", "")

    # Hard exclusions
    if not song_id:
        return None
    if song_id in excluded_ids:
        return None

    # Sub-scores (all 0.0–1.0)
    gm   = _combined_genre_mood_score(song, user_genres, user_moods)
    ap   = _artist_preference_score(song, user_artists)
    hist = _listening_history_score(song, stats_by_song)
    ac   = _audio_characteristics_score(song)
    disc = _discovery_score(song, result_artist_counts)

    w = SCORE_WEIGHTS
    composite = (
        w["genre_mood_similarity"]  * gm   +
        w["artist_preference"]      * ap   +
        w["listening_history"]      * hist +
        w["audio_characteristics"]  * ac   +
        w["discovery"]              * disc
    )

    # Soft negative dampening if user has consistent skip pattern for this artist (skips >= 2 and skips > plays)
    if artist_stats:
        artist_norm = _normalise(song.get("artist", ""))
        a_stat = artist_stats.get(artist_norm)
        if a_stat:
            skips = a_stat.get("skips", 0)
            plays = a_stat.get("plays", 0)
            if skips >= 2 and skips > plays:
                damp = min(0.15, 0.05 * (skips - plays))
                composite = max(0.0, composite - damp)

    # Apply recency penalty as a multiplier (after weighted sum)
    composite *= _recency_multiplier(song, stats_by_song)

    return composite


# ═══════════════════════════════════════════════════════════════════════════════
#   CANDIDATE FETCHING (via yt-dlp)
# ═══════════════════════════════════════════════════════════════════════════════

def _fetch_candidates_ytdlp(query: str, limit: int = MAX_CANDIDATES) -> list[dict]:
    """
    Fetch candidate songs from YouTube via yt-dlp flat extraction.
    Applies the same duration filter as /api/browse (1–10 min).
    Returns a list of song dicts.
    """
    cache_key = f"reco:{query}"
    now = time.time()
    if cache_key in _candidate_cache:
        cached_songs, cached_at = _candidate_cache[cache_key]
        if now - cached_at < CACHE_TTL_SEC:
            return cached_songs

    try:
        import yt_dlp  # imported lazily — not available in unit tests

        ydl_opts = {"extract_flat": "in_playlist", "quiet": True, "no_warnings": True}
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(f"ytsearch{limit * 3}:{query}", download=False)
            entries = info.get("entries", []) or []

        songs = []
        for entry in entries:
            if not entry:
                continue
            vid_id   = entry.get("id")
            duration = entry.get("duration") or 0
            if not vid_id or duration < 60 or duration > 600:
                continue
            thumbnail = f"https://i.ytimg.com/vi/{vid_id}/mqdefault.jpg"
            thumbs    = entry.get("thumbnails") or []
            if thumbs:
                thumbnail = thumbs[-1].get("url") or thumbs[0].get("url") or thumbnail
            songs.append({
                "id":           vid_id,
                "title":        entry.get("title") or "Unknown Title",
                "artist":       entry.get("uploader") or "Unknown Artist",
                "thumbnailUrl": thumbnail,
                "duration":     int(duration),
                "viewCount":    entry.get("view_count") or 0,
            })
            if len(songs) >= limit:
                break

        _candidate_cache[cache_key] = (songs, now)
        return songs

    except Exception as exc:
        logger.warning("_fetch_candidates_ytdlp failed for query '%s': %s", query, exc)
        return []


def _build_query_from_prefs(
    user_genres: list[str],
    user_artists: list[str],
    user_moods: list[str],
    current_song: dict | None,
) -> str:
    """
    Build a yt-dlp search query that covers the user's tastes.
    Prioritises the current song's artist, then user artists, then genres.
    """
    parts: list[str] = []

    # Current song context: find similar songs by the same artist
    if current_song:
        ca = (current_song.get("artist") or "").strip()
        if ca and ca.lower() not in ("unknown artist", ""):
            parts.append(ca)

    # Add up to 2 favourite artists
    for artist in (user_artists or [])[:2]:
        raw_name = artist if isinstance(artist, str) else (artist.get("name") if isinstance(artist, dict) else "")
        a = (raw_name or "").strip()
        if a and a not in parts:
            parts.append(a)

    # Mood keyword
    mood_map = {
        "chill": "chill vibes", "happy": "upbeat happy",
        "sad": "emotional sad", "romantic": "romantic love",
        "energetic": "energetic pump", "focus": "focus instrumental",
    }
    for mood in (user_moods or [])[:1]:
        kw = mood_map.get(mood.lower(), mood)
        parts.append(kw)

    # Genre suffix
    genre_suffix_map = {
        "bollywood": "hindi bollywood songs",
        "pop": "pop songs official",
        "lo-fi": "lofi chill beats",
        "hip-hop": "hip hop rap official",
        "punjabi": "punjabi songs official",
        "rnb-soul": "r&b soul official",
    }
    for genre in (user_genres or [])[:1]:
        suffix = genre_suffix_map.get(genre, f"{genre} songs official")
        parts.append(suffix)

    if not parts:
        # Cold start: generic trending fallback
        parts = ["trending songs official music video india"]

    query = " ".join(parts[:5])
    return query


# ═══════════════════════════════════════════════════════════════════════════════
#   PUBLIC API
# ═══════════════════════════════════════════════════════════════════════════════

def get_next_recommendations(
    *,
    user_id: str | None,
    user_genres: list[str],
    user_moods: list[str],
    user_artists: list[str],
    current_song: dict | None,
    exclude_ids: list[str],
    limit: int = RESULT_LIMIT_DEFAULT,
    auth_token: str | None = None,
) -> list[dict]:
    """
    Return up to `limit` recommended songs for the autoplay queue.

    Args:
        user_id:      Authenticated Supabase user ID, or None for guests.
        user_genres:  User's onboarding genre slugs (e.g. ['bollywood', 'pop']).
        user_moods:   User's mood preferences (e.g. ['chill', 'romantic']).
        user_artists: User's favourite artist names.
        current_song: The song currently playing (dict with id, title, artist).
        exclude_ids:  Song IDs to exclude (recently played, current queue, etc.).
        limit:        Max songs to return.
        auth_token:   Supabase JWT for fetching user history.

    Returns:
        Sorted list of song dicts, best recommendation first.
    """
    limit = min(limit, 20)  # hard cap to avoid abuse

    # 1. Fetch user's listening history stats (safe — returns [] on failure)
    stats_list    = fetch_user_song_stats(user_id, auth_token) if user_id else []
    stats_by_song = {row["song_id"]: row for row in stats_list}
    artist_stats  = _extract_artist_stats(stats_list)
    top_history_artists = _get_top_history_artists(artist_stats, limit=3)

    # 2. Derive effective artists: merge explicit preferences with top history artists
    effective_artists = list(user_artists or [])
    for ha in top_history_artists:
        if not any(_normalise(ha) == _normalise(ea) for ea in effective_artists):
            effective_artists.append(ha)

    excluded = set(exclude_ids or [])
    if current_song and current_song.get("id"):
        excluded.add(current_song.get("id"))

    # 3. Seed candidates with eligible liked / high-engagement songs from history
    candidates: list[dict] = []
    seen_ids: set[str] = set()

    for row in stats_list:
        sid = row.get("song_id")
        sdata = row.get("song_data") or {}
        if sid and sid not in excluded and sid not in seen_ids and sdata.get("id"):
            if row.get("is_liked") or (row.get("complete_count", 0) >= 2 and row.get("skip_count", 0) == 0):
                candidates.append(sdata)
                seen_ids.add(sid)

    # 4. Fetch YouTube candidates using effective preferences
    query = _build_query_from_prefs(user_genres, effective_artists, user_moods, current_song)
    yt_candidates = _fetch_candidates_ytdlp(query, limit=MAX_CANDIDATES)
    for s in yt_candidates:
        if s["id"] not in seen_ids:
            candidates.append(s)
            seen_ids.add(s["id"])

    # 5. If candidates pool is still small, add query based on top history artist or trending discovery
    if len(candidates) < limit * 2:
        if top_history_artists:
            secondary_query = f"{top_history_artists[0]} songs official music video"
        else:
            secondary_query = "trending hit songs official music video"
        extra = _fetch_candidates_ytdlp(secondary_query, limit=MAX_CANDIDATES // 2)
        for s in extra:
            if s["id"] not in seen_ids:
                candidates.append(s)
                seen_ids.add(s["id"])

    # 6. Dynamic Greedy Diversified Selection (MMR-style)
    # Iteratively select the highest-scoring candidate while updating chosen_artist_counts
    # so _discovery_score dynamically penalizes artist concentration and respects ARTIST_DIVERSITY_CAP.
    remaining = [s for s in candidates if s.get("id") and s["id"] not in excluded]

    results: list[dict] = []
    chosen_artist_counts: dict[str, int] = defaultdict(int)

    while len(results) < limit and remaining:
        best_score = -1.0
        best_idx = -1

        for idx, song in enumerate(remaining):
            artist_key = _normalise(song.get("artist", "unknown"))
            if chosen_artist_counts[artist_key] >= ARTIST_DIVERSITY_CAP:
                continue

            score = score_candidate(
                song,
                user_genres=user_genres,
                user_moods=user_moods,
                user_artists=effective_artists,
                stats_by_song=stats_by_song,
                result_artist_counts=chosen_artist_counts,
                excluded_ids=excluded,
                artist_stats=artist_stats,
            )
            if score is not None and score > best_score:
                best_score = score
                best_idx = idx

        if best_idx == -1:
            if not results and remaining:
                fallback_song = remaining.pop(0)
                results.append(fallback_song)
                artist_key = _normalise(fallback_song.get("artist", "unknown"))
                chosen_artist_counts[artist_key] += 1
                continue
            break

        chosen_song = remaining.pop(best_idx)
        results.append(chosen_song)
        artist_key = _normalise(chosen_song.get("artist", "unknown"))
        chosen_artist_counts[artist_key] += 1

    logger.info(
        "Recommendations: %d candidates → %d results (user=%s, top_artists=%s)",
        len(candidates), len(results), user_id or "guest", top_history_artists[:2],
    )
    return results


def get_similar_songs(
    *,
    current_song: dict,
    user_id: str | None,
    exclude_ids: list[str],
    limit: int = 10,
    auth_token: str | None = None,
) -> list[dict]:
    """
    Return songs similar to `current_song`.
    Uses the song's artist name as primary query signal.
    """
    artist = (current_song.get("artist") or "").strip()
    title  = (current_song.get("title")  or "").strip()

    # Build a similarity query: artist + truncated title words
    title_words = " ".join(title.split()[:4])
    query = f"{artist} {title_words} official music video" if artist else f"{title_words} official music video"

    # Reuse the scoring engine with song-specific preferences
    return get_next_recommendations(
        user_id=user_id,
        user_genres=[],      # content similarity, not genre prefs
        user_moods=[],
        user_artists=[artist] if artist else [],
        current_song=current_song,
        exclude_ids=exclude_ids,
        limit=limit,
        auth_token=auth_token,
    )


def get_home_sections(
    *,
    user_id: str | None,
    user_genres: list[str],
    user_moods: list[str],
    user_artists: list[str],
    limit_per_section: int = 10,
    auth_token: str | None = None,
) -> dict:
    """
    Build personalized home screen sections.
    Returns a dict with section names mapped to song lists.

    Sections:
        made_for_you  — hybrid mix based on all user prefs
        because_you   — per-artist "because you listen to X" sections (up to 2)
        discover_more — exploration songs (genre-diverse, new artists)
    """
    all_exclude: set[str] = set()

    # Section 1: Made for You
    made_for_you = get_next_recommendations(
        user_id=user_id,
        user_genres=user_genres,
        user_moods=user_moods,
        user_artists=user_artists,
        current_song=None,
        exclude_ids=list(all_exclude),
        limit=limit_per_section,
        auth_token=auth_token,
    )
    all_exclude.update(s["id"] for s in made_for_you)

    # Section 2: Because You Listened To [Artist] (top 2 fav artists)
    effective_home_artists = list(user_artists or [])
    if not effective_home_artists and user_id:
        stats_list = fetch_user_song_stats(user_id, auth_token)
        artist_stats = _extract_artist_stats(stats_list)
        effective_home_artists = _get_top_history_artists(artist_stats, limit=2)

    because_you_sections: list[dict] = []
    for artist_entry in effective_home_artists[:2]:
        artist = artist_entry if isinstance(artist_entry, str) else (artist_entry.get("name") if isinstance(artist_entry, dict) else "")
        if not artist:
            continue
        songs = get_next_recommendations(
            user_id=user_id,
            user_genres=[],
            user_moods=[],
            user_artists=[artist],
            current_song=None,
            exclude_ids=list(all_exclude),
            limit=limit_per_section,
            auth_token=auth_token,
        )
        if songs:
            because_you_sections.append({"artist": artist, "songs": songs})
            all_exclude.update(s["id"] for s in songs)

    # Section 3: Discover More (diversified — genres other than user's top)
    # Use a broad discovery query to surface variety
    all_genres = list(GENRE_KEYWORDS.keys())
    discover_genres = [g for g in all_genres if g not in (user_genres or [])][:3]
    discover = get_next_recommendations(
        user_id=user_id,
        user_genres=discover_genres,
        user_moods=[],
        user_artists=[],
        current_song=None,
        exclude_ids=list(all_exclude),
        limit=limit_per_section,
        auth_token=auth_token,
    )

    return {
        "made_for_you":        made_for_you,
        "because_you":         because_you_sections,
        "discover_more":       discover,
        "has_personalisation": bool(user_id and (user_genres or effective_home_artists)),
    }

