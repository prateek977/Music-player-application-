package com.listenup.app.data.local;

import android.os.Handler;
import android.os.Looper;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Capacitor Plugin: ListenUpStorage
 * Exposes Android Room SQLite database for fast, offline, local-first storage of
 * favorites, playlists, and listening history.
 */
@CapacitorPlugin(name = "ListenUpStorage")
public class ListenUpStoragePlugin extends Plugin {
    private AppDatabase db;
    private final ExecutorService executor = Executors.newFixedThreadPool(2);
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    public void load() {
        super.load();
        db = AppDatabase.getDatabase(getContext());
    }

    @PluginMethod
    public void getFavorites(PluginCall call) {
        executor.execute(() -> {
            try {
                List<FavoriteSongEntity> favs = db.favoritesDao().getAllFavorites();
                JSArray array = new JSArray();
                for (FavoriteSongEntity f : favs) {
                    JSObject item = new JSObject();
                    item.put("id", f.songId);
                    item.put("title", f.title);
                    item.put("artist", f.artist);
                    item.put("thumbnailUrl", f.thumbnailUrl);
                    item.put("duration", f.duration);
                    item.put("streamUrl", f.streamUrl);
                    item.put("addedAt", f.addedAt);
                    array.put(item);
                }
                JSObject res = new JSObject();
                res.put("favorites", array);
                mainHandler.post(() -> call.resolve(res));
            } catch (Exception e) {
                mainHandler.post(() -> call.reject("Failed fetching favorites", e));
            }
        });
    }

    @PluginMethod
    public void saveFavorite(PluginCall call) {
        JSObject song = call.getObject("song");
        if (song == null) {
            call.reject("Missing song parameter");
            return;
        }

        String id = song.getString("id");
        if (id == null || id.isEmpty()) {
            call.reject("Missing song id");
            return;
        }

        String title = song.getString("title", "");
        String artist = song.getString("artist", "");
        String thumb = song.getString("thumbnailUrl", "");
        int duration = song.getInteger("duration", 0);
        String streamUrl = song.getString("streamUrl", "");
        long now = System.currentTimeMillis();

        executor.execute(() -> {
            try {
                FavoriteSongEntity entity = new FavoriteSongEntity(id, title, artist, thumb, duration, streamUrl, now);
                db.favoritesDao().insertFavorite(entity);
                JSObject res = new JSObject();
                res.put("success", true);
                mainHandler.post(() -> call.resolve(res));
            } catch (Exception e) {
                mainHandler.post(() -> call.reject("Failed saving favorite", e));
            }
        });
    }

    @PluginMethod
    public void removeFavorite(PluginCall call) {
        String songId = call.getString("songId");
        if (songId == null) {
            call.reject("Missing songId parameter");
            return;
        }

        executor.execute(() -> {
            try {
                db.favoritesDao().deleteFavorite(songId);
                JSObject res = new JSObject();
                res.put("success", true);
                mainHandler.post(() -> call.resolve(res));
            } catch (Exception e) {
                mainHandler.post(() -> call.reject("Failed deleting favorite", e));
            }
        });
    }

    @PluginMethod
    public void getPlaylists(PluginCall call) {
        executor.execute(() -> {
            try {
                List<PlaylistEntity> playlists = db.playlistsDao().getAllPlaylists();
                JSArray array = new JSArray();
                for (PlaylistEntity p : playlists) {
                    JSObject item = new JSObject();
                    item.put("id", p.playlistId);
                    item.put("name", p.name);
                    item.put("coverUrl", p.coverUrl);
                    try {
                        item.put("songs", new JSArray(p.songsJson != null ? p.songsJson : "[]"));
                    } catch (JSONException ignored) {
                        item.put("songs", new JSArray());
                    }
                    item.put("createdAt", p.createdAt);
                    item.put("updatedAt", p.updatedAt);
                    array.put(item);
                }
                JSObject res = new JSObject();
                res.put("playlists", array);
                mainHandler.post(() -> call.resolve(res));
            } catch (Exception e) {
                mainHandler.post(() -> call.reject("Failed fetching playlists", e));
            }
        });
    }

    @PluginMethod
    public void savePlaylist(PluginCall call) {
        JSObject pl = call.getObject("playlist");
        if (pl == null) {
            call.reject("Missing playlist parameter");
            return;
        }

        String id = pl.getString("id", "pl_" + System.currentTimeMillis());
        String name = pl.getString("name", "New Playlist");
        String coverUrl = pl.getString("coverUrl", "");
        org.json.JSONArray songs = pl.optJSONArray("songs");
        String songsJson = songs != null ? songs.toString() : "[]";
        long now = System.currentTimeMillis();

        executor.execute(() -> {
            try {
                PlaylistEntity entity = new PlaylistEntity(id, name, coverUrl, songsJson, now, now);
                db.playlistsDao().insertPlaylist(entity);
                JSObject res = new JSObject();
                res.put("success", true);
                res.put("id", id);
                mainHandler.post(() -> call.resolve(res));
            } catch (Exception e) {
                mainHandler.post(() -> call.reject("Failed saving playlist", e));
            }
        });
    }

    @PluginMethod
    public void deletePlaylist(PluginCall call) {
        String playlistId = call.getString("playlistId");
        if (playlistId == null) {
            call.reject("Missing playlistId");
            return;
        }

        executor.execute(() -> {
            try {
                db.playlistsDao().deletePlaylist(playlistId);
                JSObject res = new JSObject();
                res.put("success", true);
                mainHandler.post(() -> call.resolve(res));
            } catch (Exception e) {
                mainHandler.post(() -> call.reject("Failed deleting playlist", e));
            }
        });
    }

    @PluginMethod
    public void logListeningEvent(PluginCall call) {
        String songId = call.getString("songId");
        if (songId == null) {
            call.reject("Missing songId");
            return;
        }

        String title = call.getString("title", "");
        String artist = call.getString("artist", "");
        double fraction = call.getDouble("listenFraction", 0.0);
        boolean skipped = Boolean.TRUE.equals(call.getBoolean("skipped", false));
        long now = System.currentTimeMillis();

        executor.execute(() -> {
            try {
                ListeningHistoryEntity entity = new ListeningHistoryEntity(
                        songId, title, artist, now, (float) fraction, skipped
                );
                db.historyDao().insertEvent(entity);
                db.historyDao().trimHistory();
                JSObject res = new JSObject();
                res.put("success", true);
                mainHandler.post(() -> call.resolve(res));
            } catch (Exception e) {
                mainHandler.post(() -> call.reject("Failed logging event", e));
            }
        });
    }

    @PluginMethod
    public void getListeningHistory(PluginCall call) {
        int limit = call.getInt("limit", 50);
        executor.execute(() -> {
            try {
                List<ListeningHistoryEntity> list = db.historyDao().getRecentHistory(limit);
                JSArray array = new JSArray();
                for (ListeningHistoryEntity h : list) {
                    JSObject item = new JSObject();
                    item.put("songId", h.songId);
                    item.put("title", h.title);
                    item.put("artist", h.artist);
                    item.put("playedAt", h.playedAt);
                    item.put("completedPercent", h.completedPercent);
                    item.put("wasSkipped", h.wasSkipped);
                    array.put(item);
                }
                JSObject res = new JSObject();
                res.put("history", array);
                mainHandler.post(() -> call.resolve(res));
            } catch (Exception e) {
                mainHandler.post(() -> call.reject("Failed fetching history", e));
            }
        });
    }
}
