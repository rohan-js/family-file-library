package com.familylibrary.phone.upload

import android.content.Context
import android.net.Uri
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.util.UUID

object FileSpooler {

    private const val STAGING_DIR = "pending_uploads"

    /**
     * Spools a content URI stream into app internal cache to prevent
     * SecurityException permission revocations when the Activity terminates.
     */
    suspend fun spoolToCache(
        context: Context,
        uri: Uri,
        fileName: String
    ): File = withContext(Dispatchers.IO) {
        val stagingDir = File(context.cacheDir, STAGING_DIR).apply {
            if (!exists()) mkdirs()
        }

        val safePrefix = UUID.randomUUID().toString()
        val targetFile = File(stagingDir, "${safePrefix}_${sanitizeFileName(fileName)}")

        val inputStream = context.contentResolver.openInputStream(uri)
            ?: throw IOException("Cannot open input stream for URI: $uri")

        inputStream.use { input ->
            FileOutputStream(targetFile).use { output ->
                input.copyTo(output)
            }
        }

        targetFile
    }

    fun sanitizeFileName(name: String): String {
        return name.replace(Regex("[^a-zA-Z0-9._-]"), "_")
    }

    fun cleanupStagedFile(path: String) {
        try {
            val file = File(path)
            if (file.exists()) {
                file.delete()
            }
        } catch (_: Exception) {
        }
    }
}
