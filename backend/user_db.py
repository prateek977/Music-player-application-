"""
User Data Persistence Layer (SQLite) for ListenUp Backend
=========================================================
This module manages local persistent storage for user-specific data including:
  1. User Preferences: Onboarding choices (favorite genres, artists, languages, moods).
  2. User Playlists: Custom user-created playlists with ordering and song metadata.
  3. User Favorites: Bookmarked/liked tracks stored with their full metadata.

Architecture:
  - Database Engine: SQLite3 (file-backed at 'backend/user_data.db').
  - Connection Pattern: Per-operation connection contexts (`get_connection()`) with
    row factory enabled for dict-like column access.
  - Conflict Resolution: Utilizes SQLite's `ON CONFLICT` clauses for idempotent upserts.
  - Serialization: Song lists and complex preferences payloads are serialized as JSON strings.
"""

from __future__ import annotations

import json
import os
import sqlite3
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

# Path to the local SQLite database file located in the backend directory
DB_PATH: str = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'user_data.db')


def get_connection() -> sqlite3.Connection:
    """
    Establish and return a new SQLite database connection.

    Sets `conn.row_factory = sqlite3.Row` to allow accessing row columns
    both by index and case-insensitively by column name.

    Returns:
        sqlite3.Connection: An open SQLite connection object.
    """
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    """
    Initialize database tables and performance indexes if they do not exist.

    Created Tables:
      - `user_preferences`: Stores user onboarding preferences as JSON.
          Primary Key: user_id (TEXT)
      - `user_playlists`: Stores custom playlists and their contained song arrays.
          Primary Key: id (UUID TEXT)
          Index: idx_playlists_user on (user_id)
      - `user_favorites`: Stores liked songs keyed by user and song ID.
          Primary Key: (user_id, song_id)
          Index: idx_favorites_user on (user_id)
    """
    with get_connection() as conn:
        cursor = conn.cursor()

        # ── 1. User Preferences Table ─────────────────────────────────────────
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS user_preferences (
                user_id TEXT PRIMARY KEY,
                preferences_json TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        ''')

        # ── 2. User Playlists Table ──────────────────────────────────────────
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS user_playlists (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                name TEXT NOT NULL,
                cover_url TEXT,
                songs_json TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        ''')
        # Index on user_id to accelerate playlist lookups per user
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_playlists_user ON user_playlists(user_id)')

        # ── 3. User Favorites Table ──────────────────────────────────────────
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS user_favorites (
                user_id TEXT NOT NULL,
                song_id TEXT NOT NULL,
                song_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY (user_id, song_id)
            )
        ''')
        # Index on user_id to speed up listing all favorites for a user
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_favorites_user ON user_favorites(user_id)')

        conn.commit()


# ═══════════════════════════════════════════════════════════════════════════════
#   USER PREFERENCES CRUD
# ═══════════════════════════════════════════════════════════════════════════════

def get_user_preferences(user_id: str) -> Optional[Dict[str, Any]]:
    """
    Retrieve stored preferences for a specific user.

    Args:
        user_id: Unique identifier of the authenticated user.

    Returns:
        dict: Parsed preferences dictionary if found, or None if no preferences exist
              or if deserialization fails.
    """
    if not user_id:
        return None

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT preferences_json FROM user_preferences WHERE user_id = ?', (user_id,))
        row = cursor.fetchone()
        if row:
            try:
                return json.loads(row['preferences_json'])
            except Exception:
                # Return None if corrupt JSON is encountered
                return None
        return None


def save_user_preferences(user_id: str, prefs: Dict[str, Any]) -> Dict[str, Any]:
    """
    Save or update preferences for a specific user using an upsert query.

    Args:
        user_id: Unique identifier of the authenticated user.
        prefs: Dictionary of user preferences (genres, artists, moods, etc.).

    Returns:
        dict: The saved preferences dictionary.

    Raises:
        ValueError: If user_id is empty or prefs is not a valid dictionary.
    """
    if not user_id or not isinstance(prefs, dict):
        raise ValueError("Invalid user_id or preferences payload")

    now = datetime.utcnow().isoformat()
    prefs_str = json.dumps(prefs)

    with get_connection() as conn:
        cursor = conn.cursor()
        # Upsert: insert new row or update preferences_json on conflict with user_id
        cursor.execute('''
            INSERT INTO user_preferences (user_id, preferences_json, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                preferences_json = excluded.preferences_json,
                updated_at = excluded.updated_at
        ''', (user_id, prefs_str, now))
        conn.commit()

    return prefs


# ═══════════════════════════════════════════════════════════════════════════════
#   USER PLAYLISTS CRUD
# ═══════════════════════════════════════════════════════════════════════════════

def get_user_playlists(user_id: str) -> List[Dict[str, Any]]:
    """
    Fetch all custom playlists belonging to a specific user, sorted newest first.

    Args:
        user_id: Unique identifier of the authenticated user.

    Returns:
        list[dict]: List of playlist objects with parsed song arrays.
    """
    if not user_id:
        return []

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            'SELECT id, user_id, name, cover_url, songs_json, created_at, updated_at '
            'FROM user_playlists WHERE user_id = ? ORDER BY created_at DESC',
            (user_id,)
        )
        rows = cursor.fetchall()
        playlists: List[Dict[str, Any]] = []

        for r in rows:
            try:
                songs = json.loads(r['songs_json'])
            except Exception:
                songs = []

            playlists.append({
                'id': r['id'],
                'user_id': r['user_id'],
                'name': r['name'],
                'cover_url': r['cover_url'],
                'songs': songs,
                'created_at': r['created_at'],
                'updated_at': r['updated_at']
            })

        return playlists


def create_user_playlist(
    user_id: str,
    name: str,
    cover_url: Optional[str] = None,
    songs: Optional[List[Dict[str, Any]]] = None
) -> Dict[str, Any]:
    """
    Create a new custom playlist for a user.

    Args:
        user_id: Unique identifier of the playlist owner.
        name: Name / title of the playlist.
        cover_url: Optional URL pointing to playlist artwork.
        songs: Optional initial list of song dictionaries.

    Returns:
        dict: The newly created playlist object including generated UUID and timestamps.

    Raises:
        ValueError: If user_id or name is missing or empty.
    """
    if not user_id or not name:
        raise ValueError("user_id and name are required")

    playlist_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()
    songs_json = json.dumps(songs or [])

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            INSERT INTO user_playlists (id, user_id, name, cover_url, songs_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (playlist_id, user_id, name.strip(), cover_url, songs_json, now, now))
        conn.commit()

    return {
        'id': playlist_id,
        'user_id': user_id,
        'name': name.strip(),
        'cover_url': cover_url,
        'songs': songs or [],
        'created_at': now,
        'updated_at': now
    }


def update_user_playlist(
    playlist_id: str,
    user_id: str,
    name: Optional[str] = None,
    songs: Optional[List[Dict[str, Any]]] = None,
    cover_url: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """
    Update an existing playlist's metadata or song list.

    Args:
        playlist_id: Unique identifier of the playlist to update.
        user_id: Authenticated user ID (ensures ownership check).
        name: New name for the playlist (if provided).
        songs: Updated song list (if provided).
        cover_url: Updated artwork URL (if provided).

    Returns:
        dict: Updated playlist object if found and owned by user, otherwise None.

    Raises:
        ValueError: If playlist_id or user_id is missing.
    """
    if not playlist_id or not user_id:
        raise ValueError("playlist_id and user_id are required")

    now = datetime.utcnow().isoformat()

    with get_connection() as conn:
        cursor = conn.cursor()
        # Verify ownership before updating
        cursor.execute('SELECT * FROM user_playlists WHERE id = ? AND user_id = ?', (playlist_id, user_id))
        row = cursor.fetchone()
        if not row:
            return None

        # Apply partial updates while preserving existing values when parameter is None
        current_name = row['name'] if name is None else name.strip()
        current_cover = row['cover_url'] if cover_url is None else cover_url
        if songs is not None:
            current_songs_json = json.dumps(songs)
        else:
            current_songs_json = row['songs_json']

        cursor.execute('''
            UPDATE user_playlists
            SET name = ?, cover_url = ?, songs_json = ?, updated_at = ?
            WHERE id = ? AND user_id = ?
        ''', (current_name, current_cover, current_songs_json, now, playlist_id, user_id))
        conn.commit()

        try:
            parsed_songs = json.loads(current_songs_json)
        except Exception:
            parsed_songs = []

        return {
            'id': playlist_id,
            'user_id': user_id,
            'name': current_name,
            'cover_url': current_cover,
            'songs': parsed_songs,
            'updated_at': now
        }


def delete_user_playlist(playlist_id: str, user_id: str) -> bool:
    """
    Delete a user playlist ensuring ownership validation.

    Args:
        playlist_id: ID of the playlist to delete.
        user_id: ID of the authenticated user requesting deletion.

    Returns:
        bool: True if the playlist was deleted, False if not found or unauthorized.
    """
    if not playlist_id or not user_id:
        return False

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('DELETE FROM user_playlists WHERE id = ? AND user_id = ?', (playlist_id, user_id))
        conn.commit()
        return cursor.rowcount > 0


# ═══════════════════════════════════════════════════════════════════════════════
#   USER FAVORITES CRUD
# ═══════════════════════════════════════════════════════════════════════════════

def get_user_favorites(user_id: str) -> List[Dict[str, Any]]:
    """
    Retrieve all favorite / bookmarked songs for a user, ordered by most recently added.

    Args:
        user_id: Unique identifier of the authenticated user.

    Returns:
        list[dict]: List of favorite song objects with full metadata.
    """
    if not user_id:
        return []

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            'SELECT song_id, song_json, created_at FROM user_favorites WHERE user_id = ? ORDER BY created_at DESC',
            (user_id,)
        )
        rows = cursor.fetchall()
        favorites: List[Dict[str, Any]] = []

        for r in rows:
            try:
                song = json.loads(r['song_json'])
                favorites.append(song)
            except Exception:
                pass

        return favorites


def add_user_favorite(user_id: str, song: Dict[str, Any]) -> Dict[str, Any]:
    """
    Add a song to a user's favorites list (or update its timestamp if already favorited).

    Args:
        user_id: Unique identifier of the authenticated user.
        song: Complete song metadata dictionary containing at least an 'id' key.

    Returns:
        dict: The favorited song dictionary.

    Raises:
        ValueError: If user_id is empty or song payload is invalid or lacks an 'id'.
    """
    if not user_id or not isinstance(song, dict) or not song.get('id'):
        raise ValueError("Invalid favorite song payload")

    song_id = str(song['id'])
    now = datetime.utcnow().isoformat()
    song_json = json.dumps(song)

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            INSERT INTO user_favorites (user_id, song_id, song_json, created_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, song_id) DO UPDATE SET
                song_json = excluded.song_json,
                created_at = excluded.created_at
        ''', (user_id, song_id, song_json, now))
        conn.commit()

    return song


def remove_user_favorite(user_id: str, song_id: str) -> bool:
    """
    Remove a song from a user's favorites list.

    Args:
        user_id: Unique identifier of the authenticated user.
        song_id: Video or song ID of the track to remove.

    Returns:
        bool: True if a record was deleted, False otherwise.
    """
    if not user_id or not song_id:
        return False

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('DELETE FROM user_favorites WHERE user_id = ? AND song_id = ?', (user_id, str(song_id)))
        conn.commit()
        return cursor.rowcount > 0
