package com.familylibrary.phone.util

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class ContentUriHelperTest {

    @Test
    fun testParseIncomingUrisSingleSend() {
        val testUri = Uri.parse("content://media/external/images/media/42")
        val intent = Intent(Intent.ACTION_SEND).apply {
            putExtra(Intent.EXTRA_STREAM, testUri)
            type = "image/png"
        }

        val result = ContentUriHelper.parseIncomingUris(intent)
        assertThat(result).hasSize(1)
        assertThat(result.first()).isEqualTo(testUri)
    }

    @Test
    fun testParseIncomingUrisMultipleSend() {
        val uri1 = Uri.parse("content://media/external/images/media/101")
        val uri2 = Uri.parse("content://media/external/images/media/102")
        val intent = Intent(Intent.ACTION_SEND_MULTIPLE).apply {
            putParcelableArrayListExtra(Intent.EXTRA_STREAM, arrayListOf(uri1, uri2))
            type = "image/*"
        }

        val result = ContentUriHelper.parseIncomingUris(intent)
        assertThat(result).hasSize(2)
        assertThat(result).containsExactly(uri1, uri2).inOrder()
    }

    @Test
    fun testExtractMetadataFallback() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val fileUri = Uri.parse("file:///data/local/tmp/family_pic.png")

        val metadata = ContentUriHelper.extractMetadata(context, fileUri)
        assertThat(metadata.displayName).contains("family_pic.png")
        assertThat(metadata.mimeType).isEqualTo("image/png")
    }
}
