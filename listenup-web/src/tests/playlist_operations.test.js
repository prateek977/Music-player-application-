import test from 'node:test';
import assert from 'node:assert/strict';

test('Playlist Management Operations & State Logic', async (t) => {
  const sampleSongA = { id: 's1', title: 'Kesariya', artist: 'Arijit Singh', duration: 268 };
  const sampleSongB = { id: 's2', title: 'Apna Bana Le', artist: 'Arijit Singh', duration: 261 };
  const sampleSongC = { id: 's3', title: 'Lover', artist: 'Diljit Dosanjh', duration: 189 };

  await t.test('creates playlist with trimmed name and empty songs array', () => {
    const createPlaylist = (playlists, name) => {
      const clean = (name || '').trim();
      if (!clean) return { error: 'Name cannot be empty' };
      const newPlaylist = {
        id: `pl_${Date.now()}`,
        name: clean,
        songs: []
      };
      return { success: true, playlists: [...playlists, newPlaylist], created: newPlaylist };
    };

    const res1 = createPlaylist([], '  Gym Workout Mix  ');
    assert.equal(res1.success, true);
    assert.equal(res1.created.name, 'Gym Workout Mix');
    assert.equal(res1.created.songs.length, 0);

    const res2 = createPlaylist([], '   ');
    assert.equal(res2.error, 'Name cannot be empty');
  });

  await t.test('renames existing playlist without mutating other playlists', () => {
    const playlists = [
      { id: 'p1', name: 'Old Chill', songs: [sampleSongA] },
      { id: 'p2', name: 'Roadtrip', songs: [sampleSongB] }
    ];

    const renamePlaylist = (list, playlistId, newName) => {
      const clean = (newName || '').trim();
      if (!clean) return list;
      return list.map(p => p.id === playlistId ? { ...p, name: clean } : p);
    };

    const updated = renamePlaylist(playlists, 'p1', 'Midnight Chill & Lo-Fi');
    assert.equal(updated[0].name, 'Midnight Chill & Lo-Fi');
    assert.equal(updated[0].songs.length, 1);
    assert.equal(updated[1].name, 'Roadtrip');
  });

  await t.test('prevents adding duplicate songs to the same playlist', () => {
    const playlist = { id: 'p1', name: 'Favorites', songs: [sampleSongA] };

    const addSong = (pl, song) => {
      if (pl.songs.some(s => s.id === song.id)) {
        return { success: false, alreadyExists: true, playlist: pl };
      }
      return {
        success: true,
        alreadyExists: false,
        playlist: { ...pl, songs: [...pl.songs, song] }
      };
    };

    const duplicateRes = addSong(playlist, sampleSongA);
    assert.equal(duplicateRes.alreadyExists, true);
    assert.equal(duplicateRes.playlist.songs.length, 1);

    const successRes = addSong(playlist, sampleSongB);
    assert.equal(successRes.alreadyExists, false);
    assert.equal(successRes.playlist.songs.length, 2);
  });

  await t.test('removes song from playlist and preserves other songs', () => {
    const playlist = { id: 'p1', name: 'Hits', songs: [sampleSongA, sampleSongB, sampleSongC] };

    const removeSong = (pl, songId) => {
      return {
        ...pl,
        songs: pl.songs.filter(s => s.id !== songId)
      };
    };

    const updated = removeSong(playlist, 's2');
    assert.equal(updated.songs.length, 2);
    assert.equal(updated.songs.some(s => s.id === 's2'), false);
    assert.equal(updated.songs[0].id, 's1');
    assert.equal(updated.songs[1].id, 's3');
  });

  await t.test('calculates accurate total duration and formatted summary', () => {
    const songs = [sampleSongA, sampleSongB, sampleSongC]; // 268 + 261 + 189 = 718s (~12 min)

    const calculatePlaylistStats = (songList) => {
      const totalSeconds = (songList || []).reduce((acc, s) => acc + (s.duration || 0), 0);
      const minutes = Math.round(totalSeconds / 60);
      const count = (songList || []).length;
      return {
        totalSeconds,
        summary: `${count} ${count === 1 ? 'song' : 'songs'} • ${minutes} min`
      };
    };

    const stats = calculatePlaylistStats(songs);
    assert.equal(stats.totalSeconds, 718);
    assert.equal(stats.summary, '3 songs • 12 min');

    const emptyStats = calculatePlaylistStats([]);
    assert.equal(emptyStats.totalSeconds, 0);
    assert.equal(emptyStats.summary, '0 songs • 0 min');
  });
});
