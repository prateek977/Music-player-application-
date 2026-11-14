import { registerPlugin, Capacitor } from '@capacitor/core';

/**
 * Native Android Song Search & Category Browse Bridge.
 *
 * Interfaces with the native ListenUpSearchPlugin on Android (which queries
 * YouTube's InnerTube API directly on background threads with zero Python/Flask dependency).
 * Also integrates legitimate full-length streaming from open audio providers (Audius)
 * and licensed 30-second promotional previews from Apple Music / iTunes.
 */

const ListenUpSearch = registerPlugin('ListenUpSearch');

export const BROWSE_CATEGORIES = [
  { id: 'direct', label: 'Background Audio Hits', query: 'licensed full length background audio streams' },
  { id: 'trending', label: 'Trending Hits', query: 'latest trending hit songs india official music video' },
  { id: 'sad', label: 'Broken & Heartbreak', query: 'sad emotional heartbreak songs hindi official video' },
  { id: 'bollywood', label: 'Bollywood Central', query: 'latest bollywood songs official video' },
  { id: 'hollywood', label: 'Global Hits', query: 'popular english songs official video' },
  { id: 'lofi', label: 'Midnight Lo-Fi', query: 'lofi chill single track hindi' },
  { id: 'pop', label: 'Pop Anthems', query: 'top pop songs india official music video' },
  { id: 'romantic', label: 'Pure Romance', query: 'romantic songs hindi official video' },
  { id: 'party', label: 'Club & Party', query: 'party dance songs hindi official video' }
];

export const isNativeAndroid = () => {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
};

/**
 * Sanitizes and normalizes a search query string.
 * Strips control characters, collapses whitespace, and clamps length to max 100 chars.
 * @param {string} rawQuery
 * @returns {string} Sanitized query string
 */
export function sanitizeSearchQuery(rawQuery) {
  if (typeof rawQuery !== 'string') return '';
  return rawQuery
    .replace(/\s+/g, ' ')
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\uFEFF]/g, '')
    .slice(0, 100)
    .trim();
}

/**
 * Searches legitimate 30-second preview samples (Apple Music / iTunes preview API).
 * Explicitly flagged as isPreview: true, duration: 30.
 * @param {string} query
 * @param {number} limit
 * @returns {Promise<Array>} Array of song objects with 30s preview streams
 */
export async function searchAudioPreviews(query, limit = 10) {
  const trimmed = sanitizeSearchQuery(query);
  if (!trimmed) return [];

  const cacheKey = `listenup_preview_audio_${trimmed.toLowerCase()}_${limit}`;
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (_) {}

  try {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(trimmed)}&entity=song&limit=${limit}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.results)) {
        const results = data.results
          .filter(r => r.previewUrl)
          .map(r => ({
            id: `preview_${r.trackId}`,
            title: r.trackName,
            artist: r.artistName,
            thumbnailUrl: r.artworkUrl100 ? r.artworkUrl100.replace('100x100bb', '600x600bb') : '',
            duration: 30, // Preview media file is strictly 30 seconds
            fullDuration: Math.round((r.trackTimeMillis || 30000) / 1000),
            streamUrl: r.previewUrl,
            isDirectStream: true,
            isPreview: true,
            isFullLength: false,
            playbackType: 'preview',
            album: r.collectionName,
            genre: r.primaryGenreName,
            viewCount: '30s Sample Preview'
          }));

        if (results.length > 0) {
          try {
            localStorage.setItem(cacheKey, JSON.stringify(results));
          } catch (_) {}
        }
        return results;
      }
    }
  } catch (err) {
    console.warn('Audio preview search error:', err);
  }

  return [];
}

// Backward-compatible alias
export const searchDirectAudio = searchAudioPreviews;

/**
 * Searches legitimate full-length streaming tracks via Audius open protocol.
 * Returns true, playable audio streams with full durations (e.g. 180s - 600s)
 * supporting background playback via AndroidX Media3 ExoPlayer.
 * @param {string} query
 * @param {number} limit
 * @returns {Promise<Array>}
 */
