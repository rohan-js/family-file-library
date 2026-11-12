package com.familylibrary.tv.viewer

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import android.util.Log
import android.util.LruCache
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File

/**
 * SafeTvPdfRenderer wraps Android's native PdfRenderer to ensure:
 * 1. Single-page concurrency synchronization (prevents native IllegalStateException on Android 9 OEM firmware).
 * 2. 3-Page sliding window LRU Bitmap cache (Prev, Current, Next) with RGB_565 format (caps RAM to ~12.5MB at 1080p).
 * 3. Immediate native bitmap recycling upon eviction.
 */
class SafeTvPdfRenderer(
    private val pdfFile: File
) {
    private val mutex = Mutex()
    private var fileDescriptor: ParcelFileDescriptor? = null
    private var renderer: PdfRenderer? = null

    // 3-page LRU cache (Previous, Current, Next)
    private val pageBitmapCache = object : LruCache<Int, Bitmap>(3) {
        override fun entryRemoved(evicted: Boolean, key: Int, oldValue: Bitmap, newValue: Bitmap?) {
            if (evicted && oldValue != newValue && !oldValue.isRecycled) {
                oldValue.recycle()
            }
        }
    }

    init {
        try {
            fileDescriptor = ParcelFileDescriptor.open(pdfFile, ParcelFileDescriptor.MODE_READ_ONLY)
            renderer = PdfRenderer(fileDescriptor!!)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to initialize PdfRenderer: ${e.message}", e)
        }
    }

    val pageCount: Int
        get() = renderer?.pageCount ?: 0

    suspend fun renderPage(
        pageIndex: Int,
        targetWidth: Int = 1920,
        targetHeight: Int = 1080
    ): Bitmap? = withContext(Dispatchers.IO) {
        if (renderer == null || pageIndex < 0 || pageIndex >= pageCount) {
            return@withContext null
        }

        // Return from 3-page LRU cache if already rasterized
        pageBitmapCache.get(pageIndex)?.let { cachedBitmap ->
            if (!cachedBitmap.isRecycled) return@withContext cachedBitmap
        }

        mutex.withLock {
            // Double-check cache inside lock
            pageBitmapCache.get(pageIndex)?.let { cached ->
                if (!cached.isRecycled) return@withContext cached
            }

            try {
                val page = renderer!!.openPage(pageIndex)
                try {
                    // Calculate scale matrix to fit target 1080p dimensions preserving aspect ratio
                    val scaleX = targetWidth.toFloat() / page.width
                    val scaleY = targetHeight.toFloat() / page.height
                    val scale = minOf(scaleX, scaleY).coerceAtMost(2.0f) // Max 2x zoom

                    val renderWidth = (page.width * scale).toInt().coerceAtLeast(1)
                    val renderHeight = (page.height * scale).toInt().coerceAtLeast(1)

                    // Use RGB_565 format to cut memory consumption by 50% compared to ARGB_8888
                    val bitmap = Bitmap.createBitmap(renderWidth, renderHeight, Bitmap.Config.RGB_565)
                    bitmap.eraseColor(Color.WHITE)

                    val matrix = Matrix().apply {
                        postScale(scale, scale)
                    }

                    page.render(bitmap, null, matrix, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                    pageBitmapCache.put(pageIndex, bitmap)
                    bitmap
                } finally {
                    page.close() // Mandatory: close page before any other can open
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error rendering PDF page $pageIndex: ${e.message}", e)
                null
            }
        }
    }

    fun close() {
        try {
            pageBitmapCache.evictAll()
            renderer?.close()
            fileDescriptor?.close()
        } catch (e: Exception) {
            Log.w(TAG, "Error closing PdfRenderer resources: ${e.message}")
        }
    }

    companion object {
        private const val TAG = "SafeTvPdfRenderer"
    }
}
