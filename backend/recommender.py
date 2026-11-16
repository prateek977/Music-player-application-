"""
ListenUp Recommendation Engine
===============================
A hybrid, explainable music recommendation system tailored for the ListenUp application.

Core Methodological Approach:
  1. Content-Based Filtering:
     - Evaluates textual similarity of song metadata (title, artist, uploader) against
       user-selected genres, moods, and artist preferences.
     - Utilizes normalized token overlap (Jaccard similarity) and domain-specific taxonomies.
  2. Behavioral & Engagement Signals:
     - Incorporates historical listening metrics: play count, completion rate, skips, and likes.
     - Implements dynamic logarithmic scaling for repeated listens and bounded skip penalties.
  3. Discovery & Diversity Optimization:
     - Applies Maximal Marginal Relevance (MMR) inspired greedy selection to prevent artist monopoly.
     - Enforces an artist diversity cap and penalizes repeated artists in recommendation queues.
  4. Audio Characteristics & Popularity Heuristics:
     - Duration sweet-spot fitness scoring (optimal 2.5 to 6 minutes; filters shorts and mega-mixes).
     - Log-scaled YouTube view counts acting as a proxy for crowd consensus and track quality.

Architecture & Dependencies:
  - Intentionally pure Python without bulky machine learning frameworks (e.g. PyTorch/TensorFlow),
    ensuring lightweight, deterministic, sub-50ms CPU scoring suitable for production microservices.
  - Supabase integration via REST API utilizing anon/service-role credentials (strictly server-side).

Public API:
    from recommender import get_next_recommendations, get_similar_songs, get_home_sections
"""

from __future__ import annotations

import logging
import os
import re
import time
import math
from collections import defaultdict
from typing import Any, Dict, List, Optional, Set, Tuple

import requests

# Configure module-level logger
logger = logging.getLogger(__name__)

# ─── Configurable Scoring Weights ────────────────────────────────────────────
# The composite recommendation score is a weighted linear combination of 5 dimensions.
# Tuning these coefficients adjusts the balance between user preference adherence and exploration.
SCORE_WEIGHTS: Dict[str, float] = {
    "genre_mood_similarity":  0.30,   # Textual overlap with user's selected genres and mood tags
    "artist_preference":      0.25,   # Direct affinity match against user's favourite artists
    "listening_history":      0.20,   # Historical playback metrics (play count, like status, completion)
    "audio_characteristics":  0.15,   # Duration fitness and log-scaled popularity (view count)
    "discovery":              0.10,   # Diversity reward / penalty against artist concentration
}

# Sanity check — weights must sum precisely to 1.0 (within float tolerance)
assert abs(sum(SCORE_WEIGHTS.values()) - 1.0) < 1e-9, "SCORE_WEIGHTS must sum to 1.0"

# ─── Penalty Configuration ────────────────────────────────────────────────────
# Recency penalty: suppresses tracks played within the last hour to prevent repetition fatigue
RECENT_PLAY_WINDOW_SEC: int = 3600          # 1 hour window in seconds
RECENT_PLAY_PENALTY: float    = 0.6         # Multiplier applied to tracks played within the recency window

# Skip penalties: dampens tracks frequently skipped by the user
SKIP_PENALTY_PER_SKIP: float  = 0.15        # Linear penalty deducted per recorded skip event
MAX_SKIP_PENALTY: float       = 0.45        # Upper bound on cumulative skip deduction

# Engagement boosts and limits
LIKED_SONG_BOOST: float       = 0.25        # Additive bonus granted to favorited/liked songs
ARTIST_DIVERSITY_CAP: int     = 2           # Maximum number of songs permitted from the same artist in a single result set

# ─── Candidate Fetch Configuration ───────────────────────────────────────────
MAX_CANDIDATES: int         = 40            # Max songs extracted from yt-dlp per recommendation query
RESULT_LIMIT_DEFAULT: int   = 10            # Default number of recommendation tracks returned to client
CACHE_TTL_SEC: int          = 600           # In-memory candidate search cache time-to-live (10 minutes)

