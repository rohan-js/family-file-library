package com.familylibrary.core.data.local

import androidx.room.Database
import androidx.room.RoomDatabase
import com.familylibrary.core.data.local.dao.BookmarkDao
import com.familylibrary.core.data.local.dao.CacheDao
import com.familylibrary.core.data.local.dao.FileDao
import com.familylibrary.core.data.local.dao.FolderDao
import com.familylibrary.core.data.local.entity.BookmarkEntity
import com.familylibrary.core.data.local.entity.CachedFileEntity
import com.familylibrary.core.data.local.entity.FileEntity
import com.familylibrary.core.data.local.entity.FileFtsEntity
import com.familylibrary.core.data.local.entity.FolderEntity

@Database(
    entities = [
        FileEntity::class,
        FileFtsEntity::class,
        FolderEntity::class,
        CachedFileEntity::class,
        BookmarkEntity::class
    ],
    version = 1,
    exportSchema = false
)
abstract class FamilyLibraryDatabase : RoomDatabase() {
    abstract fun fileDao(): FileDao
    abstract fun folderDao(): FolderDao
    abstract fun bookmarkDao(): BookmarkDao
    abstract fun cacheDao(): CacheDao

    companion object {
        const val DATABASE_NAME = "family_library.db"
    }
}

typealias AppDatabase = FamilyLibraryDatabase
