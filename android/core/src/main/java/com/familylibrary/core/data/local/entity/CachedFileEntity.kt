package com.familylibrary.core.data.local.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "cached_files",
    indices = [
        Index("last_accessed_at"),
        Index("is_pinned")
    ]
)
data class CachedFileEntity(
    @PrimaryKey
    @ColumnInfo(name = "file_id")
    val fileId: String,
    @ColumnInfo(name = "local_path")
    val localPath: String,
    @ColumnInfo(name = "file_size_bytes")
    val fileSizeBytes: Long,
    @ColumnInfo(name = "last_accessed_at")
    val lastAccessedAt: Long = System.currentTimeMillis(),
    @ColumnInfo(name = "is_pinned")
    val isPinned: Boolean = false,
    val checksum: String? = null
)
