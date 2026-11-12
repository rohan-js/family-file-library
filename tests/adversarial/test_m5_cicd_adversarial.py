"""
Empirical Adversarial Stress Test Suite for Milestone 5: CI/CD Workflows & Scripts.
Challenger 1 — Milestone 5 (CI/CD Workflows & Scripts).

Stress-tests:
1. scripts/convert_document.py:
   - CLI edge cases: missing env vars, empty env vars, no args, empty string file-id, unrecognized args
   - Null byte stripping in conversion errors, text content, and disk-extracted text
   - Network dropouts and HTTP error handling
   - 0-byte file inputs, LibreOffice timeouts, scanned PDFs, non-office formats
2. scripts/backup_metadata.py:
   - CLI edge cases: missing env vars, empty env vars, unrecognized args
   - PostgREST pagination boundary stress: 0 rows, 999 rows, 1000 rows (with & without Content-Range),
     1001 rows, 2500 rows
   - PostgREST error injection: simulated HTTP 416, HTTP 500, network dropouts (URLError)
   - Archive pruning edge cases: 0 archives, exactly 12 archives, 13 archives, 50 archives
   - Archive pruning determinism: filename-based sorting invariant under randomized/reversed mtime
   - Boundary value analysis for max_keep (e.g., max_keep=0)
3. Strict YAML validation of all 3 workflow files:
   - Custom strict loader detecting duplicate keys in mappings
   - Schema and cron expression verification
   - Security permissions and secret references
"""

import gzip
import io
import json
import os
import re
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock, call, patch
import urllib.error
import yaml

# Ensure repo root and scripts are on sys.path
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
SCRIPTS_DIR = REPO_ROOT / "scripts"
WORKFLOWS_DIR = REPO_ROOT / ".github" / "workflows"

if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import convert_document
from convert_document import SupabaseClient, process_single_file
import backup_metadata
from backup_metadata import SupabaseBackupClient, prune_old_backups, METADATA_TABLES


# ==============================================================================
# Strict YAML Parser (Catches duplicate mapping keys forbidden by YAML 1.2)
# ==============================================================================
class StrictYamlLoader(yaml.SafeLoader):
    """YAML Loader that enforces strict unique mapping keys."""
    pass


def _construct_strict_mapping(loader, node, deep=False):
    loader.flatten_mapping(node)
    mapping = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if key in mapping:
            raise yaml.constructor.ConstructorError(
                "while constructing a mapping",
                node.start_mark,
                f"found duplicate key '{key}' in YAML document",
                key_node.start_mark
            )
        mapping[key] = loader.construct_object(value_node, deep=deep)
    return mapping


StrictYamlLoader.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG,
    _construct_strict_mapping
)


