package com.familylibrary.core.data.local.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Fts4

@Entity(tableName = "files_fts")
@Fts4(contentEntity = FileEntity::class)
data class FileFtsEntity(
    val name: String,
    @ColumnInfo(name = "text_content")
    val textContent: String?
)
