package com.listenup.app.data.local;

import androidx.room.Entity;
import androidx.room.PrimaryKey;

@Entity(tableName = "listening_history")
public class ListeningHistoryEntity {
    @PrimaryKey(autoGenerate = true)
    public long id;
    public String songId;
    public String title;
    public String artist;
    public long playedAt;
    public float completedPercent;
    public boolean wasSkipped;

    public ListeningHistoryEntity(String songId, String title, String artist, long playedAt, float completedPercent, boolean wasSkipped) {
        this.songId = songId;
        this.title = title;
        this.artist = artist;
        this.playedAt = playedAt;
        this.completedPercent = completedPercent;
        this.wasSkipped = wasSkipped;
    }
}

