package com.familylibrary.core.cache

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.familylibrary.core.data.local.FamilyLibraryDatabase
import com.familylibrary.core.data.local.dao.CacheDao
import com.familylibrary.core.data.local.dao.FileDao
import com.familylibrary.core.data.local.entity.FileEntity
import com.google.common.truth.Truth.assertThat
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertThrows
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.ByteArrayInputStream
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class TvCacheManagerTest {

    private lateinit var db: FamilyLibraryDatabase
    private lateinit var cacheDao: CacheDao
    private lateinit var fileDao: FileDao
    private lateinit var cacheManager: TvCacheManager
    private lateinit var context: Context

    private val testQuota = 1000L // 1000 bytes quota for deterministic test boundaries

    @Before
    fun setup() {
        context = ApplicationProvider.getApplicationContext()
        db = Room.inMemoryDatabaseBuilder(context, FamilyLibraryDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        cacheDao = db.cacheDao()
        fileDao = db.fileDao()

        cacheManager = TvCacheManager(
            context = context,
            cacheDao = cacheDao,
            fileDao = fileDao,
            maxCacheSizeBytes = testQuota
        )
    }

    @After
    fun tearDown() {
        db.close()
        cacheManager.cacheDir.deleteRecursively()
    }

    @Test
    fun testStoreAndRetrieveFile() = runBlocking {
        val payload = "Hello Android TV Family Library Cache".toByteArray(Charsets.UTF_8)
        val fileId = "file-test-1"

        val stored = cacheManager.storeFile(
            fileId = fileId,
            inputStream = ByteArrayInputStream(payload),
            sizeBytes = payload.size.toLong(),
            isPinned = false
        )

        assertThat(stored.exists()).isTrue()
        assertThat(stored.length()).isEqualTo(payload.size.toLong())
        assertThat(stored.readBytes()).isEqualTo(payload)

        val retrieved = cacheManager.getCachedFile(fileId)
        assertThat(retrieved).isNotNull()
        assertThat(retrieved?.absolutePath).isEqualTo(stored.absolutePath)
    }

    @Test
    fun testAtomicRenameCleansUpTmpFiles() = runBlocking {
        val payload = ByteArray(200) { 1 }
        val fileId = "file-atomic"

        cacheManager.storeFile(
            fileId = fileId,
            inputStream = ByteArrayInputStream(payload),
            sizeBytes = payload.size.toLong(),
            isPinned = false
        )

        val tmpFiles = cacheManager.cacheDir.listFiles { f -> f.extension == "tmp" }
        assertThat(tmpFiles).isEmpty()

        val binFiles = cacheManager.cacheDir.listFiles { f -> f.extension == "bin" }
        assertThat(binFiles).hasLength(1)
        assertThat(binFiles!!.first().name).isEqualTo("$fileId.bin")
    }

    @Test
    fun testLruEvictionOldestUnpinnedFirst() = runBlocking {
        // Quota is 1000 bytes.
        // We write File 1 (400 bytes) at t0.
        // We write File 2 (400 bytes) at t1.
        // Total = 800 bytes (fits in 1000).
        val file1Data = ByteArray(400) { 1 }
        val file2Data = ByteArray(400) { 2 }

        cacheManager.storeFile("f1", ByteArrayInputStream(file1Data), 400L)
        // Ensure timestamp difference
        cacheDao.touchFile("f1", 1000L)

        cacheManager.storeFile("f2", ByteArrayInputStream(file2Data), 400L)
        cacheDao.touchFile("f2", 2000L)

        assertThat(cacheDao.getTotalCacheSizeBytes()).isEqualTo(800L)

        // Now write File 3 (400 bytes).
        // 800 + 400 = 1200 > 1000.
        // Eviction must run. Oldest unpinned is f1 (timestamp 1000 vs 2000).
        // f1 should be evicted, freeing 400 bytes. New total = 400 (f2) + 400 (f3) = 800 <= 1000.
        val file3Data = ByteArray(400) { 3 }
        cacheManager.storeFile("f3", ByteArrayInputStream(file3Data), 400L)

        assertThat(cacheManager.getCachedFile("f1")).isNull()
        assertThat(cacheManager.getCachedFile("f2")).isNotNull()
        assertThat(cacheManager.getCachedFile("f3")).isNotNull()
        assertThat(cacheDao.getTotalCacheSizeBytes()).isEqualTo(800L)
    }

    @Test
    fun testPinnedFileImmunityFromEviction() = runBlocking {
        // Quota is 1000 bytes.
        // File 1 is pinned (favorite / bookmark), 400 bytes, accessed at t=1000.
        // File 2 is unpinned, 400 bytes, accessed at t=2000.
        // Total = 800 bytes.
        val f1Data = ByteArray(400) { 1 }
        val f2Data = ByteArray(400) { 2 }

        cacheManager.storeFile("f1", ByteArrayInputStream(f1Data), 400L, isPinned = true)
        cacheDao.touchFile("f1", 1000L)

        cacheManager.storeFile("f2", ByteArrayInputStream(f2Data), 400L, isPinned = false)
        cacheDao.touchFile("f2", 2000L)

        // Now store File 3 (400 bytes).
        // Even though f1 has older access time (1000 < 2000), f1 is PINNED.
        // Eviction candidate must be f2!
        val f3Data = ByteArray(400) { 3 }
        cacheManager.storeFile("f3", ByteArrayInputStream(f3Data), 400L, isPinned = false)

        assertThat(cacheManager.getCachedFile("f1")).isNotNull() // Immune!
        assertThat(cacheManager.getCachedFile("f2")).isNull()    // Evicted!
        assertThat(cacheManager.getCachedFile("f3")).isNotNull() // Stored!
    }

    @Test
    fun testOversizedFileThrowsException() {
        // Quota is 1000 bytes. Attempting to store 1001 bytes must throw IllegalArgumentException.
        val largeData = ByteArray(1001) { 9 }
        assertThrows(IllegalArgumentException::class.java) {
            runBlocking {
                cacheManager.storeFile("oversized", ByteArrayInputStream(largeData), 1001L)
            }
        }
    }

    @Test
    fun testPhysicalFileMissingPurgesDbRecord() = runBlocking {
        val payload = ByteArray(100) { 7 }
        val stored = cacheManager.storeFile("missing-file", ByteArrayInputStream(payload), 100L)
        assertThat(cacheDao.getCachedFile("missing-file")).isNotNull()

        // Simulate physical file deletion outside app control (e.g. storage cleaner)
        stored.delete()

        // Accessing via getCachedFile must detect discrepancy and purge DB entry
        val result = cacheManager.getCachedFile("missing-file")
        assertThat(result).isNull()
        assertThat(cacheDao.getCachedFile("missing-file")).isNull()
    }
}
