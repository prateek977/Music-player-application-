package com.listenup.app.playback;

import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.content.ContextCompat;
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

import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.function.Consumer;

/**
 * Capacitor Plugin: ListenUpMedia
 * Bridges React 19 Frontend with the native AndroidX Media3 Background Playback Service.
 * Thread-safe: All MediaController invocations are guaranteed to run on the configured
 * application looper (Looper.getMainLooper()).
 */
@CapacitorPlugin(name = "ListenUpMedia")
public class ListenUpMediaPlugin extends Plugin {
    private static final String TAG = "ListenUpMediaPlugin";

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private MediaController mediaController;
    private ListenableFuture<MediaController> controllerFuture;
    private boolean isProgressTracking = false;

    private final Runnable progressRunnable = new Runnable() {
        @Override
        public void run() {
            runOnApplicationThread(() -> {
                if (mediaController != null && mediaController.isPlaying()) {
                    long pos = mediaController.getCurrentPosition();
                    long dur = mediaController.getDuration();
                    JSObject progressData = new JSObject();
                    progressData.put("positionMs", Math.max(0, pos));
                    progressData.put("durationMs", Math.max(0, dur));
                    notifyListeners("positionChange", progressData);
                    mainHandler.postDelayed(progressRunnable, 1000);
                } else {
                    isProgressTracking = false;
                }
            });
        }
    };

