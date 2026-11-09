import { Capacitor } from '@capacitor/core';

/**
 * Native Media Bridge
 * High-performance, event-driven bridge connecting React 19 UI with
 * AndroidX Media3 / ExoPlayer Foreground MediaSessionService and Room SQLite DB.
 */

const ListenUpMedia = Capacitor.Plugins.ListenUpMedia;
const ListenUpStorage = Capacitor.Plugins.ListenUpStorage;

export const isNativeAndroid = () => {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
};

// Playback Bridge
export const nativeMedia = {
  isAvailable: () => isNativeAndroid() && Boolean(ListenUpMedia),

  initialize: async () => {
    if (!isNativeAndroid() || !ListenUpMedia) return { supported: false };
    try {
      return await ListenUpMedia.initializePlayer();
    } catch (e) {
      console.warn('Native player initialization failed:', e);
      return { supported: false };
    }
  },

  playTrack: async (track) => {
    if (!isNativeAndroid() || !ListenUpMedia) return;
    try {
      await ListenUpMedia.playTrack({ track });
    } catch (e) {
      console.error('Native playTrack failed:', e);
    }
  },

  pause: async () => {
    if (!isNativeAndroid() || !ListenUpMedia) return;
    try {
      await ListenUpMedia.pauseTrack();
    } catch (e) {
      console.error('Native pause failed:', e);
    }
  },

  resume: async () => {
    if (!isNativeAndroid() || !ListenUpMedia) return;
    try {
      await ListenUpMedia.resumeTrack();
    } catch (e) {
      console.error('Native resume failed:', e);
    }
  },

  seekTo: async (positionSec) => {
    if (!isNativeAndroid() || !ListenUpMedia) return;
    try {
      await ListenUpMedia.seekTo({ positionMs: Math.round(positionSec * 1000) });
    } catch (e) {
      console.error('Native seekTo failed:', e);
    }
  },

  setQueue: async (tracks, startIndex = 0, autoPlay = true) => {
    if (!isNativeAndroid() || !ListenUpMedia) return;
    try {
      await ListenUpMedia.setQueue({ tracks, startIndex, autoPlay });
    } catch (e) {
      console.error('Native setQueue failed:', e);
    }
  },

  playNext: async () => {
    if (!isNativeAndroid() || !ListenUpMedia) return;
    try {
      await ListenUpMedia.playNext();
    } catch (e) {
      console.error('Native playNext failed:', e);
    }
  },

  playPrevious: async () => {
    if (!isNativeAndroid() || !ListenUpMedia) return;
    try {
      await ListenUpMedia.playPrevious();
    } catch (e) {
      console.error('Native playPrevious failed:', e);
    }
  },

  setRepeatMode: async (mode) => {
    if (!isNativeAndroid() || !ListenUpMedia) return;
    try {
      await ListenUpMedia.setRepeatMode({ mode });
    } catch (e) {
      console.error('Native setRepeatMode failed:', e);
    }
  },

  setShuffleMode: async (enabled) => {
    if (!isNativeAndroid() || !ListenUpMedia) return;
    try {
      await ListenUpMedia.setShuffleMode({ enabled });
    } catch (e) {
      console.error('Native setShuffleMode failed:', e);
    }
  },

  getPlaybackState: async () => {
    if (!isNativeAndroid() || !ListenUpMedia) return null;
    try {
      return await ListenUpMedia.getPlaybackState();
    } catch (e) {
      return null;
    }
  },

  // Event Listeners
  addPlaybackStateListener: (callback) => {
    if (!isNativeAndroid() || !ListenUpMedia) return { remove: () => {} };
    return ListenUpMedia.addListener('playbackStateChange', callback);
  },

  addTrackChangeListener: (callback) => {
    if (!isNativeAndroid() || !ListenUpMedia) return { remove: () => {} };
    return ListenUpMedia.addListener('trackChange', callback);
  },

  addPositionChangeListener: (callback) => {
    if (!isNativeAndroid() || !ListenUpMedia) return { remove: () => {} };
    return ListenUpMedia.addListener('positionChange', callback);
  },

  addErrorListener: (callback) => {
    if (!isNativeAndroid() || !ListenUpMedia) return { remove: () => {} };
    return ListenUpMedia.addListener('error', callback);
  }
};

// Local Room Database Storage Bridge
export const nativeStorage = {
  isAvailable: () => isNativeAndroid() && Boolean(ListenUpStorage),

  getFavorites: async () => {
    if (!isNativeAndroid() || !ListenUpStorage) return null;
    try {
      const res = await ListenUpStorage.getFavorites();
      return res.favorites || [];
    } catch (e) {
      console.warn('Native getFavorites fallback:', e);
      return null;
    }
  },

  saveFavorite: async (song) => {
    if (!isNativeAndroid() || !ListenUpStorage) return false;
    try {
      await ListenUpStorage.saveFavorite({ song });
      return true;
    } catch (e) {
      console.warn('Native saveFavorite fallback:', e);
      return false;
    }
  },

  removeFavorite: async (songId) => {
    if (!isNativeAndroid() || !ListenUpStorage) return false;
    try {
      await ListenUpStorage.removeFavorite({ songId });
      return true;
    } catch (e) {
      console.warn('Native removeFavorite fallback:', e);
      return false;
    }
  },

  getPlaylists: async () => {
    if (!isNativeAndroid() || !ListenUpStorage) return null;
    try {
      const res = await ListenUpStorage.getPlaylists();
      return res.playlists || [];
    } catch (e) {
      console.warn('Native getPlaylists fallback:', e);
      return null;
    }
  },

  savePlaylist: async (playlist) => {
    if (!isNativeAndroid() || !ListenUpStorage) return false;
    try {
      await ListenUpStorage.savePlaylist({ playlist });
      return true;
    } catch (e) {
      console.warn('Native savePlaylist fallback:', e);
      return false;
    }
  },

  deletePlaylist: async (playlistId) => {
    if (!isNativeAndroid() || !ListenUpStorage) return false;
    try {
      await ListenUpStorage.deletePlaylist({ playlistId });
      return true;
    } catch (e) {
      console.warn('Native deletePlaylist fallback:', e);
      return false;
    }
  },

  logListeningEvent: async (songId, title, artist, listenFraction, skipped) => {
    if (!isNativeAndroid() || !ListenUpStorage) return;
    try {
      await ListenUpStorage.logListeningEvent({
        songId,
        title,
        artist,
        listenFraction,
        skipped
      });
    } catch (e) {
      console.warn('Native logListeningEvent failed:', e);
    }
  },

  getListeningHistory: async (limit = 50) => {
    if (!isNativeAndroid() || !ListenUpStorage) return [];
    try {
      const res = await ListenUpStorage.getListeningHistory({ limit });
      return res.history || [];
    } catch (e) {
      return [];
    }
  }
};

