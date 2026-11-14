import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSearchQuery } from '../lib/nativeSearchBridge.js';

test('Search Query Sanitization & Validation', async (t) => {
  await t.test('handles empty, null, or undefined queries', () => {
    assert.equal(sanitizeSearchQuery(''), '');
    assert.equal(sanitizeSearchQuery(null), '');
    assert.equal(sanitizeSearchQuery(undefined), '');
    assert.equal(sanitizeSearchQuery('   '), '');
  });

  await t.test('strips leading and trailing whitespace and collapses multiple spaces', () => {
    assert.equal(sanitizeSearchQuery('   arijit    singh   '), 'arijit singh');
    assert.equal(sanitizeSearchQuery('dua\t\nlipa'), 'dua lipa');
  });

  await t.test('removes invisible control characters and zero-width spaces', () => {
    const dirty = 'Taylor\u200B \u0000Swift\uFEFF';
    assert.equal(sanitizeSearchQuery(dirty), 'Taylor Swift');
  });

  await t.test('clamps query length to maximum 100 characters', () => {
    const longQuery = 'a'.repeat(150);
    const sanitized = sanitizeSearchQuery(longQuery);
    assert.equal(sanitized.length, 100);
    assert.equal(sanitized, 'a'.repeat(100));
  });

  await t.test('preserves valid multilingual and punctuation characters', () => {
    assert.equal(sanitizeSearchQuery('A. R. Rahman - Dil Se'), 'A. R. Rahman - Dil Se');
    assert.equal(sanitizeSearchQuery('केसरिया अरिजीत सिंह'), 'केसरिया अरिजीत सिंह');
  });

  await t.test('properly cleans song titles with balanced bracket patterns', () => {
    const cleanTitle = (rawTitle) => {
      return rawTitle.split(/\||–|-/)[0]
        .replace(/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/gi, '')
        .replace(/official\s*(music\s*)?(video|audio|song)?/gi, '')
        .replace(/^(track|song)?\s*\d+\s*:\s*|^[a-z0-9_]+\s*:\s*/i, '')
        .trim();
    };

    assert.equal(cleanTitle('Kesariya (From "Brahmastra") [Official Video]'), 'Kesariya');
    assert.equal(cleanTitle('Apna Bana Le {4K Ultra HD} | Bhediya'), 'Apna Bana Le');
    assert.equal(cleanTitle('Song 01: Starboy - The Weeknd'), 'Starboy');
  });
});