# ==============================================================================
# 1. Adversarial Stress Tests: scripts/convert_document.py
# ==============================================================================
class TestConvertDocumentAdversarial(unittest.TestCase):
    """Empirical adversarial stress testing for convert_document.py."""

    def setUp(self):
        self.base_url = "https://mock.supabase.co"
        self.service_key = "mock-service-role-key-secret"
        self.client = SupabaseClient(self.base_url, self.service_key, storage_bucket="family-files")

    def test_cli_missing_supabase_url_exits_1(self):
        """CLI exits with code 1 when SUPABASE_URL is omitted."""
        with patch.dict(os.environ, {"SUPABASE_SERVICE_ROLE_KEY": "valid_key"}, clear=True):
            with patch("sys.argv", ["convert_document.py", "--all-pending"]):
                with self.assertRaises(SystemExit) as cm:
                    convert_document.main()
                self.assertEqual(cm.exception.code, 1)

    def test_cli_missing_supabase_key_exits_1(self):
        """CLI exits with code 1 when SUPABASE_SERVICE_ROLE_KEY is omitted."""
        with patch.dict(os.environ, {"SUPABASE_URL": "https://example.supabase.co"}, clear=True):
            with patch("sys.argv", ["convert_document.py", "--all-pending"]):
                with self.assertRaises(SystemExit) as cm:
                    convert_document.main()
                self.assertEqual(cm.exception.code, 1)

    def test_cli_empty_env_vars_exits_1(self):
        """CLI exits with code 1 when SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY are empty strings."""
        with patch.dict(os.environ, {"SUPABASE_URL": "", "SUPABASE_SERVICE_ROLE_KEY": ""}, clear=True):
            with patch("sys.argv", ["convert_document.py", "--all-pending"]):
                with self.assertRaises(SystemExit) as cm:
                    convert_document.main()
                self.assertEqual(cm.exception.code, 1)

    def test_cli_no_args_exits_1(self):
        """CLI exits with code 1 when neither --file-id nor --all-pending is supplied."""
        with patch.dict(os.environ, {
            "SUPABASE_URL": "https://example.supabase.co",
            "SUPABASE_SERVICE_ROLE_KEY": "valid_key"
        }, clear=True):
            with patch("sys.argv", ["convert_document.py"]):
                with self.assertRaises(SystemExit) as cm:
                    convert_document.main()
                self.assertEqual(cm.exception.code, 1)

    def test_cli_unrecognized_argument_exits_2(self):
        """CLI exits with code 2 (argparse error) when unrecognized arguments are passed."""
        with patch.dict(os.environ, {
            "SUPABASE_URL": "https://example.supabase.co",
            "SUPABASE_SERVICE_ROLE_KEY": "valid_key"
        }, clear=True):
            with patch("sys.argv", ["convert_document.py", "--unexpected-flag-12345"]):
                with self.assertRaises(SystemExit) as cm:
                    convert_document.main()
                self.assertEqual(cm.exception.code, 2)

    def test_cli_empty_string_file_id_exits_1(self):
        """CLI exits with code 1 when --file-id is provided as an empty string."""
        with patch.dict(os.environ, {
            "SUPABASE_URL": "https://example.supabase.co",
            "SUPABASE_SERVICE_ROLE_KEY": "valid_key"
        }, clear=True):
            with patch("sys.argv", ["convert_document.py", "--file-id", ""]):
                with self.assertRaises(SystemExit) as cm:
                    convert_document.main()
                self.assertEqual(cm.exception.code, 1)

    @patch.object(SupabaseClient, "get_file_record", return_value=None)
    def test_cli_file_not_found_exits_1(self, mock_get_record):
        """CLI exits with code 1 when requested file UUID is not found in database."""
        with patch.dict(os.environ, {
            "SUPABASE_URL": "https://example.supabase.co",
            "SUPABASE_SERVICE_ROLE_KEY": "valid_key"
        }, clear=True):
            with patch("sys.argv", ["convert_document.py", "--file-id", "nonexistent-uuid-999"]):
                with self.assertRaises(SystemExit) as cm:
                    convert_document.main()
                self.assertEqual(cm.exception.code, 1)

    @patch("urllib.request.urlopen")
    def test_null_byte_in_conversion_error_stripped(self, mock_urlopen):
        """Null bytes embedded in conversion error strings must be stripped before DB PATCH."""
        mock_resp = MagicMock()
        mock_resp.status = 200
        mock_urlopen.return_value.__enter__.return_value = mock_resp

        file_record = {"id": "f-null-err", "conversion_error": "old", "conversion_status": "processing"}
        malicious_error = "Fatal\x00error:\x00corrupt\x00stream\x00"

        success = self.client.set_file_status(file_record, "failed", error_value=malicious_error)
        self.assertTrue(success)

        req = mock_urlopen.call_args[0][0]
        payload = json.loads(req.data.decode("utf-8"))
        self.assertNotIn("\x00", payload["conversion_error"])
        self.assertEqual(payload["conversion_error"], "Fatalerror:corruptstream")

    @patch("urllib.request.urlopen")
    def test_null_byte_in_text_content_stripped(self, mock_urlopen):
        """Null bytes in text_content payload must be removed to prevent PostgreSQL text rejection."""
        mock_resp = MagicMock()
        mock_resp.status = 204
        mock_urlopen.return_value.__enter__.return_value = mock_resp

        file_record = {"id": "f-null-txt", "text_content": "init", "conversion_status": "processing"}
        dirty_text = "Sample\x00Malayalam\x00Text\x00With\x00Nulls"

        success = self.client.set_file_status(file_record, "ready", extra={"text_content": dirty_text})
        self.assertTrue(success)

        req = mock_urlopen.call_args[0][0]
        payload = json.loads(req.data.decode("utf-8"))
        self.assertNotIn("\x00", payload["text_content"])
        self.assertEqual(payload["text_content"], "SampleMalayalamTextWithNulls")

    def test_null_byte_in_extracted_pdf_text_sanitized_on_disk(self):
        """extract_text_from_pdf rewrites file content on disk when null bytes are detected."""
        with tempfile.TemporaryDirectory() as td:
            pdf_path = Path(td) / "dummy.pdf"
            pdf_path.write_text("dummy")
            txt_path = Path(td) / "output.txt"

            def fake_run(cmd, timeout=60):
                # Simulate pdftotext emitting null bytes
                with open(txt_path, "w", encoding="utf-8") as f:
                    f.write("Line 1\x00Line 2\x00End")
                return subprocess.CompletedProcess(cmd, 0, "", "")

            with patch("convert_document.run_command", side_effect=fake_run):
                chars = convert_document.extract_text_from_pdf(pdf_path, txt_path)

            self.assertEqual(chars, len("Line 1Line 2End"))
            sanitized_disk_content = txt_path.read_text(encoding="utf-8")
            self.assertNotIn("\x00", sanitized_disk_content)
            self.assertEqual(sanitized_disk_content, "Line 1Line 2End")

    @patch.object(SupabaseClient, "download_storage_file")
    @patch.object(SupabaseClient, "set_file_status")
    def test_zero_byte_input_marks_failed_cleanly(self, mock_set_status, mock_download):
        """Zero-byte file input halts conversion immediately and marks status as failed."""
        def fake_download(storage_path, dest_path, timeout=60):
            dest_path.touch() # 0 bytes
            return True

        mock_download.side_effect = fake_download
        file_record = {
            "id": "zero-byte-file",
            "name": "empty.docx",
            "storage_path": "space1/empty.docx",
            "conversion_status": "pending"
        }

        result = process_single_file(self.client, file_record)
        self.assertFalse(result)
        mock_set_status.assert_has_calls([
            call(file_record, "processing"),
            call(file_record, "failed", error_value="Input file is 0 bytes (empty file).")
        ])

    @patch.object(SupabaseClient, "download_storage_file")
    @patch.object(SupabaseClient, "set_file_status")
    def test_corrupt_libreoffice_conversion_marks_failed(self, mock_set_status, mock_download):
        """LibreOffice subprocess failure triggers status 'failed' with error message."""
        def fake_download(storage_path, dest_path, timeout=60):
            dest_path.write_bytes(b"PK\x03\x04corrupt_office_stream")
            return True

        mock_download.side_effect = fake_download

        with patch("convert_document.run_command", side_effect=subprocess.CalledProcessError(1, "soffice", stderr="Corrupt document structure")):
            file_record = {
                "id": "corrupt-doc-1",
                "name": "corrupt.pptx",
                "storage_path": "space1/corrupt.pptx",
                "conversion_status": "pending"
            }
            result = process_single_file(self.client, file_record)
            self.assertFalse(result)

            # Final status must be 'failed'
            final_call = mock_set_status.call_args_list[-1]
            self.assertEqual(final_call[0][1], "failed")
            self.assertIn("Corrupt document structure", final_call[1]["error_value"])

    @patch.object(SupabaseClient, "download_storage_file")
    @patch.object(SupabaseClient, "upload_storage_file", return_value=True)
    @patch.object(SupabaseClient, "set_file_status")
    def test_scanned_pdf_zero_characters_marks_ready_with_ocr_needed(self, mock_set_status, mock_upload, mock_download):
        """Scanned PDF with 0 extractable characters marks status 'ready' and ocr_needed=True."""
        def fake_download(storage_path, dest_path, timeout=60):
            dest_path.write_bytes(b"%PDF-1.4 scanned image only")
            return True

        mock_download.side_effect = fake_download

        with patch("convert_document.extract_text_from_pdf", return_value=0):
            file_record = {
                "id": "scanned-pdf-1",
                "name": "invoice_scan.pdf",
                "storage_path": "space1/invoice_scan.pdf",
                "conversion_status": "pending"
            }
            result = process_single_file(self.client, file_record)
            self.assertTrue(result)

            final_call = mock_set_status.call_args_list[-1]
            self.assertEqual(final_call[0][1], "ready")
            extra = final_call[1]["extra"]
            self.assertTrue(extra["ocr_needed"])
            self.assertFalse(extra["has_text"])
            self.assertEqual(extra["char_count"], 0)
            self.assertIsNone(extra["text_content"])

    @patch.object(SupabaseClient, "download_storage_file")
    @patch.object(SupabaseClient, "set_file_status")
    def test_non_office_non_pdf_file_marked_ready_without_conversion(self, mock_set_status, mock_download):
        """Image and audio files (.jpg, .mp3) bypass LibreOffice and mark 'ready' immediately."""
        def fake_download(storage_path, dest_path, timeout=60):
            dest_path.write_bytes(b"\xff\xd8\xff\xe0 JPEG data")
            return True

        mock_download.side_effect = fake_download
        file_record = {
            "id": "photo-1",
            "name": "vacation.jpg",
            "storage_path": "space1/vacation.jpg",
            "conversion_status": "pending"
        }
        result = process_single_file(self.client, file_record)
        self.assertTrue(result)

        final_call = mock_set_status.call_args_list[-1]
        self.assertEqual(final_call[0][1], "ready")
        extra = final_call[1]["extra"]
        self.assertIsNone(extra["pdf_path"])
        self.assertFalse(extra["has_text"])

    @patch.object(SupabaseClient, "download_storage_file", return_value=False)
    @patch.object(SupabaseClient, "set_file_status")
    def test_storage_download_failure_marks_failed(self, mock_set_status, mock_download):
        """Storage download failure halts conversion and transitions file to 'failed'."""
        file_record = {
            "id": "missing-storage",
            "name": "doc.docx",
            "storage_path": "space1/missing.docx",
            "conversion_status": "pending"
        }
        result = process_single_file(self.client, file_record)
        self.assertFalse(result)

        final_call = mock_set_status.call_args_list[-1]
        self.assertEqual(final_call[0][1], "failed")
        self.assertIn("Failed to download storage file", final_call[1]["error_value"])

    @patch("urllib.request.urlopen")
    def test_get_file_record_network_dropout_raises_urlerror(self, mock_urlopen):
        """Empirical boundary: URLError (connection timeout/DNS) in get_file_record is unhandled by HTTPError catch."""
        # This empirically demonstrates that get_file_record only catches HTTPError, not base URLError
        mock_urlopen.side_effect = urllib.error.URLError("Connection refused: 127.0.0.1:54321")
        with self.assertRaises(urllib.error.URLError):
            self.client.get_file_record("any-file-id")


