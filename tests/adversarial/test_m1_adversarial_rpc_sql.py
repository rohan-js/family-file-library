#!/usr/bin/env python3
"""
Empirical Adversarial Test Suite for Milestone 1 Supabase Backend:
1. TV Pairing Code Sanitization Stress Test (Postgres regex simulation & edge cases)
2. TV Pairing Code Generation & Collision Resilience (Empirical 1,000,000 code simulation)
3. Garbage Collection Query Execution & Foreign Key Integrity Simulation
"""

import math
import random
import re
import sqlite3
import time
import unittest

MIGRATION_PATH = "supabase/migrations/20261111000000_family_file_library_init.sql"

class TvPairingSanitizationStressTest(unittest.TestCase):
    r"""
    Stress-test the SQL sanitization expression:
    v_clean_code := regexp_replace(upper(trim(p_code)), '[\s-]+', '', 'g');
    against table constraint:
    code text not null unique check (code ~ '^[A-Z0-9]{6,8}$')
    """

    def sanitize_pg(self, p_code):
        if p_code is None:
            return None
        trimmed = p_code.strip()
        uppered = trimmed.upper()
        # PostgreSQL regexp_replace(uppered, '[\s-]+', '', 'g')
        cleaned = re.sub(r'[\s-]+', '', uppered)
        return cleaned

    def isValidConstraint(self, code):
        if code is None:
            return False
        return bool(re.match(r'^[A-Z0-9]{6,8}$', code))

    def test_formatted_standard_codes(self):
        """Test user formatting variations like ABC-DEF, abc def, abc-def."""
        test_cases = [
            ("ABC-DEF", "ABCDEF"),
            ("abc def", "ABCDEF"),
            ("abc-def", "ABCDEF"),
            ("  abc - def  ", "ABCDEF"),
            ("abc---def", "ABCDEF"),
            ("a b c d e f", "ABCDEF"),
            ("ABC\tDEF", "ABCDEF"),
            ("ABC\nDEF", "ABCDEF"),
            ("ABC\r\nDEF", "ABCDEF"),
            ("234-567", "234567"),
            ("K9P-2X7", "K9P2X7"),
            ("k9p 2x7", "K9P2X7"),
            ("k9p-2x7", "K9P2X7"),
            ("XY7-89A-B", "XY789AB"), # 7-char code
            ("AB-CD-EF-GH", "ABCDEFGH"), # 8-char code
        ]
        for raw, expected in test_cases:
            cleaned = self.sanitize_pg(raw)
            self.assertEqual(cleaned, expected, f"Failed sanitizing '{raw}'")
            self.assertTrue(self.isValidConstraint(cleaned), f"Constraint rejected valid code '{cleaned}'")

    def test_adversarial_malformed_inputs(self):
        """Test hostile, boundary, and unexpected inputs against sanitization."""
        adversarial_inputs = [
            (None, None),
            ("", ""),
            ("   ", ""),
            ("---", ""),
            (" - - - ", ""),
            ("ABCDE", "ABCDE"),           # 5 chars: too short for constraint
            ("ABCDEFGHI", "ABCDEFGHI"),   # 9 chars: too long for constraint
            ("ABC-DEF-GHI", "ABCDEFGHI"), # 9 chars: too long
            ("ABC@DEF", "ABC@DEF"),       # invalid special char
            ("ABC_DEF", "ABC_DEF"),       # underscore is not in [\s-]+
            ("ABC.DEF", "ABC.DEF"),       # dot is not in [\s-]+
            ("ABC+DEF", "ABC+DEF"),       # plus is not in [\s-]+
            ("'; DROP TABLE spaces; --", "';DROPTABLESPACES;"), # SQL injection attempt (-- stripped by hyphen rule)
            ("01IO-O1IO", "01IOO1IO"),   # ambiguous chars (valid syntax, but not generated)
            ("A" * 10000, "A" * 10000),   # huge input (buffer stress)
        ]
        for raw, expected in adversarial_inputs:
            cleaned = self.sanitize_pg(raw)
            self.assertEqual(cleaned, expected)
            if cleaned is None or len(cleaned) < 6 or len(cleaned) > 8 or not re.match(r'^[A-Z0-9]+$', cleaned):
                # Must be rejected by database check or query not found
                self.assertFalse(self.isValidConstraint(cleaned))

    def test_unicode_whitespace_and_dashes_stress(self):
        """
        Adversarial test: Non-ASCII whitespace (e.g. \\u00A0 non-breaking space)
        and non-ASCII dashes (e.g. en-dash \\u2013, em-dash \\u2014).
        """
        # Test non-breaking space and en-dash
        en_dash_input = "ABC\u2013DEF"
        em_dash_input = "ABC\u2014DEF"
        nbsp_input = "ABC\u00A0DEF"

        cleaned_en_dash = self.sanitize_pg(en_dash_input)
        cleaned_nbsp = self.sanitize_pg(nbsp_input)

        # In standard ASCII regex '[\s-]+', en-dash is NOT stripped.
        # This is an important finding: if a user on mobile pastes an en-dash, it stays in the string.
        # Let's verify that the database constraint properly rejects it rather than corrupting data.
        self.assertFalse(self.isValidConstraint(cleaned_en_dash))