export async function searchFullLengthAudio(query, limit = 15) {
  const trimmed = sanitizeSearchQuery(query);
  if (!trimmed) return [];

  const cacheKey = `listenup_audius_full_${trimmed.toLowerCase()}_${limit}`;
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (_) {}

  try {
    const url = `https://discoveryprovider.audius.co/v1/tracks/search?query=${encodeURIComponent(trimmed)}&limit=${limit}&app_name=listenup`;
    const res = await fetch(url);
    if (res.ok) {
      const json = await res.json();
      if (Array.isArray(json.data)) {
        const results = json.data
          .filter(t => t.is_streamable !== false && t.duration >= 60)
          .map(t => {
            const artwork = t.artwork ? (t.artwork['480x480'] || t.artwork['150x150'] || t.artwork['1000x1000']) : '';
            return {
              id: `audius_${t.id}`,
              title: t.title,
              artist: t.user ? (t.user.name || t.user.handle) : 'Independent Artist',
              thumbnailUrl: artwork || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&q=80',
              duration: Math.round(t.duration),
              streamUrl: `https://discoveryprovider.audius.co/v1/tracks/${t.id}/stream?app_name=listenup`,
              isDirectStream: true,
              isPreview: false,
              isFullLength: true,
              playbackType: 'full_length',
              genre: t.genre || 'Electronic',
              viewCount: 'Full Background Stream'
            };
          });

        if (results.length > 0) {
          try {
            localStorage.setItem(cacheKey, JSON.stringify(results));
          } catch (_) {}
        }
        return results;
      }
    }
  } catch (err) {
    console.warn('Audius full length search error:', err);
  }

  return [];
}

/**
 * Resolves a legitimate, licensed 30-second audio preview sample for any song.
 * Explicitly returned with isPreview: true and duration: 30.
 * @param {Object} song
 * @returns {Promise<Object|null>} { streamUrl, isPreview: true, duration: 30, playbackType: 'preview' } or null
 */
export async function resolveTrackPreview(song) {
  if (!song) return null;
  if (song.isPreview && song.streamUrl) {
    return {
      streamUrl: song.streamUrl,
      isPreview: true,
      duration: 30,
      playbackType: 'preview'
    };
  }

  const rawTitle = song.title || '';
  const rawArtist = song.artist || '';

  // 1. Extract primary title: take the part before the first pipe, em-dash, or dash
  let cleanTitle = rawTitle.split(/\||–|-/)[0]
    .replace(/[\(\[\{][^\)\]\}]*[\)\]\}]/gi, '')
    .replace(/official\s*(music\s*)?(video|audio|song)?/gi, '')
    .replace(/^[a-z0-9]+\s*:\s*/i, '')
    .trim();

  if (!cleanTitle) cleanTitle = rawTitle.replace(/[\(\[\{][^\)\]\}]*[\)\]\}]/gi, '').trim();

  // 2. Filter out record labels and channel uploader names
  let cleanArtist = rawArtist;
  if (/t-series|sony music|zee music|speed records|apna punjab|yrf|tips|saregama/i.test(rawArtist)) {
    cleanArtist = '';
  }

  const query = `${cleanTitle} ${cleanArtist}`.trim();
  if (!query) return null;

  try {
    let results = await searchAudioPreviews(query, 3);
    if (results && results.length > 0) {
      return {
        streamUrl: results[0].streamUrl,
        isPreview: true,
        duration: 30,
        playbackType: 'preview'
      };
    }
    // Fallback: search cleanTitle alone if artist was filtered
    if (cleanArtist) {
      results = await searchAudioPreviews(cleanTitle, 3);
      if (results && results.length > 0) {
        return {
          streamUrl: results[0].streamUrl,
          isPreview: true,
          duration: 30,
          playbackType: 'preview'
        };
      }
    }
  } catch (e) {
    console.warn('resolveTrackPreview failed:', e);
  }

  return null;
}

// Backward-compatible alias: returns streamUrl string
export async function resolveDirectAudioStream(song) {
  const res = await resolveTrackPreview(song);
  return res ? res.streamUrl : null;
}

/**
 * Searches for songs matching query across YouTube InnerTube and Direct Audio APIs.
 * Preserves full-length commercial songs at the top for mainstream searches (e.g. Apna Bana Le).
 * Supports user-provided direct URLs and open full-length tracks.
 * Does NOT masquerade 30s previews as full songs.
 * @param {string} query
 * @param {number} limit
 * @returns {Promise<Array>} Array of song objects
 */
