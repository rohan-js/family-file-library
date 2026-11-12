"""
Adversarial test harness for Milestone 5: CI/CD Workflows & Scripts.
Empirical Challenger test suite verifying:
1. Concurrency & LibreOffice profile isolation.
2. Malformed, corrupted, and zero-byte file resilience.
3. Scanned PDF zero-text edge cases and ocr_needed handling.
4. Supabase Storage 500/403 upload and download error resilience.
5. Workflow triggers and cron definitions against Requirement R4.
"""

import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from unittest.mock import MagicMock, call, patch
import urllib.error

# Ensure scripts is on sys.path
repo_root = Path(__file__).resolve().parent.parent
if str(repo_root / "scripts") not in sys.path:
    sys.path.insert(0, str(repo_root / "scripts"))

import convert_document
from convert_document import (
    SupabaseClient,
    convert_office_to_pdf,
    extract_text_from_pdf,
    process_single_file,
)
import backup_metadata
from backup_metadata import SupabaseBackupClient, METADATA_TABLES, FAMILY_FILE_LIBRARY_TABLES

import yaml


class AdversarialConcurrencyProfileTests(unittest.TestCase):
    """Stress-test LibreOffice profile isolation and concurrency."""

    @patch("convert_document.run_command")
    def test_concurrent_conversions_have_distinct_isolated_profiles(self, mock_run):
        """
        Verify that multiple concurrent calls to convert_office_to_pdf each generate
        a unique isolated profile URI (-env:UserInstallation=file://...) with no collisions.
        """
        user_install_args = []

        def fake_run(cmd, timeout=180):
            # Extract -env:UserInstallation arg
            user_arg = next((arg for arg in cmd if arg.startswith("-env:UserInstallation=")), None)
            if user_arg:
                user_install_args.append(user_arg)
            # Create expected output file in outdir
            outdir_idx = cmd.index("--outdir") + 1
            outdir = Path(cmd[outdir_idx])
            infile = Path(cmd[-1])
            expected_pdf = outdir / f"{infile.stem}.pdf"
            expected_pdf.write_bytes(b"%PDF-1.4 mock")
            return MagicMock()

        mock_run.side_effect = fake_run

        num_concurrent = 8
        with tempfile.TemporaryDirectory() as base_temp:
            base_dir = Path(base_temp)

            def worker_task(worker_id):
                worker_out = base_dir / f"out_{worker_id}"
                worker_out.mkdir()
                input_file = base_dir / f"doc_{worker_id}.docx"
                input_file.write_bytes(b"PK mock content")
                return convert_office_to_pdf(input_file, worker_out)

            with ThreadPoolExecutor(max_workers=num_concurrent) as executor:
                futures = [executor.submit(worker_task, i) for i in range(num_concurrent)]
                results = [f.result() for f in as_completed(futures)]

            # Check that all conversions succeeded
            self.assertEqual(len(results), num_concurrent)
            for r in results:
                self.assertTrue(r.exists())

            # Check that every single -env:UserInstallation was unique
            self.assertEqual(len(user_install_args), num_concurrent)
            unique_profiles = set(user_install_args)
            self.assertEqual(
                len(unique_profiles),
                num_concurrent,
                f"Profile collision detected! Expected {num_concurrent} unique profiles, got {len(unique_profiles)}"
            )

    @patch.object(SupabaseClient, "download_storage_file")
    @patch.object(SupabaseClient, "upload_storage_file")
    @patch.object(SupabaseClient, "update_file_status")
    @patch("convert_document.run_command")
    def test_concurrent_process_single_file_isolation(
        self, mock_run, mock_update, mock_upload, mock_download
    ):
        """
        Verify that parallel process_single_file calls maintain complete isolation
        across temporary directories, storage paths, and DB status updates.
        """
        mock_download.side_effect = lambda storage_path, dest_path, timeout=60: dest_path.write_bytes(b"PK fake docx") or True
        mock_upload.return_value = True
        mock_update.return_value = True

        def fake_run(cmd, timeout=180):
            if cmd[0] == "pdftotext":
                txt_path = Path(cmd[-1])
                txt_path.write_text("Extracted text", encoding="utf-8")
            else:
                # LibreOffice
                outdir = Path(cmd[cmd.index("--outdir") + 1])
                infile = Path(cmd[-1])
                (outdir / f"{infile.stem}.pdf").write_bytes(b"%PDF mock")
            return MagicMock()

        mock_run.side_effect = fake_run

        client = SupabaseClient("https://example.supabase.co", "key-123")
        num_tasks = 10

        records = [
            {
                "id": f"file-uuid-{i}",
                "name": f"doc_{i}.docx",
                "storage_path": f"space-1/original/file-uuid-{i}/doc_{i}.docx",
                "space_id": "space-1",
                "conversion_status": "pending",
                "conversion_error": None
            }
            for i in range(num_tasks)
        ]

        with ThreadPoolExecutor(max_workers=5) as executor:
            futures = [executor.submit(process_single_file, client, rec) for rec in records]
            results = [f.result() for f in futures]

        self.assertTrue(all(results), "All concurrent conversions should succeed")

        # Verify that all 10 files had their status updated to ready
        ready_updates = [
            call_args[0]
            for call_args in mock_update.call_args_list
            if call_args[0][1].get("conversion_status") == "ready"
        ]
        self.assertEqual(len(ready_updates), num_tasks)
        updated_ids = {u[0] for u in ready_updates}
        expected_ids = {f"file-uuid-{i}" for i in range(num_tasks)}
        self.assertEqual(updated_ids, expected_ids)


