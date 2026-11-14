/**
 * ListenUp Local Hybrid Recommendation Engine
 * Pure client/device deterministic scoring engine ported from backend/recommender.py.
 * Enables instant, offline-capable personalized recommendations without server dependency.
 */

export const SCORE_WEIGHTS = {
  genre_mood_similarity: 0.30,
  artist_preference: 0.25,
  listening_history: 0.20,
  audio_characteristics: 0.15,
  discovery: 0.10,
};

const DURATION_MIN_IDEAL = 150; // 2.5 min
const DURATION_MAX_IDEAL = 360; // 6 min
const RECENT_PLAY_WINDOW_MS = 60 * 60 * 1000; // 1 hr

export function scoreSong(song, userPrefs = {}, history = [], favorites = []) {
  if (!song) return 0;
  const safeHistory = Array.isArray(history) ? history : [];
  const safeFavorites = Array.isArray(favorites) ? favorites : [];

  const genres = (userPrefs.genres || []).map(g => g.toLowerCase());
  const artists = (userPrefs.artists || []).map(a => typeof a === 'string' ? a.toLowerCase() : a.name.toLowerCase());
  const moods = (userPrefs.moods || []).map(m => m.toLowerCase());

  const songTitle = (song.title || '').toLowerCase();
  const songArtist = (song.artist || '').toLowerCase();
  const songGenre = (song.genre || '').toLowerCase();

  // 1. Genre / Mood similarity (0.0 to 1.0)
  let genreScore;
  if (genres.length > 0) {
    const genreMatch = genres.some(g => songGenre.includes(g) || songTitle.includes(g));
    genreScore = genreMatch ? 1.0 : 0.2;
  } else {
    genreScore = 0.5;
  }
  if (moods.length > 0 && moods.some(m => songTitle.includes(m) || songGenre.includes(m))) {
    genreScore = Math.min(1.0, genreScore + 0.3);
  }

  // 2. Artist preference (0.0 to 1.0)
  let artistScore;
  if (artists.length > 0) {
    artistScore = artists.some(a => songArtist.includes(a)) ? 1.0 : 0.25;
  } else {
    artistScore = 0.5;
  }

  // 3. Listening history signal (0.0 to 1.0)
  let historyScore = 0.5;
  const songHistory = safeHistory.filter(h => h.songId === song.id);
  const playCount = songHistory.length;
  const skipCount = songHistory.filter(h => h.wasSkipped).length;
  const isFav = safeFavorites.some(f => f.id === song.id);

  if (isFav) historyScore += 0.3;
  if (playCount > 0) historyScore += Math.min(0.3, playCount * 0.1);
  if (skipCount > 0) historyScore -= Math.min(0.4, skipCount * 0.15);
  historyScore = Math.max(0.0, Math.min(1.0, historyScore));

  // 4. Audio characteristics (Duration fitness)
  let audioScore = 0.7;
  const dur = song.duration || 210;
  if (dur >= DURATION_MIN_IDEAL && dur <= DURATION_MAX_IDEAL) {
    audioScore = 1.0;
  } else if (dur > 0 && dur < DURATION_MIN_IDEAL) {
    audioScore = Math.max(0.2, dur / DURATION_MIN_IDEAL);
  } else if (dur > DURATION_MAX_IDEAL) {
    audioScore = Math.max(0.2, 1.0 - (dur - DURATION_MAX_IDEAL) / 300);
  }

  // 5. Discovery base score
  const discoveryScore = playCount === 0 ? 0.9 : 0.4;

  // Composite weighted score
  let finalScore =
    SCORE_WEIGHTS.genre_mood_similarity * genreScore +
    SCORE_WEIGHTS.artist_preference * artistScore +
    SCORE_WEIGHTS.listening_history * historyScore +
    SCORE_WEIGHTS.audio_characteristics * audioScore +
    SCORE_WEIGHTS.discovery * discoveryScore;

  // Recency penalty: songs played in the last hour receive a 40% penalty
  const mostRecent = songHistory[0];
  if (mostRecent && Date.now() - mostRecent.playedAt < RECENT_PLAY_WINDOW_MS) {
    finalScore *= 0.6;
  }

  return finalScore;
}

/**
 * Rank candidate songs locally using user preferences and history.
 */
export function rankSongs(candidates, userPrefs = {}, history = [], favorites = [], limit = 10) {
  if (!candidates || candidates.length === 0) return [];

  const scored = candidates.map(song => ({
    song,
    score: scoreSong(song, userPrefs, history, favorites)
  }));

  // Sort descending by score
  scored.sort((a, b) => b.score - a.score);

  // Apply artist diversity cap (max 2 songs per artist in result set)
  const artistCounts = new Map();
  const diverse = [];

  for (const item of scored) {
    const artist = (item.song.artist || 'Unknown').toLowerCase();
    const count = artistCounts.get(artist) || 0;
    if (count < 2) {
      diverse.push(item.song);
      artistCounts.set(artist, count + 1);
      if (diverse.length >= limit) break;
    }
  }

  // If diversity cap left fewer results, fill remaining
  if (diverse.length < limit) {
    for (const item of scored) {
      if (!diverse.some(d => d.id === item.song.id)) {
        diverse.push(item.song);
        if (diverse.length >= limit) break;
      }
    }
  }

  return diverse;
}