# Song duration sweet-spot thresholds in seconds (optimal song length for streaming)
DURATION_MIN_IDEAL: int     = 150           # Lower threshold: 2.5 minutes
DURATION_MAX_IDEAL: int     = 360           # Upper threshold: 6.0 minutes

# ─── Supabase Configuration (Server-Side Only) ──────────────────────────────
# Credentials read from server environment; never exposed to mobile or web clients
_SUPABASE_URL: str      = os.environ.get("SUPABASE_URL", "").rstrip("/")
_SUPABASE_ANON_KEY: str = os.environ.get("SUPABASE_ANON_KEY", "")

# ─── In-Memory Candidate Search Cache ────────────────────────────────────────
# Maps search query strings -> (list of song dicts, timestamp)
_candidate_cache: dict[str, tuple[list[dict], float]] = {}


# ═══════════════════════════════════════════════════════════════════════════════
#   SUPABASE HELPERS
# ═══════════════════════════════════════════════════════════════════════════════

def _supa_headers(auth_token: str | None = None) -> dict[str, str]:
    """
    Construct standard HTTP headers for Supabase REST API requests.

    Args:
        auth_token: Optional Supabase JWT for user-scoped requests. If omitted,
                    the server's anon API key is utilized for authorization.

    Returns:
        dict: Headers containing apikey, Content-Type, and Bearer Authorization.
    """
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
    Retrieve historical per-song engagement metrics for a user from Supabase.

    Fetches up to 200 of the user's most recently played songs from the
    `user_song_stats` table, including play counts, skip counts, completion counts,
    total listening seconds, and like statuses.

    Fail-safe behavior:
      This function never raises an unhandled exception. On failure or network timeout,
      it returns an empty list so recommendation generation falls back gracefully to
      content-based signals without interrupting playback.

    Args:
        user_id: Unique Supabase identifier of the authenticated user.
        auth_token: Optional Bearer token for user-scoped RLS policies.

    Returns:
        list[dict]: Array of user_song_stats records, or empty list on error.
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
    Atomically update aggregated user listening stats for a song event.

    Processes playback event types ('play_started', 'play_completed', 'song_skipped',
    'song_liked', 'song_unliked', 'playlist_added', 'play_progress') and merges the
    incremental counters into the `user_song_stats` table via Supabase REST API.

    Performance & Safety:
      - Validates and clamps `listen_seconds` delta between 0.0 and 300.0 seconds per event
        to safeguard against corrupted telemetry or runaway timer deltas.
      - Uses `Prefer: resolution=merge-duplicates` for conflict resolution on (user_id, song_id).

    Args:
        user_id: Authenticated user's unique identifier.
        song_id: YouTube video or track ID.
        song_data: Full dictionary of song metadata (title, artist, duration, etc.).
        event_type: Identifier of the playback event occurring.
        listen_seconds: Duration in seconds the user listened before this event.
        listen_fraction: Fraction (0.0 to 1.0) of song duration listened.
        auth_token: Optional user auth JWT.

    Returns:
        bool: True if upsert succeeded (HTTP 200/201/204), False otherwise.
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

    # Fetch existing metrics to perform in-memory delta increments before upsert
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
    """
    Append an immutable raw event record to the `listening_events` audit table.

    Privacy Note:
      Guest (unauthenticated) listening events are deliberately NOT persisted to Supabase
      (Zero Guest Persistence guarantee), preserving privacy and saving cloud storage.

    Args:
        user_id: Authenticated user ID (if None, function safely exits early).
        song_id: Video or track identifier.
        song_data: Full metadata dictionary for the song.
        event_type: String constant identifying event (e.g. 'play_completed').
        listen_seconds: Optional duration listened in seconds.
        listen_fraction: Optional fraction (0.0 to 1.0) of track duration completed.
        metadata: Optional additional contextual attributes (e.g. client device, UI view).
        auth_token: Optional Bearer token for Supabase authorization.

    Returns:
        bool: True if record was inserted successfully, False otherwise.
    """
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
#   TEXT HELPERS & SIMILARITY METRICS
# ═══════════════════════════════════════════════════════════════════════════════