    private boolean isReceiverRegistered = false;
    private final BroadcastReceiver actionReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (intent == null || intent.getAction() == null) return;
            if (ListenUpMediaService.ACTION_NEXT_TRACK.equals(intent.getAction())) {
                Log.d(TAG, "Notification ACTION_NEXT_TRACK received, notifying listeners");
                notifyListeners("nextTrackRequested", new JSObject());
            } else if (ListenUpMediaService.ACTION_PREV_TRACK.equals(intent.getAction())) {
                Log.d(TAG, "Notification ACTION_PREV_TRACK received, notifying listeners");
                notifyListeners("previousTrackRequested", new JSObject());
            }
        }
    };

    /**
     * Ensures runnable executes on the MediaController application looper (main thread).
     */
    private void runOnApplicationThread(Runnable runnable) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            runnable.run();
        } else {
            mainHandler.post(runnable);
        }
    }

    /**
     * Executes action on MediaController once connected, strictly on application looper.
     */
    private void withController(PluginCall call, Consumer<MediaController> action) {
        runOnApplicationThread(() -> {
            if (mediaController != null) {
                try {
                    action.accept(mediaController);
                } catch (Exception e) {
                    Log.e(TAG, "Error executing controller action", e);
                    call.reject("Error executing action: " + e.getMessage());
                }
            } else if (controllerFuture != null && !controllerFuture.isDone()) {
                Context ctx = getContext();
                if (ctx != null) {
                    controllerFuture.addListener(() -> {
                        runOnApplicationThread(() -> {
                            try {
                                if (mediaController != null) {
                                    action.accept(mediaController);
                                } else {
                                    call.reject("MediaController failed to connect");
                                }
                            } catch (Exception e) {
                                Log.e(TAG, "Error executing deferred controller action", e);
                                call.reject("Error executing action: " + e.getMessage());
                            }
                        });
                    }, ContextCompat.getMainExecutor(ctx));
                } else {
                    call.reject("Context is null");
                }
            } else {
                call.reject("MediaController not connected");
            }
        });
    }

    @Override
    public void load() {
        super.load();
        registerActionReceiver();
        connectToService(null);
    }

    private void registerActionReceiver() {
        if (!isReceiverRegistered && getContext() != null) {
            IntentFilter filter = new IntentFilter();
            filter.addAction(ListenUpMediaService.ACTION_NEXT_TRACK);
            filter.addAction(ListenUpMediaService.ACTION_PREV_TRACK);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                getContext().registerReceiver(actionReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
            } else {
                getContext().registerReceiver(actionReceiver, filter);
            }
            isReceiverRegistered = true;
        }
    }

    private void connectToService(@Nullable Runnable onConnected) {
        Context context = getContext();
        if (context == null) return;

        SessionToken sessionToken = new SessionToken(
                context,
                new ComponentName(context, ListenUpMediaService.class)
        );

        runOnApplicationThread(() -> {
            if (mediaController != null) {
                if (onConnected != null) onConnected.run();
                return;
            }

            controllerFuture = new MediaController.Builder(context, sessionToken)
                    .setApplicationLooper(Looper.getMainLooper())
                    .buildAsync();

            controllerFuture.addListener(() -> {
                runOnApplicationThread(() -> {
                    try {
                        mediaController = controllerFuture.get();
                        setupPlayerListener();
                        Log.i(TAG, "Connected to native ListenUpMediaService MediaController on application thread");
                        if (onConnected != null) {
                            onConnected.run();
                        }
                    } catch (Exception e) {
                        Log.e(TAG, "Failed connecting to ListenUpMediaService", e);
                        if (onConnected != null) {
                            onConnected.run();
                        }
                    }
                });
            }, ContextCompat.getMainExecutor(context));
        });
    }

    private void setupPlayerListener() {
        if (mediaController == null) return;

        mediaController.addListener(new Player.Listener() {
            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                runOnApplicationThread(() -> {
                    if (mediaController == null) return;
                    JSObject data = new JSObject();
                    data.put("isPlaying", isPlaying);
                    data.put("positionMs", mediaController.getCurrentPosition());
                    data.put("durationMs", mediaController.getDuration());
                    notifyListeners("playbackStateChange", data);

                    if (isPlaying && !isProgressTracking) {
                        isProgressTracking = true;
                        mainHandler.post(progressRunnable);
                    }
                });
            }

            @Override
            public void onPlaybackStateChanged(int playbackState) {
                runOnApplicationThread(() -> {
                    if (mediaController == null) return;
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
                });
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
        connectToService(() -> {
            JSObject res = new JSObject();
            res.put("supported", true);
            res.put("connected", mediaController != null);
            call.resolve(res);
        });
    }

    @PluginMethod
    public void playTrack(PluginCall call) {
        JSObject track = call.getObject("track");
        if (track == null) {
            call.reject("Missing track object");
            return;
        }

        String streamUrl = track.optString("streamUrl", track.optString("url", ""));
        MediaItem item = createMediaItem(track);

        withController(call, controller -> {
            if (streamUrl.isEmpty()) {
                // Track has no direct audio stream (e.g. YouTube video played via foreground IFrame).
                // Do NOT start ExoPlayer or request audio focus.
                // Stop/pause any previous native stream playback to release audio focus for WebView.
                if (controller.isPlaying()) {
                    controller.pause();
                }
                try {
                    controller.setPlaylistMetadata(item.mediaMetadata);
                } catch (Exception e) {
                    Log.w(TAG, "setPlaylistMetadata warning", e);
                }
                JSObject res = new JSObject();
                res.put("success", true);
                res.put("nativePlayback", false);
                res.put("reason", "No streamUrl; using foreground player");
                call.resolve(res);
                return;
            }

            // Direct stream URL present - start native Media3 playback
            controller.setMediaItem(item);
            controller.prepare();
            controller.play();

            JSObject res = new JSObject();
            res.put("success", true);
            res.put("nativePlayback", true);
            call.resolve(res);
        });
    }

    @PluginMethod
    public void updateMetadata(PluginCall call) {
        JSObject track = call.getObject("track");
        if (track == null) {
            JSObject res = new JSObject();
            res.put("success", false);
            call.resolve(res);
            return;
        }

        MediaItem item = createMediaItem(track);
        withController(call, controller -> {
            if (controller.isPlaying()) {
                controller.pause();
            }
            try {
                controller.setPlaylistMetadata(item.mediaMetadata);
            } catch (Exception e) {
                Log.w(TAG, "setPlaylistMetadata warning", e);
            }
            JSObject res = new JSObject();
            res.put("success", true);
            call.resolve(res);
        });
    }

    @PluginMethod
    public void pauseTrack(PluginCall call) {
        runOnApplicationThread(() -> {
            if (mediaController != null) {
                try {
                    mediaController.pause();
                } catch (Exception e) {
                    Log.w(TAG, "pauseTrack error", e);
                }
            }
            JSObject res = new JSObject();
            res.put("success", true);
            call.resolve(res);
        });
    }

    @PluginMethod
    public void resumeTrack(PluginCall call) {
        runOnApplicationThread(() -> {
            if (mediaController != null) {
                MediaItem item = mediaController.getCurrentMediaItem();
                if (item != null && mediaController.getPlaybackState() != Player.STATE_IDLE && mediaController.getPlaybackState() != Player.STATE_ENDED) {
                    try {
                        mediaController.play();
                    } catch (Exception e) {
                        Log.w(TAG, "resumeTrack error", e);
                    }
                }
            }
            JSObject res = new JSObject();
            res.put("success", true);
            call.resolve(res);
        });
    }

    @PluginMethod
    public void seekTo(PluginCall call) {
        Long pos = call.getLong("positionMs");
        if (pos == null) {
            Integer posInt = call.getInt("positionMs");
            if (posInt != null) pos = posInt.longValue();
        }

        final Long finalPos = pos;
        runOnApplicationThread(() -> {
            if (mediaController != null && finalPos != null) {
                try {
                    mediaController.seekTo(finalPos);
                } catch (Exception e) {
                    Log.w(TAG, "seekTo error", e);
                }
            }
            JSObject res = new JSObject();
            res.put("success", true);
            call.resolve(res);
        });
    }

    @PluginMethod
    public void setQueue(PluginCall call) {
        JSArray tracks = call.getArray("tracks");
        int startIndex = call.getInt("startIndex", 0);
        boolean autoPlay = call.getBoolean("autoPlay", false);

        if (tracks == null || tracks.length() == 0) {
            runOnApplicationThread(() -> {
                if (mediaController != null) {
                    mediaController.clearMediaItems();
                }
                JSObject res = new JSObject();
                res.put("success", true);
                call.resolve(res);
            });
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

        withController(call, controller -> {
            if (mediaItems.isEmpty()) {
                controller.clearMediaItems();
                JSObject res = new JSObject();
                res.put("success", true);
                call.resolve(res);
                return;
            }

            boolean hasPlayableUri = false;
            for (MediaItem mi : mediaItems) {
                if (mi.localConfiguration != null && mi.localConfiguration.uri != null) {
                    hasPlayableUri = true;
                    break;
                }
            }

            int safeIndex = Math.max(0, Math.min(startIndex, mediaItems.size() - 1));
            controller.setMediaItems(mediaItems, safeIndex, 0);

            if (hasPlayableUri) {
                controller.prepare();
                if (autoPlay) {
                    controller.play();
                }
            } else {
                Log.d(TAG, "setQueue: queue contains metadata only, no playable URIs");
            }

            JSObject res = new JSObject();
            res.put("success", true);
            res.put("queueSize", mediaItems.size());
            res.put("hasPlayableUri", hasPlayableUri);
            call.resolve(res);
        });
    }

    @PluginMethod
    public void playNext(PluginCall call) {
        runOnApplicationThread(() -> {
            if (mediaController != null) {
                try {
                    if (mediaController.hasNextMediaItem()) {
                        mediaController.seekToNextMediaItem();
                        mediaController.play();
                    }
                } catch (Exception e) {
                    Log.w(TAG, "playNext error", e);
                }
            }
            JSObject res = new JSObject();
            res.put("success", true);
            call.resolve(res);
        });
    }

    @PluginMethod
    public void playPrevious(PluginCall call) {
        runOnApplicationThread(() -> {
            if (mediaController != null) {
                try {
                    if (mediaController.getCurrentPosition() > 3000) {
                        mediaController.seekTo(0);
                    } else if (mediaController.hasPreviousMediaItem()) {
                        mediaController.seekToPreviousMediaItem();
                    }
                    mediaController.play();
                } catch (Exception e) {
                    Log.w(TAG, "playPrevious error", e);
                }
            }
            JSObject res = new JSObject();
            res.put("success", true);
            call.resolve(res);
        });
    }

    @PluginMethod
    public void setRepeatMode(PluginCall call) {
        String mode = call.getString("mode", "off");
        runOnApplicationThread(() -> {
            if (mediaController != null) {
                try {
                    if ("one".equals(mode)) {
                        mediaController.setRepeatMode(Player.REPEAT_MODE_ONE);
                    } else if ("all".equals(mode)) {
                        mediaController.setRepeatMode(Player.REPEAT_MODE_ALL);
                    } else {
                        mediaController.setRepeatMode(Player.REPEAT_MODE_OFF);
                    }
                } catch (Exception e) {
                    Log.w(TAG, "setRepeatMode error", e);
                }
            }
            JSObject res = new JSObject();
            res.put("success", true);
            call.resolve(res);
        });
    }

    @PluginMethod
    public void setShuffleMode(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        runOnApplicationThread(() -> {
            if (mediaController != null) {
                try {
                    mediaController.setShuffleModeEnabled(enabled);
                } catch (Exception e) {
                    Log.w(TAG, "setShuffleMode error", e);
                }
            }
            JSObject res = new JSObject();
            res.put("success", true);
            call.resolve(res);
        });
    }

    @PluginMethod
    public void getPlaybackState(PluginCall call) {
        runOnApplicationThread(() -> {
            JSObject res = new JSObject();
            if (mediaController != null) {
                try {
                    res.put("isPlaying", mediaController.isPlaying());
                    res.put("positionMs", mediaController.getCurrentPosition());
                    res.put("durationMs", mediaController.getDuration());
                    res.put("repeatMode", mediaController.getRepeatMode());
                    res.put("shuffleEnabled", mediaController.getShuffleModeEnabled());
                    MediaItem item = mediaController.getCurrentMediaItem();
                    if (item != null) {
                        JSObject trackObj = new JSObject();
                        trackObj.put("id", item.mediaId);
                        if (item.mediaMetadata.title != null) trackObj.put("title", item.mediaMetadata.title.toString());
                        if (item.mediaMetadata.artist != null) trackObj.put("artist", item.mediaMetadata.artist.toString());
                        if (item.mediaMetadata.artworkUri != null) trackObj.put("thumbnailUrl", item.mediaMetadata.artworkUri.toString());
                        if (item.localConfiguration != null && item.localConfiguration.uri != null) {
                            trackObj.put("streamUrl", item.localConfiguration.uri.toString());
                            trackObj.put("isDirectStream", true);
                        }
                        res.put("currentTrack", trackObj);
                    }
                } catch (Exception e) {
                    Log.w(TAG, "getPlaybackState error", e);
                    res.put("isPlaying", false);
                    res.put("positionMs", 0);
                    res.put("durationMs", 0);
                }
            } else {
                res.put("isPlaying", false);
                res.put("positionMs", 0);
                res.put("durationMs", 0);
            }
            call.resolve(res);
        });
    }

    @Override
    protected void handleOnDestroy() {
        runOnApplicationThread(() -> {
            mainHandler.removeCallbacks(progressRunnable);
            if (isReceiverRegistered && getContext() != null) {
                try {
                    getContext().unregisterReceiver(actionReceiver);
                } catch (Exception ignored) {}
                isReceiverRegistered = false;
            }
            if (mediaController != null) {
                try {
                    mediaController.release();
                } catch (Exception e) {
                    Log.w(TAG, "Error releasing mediaController", e);
                }
                mediaController = null;
            }
        });
        super.handleOnDestroy();
    }
}
