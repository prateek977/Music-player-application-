package com.listenup.app.data.local;

import androidx.annotation.NonNull;
import androidx.room.Entity;
import androidx.room.PrimaryKey;

@Entity(tableName = "favorites")
public class FavoriteSongEntity {
    @PrimaryKey
    @NonNull
    public String songId;
    public String title;
    public String artist;
    public String thumbnailUrl;
    public int duration;
    public String streamUrl;
    public long addedAt;

    public FavoriteSongEntity(@NonNull String songId, String title, String artist, String thumbnailUrl, int duration, String streamUrl, long addedAt) {
        this.songId = songId;
        this.title = title;
        this.artist = artist;
        this.thumbnailUrl = thumbnailUrl;
        this.duration = duration;
        this.streamUrl = streamUrl;
        this.addedAt = addedAt;
    }
}

