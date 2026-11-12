package com.familylibrary.core.data.local.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "files",
    foreignKeys = [
        ForeignKey(
            entity = FolderEntity::class,
            parentColumns = ["id"],
            childColumns = ["folder_id"],
            onDelete = ForeignKey.SET_NULL
        )
    ],
    indices = [
        Index("space_id"),
        Index("folder_id"),
        Index("file_category"),
        Index("is_favorite"),
        Index("last_opened_at"),
        Index("deleted_at"),
        Index("created_at")
    ]
)
data class FileEntity(
    @PrimaryKey
    val id: String,
    @ColumnInfo(name = "space_id")
    val spaceId: String,
    @ColumnInfo(name = "folder_id")
    val folderId: String? = null,
    val name: String,
    @ColumnInfo(name = "file_type")
    val fileType: String, // MIME type: 'application/pdf', 'image/jpeg', etc.
    @ColumnInfo(name = "file_category")
    val fileCategory: String = "other", // 'pdf', 'image', 'office', 'text', 'other'
    @ColumnInfo(name = "size_bytes")
    val sizeBytes: Long,
    @ColumnInfo(name = "storage_path")
    val storagePath: String, // '<space_id>/original/<file_id>/<filename>'
    @ColumnInfo(name = "pdf_path")
    val pdfPath: String? = null, // '<space_id>/converted/<file_id>.pdf'
    @ColumnInfo(name = "text_content")
    val textContent: String? = null, // Extracted UTF-8 text for search & TTS
    @ColumnInfo(name = "conversion_status")
    val conversionStatus: String = "ready", // 'pending', 'processing', 'ready', 'failed', 'not_applicable'
    @ColumnInfo(name = "conversion_error")
    val conversionError: String? = null,
    @ColumnInfo(name = "uploader_id")
    val uploaderId: String? = null,
    @ColumnInfo(name = "uploader_name")
    val uploaderName: String = "Family Member",
    @ColumnInfo(name = "view_count")
    val viewCount: Int = 0,
    @ColumnInfo(name = "last_viewed_at")
    val lastViewedAt: Long? = null,
    @ColumnInfo(name = "is_favorite")
    val isFavorite: Boolean = false,
    @ColumnInfo(name = "last_opened_at")
    val lastOpenedAt: Long? = null,
    @ColumnInfo(name = "last_opened_page")
    val lastOpenedPage: Int = 0,
    @ColumnInfo(name = "deleted_at")
    val deletedAt: Long? = null,
    @ColumnInfo(name = "deleted_by")
    val deletedBy: String? = null,
    @ColumnInfo(name = "created_at")
    val createdAt: Long = System.currentTimeMillis(),
    @ColumnInfo(name = "updated_at")
    val updatedAt: Long = System.currentTimeMillis()
)