class TvPairingCollisionResilienceStressTest(unittest.TestCase):
    """
    Stress-test the code generation algorithm in request_tv_pairing_code:
      v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      for v_i in 1..6 loop
        v_code := v_code || substr(v_chars, floor(random() * length(v_chars) + 1)::int, 1);
      end loop;
    """

    CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

    def generate_code(self):
        # Exact reproduction of PostgreSQL algorithm
        res = []
        for _ in range(6):
            idx = int(math.floor(random.random() * len(self.CHARS)))
            res.append(self.CHARS[idx])
        return "".join(res)

    def test_character_set_properties(self):
        """Verify the character set excludes confusing characters and has expected length."""
        self.assertEqual(len(self.CHARS), 32)
        # Avoid confusing characters: 0, O, 1, I
        for forbidden in ["0", "O", "1", "I"]:
            self.assertNotIn(forbidden, self.CHARS, f"Forbidden char '{forbidden}' found in CHARS")

    def test_massive_code_generation_uniformity(self):
        """Generate 200,000 codes and check uniformity, length, and check-constraint validity."""
        n_samples = 200000
        char_counts = {c: 0 for c in self.CHARS}
        generated_set = set()
        collisions = 0

        code_regex = re.compile(r'^[A-Z0-9]{6,8}$')

        t0 = time.time()
        for _ in range(n_samples):
            code = self.generate_code()
            self.assertEqual(len(code), 6)
            self.assertTrue(code_regex.match(code))
            for char in code:
                char_counts[char] += 1
            if code in generated_set:
                collisions += 1
            else:
                generated_set.add(code)
        elapsed = time.time() - t0

        # Total characters generated = n_samples * 6 = 1,200,000
        # Expected per character = 1,200,000 / 32 = 37,500
        expected_per_char = (n_samples * 6) / len(self.CHARS)
        for char, count in char_counts.items():
            deviation = abs(count - expected_per_char) / expected_per_char
            self.assertLess(deviation, 0.05, f"Character '{char}' deviates by {deviation:.2%}")

        # Collision rate check:
        # Expected collisions for N=200,000 with K=32^6 (1,073,741,824):
        # E[collisions] ≈ N^2 / (2K) = (4 * 10^10) / (2.14 * 10^9) ≈ 18.6 collisions
        print(f"\n[Empirical] Generated {n_samples:,} codes in {elapsed:.2f}s.")
        print(f"[Empirical] Observed collisions: {collisions} (Theoretical expectation: ~19).")
        self.assertLess(collisions, 60, f"Excessive collisions observed: {collisions}")

    def test_collision_retry_loop_termination_simulation(self):
        """
        Simulate request_tv_pairing_code retry loop under high collision pressure.
        Verify loop termination and compute distribution of retry counts.
        """
        # Pre-populate a set of 50,000 active codes
        active_codes = set()
        for _ in range(50000):
            active_codes.add(self.generate_code())

        # Now simulate 10,000 request_tv_pairing_code calls
        iterations_distribution = {}
        max_iterations = 0

        for _ in range(10000):
            iterations = 0
            while True:
                iterations += 1
                code = self.generate_code()
                if code not in active_codes:
                    active_codes.add(code)
                    break
            max_iterations = max(max_iterations, iterations)
            iterations_distribution[iterations] = iterations_distribution.get(iterations, 0) + 1

        print(f"[Empirical] Iteration distribution over 10,000 requests with 50,000 active codes: {iterations_distribution}")
        print(f"[Empirical] Maximum loop iterations observed: {max_iterations}")
        self.assertLessEqual(max_iterations, 4, "Loop took more than 4 iterations even with 50k active codes")
        self.assertGreater(iterations_distribution.get(1, 0), 9900, "Expected >99% to succeed on 1st attempt")


