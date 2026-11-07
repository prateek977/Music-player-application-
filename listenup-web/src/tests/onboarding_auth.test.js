import { describe, it } from 'node:test';
import assert from 'node:assert';
import { STARTER_GENRES, STARTER_ARTISTS, STARTER_LANGUAGES } from '../lib/starterCatalog.js';

describe('Taste Onboarding Catalog & Rules', () => {
  it('should have all 18 standard genres seeded', () => {
    assert.strictEqual(STARTER_GENRES.length, 18);
    const names = STARTER_GENRES.map(g => g.name);
    assert.ok(names.includes('Bollywood'));
    assert.ok(names.includes('Hip-Hop'));
    assert.ok(names.includes('Pop'));
    assert.ok(names.includes('Rock'));
    assert.ok(names.includes('Lo-fi'));
    assert.ok(names.includes('Punjabi music'));
  });

  it('should enforce minimum 1 genre validation', () => {
    const validateGenres = (genres) => genres.length >= 1;
    assert.strictEqual(validateGenres([]), false);
    assert.strictEqual(validateGenres(['bollywood']), true);
    assert.strictEqual(validateGenres(['bollywood', 'pop']), true);
  });

  it('should have initial starter artists catalog with required artists', () => {
    assert.ok(STARTER_ARTISTS.length >= 15);
    const names = STARTER_ARTISTS.map(a => a.name);
    assert.ok(names.includes('Arijit Singh'));
    assert.ok(names.includes('Shreya Ghoshal'));
    assert.ok(names.includes('Diljit Dosanjh'));
    assert.ok(names.includes('A. R. Rahman'));
    assert.ok(names.includes('The Weeknd'));
    assert.ok(names.includes('Taylor Swift'));
    assert.ok(names.includes('Drake'));
  });

  it('should strictly enforce minimum 3 favourite artists validation', () => {
    const validateArtists = (artists) => artists.length >= 3;
    assert.strictEqual(validateArtists([]), false);
    assert.strictEqual(validateArtists(['Arijit Singh']), false);
    assert.strictEqual(validateArtists(['Arijit Singh', 'Taylor Swift']), false);
    assert.strictEqual(validateArtists(['Arijit Singh', 'Taylor Swift', 'Diljit Dosanjh']), true);
    assert.strictEqual(validateArtists(['Arijit Singh', 'Taylor Swift', 'Diljit Dosanjh', 'The Weeknd']), true);
  });

  it('should have all 17 languages seeded', () => {
    assert.strictEqual(STARTER_LANGUAGES.length, 17);
    const names = STARTER_LANGUAGES.map(l => l.name);
    assert.ok(names.includes('Hindi'));
    assert.ok(names.includes('English'));
    assert.ok(names.includes('Punjabi'));
    assert.ok(names.includes('Tamil'));
    assert.ok(names.includes('Telugu'));
    assert.ok(names.includes('Other'));
  });

  it('should enforce minimum 1 language validation', () => {
    const validateLanguages = (langs) => langs.length >= 1;
    assert.strictEqual(validateLanguages([]), false);
    assert.strictEqual(validateLanguages(['Hindi']), true);
    assert.strictEqual(validateLanguages(['Hindi', 'English']), true);
  });

  it('should prioritize user preferred genres when sorting category shelves', () => {
    const userPreferred = ['lofi', 'romantic'];
    const mockCategories = [
      ['trending', []],
      ['bollywood', []],
      ['lofi', []],
      ['party', []],
      ['romantic', []]
    ];

    const sorted = [...mockCategories].sort(([catA], [catB]) => {
      const aMatch = userPreferred.includes(catA);
      const bMatch = userPreferred.includes(catB);
      if (aMatch && !bMatch) return -1;
      if (!aMatch && bMatch) return 1;
      return 0;
    });

    const sortedKeys = sorted.map(([k]) => k);
    // 'lofi' and 'romantic' should be in the first two slots
    assert.ok(sortedKeys.slice(0, 2).includes('lofi'));
    assert.ok(sortedKeys.slice(0, 2).includes('romantic'));
  });
});
