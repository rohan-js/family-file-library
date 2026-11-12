package com.familylibrary.phone.util

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap

data class SharedFileItem(
    val uri: Uri,
    val displayName: String,
    val sizeBytes: Long,
    val mimeType: String
)

object ContentUriHelper {

    fun parseIncomingUris(intent: Intent): List<Uri> {
        val uris = mutableListOf<Uri>()
        when (intent.action) {
            Intent.ACTION_SEND -> {
                val streamUri = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
                } else {
                    @Suppress("DEPRECATION")
                    intent.getParcelableExtra(Intent.EXTRA_STREAM)
                }
                if (streamUri != null) {
                    uris.add(streamUri)
                } else if (intent.data != null) {
                    uris.add(intent.data!!)
                }
            }
            Intent.ACTION_SEND_MULTIPLE -> {
                val streamUris = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
                } else {
                    @Suppress("DEPRECATION")
                    intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM)
                }
                if (!streamUris.isNullOrEmpty()) {
                    uris.addAll(streamUris.filterNotNull())
                }
            }
        }
        return uris
    }

    fun extractMetadata(context: Context, uri: Uri): SharedFileItem {
        var displayName: String? = null
        var sizeBytes: Long = -1L

        try {
            context.contentResolver.query(
                uri,
                arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE),
                null,
                null,
                null
            )?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (nameIndex != -1) {
                        displayName = cursor.getString(nameIndex)
                    }
                    val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
                    if (sizeIndex != -1 && !cursor.isNull(sizeIndex)) {
                        sizeBytes = cursor.getLong(sizeIndex)
                    }
                }
            }
        } catch (_: Exception) {
            // Fallback for non-standard content providers
        }

        if (displayName.isNullOrBlank()) {
            displayName = uri.lastPathSegment?.substringAfterLast('/') ?: "file_${System.currentTimeMillis()}"
        }

        var mimeType = try { context.contentResolver.getType(uri) } catch (_: Exception) { null }
        if (mimeType.isNullOrBlank()) {
            val extension = displayName.substringAfterLast('.', "").lowercase()
            mimeType = when (extension) {
                "png" -> "image/png"
                "jpg", "jpeg" -> "image/jpeg"
                "webp" -> "image/webp"
                "gif" -> "image/gif"
                "pdf" -> "application/pdf"
                "txt" -> "text/plain"
                "md" -> "text/markdown"
                "csv" -> "text/csv"
                "docx" -> "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                "xlsx" -> "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                "pptx" -> "application/vnd.openxmlformats-officedocument.presentationml.presentation"
                else -> {
                    val mapType = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension)
                    if (!mapType.isNullOrBlank()) mapType else "application/octet-stream"
                }
            }
        }

        return SharedFileItem(
            uri = uri,
            displayName = displayName,
            sizeBytes = sizeBytes,
            mimeType = mimeType ?: "application/octet-stream"
        )
    }
}
