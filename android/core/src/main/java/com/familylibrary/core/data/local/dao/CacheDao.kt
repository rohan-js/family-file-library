package com.familylibrary.core.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.familylibrary.core.data.local.entity.CachedFileEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface CacheDao {
    @Query("SELECT * FROM cached_files WHERE file_id = :fileId")
    suspend fun getCachedFile(fileId: String): CachedFileEntity?

    @Query("SELECT * FROM cached_files WHERE file_id = :fileId")
    fun observeCachedFile(fileId: String): Flow<CachedFileEntity?>

    @Query("SELECT * FROM cached_files ORDER BY last_accessed_at DESC")
    suspend fun getAllCachedFiles(): List<CachedFileEntity>

    @Query("SELECT * FROM cached_files ORDER BY last_accessed_at DESC")
    fun observeAllCachedFiles(): Flow<List<CachedFileEntity>>

    @Query("SELECT SUM(file_size_bytes) FROM cached_files")
    suspend fun getTotalCacheSizeBytes(): Long?

    // Deterministic LRU query: selects unpinned files ordered by oldest access time first
    @Query("SELECT * FROM cached_files WHERE is_pinned = 0 ORDER BY last_accessed_at ASC")
    suspend fun getEvictionCandidates(): List<CachedFileEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun recordCachedFile(entry: CachedFileEntity)

    @Query("UPDATE cached_files SET last_accessed_at = :timestamp WHERE file_id = :fileId")
    suspend fun touchFile(fileId: String, timestamp: Long = System.currentTimeMillis())

    @Query("UPDATE cached_files SET is_pinned = :isPinned WHERE file_id = :fileId")
    suspend fun setPinned(fileId: String, isPinned: Boolean)

    @Query("DELETE FROM cached_files WHERE file_id = :fileId")
    suspend fun deleteCacheRecord(fileId: String)

    @Query("DELETE FROM cached_files WHERE is_pinned = 0")
    suspend fun clearAllUnpinned()
}