class AdversarialMalformedZeroByteTests(unittest.TestCase):
    """Stress-test malformed, corrupt, and zero-byte inputs."""

    def setUp(self):
        self.client = SupabaseClient("https://example.supabase.co", "key-123")

    @patch.object(SupabaseClient, "download_storage_file")
    @patch.object(SupabaseClient, "set_file_status")
    def test_zero_byte_file_graceful_handling(self, mock_set_status, mock_download):
        """0-byte file must be trapped immediately, marked failed, without crashing."""
        mock_download.side_effect = lambda path, dest, timeout=60: dest.write_bytes(b"") or True

        file_rec = {
            "id": "zero-byte-id",
            "name": "empty.xlsx",
            "storage_path": "space/empty.xlsx",
            "conversion_status": "pending"
        }

        success = process_single_file(self.client, file_rec)
        self.assertFalse(success)

        # Check status update
        mock_set_status.assert_called_with(
            file_rec,
            "failed",
            error_value="Input file is 0 bytes (empty file)."
        )

    @patch.object(SupabaseClient, "download_storage_file")
    @patch.object(SupabaseClient, "set_file_status")
    @patch("convert_document.run_command")
    def test_corrupted_office_file_handles_libreoffice_crash(
        self, mock_run, mock_set_status, mock_download
    ):
        """Corrupted Office file where LibreOffice exits with non-zero return code."""
        mock_download.side_effect = lambda path, dest, timeout=60: dest.write_bytes(b"CORRUPT_NOT_A_ZIP") or True
        mock_run.side_effect = subprocess.CalledProcessError(
            returncode=1,
            cmd=["libreoffice"],
            output="",
            stderr="Error: source file could not be loaded"
        )

        file_rec = {
            "id": "corrupt-doc-id",
            "name": "corrupt.docx",
            "storage_path": "space/corrupt.docx",
            "conversion_status": "pending"
        }

        # Must not raise an unhandled exception
        success = process_single_file(self.client, file_rec)
        self.assertFalse(success)

        # Verify failed status set with error details
        mock_set_status.assert_any_call(
            file_rec,
            "failed",
            error_value="LibreOffice failed (code 1): Error: source file could not be loaded"
        )

    @patch.object(SupabaseClient, "download_storage_file")
    @patch.object(SupabaseClient, "set_file_status")
    @patch("convert_document.run_command")
    def test_corrupted_pdf_handles_pdftotext_error(
        self, mock_run, mock_set_status, mock_download
    ):
        """Corrupted PDF where pdftotext fails with syntax errors."""
        mock_download.side_effect = lambda path, dest, timeout=60: dest.write_bytes(b"%PDF-INVALID-DATA") or True
        mock_run.side_effect = subprocess.CalledProcessError(
            returncode=99,
            cmd=["pdftotext"],
            output="",
            stderr="Syntax Error: Couldn't read xref table"
        )

        file_rec = {
            "id": "corrupt-pdf-id",
            "name": "corrupt.pdf",
            "storage_path": "space/corrupt.pdf",
            "conversion_status": "pending"
        }

        success = process_single_file(self.client, file_rec)
        self.assertFalse(success)

        # Verify failed status was set cleanly
        mock_set_status.assert_any_call(
            file_rec,
            "failed",
            error_value="pdftotext failed (code 99): Syntax Error: Couldn't read xref table"
        )

    @patch.object(SupabaseClient, "download_storage_file")
    @patch.object(SupabaseClient, "upload_storage_file")
    @patch.object(SupabaseClient, "set_file_status")
    @patch("convert_document.run_command")
    def test_missing_pdftotext_output_file_resilience(
        self, mock_run, mock_set_status, mock_upload, mock_download
    ):
        """
        Adversarial test: pdftotext exits with code 0 but does NOT produce an output file.
        extract_text_from_pdf returns 0.
        Verify whether process_single_file handles missing output file cleanly.
        """
        mock_download.side_effect = lambda path, dest, timeout=60: dest.write_bytes(b"%PDF-1.4 dummy") or True
        mock_upload.return_value = True

        # pdftotext mock that does NOT write output file
        def fake_run(cmd, timeout=60):
            return MagicMock()

        mock_run.side_effect = fake_run

        file_rec = {
            "id": "missing-txt-id",
            "name": "document.pdf",
            "storage_path": "space/document.pdf",
            "conversion_status": "pending"
        }

        # When txt_output doesn't exist, process_single_file skips text upload
        # and marks file ready with ocr_needed=True without crashing.
        success = process_single_file(self.client, file_rec)
        self.assertTrue(success, "process_single_file should succeed gracefully when pdftotext produces no txt output")

    def test_text_sanitization_removes_null_bytes_and_preserves_indic_characters(self):
        """Verify null byte stripping while preserving Malayalam, Hindi, and Unicode text."""
        with tempfile.TemporaryDirectory() as td:
            txt_path = Path(td) / "test.txt"
            pdf_path = Path(td) / "test.pdf"
            pdf_path.write_bytes(b"%PDF mock")

            # Input with Malayalam ('കേരളം'), Devanagari ('नमस्ते'), emojis, and null bytes
            indic_text = "കേരളം\x00 - ദൈവത്തിന്റെ\x00 സ്വന്തം നാട്\nनमस्ते\x00 दुनिया! 🚀 \x00Special: & < > \" '"

            with patch("convert_document.run_command") as mock_run:
                def fake_run(cmd, timeout=60):
                    with open(txt_path, "w", encoding="utf-8") as f:
                        f.write(indic_text)
                    return MagicMock()

                mock_run.side_effect = fake_run

                char_count = extract_text_from_pdf(pdf_path, txt_path)

                with open(txt_path, "r", encoding="utf-8") as f:
                    cleaned = f.read()

                self.assertNotIn("\x00", cleaned)
                self.assertIn("കേരളം", cleaned)
                self.assertIn("नमस्ते दुनिया!", cleaned)
                self.assertIn("🚀", cleaned)
                self.assertEqual(char_count, len(cleaned.strip()))