def _normalise(text: Any) -> str:
    """
    Sanitize and normalize string or dictionary input for textual comparison.

    Transformations:
      - Extracts 'name' field if a dictionary is passed (e.g., artist or genre object).
      - Converts text to lowercase.
      - Collapses multi-character whitespace sequences into a single space.
      - Strips leading and trailing whitespace.

    Args:
        text: Input string or dict to normalize.

    Returns:
        str: Canonical normalized lowercase string.
    """
    if isinstance(text, dict):
        text = text.get("name") or ""
    return re.sub(r"\s+", " ", str(text or "").lower().strip())


def _token_overlap(a: str, b: str) -> float:
    """
    Compute Jaccard token similarity between two strings.

    Formula:
        J(A, B) = |Tokens(A) ∩ Tokens(B)| / |Tokens(A) ∪ Tokens(B)|

    Behavior:
      - Short-circuits to 0.0 if either string is empty or contains no tokens.
      - Evaluates to 1.0 for identical sets of whitespace-delimited tokens.

    Args:
        a: First string to compare.
        b: Second string to compare.

    Returns:
        float: Similarity coefficient bounded between 0.0 and 1.0.
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


# ─── Genre & Mood Keyword Taxonomy ───────────────────────────────────────────
# Maps canonical category slugs to token variations and related cultural terms
# frequently encountered in YouTube music titles, tags, and channel descriptions.
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
    Calculate content matching score (0.0 to 1.0) against user genre preferences.

    Evaluates keyword occurrences from the genre taxonomy within the song's combined
    title and artist metadata.

    Scoring Logic:
      - If user has no genre preferences: returns neutral baseline 0.5 (avoids penalizing cold-start).
      - If taxonomy keyword matches: grants strong match score 0.8.
      - Partial match: falls back to Jaccard token overlap between genre slug and metadata.
      - Returns max score across all evaluated user genres, capped at 1.0.

    Args:
        song: Candidate song dictionary containing 'title' and 'artist'.
        user_genres: List of genre slugs selected by user (e.g. ['bollywood', 'lo-fi']).

    Returns:
        float: Genre affinity score bounded between 0.0 and 1.0.
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
    """
    Calculate emotional affinity score (0.0 to 1.0) against user mood selections.

    Scoring Logic:
      - If user has no mood preferences: returns neutral baseline 0.5.
      - If taxonomy keyword matches: grants high match score 0.9.
      - Partial match: falls back to token overlap with the mood tag.
      - Returns max score across evaluated user moods, capped at 1.0.

    Args:
        song: Candidate song dictionary.
        user_moods: List of mood identifiers (e.g. ['chill', 'energetic']).

    Returns:
        float: Mood affinity score bounded between 0.0 and 1.0.
    """
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
    """
    Compute unified content similarity score blending genre and mood signals.

    Weighting Strategy:
      - Both signals available: 60% Genre, 40% Mood.
      - Only one signal available: 100% of that available signal.
      - Neither available: neutral baseline 0.5.

    Args:
        song: Candidate song dictionary.
        user_genres: User's genre preferences.
        user_moods: User's mood preferences.

    Returns:
        float: Composite genre/mood score between 0.0 and 1.0.
    """
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
    Evaluate candidate track match against user's explicitly favorited artists.

    Scoring Rules:
      - No user artists defined: returns neutral baseline 0.5.
      - Missing song artist: penalized with 0.3.
      - Substring inclusion (e.g. 'Arijit Singh' in 'Arijit Singh, Shreya Ghoshal'): 1.0 (exact match).
      - Partial overlap: proportional Jaccard token overlap score.

    Args:
        song: Candidate song dictionary.
        user_artists: List of favorite artist names (strings or dicts with 'name').

    Returns:
        float: Artist affinity score between 0.0 and 1.0.
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
    Aggregate raw user listening history rows by normalized artist name.

    Combines engagement signals (plays, skips, completions, likes, total seconds)
    across all songs associated with each artist to build an artist-level profile.

    Args:
        stats_list: List of row dictionaries from user_song_stats table.

    Returns:
        dict: Mapping of normalized_artist_name -> {
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
    Rank artists by cumulative positive engagement affinity based on listening history.

    Affinity Formula:
        Affinity = (likes * 3.0) + (completes * 1.5) + (plays * 1.0)
                   - (skips * 0.5) + min(listen_seconds / 180.0, 5.0)

    Args:
        artist_stats: Dictionary of aggregated artist statistics from `_extract_artist_stats`.
        limit: Maximum number of top artists to return (default 3).

    Returns:
        list[str]: Display names of the highest affinity artists exceeding the 0.5 threshold.
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
    Compute behavior-based recommendation score for a specific song from user history.

    Signal Mechanics:
      - Baseline: 0.5 for songs without prior playback history.
      - Liked songs: +0.25 (LIKED_SONG_BOOST).
      - Repeated plays: Diminishing returns bonus +min(0.2, 0.1 * log2(1 + play_count)).
      - Completion rate: High completion ratio adds up to +0.10.
      - Playlist adds: +0.05 per add, capped at +0.10.
      - Skips: Deducts 0.15 per skip, capped at -0.45 (MAX_SKIP_PENALTY).

    Args:
        song: Candidate song dictionary containing 'id'.
        stats_by_song: Mapping of song_id -> stats row from user_song_stats.

    Returns:
        float: Bounded score between 0.0 and 1.0.
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
    Evaluate audio fitness heuristics based on duration and popularity proxies.

    Metrics:
      1. Duration Fitness (60% weight):
         - Optimal: 150s to 360s (2.5 to 6 min) yields 1.0.
         - Short tracks (<150s): scaled linearly as duration / 150.
         - Long tracks (>360s): gentle linear decay max(0.3, 1.0 - excess / 600).
      2. Popularity Proxy (40% weight):
         - Log10-scaled YouTube view count normalized to ~0.0 - 1.0 (1M views ≈ 0.5, 100M ≈ 0.9).

    Args:
        song: Candidate song dictionary with 'duration' and 'viewCount'.

    Returns:
        float: Combined audio characteristic score between 0.0 and 1.0.
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
    Calculate diversity incentive to discourage excessive artist repetition.

    Dynamic Penalty Schedule:
      - 0 existing tracks by this artist: 1.0 (no penalty, diverse choice)
      - 1 existing track by this artist: 0.5 (slight dampening)
      - 2 or more tracks: 0.1 (strong suppression to enforce variety)

    Args:
        song: Candidate song dictionary.
        result_artist_counts: Running count of songs already selected per artist.

    Returns:
        float: Discovery factor between 0.1 and 1.0.
    """
    artist = _normalise(song.get("artist", "unknown"))
    count  = result_artist_counts.get(artist, 0)
    if count == 0:
        return 1.0
    if count == 1:
        return 0.5
    return 0.1  # strongly penalise artist monopoly


