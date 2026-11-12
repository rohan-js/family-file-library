package com.familylibrary.core.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.familylibrary.core.data.local.entity.FolderEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface FolderDao {
    @Query("SELECT * FROM folders WHERE space_id = :spaceId AND parent_id IS NULL AND deleted_at IS NULL ORDER BY name ASC")
    fun getRootFolders(spaceId: String): Flow<List<FolderEntity>>

    @Query("SELECT * FROM folders WHERE space_id = :spaceId AND parent_id = :parentId AND deleted_at IS NULL ORDER BY name ASC")
    fun getSubFolders(spaceId: String, parentId: String): Flow<List<FolderEntity>>

    @Query("SELECT * FROM folders WHERE space_id = :spaceId AND deleted_at IS NULL ORDER BY name ASC")
    fun getAllActiveFolders(spaceId: String): Flow<List<FolderEntity>>

    @Query("SELECT * FROM folders WHERE id = :folderId")
    fun getFolderById(folderId: String): Flow<FolderEntity?>

    @Query("SELECT * FROM folders WHERE id = :folderId")
    suspend fun getFolderByIdSync(folderId: String): FolderEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertFolder(folder: FolderEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertFolders(folders: List<FolderEntity>)

    @Query("UPDATE folders SET deleted_at = :timestamp WHERE id = :folderId")
    suspend fun softDeleteFolder(folderId: String, timestamp: Long = System.currentTimeMillis())

    @Query("DELETE FROM folders WHERE id = :folderId")
    suspend fun deleteFolderPermanently(folderId: String)
}