class AdversarialScannedPdfTests(unittest.TestCase):
    """Stress-test scanned PDF zero-text edge case."""

    def setUp(self):
        self.client = SupabaseClient("https://example.supabase.co", "key-123")

    @patch.object(SupabaseClient, "download_storage_file")
    @patch.object(SupabaseClient, "upload_storage_file")
    @patch.object(SupabaseClient, "update_file_status")
    @patch("convert_document.run_command")
    def test_scanned_pdf_zero_text_schema_with_ocr_needed(
        self, mock_run, mock_update, mock_upload, mock_download
    ):
        """
        When database schema includes ocr_needed, a scanned PDF (0 characters)
        must transition to 'ready' with ocr_needed = True and has_text = False.
        """
        mock_download.side_effect = lambda path, dest, timeout=60: dest.write_bytes(b"%PDF-1.4 scanned") or True
        mock_upload.return_value = True
        mock_update.return_value = True

        # pdftotext produces empty file (0 chars)
        def fake_run(cmd, timeout=60):
            out_txt = Path(cmd[-1])
            out_txt.write_text("   \n\t  ", encoding="utf-8")  # Whitespace only -> 0 chars
            return MagicMock()

        mock_run.side_effect = fake_run

        file_rec = {
            "id": "scanned-pdf-1",
            "name": "receipt_scan.pdf",
            "storage_path": "space/receipt_scan.pdf",
            "conversion_status": "pending",
            "conversion_error": None,
            "ocr_needed": False,  # Present in schema
            "has_text": True,
            "char_count": 50,
            "text_content": "old text",
            "pdf_path": None
        }

        success = process_single_file(self.client, file_rec)
        self.assertTrue(success)

        # Inspect final update payload sent to update_file_status
        final_call = mock_update.call_args_list[-1]
        updates = final_call[0][1]

        self.assertEqual(updates["conversion_status"], "ready")
        self.assertIsNone(updates["conversion_error"])
        self.assertEqual(updates["ocr_needed"], True)
        self.assertEqual(updates["has_text"], False)
        self.assertEqual(updates["char_count"], 0)
        self.assertIsNone(updates["text_content"])

    @patch.object(SupabaseClient, "download_storage_file")
    @patch.object(SupabaseClient, "upload_storage_file")
    @patch.object(SupabaseClient, "update_file_status")
    @patch("convert_document.run_command")
    def test_scanned_pdf_zero_text_schema_without_ocr_needed(
        self, mock_run, mock_update, mock_upload, mock_download
    ):
        """
        When database schema does NOT have ocr_needed (e.g. current public.files table),
        set_file_status must NOT inject ocr_needed into PATCH payload to avoid PostgREST 400.
        """
        mock_download.side_effect = lambda path, dest, timeout=60: dest.write_bytes(b"%PDF-1.4 scanned") or True
        mock_upload.return_value = True
        mock_update.return_value = True

        def fake_run(cmd, timeout=60):
            out_txt = Path(cmd[-1])
            out_txt.write_text("", encoding="utf-8")
            return MagicMock()

        mock_run.side_effect = fake_run

        # Record mirrors exact public.files table columns from migration
        file_rec = {
            "id": "scanned-pdf-2",
            "name": "scan.pdf",
            "storage_path": "space/scan.pdf",
            "conversion_status": "pending",
            "conversion_error": None,
            "pdf_path": None,
            "text_content": None,
            "updated_at": "2026-01-01T00:00:00Z"
        }

        success = process_single_file(self.client, file_rec)
        self.assertTrue(success)

        final_call = mock_update.call_args_list[-1]
        updates = final_call[0][1]

        self.assertEqual(updates["conversion_status"], "ready")
        self.assertIsNone(updates["conversion_error"])
        # ocr_needed should NOT be in updates because it's not in file_rec
        self.assertNotIn("ocr_needed", updates)
        self.assertNotIn("char_count", updates)
        self.assertNotIn("has_text", updates)


