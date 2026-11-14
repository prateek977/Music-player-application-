import test from 'node:test';
import assert from 'node:assert/strict';

test('Queue Management & Playback Ordering Logic', async (t) => {
  const sampleTracks = [
    { id: 'track-1', title: 'Kesariya', artist: 'Arijit Singh' },
    { id: 'track-2', title: 'Apna Bana Le', artist: 'Arijit Singh' },
    { id: 'track-3', title: 'Lover', artist: 'Diljit Dosanjh' },
    { id: 'track-4', title: 'Starboy', artist: 'The Weeknd' }
  ];

  await t.test('inserts track as Play Next directly after current song', () => {
    const queue = [...sampleTracks.slice(0, 3)]; // track-1, track-2, track-3
    const currentSong = queue[1]; // track-2 is playing
    const incomingTrack = sampleTracks[3]; // track-4

    const playNextQueue = (currentQueue, currentTrack, newTrack) => {
      const currentIdx = currentQueue.findIndex(s => s.id === currentTrack?.id);
      const filtered = currentQueue.filter(s => s.id !== newTrack.id);
      if (currentIdx === -1) {
        return [...filtered, newTrack];
      }
      const updated = [...filtered];
      const targetIdx = updated.findIndex(s => s.id === currentTrack.id);
      updated.splice(targetIdx + 1, 0, newTrack);
      return updated;
    };

    const result = playNextQueue(queue, currentSong, incomingTrack);
    assert.equal(result.length, 4);
    assert.equal(result[0].id, 'track-1');
    assert.equal(result[1].id, 'track-2');
    assert.equal(result[2].id, 'track-4'); // inserted right after track-2
    assert.equal(result[3].id, 'track-3');
  });

  await t.test('appends track to the end of queue without disturbing Up Next', () => {
    const queue = [sampleTracks[0], sampleTracks[1]];
    const newTrack = sampleTracks[2];

    const appendToQueue = (q, track) => {
      if (q.some(s => s.id === track.id)) return q;
      return [...q, track];
    };

    const updated = appendToQueue(queue, newTrack);
    assert.equal(updated.length, 3);
    assert.equal(updated[2].id, 'track-3');

    // Duplicate append check
    const deduped = appendToQueue(updated, newTrack);
    assert.equal(deduped.length, 3);
  });

  await t.test('removes specific song from queue and preserves remaining order', () => {
    const queue = [...sampleTracks];
    const removeId = 'track-2';

    const removeFromQueue = (q, idToRemove) => {
      return q.filter(s => s.id !== idToRemove);
    };

    const remaining = removeFromQueue(queue, removeId);
    assert.equal(remaining.length, 3);
    assert.equal(remaining.some(s => s.id === 'track-2'), false);
    assert.equal(remaining[0].id, 'track-1');
    assert.equal(remaining[1].id, 'track-3');
    assert.equal(remaining[2].id, 'track-4');
  });

  await t.test('shuffles remaining queue while keeping current track intact', () => {
    const queue = [...sampleTracks];
    const currentSong = sampleTracks[0];

    const shuffleQueue = (q, activeTrack) => {
      if (q.length <= 1) return q;
      const currentIdx = q.findIndex(s => s.id === activeTrack?.id);
      const remaining = q.filter((_, i) => i !== currentIdx);

      // Deterministic mock shuffle or in-place swap
      const shuffled = [...remaining].reverse();
      return activeTrack ? [activeTrack, ...shuffled] : shuffled;
    };

    const shuffledResult = shuffleQueue(queue, currentSong);
    assert.equal(shuffledResult.length, 4);
    assert.equal(shuffledResult[0].id, 'track-1'); // active track stays first
    assert.equal(shuffledResult[1].id, 'track-4');
    assert.equal(shuffledResult[2].id, 'track-3');
    assert.equal(shuffledResult[3].id, 'track-2');
  });

  await t.test('clears queue completely and resets active playback state', () => {
    let queue = [...sampleTracks];
    let currentSong = sampleTracks[0];
    let isPlaying = true;

    const clearQueueState = () => {
      queue = [];
      currentSong = null;
      isPlaying = false;
    };

    clearQueueState();
    assert.equal(queue.length, 0);
    assert.equal(currentSong, null);
    assert.equal(isPlaying, false);
  });
});
