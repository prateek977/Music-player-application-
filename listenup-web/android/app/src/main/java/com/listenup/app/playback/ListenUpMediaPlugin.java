package com.listenup.app.playback;

import android.content.ComponentName;
import android.content.Context;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.session.MediaController;
import androidx.media3.session.SessionToken;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.common.util.concurrent.ListenableFuture;
import com.google.common.util.concurrent.MoreExecutors;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Capacitor Plugin: ListenUpMedia
 * Bridges React 19 Frontend with the native AndroidX Media3 Background Playback Service.
 */
@CapacitorPlugin(name = "ListenUpMedia")
public class ListenUpMediaPlugin extends Plugin {
    private static final String TAG = "ListenUpMediaPlugin";

    private MediaController mediaController;
    private ListenableFuture<MediaController> controllerFuture;
    private final Handler progressHandler = new Handler(Looper.getMainLooper());
    private boolean isProgressTracking = false;

    private final Runnable progressRunnable = new Runnable() {
        @Override
        public void run() {
            if (mediaController != null && mediaController.isPlaying()) {
                long pos = mediaController.getCurrentPosition();
                long dur = mediaController.getDuration();
                JSObject progressData = new JSObject();
                progressData.put("positionMs", Math.max(0, pos));
                progressData.put("durationMs", Math.max(0, dur));
                notifyListeners("positionChange", progressData);
                progressHandler.postDelayed(this, 1000);
            } else {
                isProgressTracking = false;
            }
        }
    };

    @Override
    public void load() {
        super.load();
        connectToService(null);
    }

    private void connectToService(@Nullable Runnable onConnected) {
        Context context = getContext();
        SessionToken sessionToken = new SessionToken(
                context,
                new ComponentName(context, ListenUpMediaService.class)
        );

        controllerFuture = new MediaController.Builder(context, sessionToken).buildAsync();
        controllerFuture.addListener(() -> {
            try {
                mediaController = controllerFuture.get();
                setupPlayerListener();
                Log.i(TAG, "Connected to native ListenUpMediaService MediaController");
                if (onConnected != null) {
                    onConnected.run();
                }
            } catch (Exception e) {
                Log.e(TAG, "Failed connecting to ListenUpMediaService", e);
            }
        }, MoreExecutors.directExecutor());
    }