class AdversarialStorageErrorTests(unittest.TestCase):
    """Stress-test Supabase Storage HTTP 500 and 403 error conditions."""

    def setUp(self):
        self.client = SupabaseClient("https://example.supabase.co", "key-123")

    @patch("urllib.request.urlopen")
    def test_storage_upload_500_internal_error_handling(self, mock_urlopen):
        """Storage upload failing with HTTP 500 returns False without throwing."""
        err = urllib.error.HTTPError(
            url="https://example.supabase.co/storage/v1/object/family-files/path",
            code=500,
            msg="Internal Server Error",
            hdrs={},
            fp=io.BytesIO(b'{"error": "Database error saving storage object"}')
        )
        mock_urlopen.side_effect = err

        with tempfile.TemporaryDirectory() as td:
            src = Path(td) / "dummy.pdf"
            src.write_bytes(b"%PDF mock")

            result = self.client.upload_storage_file("space/converted/f.pdf", src, "application/pdf")
            self.assertFalse(result)

    @patch("urllib.request.urlopen")
    def test_storage_upload_403_forbidden_error_handling(self, mock_urlopen):
        """Storage upload failing with HTTP 403 Forbidden returns False without throwing."""
        err = urllib.error.HTTPError(
            url="https://example.supabase.co/storage/v1/object/family-files/path",
            code=403,
            msg="Forbidden",
            hdrs={},
            fp=io.BytesIO(b'{"error": "Row level security violation"}')
        )
        mock_urlopen.side_effect = err

        with tempfile.TemporaryDirectory() as td:
            src = Path(td) / "dummy.pdf"
            src.write_bytes(b"%PDF mock")

            result = self.client.upload_storage_file("space/converted/f.pdf", src, "application/pdf")
            self.assertFalse(result)

    @patch.object(SupabaseClient, "download_storage_file")
    @patch.object(SupabaseClient, "upload_storage_file")
    @patch.object(SupabaseClient, "set_file_status")
    @patch("convert_document.run_command")
    def test_process_single_file_transitions_to_failed_on_storage_upload_error(
        self, mock_run, mock_set_status, mock_upload, mock_download
    ):
        """
        When upload_storage_file fails on converted PDF, process_single_file
        must mark file conversion_status = 'failed' with error details.
        """
        mock_download.side_effect = lambda path, dest, timeout=60: dest.write_bytes(b"PK docx content") or True
        mock_upload.return_value = False  # Simulating 500/403 failure

        def fake_run(cmd, timeout=180):
            outdir = Path(cmd[cmd.index("--outdir") + 1])
            (outdir / "test.pdf").write_bytes(b"%PDF mock")
            return MagicMock()

        mock_run.side_effect = fake_run

        file_rec = {
            "id": "file-upload-fail",
            "name": "test.docx",
            "storage_path": "space/test.docx",
            "space_id": "space-uuid",
            "conversion_status": "pending"
        }

        success = process_single_file(self.client, file_rec)
        self.assertFalse(success)

        # Verify failed status was set
        mock_set_status.assert_called_with(
            file_rec,
            "failed",
            error_value="Failed to upload converted PDF to space-uuid/converted/file-upload-fail.pdf"
        )

    @patch.object(SupabaseClient, "download_storage_file")
    @patch.object(SupabaseClient, "set_file_status")
    def test_process_single_file_transitions_to_failed_on_storage_download_error(
        self, mock_set_status, mock_download
    ):
        """
        When download_storage_file fails (e.g. 403 or 404 from storage),
        process_single_file must mark conversion_status = 'failed'.
        """
        mock_download.return_value = False  # Download failed

        file_rec = {
            "id": "file-download-fail",
            "name": "test.docx",
            "storage_path": "space/test.docx",
            "conversion_status": "pending"
        }

        success = process_single_file(self.client, file_rec)
        self.assertFalse(success)

        mock_set_status.assert_called_with(
            file_rec,
            "failed",
            error_value="Failed to download storage file: space/test.docx"
        )


