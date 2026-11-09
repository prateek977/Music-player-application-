import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreSong, rankSongs, SCORE_WEIGHTS } from '../lib/localRecommender.js';

test('Local Recommendation Engine Logic', async (t) => {
  await t.test('SCORE_WEIGHTS sum strictly to 1.0', () => {
    const sum = Object.values(SCORE_WEIGHTS).reduce((acc, w) => acc + w, 0);
    assert.ok(Math.abs(sum - 1.0) < 1e-6, `Weights sum to ${sum}, expected 1.0`);
  });

  await t.test('boosts score for songs matching user favorite artists', () => {
    const songA = { id: 's1', title: 'Kesariya', artist: 'Arijit Singh', genre: 'Bollywood', duration: 210 };
    const songB = { id: 's2', title: 'Random Song', artist: 'Unknown Singer', genre: 'Indie', duration: 210 };
    const userPrefs = { artists: ['Arijit Singh'], genres: ['Bollywood'] };

    const scoreA = scoreSong(songA, userPrefs, [], []);
    const scoreB = scoreSong(songB, userPrefs, [], []);

    assert.ok(scoreA > scoreB, `Expected scoreA (${scoreA}) > scoreB (${scoreB})`);
  });

  await t.test('penalizes songs with high skip counts', () => {
    const song = { id: 's1', title: 'Song 1', artist: 'Artist 1', genre: 'Pop', duration: 200 };
    const cleanHistory = [{ songId: 's1', wasSkipped: false }];
    const skippedHistory = [
      { songId: 's1', wasSkipped: true },
      { songId: 's1', wasSkipped: true },
      { songId: 's1', wasSkipped: true }
    ];

    const scoreClean = scoreSong(song, {}, cleanHistory, []);
    const scoreSkipped = scoreSong(song, {}, skippedHistory, []);

    assert.ok(scoreClean > scoreSkipped, `Expected clean score (${scoreClean}) > skipped score (${scoreSkipped})`);
  });

  await t.test('enforces artist diversity cap in ranked results', () => {
    const candidates = [
      { id: '1', title: 'Track 1', artist: 'Artist A' },
      { id: '2', title: 'Track 2', artist: 'Artist A' },
      { id: '3', title: 'Track 3', artist: 'Artist A' },
      { id: '4', title: 'Track 4', artist: 'Artist B' },
      { id: '5', title: 'Track 5', artist: 'Artist C' },
    ];
    const userPrefs = { artists: ['Artist A'] };
    const ranked = rankSongs(candidates, userPrefs, [], [], 3);

    const artistACount = ranked.filter(s => s.artist === 'Artist A').length;
    assert.ok(artistACount <= 2, `Artist A count (${artistACount}) should not exceed cap of 2`);
    assert.equal(ranked.length, 3);
  });
});

