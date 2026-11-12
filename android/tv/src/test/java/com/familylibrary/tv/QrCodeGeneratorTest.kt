package com.familylibrary.tv

import com.familylibrary.tv.auth.QrCodeGenerator
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class QrCodeGeneratorTest {

    @Test
    fun testGenerateQrBitmapProducesValidDimensions() = runBlocking {
        val testUrl = "https://family-library.pages.dev/pair?code=K7M-93R"
        val bitmap = QrCodeGenerator.generateQrBitmap(testUrl, width = 320, height = 320)

        assertNotNull(bitmap)
        assertEquals(320, bitmap.width)
        assertEquals(320, bitmap.height)
    }
}
