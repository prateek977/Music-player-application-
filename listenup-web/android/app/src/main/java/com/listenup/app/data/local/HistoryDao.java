package com.listenup.app.data.local;

import androidx.room.Dao;
import androidx.room.Insert;
import androidx.room.Query;

import java.util.List;

@Dao
public interface HistoryDao {
    @Query("SELECT * FROM listening_history ORDER BY playedAt DESC LIMIT :limit")
    List<ListeningHistoryEntity> getRecentHistory(int limit);

    @Insert
    void insertEvent(ListeningHistoryEntity event);

    @Query("DELETE FROM listening_history WHERE id NOT IN (SELECT id FROM listening_history ORDER BY playedAt DESC LIMIT 500)")
    void trimHistory();
}

