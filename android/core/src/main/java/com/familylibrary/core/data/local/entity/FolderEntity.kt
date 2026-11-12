package com.familylibrary.core.data.local.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "folders",
    foreignKeys = [
        ForeignKey(
            entity = FolderEntity::class,
            parentColumns = ["id"],
            childColumns = ["parent_id"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [
        Index("space_id"),
        Index("parent_id"),
        Index("deleted_at")
    ]
)
data class FolderEntity(
    @PrimaryKey
    val id: String,
    @ColumnInfo(name = "space_id")
    val spaceId: String,
    @ColumnInfo(name = "parent_id")
    val parentId: String? = null,
    val name: String,
    val color: String? = null,
    val icon: String? = null,
    @ColumnInfo(name = "created_by")
    val createdBy: String? = null,
    @ColumnInfo(name = "deleted_at")
    val deletedAt: Long? = null, // Epoch millis (null = active, non-null = trash)
    @ColumnInfo(name = "created_at")
    val createdAt: Long = System.currentTimeMillis(),
    @ColumnInfo(name = "updated_at")
    val updatedAt: Long = System.currentTimeMillis()
)