# ==============================================================================
# 2. Adversarial Stress Tests: scripts/backup_metadata.py
# ==============================================================================
class TestBackupMetadataAdversarial(unittest.TestCase):
    """Empirical adversarial stress testing for backup_metadata.py."""

    def setUp(self):
        self.base_url = "https://mock.supabase.co"
        self.service_key = "mock-backup-service-key"
        self.client = SupabaseBackupClient(self.base_url, self.service_key)

    def test_cli_missing_supabase_url_exits_1(self):
        """backup_metadata.py exits 1 when SUPABASE_URL is omitted."""
        with patch.dict(os.environ, {"SUPABASE_SERVICE_ROLE_KEY": "valid_key"}, clear=True):
            with patch("sys.argv", ["backup_metadata.py"]):
                with self.assertRaises(SystemExit) as cm:
                    backup_metadata.main()
                self.assertEqual(cm.exception.code, 1)

    def test_cli_missing_supabase_key_exits_1(self):
        """backup_metadata.py exits 1 when SUPABASE_SERVICE_ROLE_KEY is omitted."""
        with patch.dict(os.environ, {"SUPABASE_URL": "https://example.supabase.co"}, clear=True):
            with patch("sys.argv", ["backup_metadata.py"]):
                with self.assertRaises(SystemExit) as cm:
                    backup_metadata.main()
                self.assertEqual(cm.exception.code, 1)

    def test_cli_empty_env_vars_exits_1(self):
        """backup_metadata.py exits 1 when env vars are empty strings."""
        with patch.dict(os.environ, {"SUPABASE_URL": "", "SUPABASE_SERVICE_ROLE_KEY": ""}, clear=True):
            with patch("sys.argv", ["backup_metadata.py"]):
                with self.assertRaises(SystemExit) as cm:
                    backup_metadata.main()
                self.assertEqual(cm.exception.code, 1)

    def test_cli_unrecognized_argument_exits_2(self):
        """backup_metadata.py exits 2 on unrecognized arguments."""
        with patch.dict(os.environ, {
            "SUPABASE_URL": "https://example.supabase.co",
            "SUPABASE_SERVICE_ROLE_KEY": "valid_key"
        }, clear=True):
            with patch("sys.argv", ["backup_metadata.py", "--invalid-flag"]):
                with self.assertRaises(SystemExit) as cm:
                    backup_metadata.main()
                self.assertEqual(cm.exception.code, 2)

    # --------------------------------------------------------------------------
    # PostgREST Pagination Bounds Stress Testing
    # --------------------------------------------------------------------------
    @patch("urllib.request.urlopen")
    def test_postgrest_pagination_0_rows_empty_table(self, mock_urlopen):
        """Pagination boundary 0 rows: returns [] immediately without infinite loop."""
        mock_resp = MagicMock()
        mock_resp.headers = {"Content-Range": "*/0"}
        mock_resp.read.return_value = b"[]"
        mock_urlopen.return_value.__enter__.return_value = mock_resp

        data = self.client.fetch_table_data("empty_table", batch_size=1000)
        self.assertEqual(data, [])
        self.assertEqual(mock_urlopen.call_count, 1)

    @patch("urllib.request.urlopen")
    def test_postgrest_pagination_999_rows_single_page(self, mock_urlopen):
        """Pagination boundary 999 rows (batch_size - 1): single request, breaks cleanly."""
        rows = [{"id": f"r-{i}"} for i in range(999)]
        mock_resp = MagicMock()
        mock_resp.headers = {"Content-Range": "0-998/999"}
        mock_resp.read.return_value = json.dumps(rows).encode("utf-8")
        mock_urlopen.return_value.__enter__.return_value = mock_resp

        data = self.client.fetch_table_data("boundary_999", batch_size=1000)
        self.assertEqual(len(data), 999)
        self.assertEqual(mock_urlopen.call_count, 1)

    @patch("urllib.request.urlopen")
    def test_postgrest_pagination_1000_rows_with_content_range(self, mock_urlopen):
        """Pagination boundary exactly 1000 rows with Content-Range 0-999/1000: terminates after 1 page."""
        rows = [{"id": f"r-{i}"} for i in range(1000)]
        mock_resp = MagicMock()
        mock_resp.headers = {"Content-Range": "0-999/1000"}
        mock_resp.read.return_value = json.dumps(rows).encode("utf-8")
        mock_urlopen.return_value.__enter__.return_value = mock_resp

        data = self.client.fetch_table_data("boundary_1000", batch_size=1000)
        self.assertEqual(len(data), 1000)
        self.assertEqual(mock_urlopen.call_count, 1)

    @patch("urllib.request.urlopen")
    def test_postgrest_pagination_1000_rows_without_content_range(self, mock_urlopen):
        """Pagination boundary exactly 1000 rows without Content-Range: requests page 2, receives [], stops."""
        rows_page1 = [{"id": f"r-{i}"} for i in range(1000)]

        resp1 = MagicMock()
        resp1.headers = {}  # No Content-Range header
        resp1.read.return_value = json.dumps(rows_page1).encode("utf-8")

        resp2 = MagicMock()
        resp2.headers = {}
        resp2.read.return_value = b"[]"

        mock_urlopen.return_value.__enter__.side_effect = [resp1, resp2]

        data = self.client.fetch_table_data("boundary_1000_no_cr", batch_size=1000)
        self.assertEqual(len(data), 1000)
        self.assertEqual(mock_urlopen.call_count, 2)

    @patch("urllib.request.urlopen")
    def test_postgrest_pagination_1001_rows_boundary(self, mock_urlopen):
        """Pagination boundary 1001 rows: page 1 returns 1000, page 2 returns 1, total 1001."""
        page1 = [{"id": f"r-{i}"} for i in range(1000)]
        page2 = [{"id": "r-1000"}]

        resp1 = MagicMock()
        resp1.headers = {"Content-Range": "0-999/1001"}
        resp1.read.return_value = json.dumps(page1).encode("utf-8")

        resp2 = MagicMock()
        resp2.headers = {"Content-Range": "1000-1000/1001"}
        resp2.read.return_value = json.dumps(page2).encode("utf-8")

        mock_urlopen.return_value.__enter__.side_effect = [resp1, resp2]

        data = self.client.fetch_table_data("boundary_1001", batch_size=1000)
        self.assertEqual(len(data), 1001)
        self.assertEqual(mock_urlopen.call_count, 2)

    @patch("urllib.request.urlopen")
    def test_postgrest_pagination_2500_rows(self, mock_urlopen):
        """Pagination boundary 2500 rows: 3 pages (1000, 1000, 500)."""
        page1 = [{"id": f"r-{i}"} for i in range(1000)]
        page2 = [{"id": f"r-{i}"} for i in range(1000, 2000)]
        page3 = [{"id": f"r-{i}"} for i in range(2000, 2500)]

        resp1 = MagicMock()
        resp1.headers = {"Content-Range": "0-999/2500"}
        resp1.read.return_value = json.dumps(page1).encode("utf-8")

        resp2 = MagicMock()
        resp2.headers = {"Content-Range": "1000-1999/2500"}
        resp2.read.return_value = json.dumps(page2).encode("utf-8")

        resp3 = MagicMock()
        resp3.headers = {"Content-Range": "2000-2499/2500"}
        resp3.read.return_value = json.dumps(page3).encode("utf-8")

        mock_urlopen.return_value.__enter__.side_effect = [resp1, resp2, resp3]

        data = self.client.fetch_table_data("boundary_2500", batch_size=1000)
        self.assertEqual(len(data), 2500)
        self.assertEqual(mock_urlopen.call_count, 3)

    @patch("urllib.request.urlopen")
    def test_postgrest_simulated_http_416_clean_termination(self, mock_urlopen):
        """HTTP 416 (Range Not Satisfiable) signals end-of-table boundary and terminates cleanly."""
        err_416 = urllib.error.HTTPError(
            url="https://mock.supabase.co/rest/v1/files?select=*",
            code=416,
            msg="Range Not Satisfiable",
            hdrs={"Content-Range": "*/1000"},
            fp=io.BytesIO(b'{"message": "Requested range not satisfiable"}')
        )
        mock_urlopen.side_effect = err_416

        data = self.client.fetch_table_data("files", batch_size=1000)
        self.assertEqual(data, [])

    @patch("urllib.request.urlopen")
    def test_postgrest_simulated_http_500_server_error_logged_and_exits_1(self, mock_urlopen):
        """HTTP 500 triggers non-zero script exit code (sys.exit(1))."""
        err_500 = urllib.error.HTTPError(
            url="https://mock.supabase.co/rest/v1/files?select=*",
            code=500,
            msg="Internal Server Error",
            hdrs={},
            fp=io.BytesIO(b'{"message": "Database error"}')
        )
        mock_urlopen.side_effect = err_500

        with tempfile.TemporaryDirectory() as td:
            with patch.dict(os.environ, {
                "SUPABASE_URL": "https://example.supabase.co",
                "SUPABASE_SERVICE_ROLE_KEY": "valid_key"
            }, clear=True):
                with patch("sys.argv", ["backup_metadata.py", "--output-dir", td, "--tables", "files"]):
                    with self.assertRaises(SystemExit) as cm:
                        backup_metadata.main()
                    self.assertEqual(cm.exception.code, 1)

    @patch("urllib.request.urlopen")
    def test_postgrest_network_dropout_urlerror_handled_and_exits_1(self, mock_urlopen):
        """Network dropouts (URLError / socket.timeout) during backup cause script to exit with code 1."""
        mock_urlopen.side_effect = urllib.error.URLError(socket.timeout("The read operation timed out"))

        with tempfile.TemporaryDirectory() as td:
            with patch.dict(os.environ, {
                "SUPABASE_URL": "https://example.supabase.co",
                "SUPABASE_SERVICE_ROLE_KEY": "valid_key"
            }, clear=True):
                with patch("sys.argv", ["backup_metadata.py", "--output-dir", td, "--tables", "files"]):
                    with self.assertRaises(SystemExit) as cm:
                        backup_metadata.main()
                    self.assertEqual(cm.exception.code, 1)

    # --------------------------------------------------------------------------
    # Archive Pruning Stress Testing
    # --------------------------------------------------------------------------
    def test_archive_pruning_0_archives(self):
        """prune_old_backups does not fail when 0 archives exist."""
        with tempfile.TemporaryDirectory() as td:
            backup_dir = Path(td)
            prune_old_backups(backup_dir, max_keep=12)
            self.assertEqual(len(list(backup_dir.glob("*.json.gz"))), 0)

    def test_archive_pruning_exactly_12_archives(self):
        """prune_old_backups retains all 12 archives when count == max_keep."""
        with tempfile.TemporaryDirectory() as td:
            backup_dir = Path(td)
            for i in range(12):
                f = backup_dir / f"metadata_backup_2026-01-{i+1:02d}_000000Z.json.gz"
                f.touch()

            prune_old_backups(backup_dir, max_keep=12)
            remaining = list(backup_dir.glob("*.json.gz"))
            self.assertEqual(len(remaining), 12)

    def test_archive_pruning_13_archives_removes_oldest_1(self):
        """prune_old_backups removes exactly the 1 oldest archive when count == 13."""
        with tempfile.TemporaryDirectory() as td:
            backup_dir = Path(td)
            for i in range(13):
                f = backup_dir / f"metadata_backup_2026-01-{i+1:02d}_000000Z.json.gz"
                f.touch()

            prune_old_backups(backup_dir, max_keep=12)
            remaining = sorted([f.name for f in backup_dir.glob("*.json.gz")])
            self.assertEqual(len(remaining), 12)
            self.assertNotIn("metadata_backup_2026-01-01_000000Z.json.gz", remaining)
            self.assertIn("metadata_backup_2026-01-02_000000Z.json.gz", remaining)
            self.assertIn("metadata_backup_2026-01-13_000000Z.json.gz", remaining)

    def test_archive_pruning_50_archives_removes_oldest_38(self):
        """prune_old_backups removes oldest 38 archives when 50 archives exist."""
        with tempfile.TemporaryDirectory() as td:
            backup_dir = Path(td)
            for i in range(50):
                f = backup_dir / f"metadata_backup_2026-05-{i+1:02d}_120000Z.json.gz"
                f.touch()

            prune_old_backups(backup_dir, max_keep=12)
            remaining = sorted([f.name for f in backup_dir.glob("*.json.gz")])
            self.assertEqual(len(remaining), 12)
            # The 12 remaining should be 39 through 50
            expected_oldest_remaining = "metadata_backup_2026-05-39_120000Z.json.gz"
            expected_newest_remaining = "metadata_backup_2026-05-50_120000Z.json.gz"
            self.assertEqual(remaining[0], expected_oldest_remaining)
            self.assertEqual(remaining[-1], expected_newest_remaining)

    def test_archive_pruning_deterministic_sorting_by_filename_mtime_invariant(self):
        """
        Adversarial: Filesystem mtimes are inverted (newest filename has oldest mtime).
        prune_old_backups MUST delete by filename ISO timestamp, proving deterministic retention
        on fresh CI git clones where mtimes are identical or scrambled.
        """
        with tempfile.TemporaryDirectory() as td:
            backup_dir = Path(td)
            files = []
            now = time.time()

            for i in range(15):
                name = f"metadata_backup_2026-03-{i+1:02d}_020000Z.json.gz"
                p = backup_dir / name
                p.touch()
                # Invert mtime: file 1 gets newest mtime, file 15 gets oldest mtime
                inverted_mtime = now + (15 - i) * 100
                os.utime(p, (inverted_mtime, inverted_mtime))
                files.append(p)

            prune_old_backups(backup_dir, max_keep=12)
            remaining = sorted([f.name for f in backup_dir.glob("*.json.gz")])

            self.assertEqual(len(remaining), 12)
            # Must delete 2026-03-01, 2026-03-02, 2026-03-03 despite having highest mtimes!
            self.assertNotIn("metadata_backup_2026-03-01_020000Z.json.gz", remaining)
            self.assertNotIn("metadata_backup_2026-03-02_020000Z.json.gz", remaining)
            self.assertNotIn("metadata_backup_2026-03-03_020000Z.json.gz", remaining)
            self.assertIn("metadata_backup_2026-03-04_020000Z.json.gz", remaining)
            self.assertIn("metadata_backup_2026-03-15_020000Z.json.gz", remaining)

    def test_archive_pruning_boundary_max_keep_zero(self):
        """
        Empirical boundary: Python slice [:-0] evaluates to [:0] (empty list).
        With max_keep=0, prune_old_backups currently prunes 0 files because of [:-0].
        This test documents the empirical behavior of max_keep=0.
        """
        with tempfile.TemporaryDirectory() as td:
            backup_dir = Path(td)
            for i in range(5):
                (backup_dir / f"metadata_backup_2026-04-{i+1:02d}_000000Z.json.gz").touch()

            # Python's [:-0] slice evaluates to []
            prune_old_backups(backup_dir, max_keep=0)
            remaining = list(backup_dir.glob("*.json.gz"))
            # Documents current behavior: [:-0] retains files because slice is empty
            self.assertEqual(len(remaining), 5)


