package com.listenup.app.playback;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.annotation.OptIn;
import androidx.core.app.NotificationCompat;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.session.CommandButton;
import androidx.media3.session.DefaultMediaNotificationProvider;
import androidx.media3.session.MediaNotification;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;
import androidx.media3.session.SessionCommand;
import androidx.media3.session.SessionResult;

import com.google.common.collect.ImmutableList;
import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;
import com.listenup.app.MainActivity;

import java.util.List;

/**
 * ListenUpMediaService
 * Production-grade background audio playback service powered by AndroidX Media3 & ExoPlayer.
 * Conforms to modern Android foreground service requirements (Android 14+ mediaPlayback).
 * Supports Lockscreen controls, MediaNotification, Bluetooth media buttons, and Audio Focus.
 */
public class ListenUpMediaService extends MediaSessionService {
    private static final String TAG = "ListenUpMediaService";
    public static final String CHANNEL_ID = "listenup_media_playback";
    private static final int NOTIFICATION_ID = 1001;

    private ExoPlayer player;
    private MediaSession mediaSession;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();

        // 1. Configure audio attributes for music playback with automatic audio focus
        AudioAttributes audioAttributes = new AudioAttributes.Builder()
                .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                .setUsage(C.USAGE_MEDIA)
                .build();

        // 2. Build ExoPlayer instance
        player = new ExoPlayer.Builder(this)
                .setAudioAttributes(audioAttributes, true /* handleAudioFocus = true */)
                .setHandleAudioBecomingNoisy(true)
                .setWakeMode(C.WAKE_MODE_NETWORK)
                .build();

        // 3. Activity launch PendingIntent when user taps notification
        Intent sessionIntent = new Intent(this, MainActivity.class);
        sessionIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent sessionActivityPendingIntent = PendingIntent.getActivity(
                this,
                0,
                sessionIntent,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );

        // 4. Create MediaSession
        mediaSession = new MediaSession.Builder(this, player)
                .setSessionActivity(sessionActivityPendingIntent)
                .setCallback(new CustomMediaSessionCallback())
                .build();

        // 5. Configure modern Media3 notification provider
        DefaultMediaNotificationProvider notificationProvider = new DefaultMediaNotificationProvider.Builder(this)
                .setChannelId(CHANNEL_ID)
                .setNotificationId(NOTIFICATION_ID)
                .build();
        setMediaNotificationProvider(notificationProvider);

        Log.i(TAG, "ListenUpMediaService created with ExoPlayer & MediaSession");
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "ListenUp Music Playback",
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Controls for active background music playback");
            channel.setShowBadge(false);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);

            NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    public static final String ACTION_NEXT_TRACK = "com.listenup.app.ACTION_NEXT_TRACK";
    public static final String ACTION_PREV_TRACK = "com.listenup.app.ACTION_PREV_TRACK";

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        super.onStartCommand(intent, flags, startId);
        return START_STICKY;
    }

    @Override
    public void onTaskRemoved(@Nullable Intent rootIntent) {
        if (player == null || !player.getPlayWhenReady() || player.getPlaybackState() == Player.STATE_IDLE || player.getPlaybackState() == Player.STATE_ENDED) {
            stopSelf();
        }
        super.onTaskRemoved(rootIntent);
    }

    @Nullable
    @Override
    public MediaSession onGetSession(@NonNull MediaSession.ControllerInfo controllerInfo) {
        return mediaSession;
    }

    @Override
    public void onDestroy() {
        Log.i(TAG, "Destroying ListenUpMediaService");

        if (player != null) {
            player.stop();
            player.release();
            player = null;
        }

        if (mediaSession != null) {
            mediaSession.release();
            mediaSession = null;
        }

        super.onDestroy();
    }

    /**
     * Custom session callback handling command permissions and transport commands
     */
    private class CustomMediaSessionCallback implements MediaSession.Callback {
        @NonNull
        @Override
        public MediaSession.ConnectionResult onConnect(
                @NonNull MediaSession session,
                @NonNull MediaSession.ControllerInfo controller) {
            // Allow all player commands for connected controller including transport controls
            Player.Commands availableCommands = session.getPlayer().getAvailableCommands().buildUpon()
                    .add(Player.COMMAND_PLAY_PAUSE)
                    .add(Player.COMMAND_PREPARE)
                    .add(Player.COMMAND_STOP)
                    .add(Player.COMMAND_SET_MEDIA_ITEM)
                    .add(Player.COMMAND_CHANGE_MEDIA_ITEMS)
                    .add(Player.COMMAND_SET_PLAYLIST_METADATA)
                    .add(Player.COMMAND_SEEK_TO_NEXT)
                    .add(Player.COMMAND_SEEK_TO_PREVIOUS)
                    .add(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
                    .add(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
                    .add(Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM)
                    .build();

            MediaSession.ConnectionResult.AcceptedResultBuilder builder =
                    new MediaSession.ConnectionResult.AcceptedResultBuilder(session);
            builder.setAvailablePlayerCommands(availableCommands);
            return builder.build();
        }

        @NonNull
        @Override
        public ListenableFuture<List<MediaItem>> onAddMediaItems(
                @NonNull MediaSession session,
                @NonNull MediaSession.ControllerInfo controller,
                @NonNull List<MediaItem> mediaItems) {
            return Futures.immediateFuture(mediaItems);
        }

        @NonNull
        @Override
        public ListenableFuture<MediaSession.MediaItemsWithStartPosition> onSetMediaItems(
                @NonNull MediaSession session,
                @NonNull MediaSession.ControllerInfo controller,
                @NonNull List<MediaItem> mediaItems,
                int startIndex,
                long startPositionMs) {
            return Futures.immediateFuture(new MediaSession.MediaItemsWithStartPosition(mediaItems, startIndex, startPositionMs));
        }

        @Override
        public int onPlayerCommandRequest(
                @NonNull MediaSession session,
                @NonNull MediaSession.ControllerInfo controller,
                int playerCommand) {
            if (playerCommand == Player.COMMAND_SEEK_TO_NEXT || playerCommand == Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM) {
                Intent intent = new Intent(ACTION_NEXT_TRACK);
                intent.setPackage(getPackageName());
                sendBroadcast(intent);
            } else if (playerCommand == Player.COMMAND_SEEK_TO_PREVIOUS || playerCommand == Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM) {
                Intent intent = new Intent(ACTION_PREV_TRACK);
                intent.setPackage(getPackageName());
                sendBroadcast(intent);
            }
            return MediaSession.Callback.super.onPlayerCommandRequest(session, controller, playerCommand);
        }
    }
}