    private void setupPlayerListener() {
        if (mediaController == null) return;

        mediaController.addListener(new Player.Listener() {
            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                JSObject data = new JSObject();
                data.put("isPlaying", isPlaying);
                data.put("positionMs", mediaController.getCurrentPosition());
                data.put("durationMs", mediaController.getDuration());
                notifyListeners("playbackStateChange", data);

                if (isPlaying && !isProgressTracking) {
                    isProgressTracking = true;
                    progressHandler.post(progressRunnable);
                }
            }

            @Override
            public void onPlaybackStateChanged(int playbackState) {
                JSObject data = new JSObject();
                String stateString;
                switch (playbackState) {
                    case Player.STATE_BUFFERING:
                        stateString = "BUFFERING";
                        break;
                    case Player.STATE_READY:
                        stateString = "READY";
                        break;
                    case Player.STATE_ENDED:
                        stateString = "ENDED";
                        break;
                    default:
                        stateString = "IDLE";
                        break;
                }
                data.put("state", stateString);
                data.put("isPlaying", mediaController.isPlaying());
                notifyListeners("playbackStateChange", data);
            }

            @Override
            public void onMediaItemTransition(@Nullable MediaItem mediaItem, int reason) {
                if (mediaItem != null) {
                    JSObject data = new JSObject();
                    data.put("id", mediaItem.mediaId);
                    if (mediaItem.mediaMetadata.title != null) {
                        data.put("title", mediaItem.mediaMetadata.title.toString());
                    }
                    if (mediaItem.mediaMetadata.artist != null) {
                        data.put("artist", mediaItem.mediaMetadata.artist.toString());
                    }
                    if (mediaItem.mediaMetadata.artworkUri != null) {
                        data.put("thumbnailUrl", mediaItem.mediaMetadata.artworkUri.toString());
                    }
                    notifyListeners("trackChange", data);
                }
            }

            @Override
            public void onPlayerError(@NonNull PlaybackException error) {
                Log.e(TAG, "Native ExoPlayer error", error);
                JSObject data = new JSObject();
                data.put("errorCode", error.errorCode);
                data.put("message", error.getMessage());
                notifyListeners("error", data);
            }
        });
    }

    private MediaItem createMediaItem(JSONObject json) {
        String id = json.optString("id", "track_" + System.currentTimeMillis());
        String title = json.optString("title", "Unknown Title");
        String artist = json.optString("artist", "Unknown Artist");
        String streamUrl = json.optString("streamUrl", json.optString("url", ""));
        String thumbnailUrl = json.optString("thumbnailUrl", json.optString("coverUrl", ""));

        MediaMetadata.Builder metaBuilder = new MediaMetadata.Builder()
                .setTitle(title)
                .setArtist(artist);

        if (!thumbnailUrl.isEmpty()) {
            metaBuilder.setArtworkUri(Uri.parse(thumbnailUrl));
        }

        MediaItem.Builder item = new MediaItem.Builder()
                .setMediaId(id)
                .setMediaMetadata(metaBuilder.build());

        if (!streamUrl.isEmpty()) {
            item.setUri(Uri.parse(streamUrl));
        }

        return item.build();
    }

    @PluginMethod
    public void initializePlayer(PluginCall call) {
        if (mediaController != null) {
            JSObject res = new JSObject();
            res.put("supported", true);
            res.put("connected", true);
            call.resolve(res);
            return;
        }

        connectToService(() -> {
            JSObject res = new JSObject();
            res.put("supported", true);
            res.put("connected", true);
            call.resolve(res);
        });
    }

    @PluginMethod
    public void playTrack(PluginCall call) {
        if (mediaController == null) {
            call.reject("MediaController not connected");
            return;
        }

        JSObject track = call.getObject("track");
        if (track == null) {
            call.reject("Missing track object");
            return;
        }

        MediaItem item = createMediaItem(track);
        mediaController.setMediaItem(item);
        mediaController.prepare();
        mediaController.play();

        JSObject res = new JSObject();
        res.put("success", true);
        call.resolve(res);
    }

    @PluginMethod
    public void pauseTrack(PluginCall call) {
        if (mediaController != null) {
            mediaController.pause();
        }
        JSObject res = new JSObject();
        res.put("success", true);
        call.resolve(res);
    }

    @PluginMethod
    public void resumeTrack(PluginCall call) {
        if (mediaController != null) {
            mediaController.play();
        }
        JSObject res = new JSObject();
        res.put("success", true);
        call.resolve(res);
    }

    @PluginMethod
    public void seekTo(PluginCall call) {
        Long pos = call.getLong("positionMs");
        if (pos == null) {
            Integer posInt = call.getInt("positionMs");
            if (posInt != null) pos = posInt.longValue();
        }

        if (mediaController != null && pos != null) {
            mediaController.seekTo(pos);
        }
        JSObject res = new JSObject();
        res.put("success", true);
        call.resolve(res);
    }

    @PluginMethod
    public void setQueue(PluginCall call) {
        if (mediaController == null) {
            call.reject("MediaController not connected");
            return;
        }

        JSArray tracks = call.getArray("tracks");
        int startIndex = call.getInt("startIndex", 0);

        if (tracks == null || tracks.length() == 0) {
            mediaController.clearMediaItems();
            JSObject res = new JSObject();
            res.put("success", true);
            call.resolve(res);
            return;
        }

        List<MediaItem> mediaItems = new ArrayList<>();
        for (int i = 0; i < tracks.length(); i++) {
            try {
                mediaItems.add(createMediaItem(tracks.getJSONObject(i)));
            } catch (JSONException e) {
                Log.w(TAG, "Invalid track in queue array at index " + i, e);
            }
        }

        mediaController.setMediaItems(mediaItems, startIndex, 0);
        mediaController.prepare();

        boolean autoPlay = call.getBoolean("autoPlay", false);
        if (autoPlay) {
            mediaController.play();
        }

        JSObject res = new JSObject();
        res.put("success", true);
        res.put("queueSize", mediaItems.size());
        call.resolve(res);
    }

    @PluginMethod
    public void playNext(PluginCall call) {
        if (mediaController != null && mediaController.hasNextMediaItem()) {
            mediaController.seekToNextMediaItem();
            mediaController.play();
        }
        JSObject res = new JSObject();
        res.put("success", true);
        call.resolve(res);
    }

    @PluginMethod
    public void playPrevious(PluginCall call) {
        if (mediaController != null) {
            if (mediaController.getCurrentPosition() > 3000) {
                mediaController.seekTo(0);
            } else if (mediaController.hasPreviousMediaItem()) {
                mediaController.seekToPreviousMediaItem();
            }
            mediaController.play();
        }
        JSObject res = new JSObject();
        res.put("success", true);
        call.resolve(res);
    }

    @PluginMethod
    public void setRepeatMode(PluginCall call) {
        String mode = call.getString("mode", "off");
        if (mediaController != null) {
            if ("one".equals(mode)) {
                mediaController.setRepeatMode(Player.REPEAT_MODE_ONE);
            } else if ("all".equals(mode)) {
                mediaController.setRepeatMode(Player.REPEAT_MODE_ALL);
            } else {
                mediaController.setRepeatMode(Player.REPEAT_MODE_OFF);
            }
        }
        JSObject res = new JSObject();
        res.put("success", true);
        call.resolve(res);
    }

    @PluginMethod
    public void setShuffleMode(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        if (mediaController != null) {
            mediaController.setShuffleModeEnabled(enabled);
        }
        JSObject res = new JSObject();
        res.put("success", true);
        call.resolve(res);
    }

    @PluginMethod
    public void getPlaybackState(PluginCall call) {
        JSObject res = new JSObject();
        if (mediaController != null) {
            res.put("isPlaying", mediaController.isPlaying());
            res.put("positionMs", mediaController.getCurrentPosition());
            res.put("durationMs", mediaController.getDuration());
            res.put("repeatMode", mediaController.getRepeatMode());
            res.put("shuffleEnabled", mediaController.getShuffleModeEnabled());
        } else {
            res.put("isPlaying", false);
            res.put("positionMs", 0);
            res.put("durationMs", 0);
        }
        call.resolve(res);
    }

    @Override
    protected void handleOnDestroy() {
        progressHandler.removeCallbacks(progressRunnable);
        if (mediaController != null) {
            mediaController.release();
            mediaController = null;
        }
        super.handleOnDestroy();
    }
}