class AdversarialWorkflowTriggersAndCronTests(unittest.TestCase):
    """Verify workflow triggers, cron schedules, and backup table alignment against Requirement R4."""

    def setUp(self):
        self.workflows_dir = repo_root / ".github" / "workflows"

    def test_convert_document_triggers_and_concurrency(self):
        """Test .github/workflows/convert-document.yml triggers and cron."""
        wf_path = self.workflows_dir / "convert-document.yml"
        self.assertTrue(wf_path.exists())

        with open(wf_path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)

        on_block = data.get("on") or data.get(True)
        self.assertIsNotNone(on_block)

        # 1. repository_dispatch trigger
        self.assertIn("repository_dispatch", on_block)
        types = on_block["repository_dispatch"]["types"]
        self.assertIn("convert-document", types)

        # 2. workflow_dispatch trigger
        self.assertIn("workflow_dispatch", on_block)
        inputs = on_block["workflow_dispatch"].get("inputs", {})
        self.assertIn("file_id", inputs)
        self.assertIn("all_pending", inputs)

        # 3. schedule cron trigger
        self.assertIn("schedule", on_block)
        cron_expr = on_block["schedule"][0]["cron"]
        self.assertEqual(cron_expr, "0 */6 * * *", "Sweeper cron must run every 6 hours")

        # 4. Concurrency definition
        concurrency = data.get("concurrency")
        self.assertIsNotNone(concurrency)
        self.assertIn("group", concurrency)
        self.assertFalse(concurrency.get("cancel-in-progress", True))

        # 5. Font packages installed
        steps = data["jobs"]["convert-and-extract"]["steps"]
        install_step = next(s for s in steps if "Install LibreOffice" in s.get("name", ""))
        run_script = install_step["run"]
        self.assertIn("fonts-smc", run_script)
        self.assertIn("fonts-lohit-deva", run_script)
        self.assertIn("poppler-utils", run_script)

    def test_supabase_keepalive_triggers_and_cron(self):
        """Test .github/workflows/supabase-keepalive.yml triggers and 3-day cron."""
        wf_path = self.workflows_dir / "supabase-keepalive.yml"
        self.assertTrue(wf_path.exists())

        with open(wf_path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)

        on_block = data.get("on") or data.get(True)
        self.assertIsNotNone(on_block)

        # 1. schedule cron
        self.assertIn("schedule", on_block)
        cron_expr = on_block["schedule"][0]["cron"]
        self.assertEqual(cron_expr, "0 4 */3 * *", "Keepalive cron must run every 3 days at 04:00 UTC")

        # 2. workflow_dispatch
        self.assertIn("workflow_dispatch", on_block)

        # 3. RPC endpoint called
        steps = data["jobs"]["ping-supabase"]["steps"]
        ping_step = next(s for s in steps if "Keep-Alive" in s.get("name", ""))
        run_script = ping_step["run"]
        self.assertIn("/rest/v1/rpc/health_check_ping", run_script)
        self.assertIn("MAX_RETRIES", run_script)

    def test_supabase_backup_triggers_and_cron(self):
        """Test .github/workflows/supabase-backup.yml triggers and weekly Sunday cron."""
        wf_path = self.workflows_dir / "supabase-backup.yml"
        self.assertTrue(wf_path.exists())

        with open(wf_path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)

        on_block = data.get("on") or data.get(True)
        self.assertIsNotNone(on_block)

        # 1. schedule cron
        self.assertIn("schedule", on_block)
        cron_expr = on_block["schedule"][0]["cron"]
        self.assertEqual(cron_expr, "0 2 * * 0", "Backup cron must run Sundays at 02:00 UTC")

        # 2. workflow_dispatch
        self.assertIn("workflow_dispatch", on_block)

        # 3. Artifact retention
        steps = data["jobs"]["backup-metadata"]["steps"]
        artifact_step = next(s for s in steps if "upload-artifact" in s.get("uses", ""))
        self.assertEqual(artifact_step["with"]["retention-days"], 90)

    def test_backup_metadata_table_inventory_discrepancy(self):
        """
        Empirical check: Verify whether backup_metadata.py default table export
        matches the actual 10 relational tables in the project schema.
        
        Canonical 10 Family File Library tables (from PROJECT.md & Migration):
        ['spaces', 'members', 'invites', 'devices', 'pairing_codes', 'folders', 'files', 'notes', 'favorites', 'bookmarks']
        """
        canonical_tables = {
            "spaces", "members", "invites", "devices", "pairing_codes",
            "folders", "files", "notes", "favorites", "bookmarks"
        }
        self.assertEqual(set(FAMILY_FILE_LIBRARY_TABLES), canonical_tables)

        is_default_matching_family = (set(METADATA_TABLES) == canonical_tables)
        self.assertTrue(
            is_default_matching_family,
            "Remediation verified: METADATA_TABLES matches canonical FAMILY_FILE_LIBRARY_TABLES"
        )
        self.assertEqual(set(METADATA_TABLES), canonical_tables)
        self.assertEqual(METADATA_TABLES, FAMILY_FILE_LIBRARY_TABLES)


if __name__ == "__main__":
    unittest.main()
