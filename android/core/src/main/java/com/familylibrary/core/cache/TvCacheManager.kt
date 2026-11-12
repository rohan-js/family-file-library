package com.familylibrary.core.cache

import android.content.Context
import android.util.Log
import com.familylibrary.core.data.local.dao.CacheDao
import com.familylibrary.core.data.local.dao.FileDao
import com.familylibrary.core.data.local.entity.CachedFileEntity
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream

class CacheStorageFullException(message: String) : Exception(message)

class TvCacheManager(
    private val context: Context,
    private val cacheDao: CacheDao,
    private val fileDao: FileDao? = null,
    private val maxCacheSizeBytes: Long = 500L * 1024 * 1024 // 500 MB default
) {
    private val mutex = Mutex()
    val cacheDir: File by lazy {
        File(context.filesDir, "library_offline_cache").apply {
            if (!exists()) mkdirs()
        }
    }

    init {
        cleanOrphanedTmpFiles()
    }

    fun cleanOrphanedTmpFiles() {
        try {
            cacheDir.listFiles { file -> file.extension == "tmp" }?.forEach { tmpFile ->
                tmpFile.delete()
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to clean orphaned tmp files: ${e.message}")
        }
    }

    suspend fun getCachedFile(fileId: String): File? = withContext(Dispatchers.IO) {
        mutex.withLock {
            val record = cacheDao.getCachedFile(fileId) ?: return@withContext null
            val file = File(record.localPath)
            if (file.exists() && file.length() == record.fileSizeBytes) {
                cacheDao.touchFile(fileId)
                file
            } else {
                cacheDao.deleteCacheRecord(fileId)
                if (file.exists()) file.delete()
                null
            }
        }
    }

    suspend fun storeFile(
        fileId: String,
        inputStream: InputStream,
        sizeBytes: Long,
        isPinned: Boolean = false,
        onProgress: ((bytesRead: Long, totalBytes: Long) -> Unit)? = null
    ): File = withContext(Dispatchers.IO) {
        mutex.withLock {
            val existing = cacheDao.getCachedFile(fileId)
            if (existing != null) {
                val existingFile = File(existing.localPath)
                if (existingFile.exists() && existingFile.length() == sizeBytes) {
                    cacheDao.touchFile(fileId)
                    if (isPinned && !existing.isPinned) {
                        cacheDao.setPinned(fileId, true)
                    }
                    return@withContext existingFile
                }
            }

            if (sizeBytes > maxCacheSizeBytes) {
                throw IllegalArgumentException("Incoming file ($sizeBytes bytes) exceeds total cache quota ($maxCacheSizeBytes bytes)")
            }

            evictIfNeededInternal(sizeBytes)

            val targetFile = File(cacheDir, "$fileId.bin")
            val tempFile = File(cacheDir, "$fileId.${System.currentTimeMillis()}.tmp")

            try {
                FileOutputStream(tempFile).use { output ->
                    val buffer = ByteArray(8192)
                    var bytesRead: Int
                    var totalRead = 0L
                    while (inputStream.read(buffer).also { bytesRead = it } != -1) {
                        output.write(buffer, 0, bytesRead)
                        totalRead += bytesRead
                        onProgress?.invoke(totalRead, sizeBytes)
                    }
                    output.flush()
                }

                if (sizeBytes > 0 && tempFile.length() != sizeBytes) {
                    tempFile.delete()
                    throw IllegalStateException("Downloaded size mismatch: expected $sizeBytes, got ${tempFile.length()}")
                }

                if (!tempFile.renameTo(targetFile)) {
                    tempFile.copyTo(targetFile, overwrite = true)
                    tempFile.delete()
                }

                val effectivePinned = isPinned || (fileDao?.getFileByIdSync(fileId)?.isFavorite == true)

                cacheDao.recordCachedFile(
                    CachedFileEntity(
                        fileId = fileId,
                        localPath = targetFile.absolutePath,
                        fileSizeBytes = targetFile.length(),
                        lastAccessedAt = System.currentTimeMillis(),
                        isPinned = effectivePinned
                    )
                )

                targetFile
            } catch (e: Exception) {
                if (tempFile.exists()) tempFile.delete()
                throw e
            }
        }
    }

    suspend fun evictIfNeeded(incomingSizeBytes: Long): Boolean = withContext(Dispatchers.IO) {
        mutex.withLock {
            evictIfNeededInternal(incomingSizeBytes)
        }
    }

    private suspend fun evictIfNeededInternal(incomingSizeBytes: Long): Boolean {
        var currentTotal = cacheDao.getTotalCacheSizeBytes() ?: 0L
        if (currentTotal + incomingSizeBytes <= maxCacheSizeBytes) {
            return true
        }

        val candidates = cacheDao.getEvictionCandidates()
        for (candidate in candidates) {
            if (currentTotal + incomingSizeBytes <= maxCacheSizeBytes) {
                break
            }
            if (candidate.isPinned) {
                continue
            }

            val file = File(candidate.localPath)
            val fileSize = candidate.fileSizeBytes
            if (file.exists()) {
                file.delete()
            }
            cacheDao.deleteCacheRecord(candidate.fileId)
            currentTotal -= fileSize
            Log.d(TAG, "Evicted unpinned file ${candidate.fileId}, freed $fileSize bytes")
        }

        if (currentTotal + incomingSizeBytes > maxCacheSizeBytes) {
            throw CacheStorageFullException("Insufficient cache space. Unpinned files evicted, but remaining pinned files take up $currentTotal bytes")
        }
        return true
    }

    suspend fun pinFile(fileId: String, isPinned: Boolean) = withContext(Dispatchers.IO) {
        mutex.withLock {
            cacheDao.setPinned(fileId, isPinned)
        }
    }

    suspend fun clearAllUnpinned() = withContext(Dispatchers.IO) {
        mutex.withLock {
            val candidates = cacheDao.getEvictionCandidates()
            for (candidate in candidates) {
                val file = File(candidate.localPath)
                if (file.exists()) {
                    file.delete()
                }
                cacheDao.deleteCacheRecord(candidate.fileId)
            }
        }
    }

    companion object {
        private const val TAG = "TvCacheManager"
    }
}
