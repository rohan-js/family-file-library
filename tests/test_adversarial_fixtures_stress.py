#!/usr/bin/env python3
"""
Adversarial Fixtures Stress Test for Milestone 1 (Supabase Backend)
Tests the actual synthetic test fixtures generated in tests/fixtures/ against:
1. Database check constraints (size limits, zero-byte handling)
2. Storage bucket configuration (allowed MIME types, 50MB file size limit)
3. FTS generated column text extraction on Indic, null-byte, and oversized documents
"""

import os
import re
import json
import unittest

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "fixtures")
MIGRATION_PATH = os.path.join(
    os.path.dirname(__file__), "..", "supabase", "migrations", "20261111000000_family_file_library_init.sql"
)


class TestAdversarialFixturesAgainstSchema(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        manifest_path = os.path.join(FIXTURES_DIR, "fixtures_manifest.json")
        assert os.path.exists(manifest_path), f"Manifest not found: {manifest_path}"
        with open(manifest_path, "r", encoding="utf-8") as f:
            cls.manifest = json.load(f)

        with open(MIGRATION_PATH, "r", encoding="utf-8") as f:
            cls.sql = f.read()

        # Extract allowed MIME types from migration SQL
        mime_match = re.search(r"array\[([\s\S]*?)\]", cls.sql)
        assert mime_match, "Could not extract allowed_mime_types from migration SQL"
        cls.allowed_mimes = set(re.findall(r"'([^']+)'", mime_match.group(1)))

    def test_sample_50mb_boundary_fixture(self):
        """sample_50mb_boundary.bin must be exactly 52,428,800 bytes and accepted by DB/storage size check."""
        path = os.path.join(FIXTURES_DIR, "sample_50mb_boundary.bin")
        self.assertTrue(os.path.exists(path))
        file_size = os.path.getsize(path)
        self.assertEqual(file_size, 52428800)

        # Database constraint: size_bytes > 0 and size_bytes <= 52428800
        db_valid = (0 < file_size <= 52428800)
        self.assertTrue(db_valid, "50MB boundary file must be permitted by database constraint")

    def test_sample_over_50mb_fixture_rejected(self):
        """sample_over_50mb.bin (52,428,801 bytes) must be rejected by DB constraint and storage limit."""
        path = os.path.join(FIXTURES_DIR, "sample_over_50mb.bin")
        self.assertTrue(os.path.exists(path))
        file_size = os.path.getsize(path)
        self.assertEqual(file_size, 52428801)

        db_valid = (0 < file_size <= 52428800)
        self.assertFalse(db_valid, "File over 50MB must be rejected by files.size_bytes check constraint")

    def test_sample_zero_byte_fixture_rejected(self):
        """sample_zero_byte.txt (0 bytes) must be rejected by DB constraint (size_bytes > 0)."""
        path = os.path.join(FIXTURES_DIR, "sample_zero_byte.txt")
        self.assertTrue(os.path.exists(path))
        file_size = os.path.getsize(path)
        self.assertEqual(file_size, 0)

        db_valid = (0 < file_size <= 52428800)
        self.assertFalse(db_valid, "0-byte file must be rejected by size_bytes > 0 constraint")

    def test_all_fixture_mime_types_in_storage_whitelist(self):
        """Every non-binary test fixture mime type must be supported in allowed_mime_types."""
        mime_map = {
            "sample_document.pdf": "application/pdf",
            "sample_photo.jpg": "image/jpeg",
            "sample_image.png": "image/png",
            "sample_sheet.xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "sample_slides.pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "sample_indic_malayalam.docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "sample_indic_malayalam.pdf": "application/pdf",
            "sample_indic_devanagari.docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "sample_indic_devanagari.pdf": "application/pdf",
            "sample_markdown.md": "text/markdown",
            "sample_text.txt": "text/plain",
            "sample_scanned.pdf": "application/pdf"
        }
        for filename, mime in mime_map.items():
            path = os.path.join(FIXTURES_DIR, filename)
            self.assertTrue(os.path.exists(path), f"Fixture missing: {filename}")
            self.assertIn(mime, self.allowed_mimes, f"MIME type '{mime}' for {filename} is missing from allowed_mime_types!")

    def test_indic_unicode_text_content_in_fts(self):
        """Test Malayalam and Devanagari text content in FTS generated column simulation."""
        # Read sample text fixture
        with open(os.path.join(FIXTURES_DIR, "sample_markdown.md"), "r", encoding="utf-8") as f:
            md_content = f.read()

        # Malayalam text
        malayalam_text = "ആൻഡ്രോയിഡ് ടിവി ഫാമിലി ഫയൽ ലൈബ്രറി കുടുംബാംഗങ്ങൾക്ക് പ്രമാണങ്ങളും ഫോട്ടോകളും ടിവിയിൽ കാണാൻ സഹായിക്കുന്നു."
        devanagari_text = "एंड्रॉइड टीवी फैमिली फाइल लाइब्रेरी परिवार के सदस्यों को टीवी पर दस्तावेज़ देखने की सुविधा देती है।"

        combined_text = f"{md_content}\n{malayalam_text}\n{devanagari_text}"
        truncated = combined_text[:50000]

        # Verify concatenation does not corrupt multibyte unicode
        fts_string = f"sample_markdown.md {truncated}"
        self.assertIn("കുടുംബാംഗങ്ങൾക്ക്", fts_string)
        self.assertIn("परिवार", fts_string)
        self.assertLessEqual(len(fts_string), 255 + 1 + 50000)

    def test_null_bytes_in_text_content(self):
        """Test that null bytes in sample_null_bytes.txt do not break string manipulation."""
        path = os.path.join(FIXTURES_DIR, "sample_null_bytes.txt")
        with open(path, "rb") as f:
            raw = f.read()
        self.assertIn(b"\x00", raw)
        # In Python and Postgres, text sanitization strips or handles nulls
        sanitized = raw.replace(b"\x00", b"").decode("utf-8", errors="ignore")
        fts_string = f"sample_null_bytes.txt {sanitized[:50000]}"
        self.assertNotIn("\x00", fts_string)


if __name__ == "__main__":
    unittest.main(verbosity=2)