export async function searchSongs(query, limit = 20) {
  const trimmed = sanitizeSearchQuery(query);
  if (!trimmed) return [];

  // Direct Audio URL Support: user-provided stream URL
  if (/^https?:\/\/.+\.(mp3|m4a|aac|wav|ogg|flac)(\?.*)?$/i.test(trimmed) || /^https?:\/\/.+/i.test(trimmed) && trimmed.includes('/stream')) {
    const urlParts = trimmed.split('/');
    const lastPart = urlParts[urlParts.length - 1].split('?')[0];
    return [{
      id: `custom_${Date.now()}`,
      title: decodeURIComponent(lastPart) || 'Direct Audio Stream',
      artist: 'Custom Stream URL',
      thumbnailUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&q=80',
      duration: 0,
      streamUrl: trimmed,
      isDirectStream: true,
      isPreview: false,
      isFullLength: true,
      playbackType: 'full_length',
      viewCount: 'Custom URL'
    }];
  }

  const cacheKey = `listenup_search_cache_${trimmed.toLowerCase()}`;

  // 1. Fetch YouTube InnerTube results (primary source for full-length mainstream music)
  let ytResults = [];
  if (isNativeAndroid()) {
    try {
      const res = await ListenUpSearch.searchYouTube({ query: trimmed, limit });
      if (res && Array.isArray(res.results) && res.results.length > 0) {
        ytResults = res.results.map(r => ({
          ...r,
          playbackType: 'youtube',
          isDirectStream: false,
          isPreview: false,
          isFullLength: true
        }));
      }
    } catch (err) {
      console.warn('Native search failed, checking local cache:', err);
    }
  }

  // 2. Check local offline cache if native search yielded empty
  if (ytResults.length === 0) {
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed.results) && parsed.results.length > 0) {
          ytResults = parsed.results;
        }
      }
    } catch (_) {}
  }

  // 3. In parallel, fetch open full-length tracks from Audius for broad discovery
  const audiusResults = await searchFullLengthAudio(trimmed, 5).catch(() => []);

  // Primary results: Full-length YouTube songs come FIRST for mainstream user searches!
  // Followed by genuine full-length Audius streams.
  // 30-second previews are NOT mixed into primary search results.
  const combined = [];
  if (ytResults.length > 0) {
    combined.push(...ytResults);
  }
  if (audiusResults.length > 0) {
    combined.push(...audiusResults);
  }

  if (combined.length > 0) {
    try {
      localStorage.setItem(cacheKey, JSON.stringify({
        results: combined,
        timestamp: Date.now()
      }));
    } catch (_) {}
    return combined;
  }

  return [];
}

/**
 * Retrieves curated category songs (e.g. trending, bollywood, lofi, direct).
 * @param {string} category
 * @returns {Promise<Array>}
 */
export async function browseCategory(category = 'trending') {
  const cat = (category || 'trending').toLowerCase().trim();

  // If user selected background audio hits, load genuine FULL-LENGTH direct audio streams from Audius
  if (cat === 'direct') {
    const cacheKey = 'listenup_audius_trending_full';
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (_) {}

    try {
      const url = 'https://discoveryprovider.audius.co/v1/tracks/trending?limit=25&app_name=listenup';
      const res = await fetch(url);
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json.data)) {
          const results = json.data
            .filter(t => t.is_streamable !== false && t.duration >= 60)
            .map(t => {
              const artwork = t.artwork ? (t.artwork['480x480'] || t.artwork['150x150'] || t.artwork['1000x1000']) : '';
              return {
                id: `audius_${t.id}`,
                title: t.title,
                artist: t.user ? (t.user.name || t.user.handle) : 'Audius Artist',
                thumbnailUrl: artwork || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&q=80',
                duration: Math.round(t.duration),
                streamUrl: `https://discoveryprovider.audius.co/v1/tracks/${t.id}/stream?app_name=listenup`,
                isDirectStream: true,
                isPreview: false,
                isFullLength: true,
                playbackType: 'full_length',
                genre: t.genre || 'Electronic',
                viewCount: 'Full Background Stream'
              };
            });

          if (results.length > 0) {
            try {
              localStorage.setItem(cacheKey, JSON.stringify(results));
            } catch (_) {}
            return results;
          }
        }
      }
    } catch (err) {
      console.warn('Audius trending browse error:', err);
    }

    return [];
  }

  const cacheKey = `listenup_browse_cache_${cat}`;

  // 1. If on Native Android, call ListenUpSearchPlugin.browseCategory
  if (isNativeAndroid()) {
    try {
      const res = await ListenUpSearch.browseCategory({ category: cat });
      if (res && Array.isArray(res.results) && res.results.length > 0) {
        const normalized = res.results.map(r => ({
          ...r,
          playbackType: 'youtube',
          isDirectStream: false,
          isPreview: false,
          isFullLength: true
        }));
        try {
          localStorage.setItem(cacheKey, JSON.stringify({
            results: normalized,
            timestamp: Date.now()
          }));
        } catch (_) {}
        return normalized;
      }
    } catch (err) {
      console.warn('Native browse category failed, checking local cache:', err);
    }
  }

  // 2. Check local offline cache
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed.results) && parsed.results.length > 0) {
        return parsed.results;
      }
    }
  } catch (_) {}

  // 3. Fallback for browser development
  const apiBase = (import.meta.env.VITE_API_URL || import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '');
  if (apiBase) {
    try {
      const res = await fetch(`${apiBase}/api/browse?category=${encodeURIComponent(cat)}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) return data;
      }
    } catch (err) {
      console.warn('Browser fallback browse failed:', err);
    }
  }

  return [];
}
