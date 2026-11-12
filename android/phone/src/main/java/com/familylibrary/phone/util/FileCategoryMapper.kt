package com.familylibrary.phone.util

object FileCategoryMapper {

    /**
     * Maps MIME type and extension to Supabase database schema check constraint:
     * check (file_category in ('pdf', 'image', 'office', 'text', 'other'))
     */
    fun resolveCategory(mimeType: String, fileName: String): String {
        val lowerMime = mimeType.lowercase()
        val lowerName = fileName.lowercase()

        return when {
            lowerMime == "application/pdf" || lowerName.endsWith(".pdf") -> "pdf"
            lowerMime.startsWith("image/") || lowerName.matches(Regex(".*\\.(jpe?g|png|webp|gif|heic|heif)$")) -> "image"
            lowerMime.contains("word") || lowerMime.contains("excel") ||
            lowerMime.contains("presentation") || lowerMime.contains("officedocument") ||
            lowerName.matches(Regex(".*\\.(docx?|xlsx?|pptx?)$")) -> "office"
            lowerMime.startsWith("text/") || lowerName.matches(Regex(".*\\.(txt|md|csv)$")) -> "text"
            else -> "other"
        }
    }

    /**
     * Determines conversion status based on category.
     * Office documents trigger LibreOffice conversion pipeline in CI/CD.
     */
    fun resolveConversionStatus(category: String): String {
        return if (category == "office") "pending" else "ready"
    }
}
