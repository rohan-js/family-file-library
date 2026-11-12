package com.familylibrary.phone.util

import com.google.common.truth.Truth.assertThat
import org.junit.Test

class FileCategoryMapperTest {

    @Test
    fun testResolveCategory() {
        // PDF
        assertThat(FileCategoryMapper.resolveCategory("application/pdf", "document.pdf")).isEqualTo("pdf")

        // Image
        assertThat(FileCategoryMapper.resolveCategory("image/jpeg", "family.jpg")).isEqualTo("image")
        assertThat(FileCategoryMapper.resolveCategory("image/png", "screenshot.png")).isEqualTo("image")
        assertThat(FileCategoryMapper.resolveCategory("image/webp", "photo.webp")).isEqualTo("image")

        // Office
        assertThat(FileCategoryMapper.resolveCategory("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "report.docx")).isEqualTo("office")
        assertThat(FileCategoryMapper.resolveCategory("application/msword", "legacy.doc")).isEqualTo("office")
        assertThat(FileCategoryMapper.resolveCategory("application/vnd.ms-excel", "sheet.xls")).isEqualTo("office")
        assertThat(FileCategoryMapper.resolveCategory("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "budget.xlsx")).isEqualTo("office")
        assertThat(FileCategoryMapper.resolveCategory("application/vnd.openxmlformats-officedocument.presentationml.presentation", "slides.pptx")).isEqualTo("office")

        // Text
        assertThat(FileCategoryMapper.resolveCategory("text/plain", "readme.txt")).isEqualTo("text")
        assertThat(FileCategoryMapper.resolveCategory("text/markdown", "notes.md")).isEqualTo("text")
        assertThat(FileCategoryMapper.resolveCategory("text/csv", "data.csv")).isEqualTo("text")

        // Other
        assertThat(FileCategoryMapper.resolveCategory("application/zip", "archive.zip")).isEqualTo("other")
        assertThat(FileCategoryMapper.resolveCategory("audio/mp3", "audio.mp3")).isEqualTo("other")
    }

    @Test
    fun testResolveConversionStatus() {
        // Office triggers LibreOffice conversion pipeline in CI/CD -> pending
        assertThat(FileCategoryMapper.resolveConversionStatus("office")).isEqualTo("pending")

        // Directly displayable categories -> ready
        assertThat(FileCategoryMapper.resolveConversionStatus("pdf")).isEqualTo("ready")
        assertThat(FileCategoryMapper.resolveConversionStatus("image")).isEqualTo("ready")
        assertThat(FileCategoryMapper.resolveConversionStatus("text")).isEqualTo("ready")
        assertThat(FileCategoryMapper.resolveConversionStatus("other")).isEqualTo("ready")
    }
}