# ==============================================================================
# 3. Strict YAML Parsing & Workflow Verification
# ==============================================================================
class TestWorkflowYamlStrictValidation(unittest.TestCase):
    """Empirical strict YAML parsing and workflow architecture verification."""

    def setUp(self):
        self.workflow_paths = {
            "convert": WORKFLOWS_DIR / "convert-document.yml",
            "keepalive": WORKFLOWS_DIR / "supabase-keepalive.yml",
            "backup": WORKFLOWS_DIR / "supabase-backup.yml"
        }

    def test_strict_yaml_parsing_no_duplicate_keys(self):
        """All 3 workflow files must pass strict YAML parsing forbidding duplicate mapping keys."""
        for name, path in self.workflow_paths.items():
            self.assertTrue(path.exists(), f"Workflow file {path} must exist.")
            content = path.read_text(encoding="utf-8")

            # Must parse without ConstructorError for duplicate keys
            try:
                parsed = yaml.load(content, Loader=StrictYamlLoader)
                self.assertIsInstance(parsed, dict, f"{name} workflow should parse as a dictionary")
            except yaml.constructor.ConstructorError as e:
                self.fail(f"Workflow {path.name} contains duplicate YAML keys: {e}")
            except yaml.YAMLError as e:
                self.fail(f"Workflow {path.name} failed strict YAML parsing: {e}")

    def test_convert_document_workflow_structure_and_cron(self):
        """convert-document.yml matches required triggers, cron, permissions, and toolchain."""
        path = self.workflow_paths["convert"]
        content = path.read_text(encoding="utf-8")
        parsed = yaml.load(content, Loader=StrictYamlLoader)

        # Trigger verification
        # Note: In YAML 1.1 'on' is parsed as True
        triggers = parsed.get(True) or parsed.get("on")
        self.assertIsNotNone(triggers)
        self.assertIn("repository_dispatch", triggers)
        self.assertIn("workflow_dispatch", triggers)
        self.assertIn("schedule", triggers)

        # 6-hour cron sweeper
        cron_expr = triggers["schedule"][0]["cron"]
        self.assertEqual(cron_expr, "0 */6 * * *")

        # Permissions: contents: read
        self.assertEqual(parsed.get("permissions"), {"contents": "read"})

        # Jobs and steps
        jobs = parsed["jobs"]
        self.assertIn("convert-and-extract", jobs)
        job = jobs["convert-and-extract"]
        self.assertEqual(job["runs-on"], "ubuntu-latest")
        self.assertEqual(job["timeout-minutes"], 15)

        step_names = [s.get("name", "") for s in job["steps"]]
        self.assertTrue(any("LibreOffice" in name for name in step_names))
        self.assertTrue(any("Conversion" in name for name in step_names))

        # Check font packages installed
        all_runs = " ".join([s.get("run", "") for s in job["steps"]])
        self.assertIn("fonts-smc", all_runs)
        self.assertIn("fonts-lohit-deva", all_runs)
        self.assertIn("poppler-utils", all_runs)
        self.assertIn("libreoffice", all_runs)

    def test_supabase_keepalive_workflow_structure_and_cron(self):
        """supabase-keepalive.yml matches 3-day cron, ping logic, and permissions."""
        path = self.workflow_paths["keepalive"]
        content = path.read_text(encoding="utf-8")
        parsed = yaml.load(content, Loader=StrictYamlLoader)

        triggers = parsed.get(True) or parsed.get("on")
        self.assertIsNotNone(triggers)
        self.assertIn("schedule", triggers)
        self.assertIn("workflow_dispatch", triggers)

        cron_expr = triggers["schedule"][0]["cron"]
        self.assertEqual(cron_expr, "0 4 */3 * *")

        self.assertEqual(parsed.get("permissions"), {"contents": "read"})

        job = parsed["jobs"]["ping-supabase"]
        self.assertEqual(job["runs-on"], "ubuntu-latest")
        self.assertEqual(job["timeout-minutes"], 5)

        all_runs = " ".join([s.get("run", "") for s in job["steps"]])
        self.assertIn("health_check_ping", all_runs)
        # Check string comparison used for HTTP code safety
        self.assertIn('[ "$HTTP_CODE" = "200" ]', all_runs)

    def test_supabase_backup_workflow_structure_and_cron(self):
        """supabase-backup.yml matches weekly Sunday cron, write permissions, and skip ci commit."""
        path = self.workflow_paths["backup"]
        content = path.read_text(encoding="utf-8")
        parsed = yaml.load(content, Loader=StrictYamlLoader)

        triggers = parsed.get(True) or parsed.get("on")
        self.assertIsNotNone(triggers)
        self.assertIn("schedule", triggers)
        self.assertIn("workflow_dispatch", triggers)

        # Weekly Sunday at 02:00 UTC
        cron_expr = triggers["schedule"][0]["cron"]
        self.assertEqual(cron_expr, "0 2 * * 0")

        # Write permissions needed for git push
        self.assertEqual(parsed.get("permissions"), {"contents": "write"})

        job = parsed["jobs"]["backup-metadata"]
        self.assertEqual(job["runs-on"], "ubuntu-latest")
        self.assertEqual(job["timeout-minutes"], 10)

        step_names = [s.get("name", "") for s in job["steps"]]
        self.assertTrue(any("Export" in name for name in step_names))
        self.assertTrue(any("Artifact" in name for name in step_names))
        self.assertTrue(any("Commit and Push" in name for name in step_names))

        all_runs = " ".join([s.get("run", "") for s in job["steps"]])
        self.assertIn("scripts/backup_metadata.py", all_runs)
        self.assertIn("[skip ci]", all_runs)


if __name__ == "__main__":
    unittest.main()