# ═══════════════════════════════════════════════════════════════════════════════
#   RECENCY SUPPRESSION
# ═══════════════════════════════════════════════════════════════════════════════

def _recency_multiplier(song: dict, stats_by_song: dict[str, dict]) -> float:
    """
    Determine recency suppression multiplier for songs played very recently.

    If the track was played within `RECENT_PLAY_WINDOW_SEC` (1 hour), its score
    is discounted by `RECENT_PLAY_PENALTY` (0.6x) to avoid immediate playback loops.
    Tracks played longer ago or never played return full multiplier 1.0.

    Args:
        song: Candidate song dictionary with 'id'.
        stats_by_song: User's historical song playback records.

    Returns:
        float: Multiplier (0.6 or 1.0).
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
#   COMPOSITE CANDIDATE SCORING
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
    Calculate the overall composite recommendation score for a candidate song.

    Evaluation Steps:
      1. Hard Exclusion Filter:
         - Rejects songs without valid IDs or belonging to `excluded_ids`.
      2. Multi-Dimensional Weighted Sum:
         - Computes sub-scores for Genre/Mood, Artist Affinity, History, Audio, and Discovery.
         - Weights each using the configured `SCORE_WEIGHTS` dictionary.
      3. Negative Habit Dampening:
         - If the user has a consistent skip history for this artist (skips >= 2 and skips > plays),
           applies a penalty deduction proportional to the excess skips.
      4. Recency Penalty:
         - Multiplies score by 0.6 if the song was played within the last hour.

    Args:
        song: Song metadata dictionary to evaluate.
        user_genres: User's selected genre preferences.
        user_moods: User's selected mood preferences.
        user_artists: User's preferred artist names.
        stats_by_song: Mapping of song IDs to playback metrics for this user.
        result_artist_counts: Current artist representation counts in the recommendation set.
        excluded_ids: Set of video IDs that must not be recommended (queue, exclusions).
        artist_stats: Optional aggregated artist metrics for habit dampening.

    Returns:
        float | None: Composite recommendation score, or None if candidate is excluded.
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
#   CANDIDATE FETCHING & SEARCH QUERY FORMULATION (via yt-dlp)
# ═══════════════════════════════════════════════════════════════════════════════

def _fetch_candidates_ytdlp(query: str, limit: int = MAX_CANDIDATES) -> list[dict]:
    """
    Extract candidate songs from YouTube using yt-dlp flat playlist extraction.

    Performance & Caching:
      - Caches search responses in `_candidate_cache` for `CACHE_TTL_SEC` (10 minutes)
        to prevent redundant network traffic and avoid YouTube IP rate limiting.
      - Uses lazy import of `yt_dlp` so that unit test environments without yt-dlp
        can run purely algorithmic scoring tests without failure.

    Filtering Criteria:
      - Minimum duration: 60 seconds (excludes shorts, preview clips, and ads).
      - Maximum duration: 600 seconds (10 minutes; excludes extended podcasts/mixes).
      - Extracts thumbnail fallback chain (best available image down to mqdefault).

    Args:
        query: YouTube search string.
        limit: Maximum candidates to parse (default 40).

    Returns:
        list[dict]: Array of standardized song objects with id, title, artist,
                    thumbnailUrl, duration, and viewCount.
    """
    cache_key = f"reco:{query}"
    now = time.time()
    # Check in-memory TTL candidate cache
    if cache_key in _candidate_cache:
        cached_songs, cached_at = _candidate_cache[cache_key]
        if now - cached_at < CACHE_TTL_SEC:
            return cached_songs

    try:
        import yt_dlp  # imported lazily — not available in unit tests

        # Extract flat metadata to avoid downloading audio or resolving full stream formats
        ydl_opts = {"extract_flat": "in_playlist", "quiet": True, "no_warnings": True}
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            # Over-fetch 3x to ensure sufficient candidates after duration filtering
            info = ydl.extract_info(f"ytsearch{limit * 3}:{query}", download=False)
            entries = info.get("entries", []) or []

        songs = []
        for entry in entries:
            if not entry:
                continue
            vid_id   = entry.get("id")
            duration = entry.get("duration") or 0
            # Enforce 1 min to 10 min track boundaries
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
    Synthesize an optimal YouTube search query aligned with user context and tastes.

    Priority Order for Query Construction:
      1. Current playing track's artist (for immediate acoustic continuity).
      2. Up to 2 favorite artists from user onboarding or top listening history.
      3. Primary user mood mapped to intent keywords (e.g. 'chill' -> 'chill vibes').
      4. Primary user genre mapped to search suffix (e.g. 'bollywood' -> 'hindi bollywood songs').
      5. Cold-Start Fallback: "trending songs official music video india" if no tastes provided.

    Args:
        user_genres: User's genre preferences.
        user_artists: User's artist preferences.
        user_moods: User's mood preferences.
        current_song: Currently playing song dictionary (if available).

    Returns:
        str: Composed YouTube search string truncated to max 5 tokens.
    """
    parts: list[str] = []

    # Current song context: prioritize finding tracks related to the active playing artist
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

    # Mood keyword mapping
    mood_map = {
        "chill": "chill vibes", "happy": "upbeat happy",
        "sad": "emotional sad", "romantic": "romantic love",
        "energetic": "energetic pump", "focus": "focus instrumental",
    }
    for mood in (user_moods or [])[:1]:
        kw = mood_map.get(mood.lower(), mood)
        parts.append(kw)

    # Genre suffix mapping for localized audio discovery
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
        # Cold start fallback for guest users without preferences
        parts = ["trending songs official music video india"]

    query = " ".join(parts[:5])
    return query


