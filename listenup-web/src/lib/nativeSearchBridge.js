import { registerPlugin, Capacitor } from '@capacitor/core';

/**
 * Native Android Song Search & Category Browse Bridge.
 *
 * Interfaces with the native ListenUpSearchPlugin on Android (which queries
 * YouTube's InnerTube API directly on background threads with zero Python/Flask dependency).
 * Falls back to offline cache and graceful web fallbacks when running in a browser.
 */

const ListenUpSearch = registerPlugin('ListenUpSearch');

export const BROWSE_CATEGORIES = [
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
 * Searches YouTube for songs matching query.
 * @param {string} query
 * @param {number} limit
 * @returns {Promise<Array>} Array of song objects: [{ id, title, artist, thumbnailUrl, duration, viewCount }]
 */
export async function searchSongs(query, limit = 20) {
  const trimmed = (query || '').trim();
  if (!trimmed) return [];

  const cacheKey = `listenup_search_cache_${trimmed.toLowerCase()}`;

  // 1. If on Native Android, use ListenUpSearchPlugin (InnerTube)
  if (isNativeAndroid()) {
    try {
      const res = await ListenUpSearch.searchYouTube({ query: trimmed, limit });
      if (res && Array.isArray(res.results) && res.results.length > 0) {
        try {
          localStorage.setItem(cacheKey, JSON.stringify({
            results: res.results,
            timestamp: Date.now()
          }));
        } catch (_) {}
        return res.results;
      }
    } catch (err) {
      console.warn('Native search failed, checking local cache:', err);
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

  // 3. Fallback for browser development (if API server is available)
  const apiBase = (import.meta.env.VITE_API_URL || import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '');
  if (apiBase) {
    try {
      const res = await fetch(`${apiBase}/api/search?q=${encodeURIComponent(trimmed)}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) return data;
      }
    } catch (err) {
      console.warn('Browser fallback search failed:', err);
    }
  }

  return [];
}

/**
 * Retrieves curated category songs (e.g. trending, bollywood, lofi).
 * @param {string} category
 * @returns {Promise<Array>}
 */
export async function browseCategory(category = 'trending') {
  const cat = (category || 'trending').toLowerCase().trim();
  const cacheKey = `listenup_browse_cache_${cat}`;

  // 1. If on Native Android, call ListenUpSearchPlugin.browseCategory
  if (isNativeAndroid()) {
    try {
      const res = await ListenUpSearch.browseCategory({ category: cat });
      if (res && Array.isArray(res.results) && res.results.length > 0) {
        try {
          localStorage.setItem(cacheKey, JSON.stringify({
            results: res.results,
            timestamp: Date.now()
          }));
        } catch (_) {}
        return res.results;
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

