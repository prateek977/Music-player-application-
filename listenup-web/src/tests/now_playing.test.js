import test from 'node:test';
import assert from 'node:assert/strict';

test('Now Playing Audio & Playback Logic', async (t) => {
  await t.test('calculates correct progress percentage across duration bounds', () => {
    const calcProgress = (currentTime, duration) => {
      const activeDuration = duration > 0 ? duration : 100;
      return Math.min(Math.max((currentTime / activeDuration) * 100, 0), 100);
    };

    assert.equal(calcProgress(0, 200), 0);
    assert.equal(calcProgress(100, 200), 50);
    assert.equal(calcProgress(200, 200), 100);
    // Clamping checks
    assert.equal(calcProgress(-10, 200), 0);
    assert.equal(calcProgress(250, 200), 100);
    assert.equal(calcProgress(50, 0), 50); // fallback duration 100
  });

  await t.test('formats seconds to MM:SS correctly', () => {
    const formatTime = (secs) => {
      if (isNaN(secs) || secs === null || secs === undefined) return '0:00';
      const m = Math.floor(secs / 60);
      const s = Math.floor(secs % 60);
      return `${m}:${s < 10 ? '0' : ''}${s}`;
    };

    assert.equal(formatTime(0), '0:00');
    assert.equal(formatTime(9), '0:09');
    assert.equal(formatTime(65), '1:05');
    assert.equal(formatTime(254), '4:14');
    assert.equal(formatTime(3600), '60:00');
  });

  await t.test('cycles repeat mode correctly (off -> all -> one -> off)', () => {
    const getNextRepeat = (current) => {
      if (current === 'off') return 'all';
      if (current === 'all') return 'one';
      return 'off';
    };

    assert.equal(getNextRepeat('off'), 'all');
    assert.equal(getNextRepeat('all'), 'one');
    assert.equal(getNextRepeat('one'), 'off');
  });

  await t.test('handles queue navigation bounds correctly', () => {
    const queue = [
      { id: '1', title: 'Song 1' },
      { id: '2', title: 'Song 2' },
      { id: '3', title: 'Song 3' }
    ];

    const getNextSong = (currentId, q, repeatMode) => {
      const idx = q.findIndex(s => s.id === currentId);
      if (idx === -1) return q[0];
      if (idx < q.length - 1) return q[idx + 1];
      if (repeatMode === 'all') return q[0];
      return null;
    };

    const getPrevSong = (currentId, q, currentTime, repeatMode) => {
      if (currentTime > 3) return { action: 'restart' };
      const idx = q.findIndex(s => s.id === currentId);
      if (idx > 0) return q[idx - 1];
      if (idx === 0 && repeatMode === 'all') return q[q.length - 1];
      return null;
    };

    assert.deepEqual(getNextSong('1', queue, 'off'), queue[1]);
    assert.deepEqual(getNextSong('3', queue, 'off'), null);
    assert.deepEqual(getNextSong('3', queue, 'all'), queue[0]);

    assert.deepEqual(getPrevSong('2', queue, 1, 'off'), queue[0]);
    assert.deepEqual(getPrevSong('2', queue, 5, 'off'), { action: 'restart' });
    assert.deepEqual(getPrevSong('1', queue, 1, 'all'), queue[2]);
  });

  await t.test('toggles favorite status properly without mutation', () => {
    const favorites = [{ id: 's1', title: 'Song 1' }];
    const songToToggle = { id: 's2', title: 'Song 2' };

    const toggle = (list, song) => {
      const exists = list.some(s => s.id === song.id);
      return exists ? list.filter(s => s.id !== song.id) : [...list, song];
    };

    const updated = toggle(favorites, songToToggle);
    assert.equal(updated.length, 2);
    assert.equal(favorites.length, 1); // no mutation

    const removed = toggle(updated, songToToggle);
    assert.equal(removed.length, 1);
    assert.equal(removed[0].id, 's1');
  });
});
