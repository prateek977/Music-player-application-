package com.listenup.app.data.local;

import androidx.room.Dao;
import androidx.room.Insert;
import androidx.room.OnConflictStrategy;
import androidx.room.Query;

import java.util.List;

@Dao
public interface PlaylistsDao {
    @Query("SELECT * FROM playlists ORDER BY updatedAt DESC")
    List<PlaylistEntity> getAllPlaylists();

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    void insertPlaylist(PlaylistEntity playlist);

    @Query("DELETE FROM playlists WHERE playlistId = :playlistId")
    void deletePlaylist(String playlistId);

    @Query("SELECT * FROM playlists WHERE playlistId = :playlistId LIMIT 1")
    PlaylistEntity getPlaylist(String playlistId);
}

