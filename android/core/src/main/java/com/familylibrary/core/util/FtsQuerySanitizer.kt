package com.familylibrary.core.util

object FtsQuerySanitizer {
    /**
     * Sanitizes user input for SQLite FTS4 MATCH queries.
     * Replaces dangerous syntax characters (*, ", ', :, (, ), [, ], {, }, ^, ~) with spaces
     * and constructs prefix matching query tokens (e.g., "tax report" -> "tax* report*").
     */
    fun sanitize(rawQuery: String): String {
        val clean = rawQuery.replace(Regex("[*\"':()\\[\\]{}^~]"), " ").trim()
        if (clean.isBlank()) return "\"\""
        return clean.split(Regex("\\s+"))
            .filter { it.isNotBlank() }
            .joinToString(" ") { "$it*" }
    }
}
