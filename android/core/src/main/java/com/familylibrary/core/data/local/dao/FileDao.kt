package com.familylibrary.core.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.familylibrary.core.data.local.entity.FileEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface FileDao {

    @Query("""
        SELECT files.* FROM files
        JOIN files_fts ON files.rowid = files_fts.docid
        WHERE files_fts MATCH :sanitizedQuery
          AND files.deleted_at IS NULL
        ORDER BY files.last_opened_at DESC, files.created_at DESC
    """)
    fun searchFilesFts(sanitizedQuery: String): Flow<List<FileEntity>>

    @Query("SELECT * FROM files WHERE space_id = :spaceId AND deleted_at IS NULL ORDER BY created_at DESC")
    fun getAllActiveFiles(spaceId: String): Flow<List<FileEntity>>

    @Query("SELECT * FROM files WHERE space_id = :spaceId AND folder_id = :folderId AND deleted_at IS NULL ORDER BY name ASC")
    fun getFilesByFolder(spaceId: String, folderId: String): Flow<List<FileEntity>>

    @Query("SELECT * FROM files WHERE space_id = :spaceId AND folder_id IS NULL AND deleted_at IS NULL ORDER BY created_at DESC")
    fun getRootFiles(spaceId: String): Flow<List<FileEntity>>

    @Query("SELECT * FROM files WHERE space_id = :spaceId AND is_favorite = 1 AND deleted_at IS NULL ORDER BY name ASC")
    fun getFavoriteFiles(spaceId: String): Flow<List<FileEntity>>

    @Query("SELECT * FROM files WHERE space_id = :spaceId AND last_opened_at IS NOT NULL AND deleted_at IS NULL ORDER BY last_opened_at DESC LIMIT :limit")
    fun getContinueReadingFiles(spaceId: String, limit: Int = 10): Flow<List<FileEntity>>

    @Query("SELECT * FROM files WHERE id = :fileId")
    fun getFileById(fileId: String): Flow<FileEntity?>

    @Query("SELECT * FROM files WHERE id = :fileId")
    suspend fun getFileByIdSync(fileId: String): FileEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertFile(file: FileEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertFiles(files: List<FileEntity>)

    @Query("UPDATE files SET last_opened_at = :timestamp, last_opened_page = :page WHERE id = :fileId")
    suspend fun updateReadingProgress(fileId: String, page: Int, timestamp: Long = System.currentTimeMillis())

    @Query("UPDATE files SET is_favorite = :isFavorite WHERE id = :fileId")
    suspend fun toggleFavorite(fileId: String, isFavorite: Boolean)

    @Query("UPDATE files SET deleted_at = :timestamp WHERE id = :fileId")
    suspend fun softDeleteFile(fileId: String, timestamp: Long = System.currentTimeMillis())

    @Query("DELETE FROM files WHERE id = :fileId")
    suspend fun deleteFilePermanently(fileId: String)

    @Query("SELECT * FROM files WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC")
    fun getTrashFiles(): Flow<List<FileEntity>>

    @Query("DELETE FROM files WHERE deleted_at IS NOT NULL AND deleted_at < :cutoffTimestamp")
    suspend fun purgeExpiredTrash(cutoffTimestamp: Long): Int
}