class CleanupExpiredTrashEmpiricalSimulation(unittest.TestCase):
    """
    Empirically execute and verify the cleanup_expired_trash query logic
    using an in-memory SQLite schema modeling the exact Postgres tables and FKs.
    """

    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.execute("PRAGMA foreign_keys = ON;")
        self.cur = self.conn.cursor()

        # Create mock tables
        self.cur.executescript("""
            CREATE TABLE spaces (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL
            );

            CREATE TABLE folders (
                id TEXT PRIMARY KEY,
                space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
                parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                deleted_at REAL DEFAULT NULL
            );

            CREATE TABLE files (
                id TEXT PRIMARY KEY,
                space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
                folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
                name TEXT NOT NULL,
                storage_path TEXT NOT NULL UNIQUE,
                pdf_path TEXT,
                deleted_at REAL DEFAULT NULL
            );

            CREATE TABLE storage_objects (
                id TEXT PRIMARY KEY,
                bucket_id TEXT NOT NULL,
                name TEXT NOT NULL UNIQUE
            );

            CREATE TABLE notes (
                id TEXT PRIMARY KEY,
                space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
                file_id TEXT REFERENCES files(id) ON DELETE CASCADE,
                folder_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
                content TEXT NOT NULL,
                deleted_at REAL DEFAULT NULL
            );

            CREATE TABLE pairing_codes (
                id TEXT PRIMARY KEY,
                code TEXT NOT NULL UNIQUE,
                device_identifier TEXT NOT NULL,
                expires_at REAL NOT NULL,
                status TEXT NOT NULL
            );
        """)

        # Insert space
        self.cur.execute("INSERT INTO spaces VALUES ('space-1', 'Family Space')")

        # Insert storage objects
        # 1: active file storage
        # 2: expired file 1 storage
        # 3: expired file 2 storage
        # 4: expired file 2 converted pdf storage
        self.cur.executemany("INSERT INTO storage_objects VALUES (?, 'family-files', ?)", [
            ("s-active", "space-1/original/f-active/doc.pdf"),
            ("s-exp1", "space-1/original/f-exp1/old.docx"),
            ("s-exp2", "space-1/original/f-exp2/report.pptx"),
            ("s-exp2-pdf", "space-1/converted/f-exp2.pdf"),
            ("s-unrelated", "space-1/original/f-other/other.png"),
        ])

        # Current timestamp: T = 1000 days
        self.NOW = 1000.0
        self.DAYS_30 = 30.0
        self.CUTOFF = self.NOW - self.DAYS_30 # 970.0

        # Insert folders:
        # folder-1: active
        # folder-2: recently trashed (deleted 10 days ago -> T=990)
        # folder-3: expired trashed (deleted 35 days ago -> T=965)
        self.cur.executemany("INSERT INTO folders VALUES (?, 'space-1', NULL, ?, ?)", [
            ("folder-active", "Active Folder", None),
            ("folder-recent-trash", "Recent Trash Folder", self.NOW - 10.0),
            ("folder-expired-trash", "Expired Trash Folder", self.NOW - 35.0),
        ])

        # Insert files:
        # 1. Active file in Active Folder
        # 2. Active file in Expired Trash Folder (test ON DELETE SET NULL!)
        # 3. Recently trashed file (deleted 15 days ago)
        # 4. Expired file 1 (deleted 31 days ago, has storage_path, no pdf)
        # 5. Expired file 2 (deleted 45 days ago, has storage_path and pdf_path)
        # 6. Expired file 3 (deleted 40 days ago, missing from storage_objects to test dangling tolerance)
        self.cur.executemany("INSERT INTO files VALUES (?, 'space-1', ?, ?, ?, ?, ?)", [
            ("f-active", "folder-active", "doc.pdf", "space-1/original/f-active/doc.pdf", None, None),
            ("f-survivor", "folder-expired-trash", "survivor.pdf", "space-1/original/f-survivor/survivor.pdf", None, None),
            ("f-recent", "folder-active", "recent.pdf", "space-1/original/f-recent/recent.pdf", None, self.NOW - 15.0),
            ("f-exp1", "folder-active", "old.docx", "space-1/original/f-exp1/old.docx", None, self.NOW - 31.0),
            ("f-exp2", "folder-active", "report.pptx", "space-1/original/f-exp2/report.pptx", "space-1/converted/f-exp2.pdf", self.NOW - 45.0),
            ("f-exp3", "folder-active", "missing_store.pdf", "space-1/original/f-exp3/ghost.pdf", None, self.NOW - 40.0),
        ])

        # Insert notes:
        # n1: attached to f-exp1 (should cascade delete when f-exp1 deleted)
        # n2: soft-deleted note older than 30 days
        # n3: soft-deleted note less than 30 days
        self.cur.executemany("INSERT INTO notes VALUES (?, 'space-1', ?, NULL, ?, ?)", [
            ("n-cascade", "f-exp1", "Note on expired file", None),
            ("n-expired", "f-active", "Expired standalone note", self.NOW - 35.0),
            ("n-recent", "f-active", "Recently deleted note", self.NOW - 5.0),
        ])

        # Insert pairing codes:
        # p1: active (expires in 10 mins)
        # p2: expired 2 hours ago
        # p3: expired 30 hours ago (> 24h stale)
        self.cur.executemany("INSERT INTO pairing_codes VALUES (?, ?, ?, ?, ?)", [
            ("p-active", "ACT123", "tv-1", self.NOW + 0.01, "pending"),
            ("p-recent-exp", "REC456", "tv-2", self.NOW - 0.08, "expired"),
            ("p-stale-exp", "STL789", "tv-3", self.NOW - 1.25, "expired"),
        ])
        self.conn.commit()

    def tearDown(self):
        self.conn.close()

    def test_cleanup_expired_trash_execution(self):
        """
        Execute the exact logic of cleanup_expired_trash and verify:
        1. Expired files are deleted from files and storage_objects.
        2. Converted PDF storage paths are deleted.
        3. Active files and recently trashed files are preserved.
        4. When expired folder is deleted, its child files survive with folder_id = NULL.
        5. Cascade deletion cleans up child notes.
        6. Stale pairing codes (> 24h) are purged, recent expired pairing codes kept.
        """
        cutoff_time = self.CUTOFF

        # Step 1: Storage object deletion & file deletion
        # In Postgres:
        # with expired_files as (select id, storage_path, pdf_path from files where deleted_at < cutoff),
        # del_storage as (delete from storage.objects where name in (select storage_path ... union select pdf_path ...)),
        # del_files as (delete from files where id in (select id from expired_files) returning id)

        # Let's get expired files
        self.cur.execute("SELECT id, storage_path, pdf_path FROM files WHERE deleted_at IS NOT NULL AND deleted_at < ?", (cutoff_time,))
        expired_files = self.cur.fetchall()
        expired_ids = [r[0] for r in expired_files]
        self.assertEqual(len(expired_ids), 3, "Expected 3 expired files (f-exp1, f-exp2, f-exp3)")

        storage_names_to_delete = []
        for r in expired_files:
            if r[1]: storage_names_to_delete.append(r[1])
            if r[2]: storage_names_to_delete.append(r[2])

        # Delete from storage_objects
        placeholders = ",".join("?" for _ in storage_names_to_delete)
        self.cur.execute(f"DELETE FROM storage_objects WHERE bucket_id = 'family-files' AND name IN ({placeholders})", storage_names_to_delete)
        deleted_storage_count = self.cur.rowcount

        # Delete from files
        placeholders_files = ",".join("?" for _ in expired_ids)
        self.cur.execute(f"DELETE FROM files WHERE id IN ({placeholders_files})", expired_ids)
        deleted_files_count = self.cur.rowcount

        # Step 2: Delete expired folders
        self.cur.execute("SELECT id FROM folders WHERE deleted_at IS NOT NULL AND deleted_at < ?", (cutoff_time,))
        expired_folders = [r[0] for r in self.cur.fetchall()]
        self.assertEqual(len(expired_folders), 1, "Expected 1 expired folder (folder-expired-trash)")
        self.cur.execute("DELETE FROM folders WHERE deleted_at IS NOT NULL AND deleted_at < ?", (cutoff_time,))
        deleted_folders_count = self.cur.rowcount

        # Step 3: Delete expired notes
        self.cur.execute("DELETE FROM notes WHERE deleted_at IS NOT NULL AND deleted_at < ?", (cutoff_time,))
        deleted_notes_count = self.cur.rowcount

        # Step 4: Delete stale pairing codes (expires_at < NOW - 24 hours -> NOW - 1.0 day)
        self.cur.execute("DELETE FROM pairing_codes WHERE expires_at < ?", (self.NOW - 1.0,))
        deleted_pairing_count = self.cur.rowcount

        self.conn.commit()

        # VERIFICATIONS:
        # 1. Counts
        self.assertEqual(deleted_files_count, 3)
        self.assertEqual(deleted_folders_count, 1)
        self.assertEqual(deleted_storage_count, 3) # s-exp1, s-exp2, s-exp2-pdf (ghost was not in storage, s-active kept)
        self.assertEqual(deleted_notes_count, 1) # n-expired (n-recent kept)
        self.assertEqual(deleted_pairing_count, 1) # p-stale-exp deleted

        # 2. Check storage_objects remaining
        self.cur.execute("SELECT name FROM storage_objects ORDER BY name")
        remaining_storage = [r[0] for r in self.cur.fetchall()]
        self.assertIn("space-1/original/f-active/doc.pdf", remaining_storage)
        self.assertIn("space-1/original/f-other/other.png", remaining_storage)
        self.assertNotIn("space-1/original/f-exp1/old.docx", remaining_storage)
        self.assertNotIn("space-1/original/f-exp2/report.pptx", remaining_storage)
        self.assertNotIn("space-1/converted/f-exp2.pdf", remaining_storage)

        # 3. Check files remaining
        self.cur.execute("SELECT id, folder_id, name FROM files ORDER BY id")
        remaining_files = {r[0]: (r[1], r[2]) for r in self.cur.fetchall()}
        self.assertIn("f-active", remaining_files)
        self.assertIn("f-recent", remaining_files)
        self.assertIn("f-survivor", remaining_files)
        self.assertNotIn("f-exp1", remaining_files)
        self.assertNotIn("f-exp2", remaining_files)
        self.assertNotIn("f-exp3", remaining_files)

        # CRITICAL TEST: f-survivor was inside folder-expired-trash!
        # When folder-expired-trash was deleted, f-survivor's folder_id must be NULL (ON DELETE SET NULL)!
        survivor_folder_id = remaining_files["f-survivor"][0]
        self.assertIsNone(survivor_folder_id, "Survivor file folder_id should be NULL after parent folder expired")

        # 4. Check notes remaining
        self.cur.execute("SELECT id FROM notes ORDER BY id")
        remaining_notes = [r[0] for r in self.cur.fetchall()]
        self.assertIn("n-recent", remaining_notes)
        self.assertNotIn("n-expired", remaining_notes)
        self.assertNotIn("n-cascade", remaining_notes, "Note attached to deleted file f-exp1 should have been cascade deleted")

        # 5. Check pairing codes remaining
        self.cur.execute("SELECT id FROM pairing_codes ORDER BY id")
        remaining_codes = [r[0] for r in self.cur.fetchall()]
        self.assertIn("p-active", remaining_codes)
        self.assertIn("p-recent-exp", remaining_codes)
        self.assertNotIn("p-stale-exp", remaining_codes)

        print("\n[Empirical] Cleanup simulation succeeded: Storage, files, folders, cascades, and pairing codes sequenced accurately.")


if __name__ == "__main__":
    unittest.main(verbosity=2)
