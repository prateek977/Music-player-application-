/**
 * Artist Discovery Service
 * Queries Deezer API with local in-memory caching and clean avatar normalization.
 * Connects directly to public Deezer endpoints with graceful backend proxy fallback.
 */

const artistCache = new Map();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 mins

const cleanArtistImage = (url) => {
  if (!url) return null;
  // Filter empty 250x250 placeholder hashes
  if (url.includes('/images/artist//') || url.includes('/250x250-000000-80-0-0.jpg')) {
    return null;
  }
  return url;
};

export async function searchArtists(query, limit = 20) {
  const trimmed = (query || '').trim();
  if (!trimmed) return [];

  const cacheKey = `${trimmed.toLowerCase()}_${limit}`;
  const cached = artistCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  // Direct Deezer API with in-memory caching and clean avatar normalization
  try {
    const url = `https://api.deezer.com/search/artist?q=${encodeURIComponent(trimmed)}&limit=${limit}`;
    const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (resp.ok) {
      const json = await resp.json();
      const results = (json.data || []).map(a => ({
        id: a.id,
        name: a.name,
        imageUrl: cleanArtistImage(a.picture_medium || a.picture_big || a.picture),
        nbFans: a.nb_fan || 0,
        link: a.link
      })).filter(a => a.imageUrl !== null);

      artistCache.set(cacheKey, { timestamp: Date.now(), data: results });
      return results;
    }
  } catch (directErr) {
    console.warn('Direct Deezer query failed:', directErr);
  }

  return [];
}

