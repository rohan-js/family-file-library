"""
Unit tests for scripts/convert_document.py.

Verifies:
1. SupabaseClient initialization, headers, and update_file_status PATCH method.
2. Status updating with schema column alignment (conversion_status, conversion_error, pdf_path, text_content).
3. Null-byte stripping from text content and error messages.
4. User profile isolation in LibreOffice execution (-env:UserInstallation=file://...).
5. Zero-byte input handling.
6. Native PDF bypass of LibreOffice conversion.
7. Scanned document handling (char_count == 0, ocr_needed == True).
8. Office format conversion and storage upload.
9. CLI argument parsing and error exit codes.
"""

import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, call, patch
import urllib.error

# Ensure scripts directory is on sys.path
repo_root = Path(__file__).resolve().parent.parent
if str(repo_root / "scripts") not in sys.path:
    sys.path.insert(0, str(repo_root / "scripts"))

import convert_document
from convert_document import (
    OFFICE_EXTENSIONS,
    PDF_EXTENSIONS,
    SupabaseClient,
    convert_office_to_pdf,
    extract_text_from_pdf,
    process_single_file,
)


class TestConvertDocument(unittest.TestCase):
    def setUp(self):
        self.base_url = "https://example.supabase.co"
        self.service_key = "test-secret-service-role-key"
        self.client = SupabaseClient(self.base_url, self.service_key, storage_bucket="family-files")

    def test_client_initialization_defaults(self):
        """SupabaseClient initializes with default bucket 'family-files'."""
        default_client = SupabaseClient(self.base_url, self.service_key)
        self.assertEqual(default_client.storage_bucket, "family-files")
        self.assertEqual(default_client.rest_url, f"{self.base_url}/rest/v1")
        self.assertEqual(default_client.storage_url, f"{self.base_url}/storage/v1")

    def test_client_headers(self):
        """Headers must include apikey and Bearer Authorization."""
        headers = self.client._headers({"Custom": "Header"})
        self.assertEqual(headers["apikey"], self.service_key)
        self.assertEqual(headers["Authorization"], f"Bearer {self.service_key}")
        self.assertEqual(headers["Custom"], "Header")

    @patch("urllib.request.urlopen")
    def test_update_file_status_patch_request(self, mock_urlopen):
        """update_file_status performs HTTP PATCH to /files?id=eq.{file_id} with Prefer: return=minimal."""
        mock_resp = MagicMock()
        mock_resp.status = 200
        mock_urlopen.return_value.__enter__.return_value = mock_resp

        updates = {"conversion_status": "ready", "pdf_path": "space/converted/1.pdf"}
        success = self.client.update_file_status("file-123", updates)

        self.assertTrue(success)
        mock_urlopen.assert_called_once()
        req = mock_urlopen.call_args[0][0]
        self.assertEqual(req.get_method(), "PATCH")
        self.assertEqual(req.full_url, f"{self.base_url}/rest/v1/files?id=eq.file-123")
        self.assertEqual(req.headers["Content-type"], "application/json")
        self.assertEqual(req.headers["Prefer"], "return=minimal")
        self.assertEqual(req.headers["Apikey"], self.service_key)
        self.assertEqual(json.loads(req.data.decode("utf-8")), updates)

    @patch("urllib.request.urlopen")
    def test_update_file_status_handles_http_error(self, mock_urlopen):
        """update_file_status returns False when HTTP error occurs without crashing."""
        err = urllib.error.HTTPError(
            url="https://example.supabase.co/rest/v1/files?id=eq.file-123",
            code=400,
            msg="Bad Request",
            hdrs={},
            fp=io.BytesIO(b'{"message": "column does not exist"}')
        )
        mock_urlopen.side_effect = err

        success = self.client.update_file_status("file-123", {"invalid_col": "val"})
        self.assertFalse(success)

    @patch.object(SupabaseClient, "update_file_status")
    def test_set_file_status_schema_alignment(self, mock_update):
        """set_file_status sets conversion_status, clears conversion_error, and updates canonical fields."""
        mock_update.return_value = True
        file_rec = {
            "id": "file-abc",
            "name": "test.docx",
            "conversion_status": "pending",
            "conversion_error": "previous error",
            "pdf_path": None,
            "text_content": None,
            "updated_at": "2026-01-01T00:00:00Z"
        }

        extra = {
            "pdf_path": "space/converted/file-abc.pdf",
            "text_content": "Extracted text content",
            "char_count": 22
        }

        res = self.client.set_file_status(file_rec, "ready", extra=extra)
        self.assertTrue(res)

        mock_update.assert_called_once()
        args = mock_update.call_args[0]
        self.assertEqual(args[0], "file-abc")
        payload = args[1]
        self.assertEqual(payload["conversion_status"], "ready")
        self.assertIsNone(payload["conversion_error"])
        self.assertEqual(payload["pdf_path"], "space/converted/file-abc.pdf")
        self.assertEqual(payload["text_content"], "Extracted text content")
        self.assertIn("updated_at", payload)

    @patch.object(SupabaseClient, "update_file_status")
    def test_set_file_status_null_byte_stripping(self, mock_update):
        """set_file_status strips null bytes (\x00) from both error_value and text_content."""
        mock_update.return_value = True
        file_rec = {
            "id": "file-null",
            "conversion_status": "processing",
            "conversion_error": None,
            "text_content": None
        }

        dirty_error = "Error\x00 in \x00processing"
        dirty_text = "Clean\x00 text\x00 preview"

        self.client.set_file_status(
            file_rec,
            "failed",
            error_value=dirty_error,
            extra={"text_content": dirty_text}
        )

        mock_update.assert_called_once()
        payload = mock_update.call_args[0][1]
        self.assertNotIn("\x00", payload["conversion_error"])
        self.assertEqual(payload["conversion_error"], "Error in processing")
        self.assertNotIn("\x00", payload["text_content"])
        self.assertEqual(payload["text_content"], "Clean text preview")

    @patch("urllib.request.urlopen")
    def test_get_file_record(self, mock_urlopen):
        """get_file_record fetches record by UUID."""
        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps([{"id": "uuid-1", "name": "doc.pdf"}]).encode("utf-8")
        mock_urlopen.return_value.__enter__.return_value = mock_resp

        rec = self.client.get_file_record("uuid-1")
        self.assertEqual(rec, {"id": "uuid-1", "name": "doc.pdf"})

    @patch("urllib.request.urlopen")
    def test_get_file_record_not_found(self, mock_urlopen):
        """get_file_record returns None when record does not exist."""
        mock_resp = MagicMock()
        mock_resp.read.return_value = b"[]"
        mock_urlopen.return_value.__enter__.return_value = mock_resp

        rec = self.client.get_file_record("uuid-missing")
        self.assertIsNone(rec)

    @patch("urllib.request.urlopen")
    def test_download_storage_file_url_and_bucket(self, mock_urlopen):
        """download_storage_file requests authenticated object endpoint with bucket 'family-files'."""
        mock_resp = MagicMock()
        mock_resp.read = io.BytesIO(b"file-content").read
        mock_urlopen.return_value.__enter__.return_value = mock_resp

        with tempfile.TemporaryDirectory() as td:
            dest = Path(td) / "downloaded.bin"
            success = self.client.download_storage_file("space-1/folder-1/doc.docx", dest)
            self.assertTrue(success)
            self.assertTrue(dest.exists())
            req = mock_urlopen.call_args[0][0]
            self.assertIn("/storage/v1/object/authenticated/family-files/space-1/folder-1/doc.docx", req.full_url)

    @patch("urllib.request.urlopen")
    def test_upload_storage_file_with_upsert(self, mock_urlopen):
        """upload_storage_file uploads with Content-Type and x-upsert: true."""
        mock_resp = MagicMock()
        mock_resp.status = 200
        mock_urlopen.return_value.__enter__.return_value = mock_resp

        with tempfile.TemporaryDirectory() as td:
            src = Path(td) / "test.pdf"
            src.write_bytes(b"%PDF-1.4 sample")

            success = self.client.upload_storage_file(
                "space-1/converted/f.pdf",
                src,
                "application/pdf"
            )
            self.assertTrue(success)
            req = mock_urlopen.call_args[0][0]
            self.assertEqual(req.headers["Content-type"], "application/pdf")
            self.assertEqual(req.headers["X-upsert"], "true")
            self.assertIn("/storage/v1/object/family-files/space-1/converted/f.pdf", req.full_url)

    @patch("convert_document.run_command")
    def test_convert_office_to_pdf_user_profile_isolation(self, mock_run):
        """convert_office_to_pdf passes isolated -env:UserInstallation=file://... argument."""
        with tempfile.TemporaryDirectory() as td:
            out_dir = Path(td) / "out"
            out_dir.mkdir()
            input_doc = Path(td) / "sample.docx"
            input_doc.write_bytes(b"PK fake docx")

            # Create the expected output PDF so existence check passes
            expected_pdf = out_dir / "sample.pdf"
            expected_pdf.write_bytes(b"%PDF-1.5 fake")

            res = convert_office_to_pdf(input_doc, out_dir)
            self.assertEqual(res, expected_pdf)

            mock_run.assert_called_once()
            cmd = mock_run.call_args[0][0]

            self.assertIn("--headless", cmd)
            self.assertIn("--convert-to", cmd)
            self.assertIn("pdf", cmd)

            # Check profile isolation argument
            user_arg = next(arg for arg in cmd if arg.startswith("-env:UserInstallation="))
            self.assertTrue(user_arg.startswith("-env:UserInstallation=file://"))
            self.assertIn("lo_profile", user_arg)

    @patch("convert_document.run_command")
    def test_convert_office_to_pdf_timeout_raises_runtime_error(self, mock_run):
        """Subprocess TimeoutExpired raises RuntimeError."""
        mock_run.side_effect = subprocess.TimeoutExpired(cmd=["libreoffice"], timeout=180)
        with tempfile.TemporaryDirectory() as td:
            with self.assertRaises(RuntimeError) as cm:
                convert_office_to_pdf(Path(td) / "doc.docx", Path(td) / "out")
            self.assertIn("timed out", str(cm.exception))

    @patch("convert_document.run_command")
    def test_extract_text_from_pdf_null_byte_sanitization(self, mock_run):
        """extract_text_from_pdf invokes pdftotext -layout and strips null bytes from disk."""
        with tempfile.TemporaryDirectory() as td:
            pdf_path = Path(td) / "input.pdf"
            pdf_path.write_bytes(b"%PDF dummy")
            txt_output = Path(td) / "output.txt"

            # Simulate pdftotext writing output with embedded null bytes
            def mock_side_effect(cmd, *args, **kwargs):
                with open(txt_output, "w", encoding="utf-8") as f:
                    f.write("Line 1\x00 with null\x00 bytes.")
                return MagicMock()

            mock_run.side_effect = mock_side_effect

            char_count = extract_text_from_pdf(pdf_path, txt_output)

            # Verify command arguments
            cmd = mock_run.call_args[0][0]
            self.assertEqual(cmd[0], "pdftotext")
            self.assertIn("-enc", cmd)
            self.assertIn("UTF-8", cmd)
            self.assertIn("-layout", cmd)

            # Verify file on disk was rewritten without null bytes
            with open(txt_output, "r", encoding="utf-8") as f:
                content = f.read()
            self.assertNotIn("\x00", content)
            self.assertEqual(content, "Line 1 with null bytes.")
            self.assertEqual(char_count, len(content.strip()))

    @patch.object(SupabaseClient, "download_storage_file")
    @patch.object(SupabaseClient, "set_file_status")
    def test_process_single_file_zero_byte_fails_cleanly(self, mock_set_status, mock_download):
        """Zero-byte file is flagged and marked failed with descriptive error."""
        def fake_download(storage_path, dest_path, timeout=60):
            dest_path.write_bytes(b"")  # 0 bytes
            return True

        mock_download.side_effect = fake_download
        file_rec = {
            "id": "file-empty",
            "name": "empty.docx",
            "storage_path": "space/empty.docx",
            "conversion_status": "pending"
        }

        res = process_single_file(self.client, file_rec)
        self.assertFalse(res)

        mock_set_status.assert_any_call(
            file_rec,
            "failed",
            error_value="Input file is 0 bytes (empty file)."
        )

    @patch.object(SupabaseClient, "set_file_status")
    def test_process_single_file_missing_storage_path(self, mock_set_status):
        """Record lacking storage_path fails immediately."""
        file_rec = {"id": "f-missing", "name": "no_path.docx", "storage_path": None}
        res = process_single_file(self.client, file_rec)
        self.assertFalse(res)
        mock_set_status.assert_called_with(
            file_rec,
            "failed",
            error_value="File record has no storage_path"
        )

    @patch.object(SupabaseClient, "download_storage_file")
    @patch.object(SupabaseClient, "upload_storage_file")
    @patch.object(SupabaseClient, "set_file_status")
    @patch("convert_document.extract_text_from_pdf")
    def test_process_single_file_already_pdf_skips_libreoffice(
        self, mock_extract, mock_set_status, mock_upload, mock_download
    ):
        """Native .pdf file skips LibreOffice conversion and reuses storage_path as pdf_path."""
        def fake_download(storage_path, dest_path, timeout=60):
            dest_path.write_bytes(b"%PDF-1.4 valid content")
            return True

        mock_download.side_effect = fake_download
        mock_upload.return_value = True
        mock_extract.return_value = 100

        file_rec = {
            "id": "pdf-123",
            "name": "already.pdf",
            "storage_path": "space/already.pdf",
            "space_id": "space-uuid"
        }

        with patch("convert_document.convert_office_to_pdf") as mock_lo:
            res = process_single_file(self.client, file_rec)
            self.assertTrue(res)
            mock_lo.assert_not_called()

        # Final status call must have pdf_path set to original storage_path
        final_call = mock_set_status.call_args_list[-1]
        self.assertEqual(final_call[0][1], "ready")
        extra_payload = final_call[1]["extra"]
        self.assertEqual(extra_payload["pdf_path"], "space/already.pdf")

    @patch.object(SupabaseClient, "download_storage_file")
    @patch.object(SupabaseClient, "set_file_status")
    def test_process_single_file_image_marked_ready_without_conversion(
        self, mock_set_status, mock_download
    ):
        """Image files (.jpg, .png) are marked ready without LibreOffice or text extraction."""
        def fake_download(storage_path, dest_path, timeout=60):
            dest_path.write_bytes(b"\x89PNG fake png")
            return True

        mock_download.side_effect = fake_download
        file_rec = {
            "id": "img-123",
            "name": "photo.jpg",
            "storage_path": "space/photo.jpg"
        }

        res = process_single_file(self.client, file_rec)
        self.assertTrue(res)
        final_call = mock_set_status.call_args_list[-1]
        self.assertEqual(final_call[0][1], "ready")

    def test_main_cli_missing_env_vars_exits_1(self):
        """main() exits with code 1 when SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing."""
        with patch.dict(os.environ, {}, clear=True):
            with patch("sys.argv", ["convert_document.py", "--file-id", "test-uuid"]):
                with self.assertRaises(SystemExit) as cm:
                    convert_document.main()
                self.assertEqual(cm.exception.code, 1)

    def test_main_cli_missing_target_exits_1(self):
        """main() exits with code 1 when neither --file-id nor --all-pending is provided."""
        env = {
            "SUPABASE_URL": "https://test.supabase.co",
            "SUPABASE_SERVICE_ROLE_KEY": "test-key"
        }
        with patch.dict(os.environ, env, clear=True):
            with patch("sys.argv", ["convert_document.py"]):
                with self.assertRaises(SystemExit) as cm:
                    convert_document.main()
                self.assertEqual(cm.exception.code, 1)

    @patch.object(SupabaseClient, "download_storage_file")
    @patch.object(SupabaseClient, "upload_storage_file")
    @patch.object(SupabaseClient, "set_file_status")
    @patch("convert_document.extract_text_from_pdf")
    def test_process_single_file_handles_missing_txt_output_file(
        self, mock_extract, mock_set_status, mock_upload, mock_download
    ):
        """When pdftotext does not produce txt_output file, conversion succeeds without FileNotFoundError."""
        def fake_download(storage_path, dest_path, timeout=60):
            dest_path.write_bytes(b"%PDF-1.4 dummy")
            return True

        mock_download.side_effect = fake_download
        mock_upload.return_value = True
        mock_extract.return_value = 0  # Does not create txt_output file on disk

        file_rec = {
            "id": "missing-txt-output-id",
            "name": "doc.pdf",
            "storage_path": "space-1/doc.pdf",
            "space_id": "space-1"
        }

        success = process_single_file(self.client, file_rec)
        self.assertTrue(success)
        txt_upload_calls = [
            c for c in mock_upload.call_args_list
            if str(c[0][0]).endswith(".txt")
        ]
        self.assertEqual(len(txt_upload_calls), 0)

        final_call = mock_set_status.call_args_list[-1]
        self.assertEqual(final_call[0][1], "ready")
        extra_payload = final_call[1]["extra"]
        self.assertIsNone(extra_payload.get("text_path"))
        self.assertFalse(extra_payload.get("has_text"))
        self.assertTrue(extra_payload.get("ocr_needed"))

    @patch.object(SupabaseClient, "download_storage_file")
    @patch.object(SupabaseClient, "upload_storage_file")
    @patch.object(SupabaseClient, "set_file_status")
    def test_process_single_file_uploads_text_with_clean_text_plain_mime_type(
        self, mock_set_status, mock_upload, mock_download
    ):
        """upload_storage_file for extracted text must use exact 'text/plain' without charset parameter."""
        def fake_download(storage_path, dest_path, timeout=60):
            dest_path.write_bytes(b"%PDF-1.4 dummy")
            return True

        mock_download.side_effect = fake_download
        mock_upload.return_value = True

        file_rec = {
            "id": "text-mime-check-id",
            "name": "doc.pdf",
            "storage_path": "space-1/doc.pdf",
            "space_id": "space-1"
        }

        def fake_extract(pdf_path, txt_path, timeout=60):
            txt_path.write_text("Extracted text sample", encoding="utf-8")
            return len("Extracted text sample")

        with patch("convert_document.extract_text_from_pdf", side_effect=fake_extract):
            success = process_single_file(self.client, file_rec)
            self.assertTrue(success)

        txt_upload_calls = [
            c for c in mock_upload.call_args_list
            if str(c[0][0]).endswith(".txt")
        ]
        self.assertEqual(len(txt_upload_calls), 1)
        mime_arg = txt_upload_calls[0][0][2]
        self.assertEqual(mime_arg, "text/plain")
        self.assertNotIn("charset", mime_arg)

    def test_client_initialization_empty_storage_bucket_fallback(self):
        """SupabaseClient falls back to 'family-files' when storage_bucket is empty string or None."""
        client_empty = SupabaseClient(self.base_url, self.service_key, storage_bucket="")
        self.assertEqual(client_empty.storage_bucket, "family-files")

        client_none = SupabaseClient(self.base_url, self.service_key, storage_bucket=None)
        self.assertEqual(client_none.storage_bucket, "family-files")

    @patch("convert_document.process_single_file", return_value=True)
    def test_main_cli_storage_bucket_empty_env_var_fallback(self, mock_process):
        """main() falls back to 'family-files' when STORAGE_BUCKET is empty string in env."""
        env = {
            "SUPABASE_URL": "https://test.supabase.co",
            "SUPABASE_SERVICE_ROLE_KEY": "test-key",
            "STORAGE_BUCKET": ""
        }
        with patch.dict(os.environ, env, clear=True):
            with patch("sys.argv", ["convert_document.py", "--file-id", "test-uuid"]):
                with patch("convert_document.SupabaseClient") as mock_client_cls:
                    mock_inst = MagicMock()
                    mock_inst.get_file_record.return_value = {"id": "test-uuid", "name": "f.txt", "storage_path": "p"}
                    mock_client_cls.return_value = mock_inst
                    with self.assertRaises(SystemExit) as cm:
                        convert_document.main()
                    self.assertEqual(cm.exception.code, 0)
                    mock_client_cls.assert_called_once()
                    _, kwargs = mock_client_cls.call_args
                    self.assertEqual(kwargs.get("storage_bucket"), "family-files")

    @patch("urllib.request.urlopen")
    def test_get_pending_files_includes_deleted_at_is_null_filter(self, mock_urlopen):
        """get_pending_files appends &deleted_at=is.null to avoid converting soft-deleted records."""
        mock_resp = MagicMock()
        mock_resp.read.return_value = b"[]"
        mock_urlopen.return_value.__enter__.return_value = mock_resp

        self.client.get_pending_files(limit=10)
        mock_urlopen.assert_called_once()
        req = mock_urlopen.call_args[0][0]
        self.assertIn("deleted_at=is.null", req.full_url)


if __name__ == "__main__":
    unittest.main()
