package com.listenup.app.data.local;

import androidx.annotation.NonNull;
import androidx.room.Entity;
import androidx.room.PrimaryKey;

@Entity(tableName = "playlists")
public class PlaylistEntity {
    @PrimaryKey
    @NonNull
    public String playlistId;
    public String name;
    public String coverUrl;
    public String songsJson; // JSON string of songs array
    public long createdAt;
    public long updatedAt;

    public PlaylistEntity(@NonNull String playlistId, String name, String coverUrl, String songsJson, long createdAt, long updatedAt) {
        this.playlistId = playlistId;
        this.name = name;
        this.coverUrl = coverUrl;
        this.songsJson = songsJson;
        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
    }
}