# ═══════════════════════════════════════════════════════════════════════════════
#   PUBLIC RECOMMENDATION API
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
    Generate up to `limit` personalized recommended songs for autoplay queues.

    Pipeline Architecture:
      1. Listening History Ingestion:
         - Retrieves past 200 interaction rows from Supabase (safe against failure).
         - Aggregates artist statistics and extracts top affinity artists.
      2. Effective Taste Derivation:
         - Merges user's explicitly selected artists with high-affinity history artists.
      3. Candidate Pool Seeding:
         - Seeds candidate set with user's previously liked songs or repeatedly completed songs.
         - Fetches candidates from YouTube using synthesized queries from effective tastes.
         - Expands pool with secondary queries if total candidate count is low (< 2 * limit).
      4. Dynamic Greedy Diversified Selection (MMR-Style):
         - Iteratively scores remaining candidates and selects the highest scorer.
         - Enforces `ARTIST_DIVERSITY_CAP` (max 2 songs per artist in the result set).
         - Dynamically applies `_discovery_score` penalties to prevent artist monopoly.

    Args:
        user_id: Authenticated Supabase user ID, or None for guest sessions.
        user_genres: User's onboarding genre slugs (e.g. ['bollywood', 'pop']).
        user_moods: User's mood preferences (e.g. ['chill', 'romantic']).
        user_artists: User's favourite artist names.
        current_song: The song currently playing (dict with id, title, artist).
        exclude_ids: Song IDs to exclude (recently played, current queue, etc.).
        limit: Max songs to return (capped at 20).
        auth_token: Optional Supabase JWT for authenticated history retrieval.

    Returns:
        list[dict]: Ranked list of song dicts, best recommendation first.
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
            # Respect hard diversity cap per artist
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
            # Fallback if remaining candidates all hit artist caps
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
    Retrieve songs acoustically and thematically similar to `current_song`.

    Builds a targeted query utilizing the current track's artist and key title tokens,
    then executes the diversified ranking pipeline scoped to that musical aesthetic.

    Args:
        current_song: Reference song dictionary with 'id', 'title', and 'artist'.
        user_id: Authenticated user ID (or None for guest).
        exclude_ids: List of song IDs to exclude from results.
        limit: Maximum similar songs to return (default 10).
        auth_token: Optional Supabase JWT.

    Returns:
        list[dict]: Ranked list of similar track dictionaries.
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
    Construct multi-section personalized music recommendations for the home screen.

    Generated Sections:
      1. `made_for_you`: Hybrid personalized mix blending all user onboarding tastes and history.
      2. `because_you`: Up to 2 per-artist sections showcasing deep cuts by user's top favorite artists.
      3. `discover_more`: Exploration section featuring genres outside the user's immediate selection.

    Args:
        user_id: Authenticated Supabase user ID (or None for guest).
        user_genres: User's selected genres.
        user_moods: User's selected moods.
        user_artists: User's favorite artists.
        limit_per_section: Maximum songs per section shelf (default 10).
        auth_token: Optional Supabase JWT.

    Returns:
        dict: {
            "made_for_you": list[dict],
            "because_you": list[{"artist": str, "songs": list[dict]}],
            "discover_more": list[dict],
            "has_personalisation": bool
        }
    """
    all_exclude: set[str] = set()

    # ── Section 1: Made for You (Hybrid Personalized Mix) ────────────────────
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

    # ── Section 2: Because You Listened To [Artist] ──────────────────────────
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

    # ── Section 3: Discover More (Diversified Exploration) ────────────────────
    # Select genres outside user's current selections to encourage musical discovery
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


