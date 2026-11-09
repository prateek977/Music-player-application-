package com.listenup.app.data.local;

import androidx.room.Dao;
import androidx.room.Insert;
import androidx.room.OnConflictStrategy;
import androidx.room.Query;

import java.util.List;

@Dao
public interface FavoritesDao {
    @Query("SELECT * FROM favorites ORDER BY addedAt DESC")
    List<FavoriteSongEntity> getAllFavorites();

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    void insertFavorite(FavoriteSongEntity song);

    @Query("DELETE FROM favorites WHERE songId = :songId")
    void deleteFavorite(String songId);

    @Query("SELECT EXISTS(SELECT 1 FROM favorites WHERE songId = :songId)")
    boolean isFavorite(String songId);
}

