import sqlite3
import json
import os
import uuid
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'user_data.db')

def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """Initialize database tables for persistent user preferences, playlists, and favorites."""
    with get_connection() as conn:
        cursor = conn.cursor()
        
        # User Preferences Table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS user_preferences (
                user_id TEXT PRIMARY KEY,
                preferences_json TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        ''')
        
        # User Playlists Table
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
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_playlists_user ON user_playlists(user_id)')
        
        # User Favorites Table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS user_favorites (
                user_id TEXT NOT NULL,
                song_id TEXT NOT NULL,
                song_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY (user_id, song_id)
            )
        ''')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_favorites_user ON user_favorites(user_id)')
        
        conn.commit()

# --- PREFERENCES ---

def get_user_preferences(user_id: str):
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
                return None
        return None

def save_user_preferences(user_id: str, prefs: dict):
    if not user_id or not isinstance(prefs, dict):
        raise ValueError("Invalid user_id or preferences payload")
    now = datetime.utcnow().isoformat()
    prefs_str = json.dumps(prefs)
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            INSERT INTO user_preferences (user_id, preferences_json, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                preferences_json = excluded.preferences_json,
                updated_at = excluded.updated_at
        ''', (user_id, prefs_str, now))
        conn.commit()
    return prefs

# --- PLAYLISTS ---

def get_user_playlists(user_id: str):
    if not user_id:
        return []
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            'SELECT id, user_id, name, cover_url, songs_json, created_at, updated_at FROM user_playlists WHERE user_id = ? ORDER BY created_at DESC',
            (user_id,)
        )
        rows = cursor.fetchall()
        playlists = []
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

def create_user_playlist(user_id: str, name: str, cover_url: str = None, songs: list = None):
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

def update_user_playlist(playlist_id: str, user_id: str, name: str = None, songs: list = None, cover_url: str = None):
    if not playlist_id or not user_id:
        raise ValueError("playlist_id and user_id are required")
    now = datetime.utcnow().isoformat()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM user_playlists WHERE id = ? AND user_id = ?', (playlist_id, user_id))
        row = cursor.fetchone()
        if not row:
            return None
        
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

def delete_user_playlist(playlist_id: str, user_id: str):
    if not playlist_id or not user_id:
        return False
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('DELETE FROM user_playlists WHERE id = ? AND user_id = ?', (playlist_id, user_id))
        conn.commit()
        return cursor.rowcount > 0

# --- FAVORITES ---

def get_user_favorites(user_id: str):
    if not user_id:
        return []
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            'SELECT song_id, song_json, created_at FROM user_favorites WHERE user_id = ? ORDER BY created_at DESC',
            (user_id,)
        )
        rows = cursor.fetchall()
        favorites = []
        for r in rows:
            try:
                song = json.loads(r['song_json'])
                favorites.append(song)
            except Exception:
                pass
        return favorites

def add_user_favorite(user_id: str, song: dict):
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

def remove_user_favorite(user_id: str, song_id: str):
    if not user_id or not song_id:
        return False
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('DELETE FROM user_favorites WHERE user_id = ? AND song_id = ?', (user_id, str(song_id)))
        conn.commit()
        return cursor.rowcount > 0

