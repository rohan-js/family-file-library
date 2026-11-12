package com.familylibrary.core.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import com.familylibrary.core.data.local.entity.BookmarkEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface BookmarkDao {
    @Query("SELECT * FROM bookmarks WHERE file_id = :fileId ORDER BY page_number ASC")
    fun getBookmarksForFile(fileId: String): Flow<List<BookmarkEntity>>

    @Query("SELECT * FROM bookmarks WHERE file_id = :fileId AND (:deviceId IS NULL OR device_id = :deviceId) AND is_last_read = 1 LIMIT 1")
    fun getLastReadBookmark(fileId: String, deviceId: String?): Flow<BookmarkEntity?>

    @Query("SELECT * FROM bookmarks WHERE file_id = :fileId AND (:deviceId IS NULL OR device_id = :deviceId) AND is_last_read = 1 LIMIT 1")
    suspend fun getLastReadBookmarkSync(fileId: String, deviceId: String?): BookmarkEntity?

    @Query("""
        SELECT b.* FROM bookmarks b
        JOIN files f ON b.file_id = f.id
        WHERE b.space_id = :spaceId AND b.is_last_read = 1 AND f.deleted_at IS NULL
        ORDER BY b.updated_at DESC
        LIMIT :limit
    """)
    fun getContinueReadingBookmarks(spaceId: String, limit: Int = 10): Flow<List<BookmarkEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertBookmark(bookmark: BookmarkEntity)

    @Query("UPDATE bookmarks SET is_last_read = 0 WHERE file_id = :fileId AND (:deviceId IS NULL OR device_id = :deviceId)")
    suspend fun clearLastReadForFile(fileId: String, deviceId: String?)

    @Transaction
    suspend fun setLastReadBookmark(bookmark: BookmarkEntity) {
        clearLastReadForFile(bookmark.fileId, bookmark.deviceId)
        upsertBookmark(bookmark.copy(isLastRead = true, updatedAt = System.currentTimeMillis()))
    }

    @Query("DELETE FROM bookmarks WHERE id = :id")
    suspend fun deleteBookmark(id: String)

    @Query("DELETE FROM bookmarks WHERE file_id = :fileId")
    suspend fun deleteBookmarksForFile(fileId: String)
}
