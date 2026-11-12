package com.familylibrary.core.data.local.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "bookmarks",
    foreignKeys = [
        ForeignKey(
            entity = FileEntity::class,
            parentColumns = ["id"],
            childColumns = ["file_id"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [
        Index("space_id"),
        Index("file_id"),
        Index("device_id"),
        Index("user_id"),
        Index("is_last_read")
    ]
)
data class BookmarkEntity(
    @PrimaryKey
    val id: String,
    @ColumnInfo(name = "space_id")
    val spaceId: String,
    @ColumnInfo(name = "file_id")
    val fileId: String,
    @ColumnInfo(name = "user_id")
    val userId: String? = null,
    @ColumnInfo(name = "device_id")
    val deviceId: String? = null,
    @ColumnInfo(name = "page_number")
    val pageNumber: Int = 1,
    @ColumnInfo(name = "scroll_position")
    val scrollPosition: Float = 0.0f,
    val label: String? = null,
    @ColumnInfo(name = "is_last_read")
    val isLastRead: Boolean = false,
    @ColumnInfo(name = "created_at")
    val createdAt: Long = System.currentTimeMillis(),
    @ColumnInfo(name = "updated_at")
    val updatedAt: Long = System.currentTimeMillis()
)
