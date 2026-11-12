package com.familylibrary.phone.upload

import android.content.Context
import android.net.Uri
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import kotlinx.coroutines.runBlocking
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class FileSpoolerTest {

    @Test
    fun testSpoolToCacheAndCleanup() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()

        // Create a source test file
        val sourceDir = File(context.cacheDir, "test_source").apply { mkdirs() }
        val sourceFile = File(sourceDir, "test_doc.pdf")
        val content = "Family Library Test Spool Content"
        sourceFile.writeText(content)

        val uri = Uri.fromFile(sourceFile)
        val staged = FileSpooler.spoolToCache(context, uri, "test_doc.pdf")

        assertThat(staged.exists()).isTrue()
        assertThat(staged.readText()).isEqualTo(content)
        assertThat(staged.parentFile?.name).isEqualTo("pending_uploads")

        FileSpooler.cleanupStagedFile(staged.absolutePath)
        assertThat(staged.exists()).isFalse()
    }

    @Test
    fun testSanitizeFileName() {
        val dirty = "my photo: [family] & (trip) *2026?.jpg"
        val clean = FileSpooler.sanitizeFileName(dirty)
        assertThat(clean).doesNotContain(":")
        assertThat(clean).doesNotContain("[")
        assertThat(clean).doesNotContain("]")
        assertThat(clean).doesNotContain("*")
        assertThat(clean).doesNotContain("?")
    }
}
