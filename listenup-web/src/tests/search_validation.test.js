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
});
