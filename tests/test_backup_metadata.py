"""
Unit tests for scripts/backup_metadata.py.

Verifies:
1. 10 metadata tables list coverage.
2. Header construction with Range and count=exact.
3. PostgREST pagination across single and multiple batches.
4. HTTP 200, 206, 416 (Range Not Satisfiable), and 404 handling.
5. Deterministic archive pruning by filename (ISO timestamp).
6. Gzip archive structure and decompression.
7. Process exit codes on success and failure.
"""

import gzip
import io
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch
import urllib.error

# Ensure scripts directory is on sys.path
repo_root = Path(__file__).resolve().parent.parent
if str(repo_root / "scripts") not in sys.path:
    sys.path.insert(0, str(repo_root / "scripts"))

import backup_metadata
from backup_metadata import METADATA_TABLES, SupabaseBackupClient, prune_old_backups


class TestBackupMetadata(unittest.TestCase):
    def setUp(self):
        self.base_url = "https://example.supabase.co"
        self.service_key = "test-service-key-secret"
        self.client = SupabaseBackupClient(self.base_url, self.service_key)

    def test_metadata_tables_count_and_names(self):
        """All 10 required family metadata tables must be present in METADATA_TABLES."""
        expected_tables = [
            "spaces",
            "members",
            "invites",
            "devices",
            "pairing_codes",
            "folders",
            "files",
            "notes",
            "favorites",
            "bookmarks"
        ]
        self.assertEqual(len(METADATA_TABLES), 10)
        self.assertEqual(METADATA_TABLES, expected_tables)
        if hasattr(backup_metadata, "FAMILY_FILE_LIBRARY_TABLES"):
            self.assertEqual(backup_metadata.FAMILY_FILE_LIBRARY_TABLES, expected_tables)

    def test_headers_construction(self):
        """Headers must include apikey, Bearer Authorization, Range, and Prefer: count=exact."""
        headers = self.client._headers(start_range=0, end_range=999)
        self.assertEqual(headers["apikey"], self.service_key)
        self.assertEqual(headers["Authorization"], f"Bearer {self.service_key}")
        self.assertEqual(headers["Range"], "0-999")
        self.assertEqual(headers["Prefer"], "count=exact")
        self.assertEqual(headers["Accept"], "application/json")

        headers_second = self.client._headers(start_range=1000, end_range=1999)
        self.assertEqual(headers_second["Range"], "1000-1999")

    @patch("urllib.request.urlopen")
    def test_fetch_table_data_single_page(self, mock_urlopen):
        """Table with fewer rows than batch_size returns all rows in one request."""
        sample_rows = [{"id": f"row-{i}", "val": f"data-{i}"} for i in range(50)]
        mock_resp = MagicMock()
        mock_resp.headers = {"Content-Range": "0-49/50"}
        mock_resp.read.return_value = json.dumps(sample_rows).encode("utf-8")
        mock_urlopen.return_value.__enter__.return_value = mock_resp

        data = self.client.fetch_table_data("folders", batch_size=1000)
        self.assertEqual(len(data), 50)
        self.assertEqual(data, sample_rows)
        self.assertEqual(mock_urlopen.call_count, 1)

    @patch("urllib.request.urlopen")
    def test_fetch_table_data_multi_page_pagination(self, mock_urlopen):
        """Table with 2500 rows is fetched across 3 paginated requests."""
        batch_1 = [{"id": f"row-{i}"} for i in range(1000)]
        batch_2 = [{"id": f"row-{i}"} for i in range(1000, 2000)]
        batch_3 = [{"id": f"row-{i}"} for i in range(2000, 2500)]

        resp1 = MagicMock()
        resp1.headers = {"Content-Range": "0-999/2500"}
        resp1.read.return_value = json.dumps(batch_1).encode("utf-8")

        resp2 = MagicMock()
        resp2.headers = {"Content-Range": "1000-1999/2500"}
        resp2.read.return_value = json.dumps(batch_2).encode("utf-8")

        resp3 = MagicMock()
        resp3.headers = {"Content-Range": "2000-2499/2500"}
        resp3.read.return_value = json.dumps(batch_3).encode("utf-8")

        mock_urlopen.return_value.__enter__.side_effect = [resp1, resp2, resp3]

        data = self.client.fetch_table_data("files", batch_size=1000)
        self.assertEqual(len(data), 2500)
        self.assertEqual(mock_urlopen.call_count, 3)

    @patch("urllib.request.urlopen")
    def test_fetch_table_data_handles_empty_table(self, mock_urlopen):
        """Empty table returning [] terminates immediately without errors."""
        resp = MagicMock()
        resp.headers = {"Content-Range": "*/0"}
        resp.read.return_value = b"[]"
        mock_urlopen.return_value.__enter__.return_value = resp

        data = self.client.fetch_table_data("notes", batch_size=1000)
        self.assertEqual(data, [])
        self.assertEqual(mock_urlopen.call_count, 1)

    @patch("urllib.request.urlopen")
    def test_fetch_table_data_handles_http_416_cleanly(self, mock_urlopen):
        """HTTP 416 Range Not Satisfiable terminates pagination cleanly without raising."""
        batch_1 = [{"id": f"row-{i}"} for i in range(1000)]
        resp1 = MagicMock()
        resp1.headers = {"Content-Range": "0-999/*"}
        resp1.read.return_value = json.dumps(batch_1).encode("utf-8")

        # Second request encounters out-of-range 416 error
        err_416 = urllib.error.HTTPError(
            url="https://example.supabase.co/rest/v1/files",
            code=416,
            msg="Requested Range Not Satisfiable",
            hdrs={"Content-Range": "*/1000"},
            fp=io.BytesIO(b'{"message": "Range not satisfiable"}')
        )

        mock_urlopen.side_effect = [
            MagicMock(__enter__=MagicMock(return_value=resp1), __exit__=MagicMock()),
            err_416
        ]

        data = self.client.fetch_table_data("files", batch_size=1000)
        self.assertEqual(len(data), 1000)

    @patch("urllib.request.urlopen")
    def test_fetch_table_data_handles_http_206_partial_content(self, mock_urlopen):
        """HTTP 206 Partial Content is accepted and parsed seamlessly."""
        batch = [{"id": "row-1"}, {"id": "row-2"}]
        resp = MagicMock()
        resp.headers = {"Content-Range": "0-1/2"}
        resp.status = 206
        resp.read.return_value = json.dumps(batch).encode("utf-8")
        mock_urlopen.return_value.__enter__.return_value = resp

        data = self.client.fetch_table_data("favorites", batch_size=1000)
        self.assertEqual(len(data), 2)

    @patch("urllib.request.urlopen")
    def test_fetch_table_data_handles_http_404_when_allowed(self, mock_urlopen):
        """Missing table (404) returns [] when allow_missing=True."""
        err_404 = urllib.error.HTTPError(
            url="https://example.supabase.co/rest/v1/missing_table",
            code=404,
            msg="Not Found",
            hdrs={},
            fp=io.BytesIO(b'{"message": "relation does not exist"}')
        )
        mock_urlopen.side_effect = err_404

        data = self.client.fetch_table_data("missing_table", allow_missing=True)
        self.assertEqual(data, [])

    @patch("urllib.request.urlopen")
    def test_fetch_table_data_raises_http_404_by_default(self, mock_urlopen):
        """Missing table (404) raises HTTPError by default to prevent silent backup loss."""
        err_404 = urllib.error.HTTPError(
            url="https://example.supabase.co/rest/v1/missing_table",
            code=404,
            msg="Not Found",
            hdrs={},
            fp=io.BytesIO(b'{"message": "relation does not exist"}')
        )
        mock_urlopen.side_effect = err_404

        with self.assertRaises(urllib.error.HTTPError):
            self.client.fetch_table_data("missing_table")

    @patch("urllib.request.urlopen")
    def test_fetch_table_data_deterministic_order_parameter(self, mock_urlopen):
        """fetch_table_data must append &order=id.asc for deterministic PostgREST pagination."""
        mock_resp = MagicMock()
        mock_resp.headers = {"Content-Range": "0-0/1"}
        mock_resp.read.return_value = b'[{"id": "space-1"}]'
        mock_urlopen.return_value.__enter__.return_value = mock_resp

        self.client.fetch_table_data("spaces", batch_size=1000)
        mock_urlopen.assert_called_once()
        req = mock_urlopen.call_args[0][0]
        self.assertIn("order=id.asc", req.full_url)
        self.assertIn(f"{self.base_url}/rest/v1/spaces?select=*&order=id.asc", req.full_url)

    @patch("urllib.request.urlopen")
    def test_fetch_table_data_re_raises_server_errors(self, mock_urlopen):
        """HTTP 500 or network exceptions must be re-raised to trigger retry or alert."""
        err_500 = urllib.error.HTTPError(
            url="https://example.supabase.co/rest/v1/files",
            code=500,
            msg="Internal Server Error",
            hdrs={},
            fp=io.BytesIO(b"Internal Error")
        )
        mock_urlopen.side_effect = err_500

        with self.assertRaises(urllib.error.HTTPError):
            self.client.fetch_table_data("files")

    def test_prune_old_backups_deterministic_by_filename(self):
        """Pruning sorts by ISO timestamp in filename, ignoring filesystem modification times."""
        with tempfile.TemporaryDirectory() as td:
            dir_path = Path(td)
            created_files = []

            # Create 15 synthetic backup files with ISO timestamps in names:
            # 2026-01-01 to 2026-01-15
            for i in range(1, 16):
                fn = dir_path / f"metadata_backup_2026-01-{i:02d}_020000Z.json.gz"
                fn.write_bytes(b"dummy")
                created_files.append(fn)

            # Invert mtimes deliberately: give the oldest file the newest mtime!
            now = time.time()
            for idx, f in enumerate(created_files):
                # idx 0 (oldest filename 2026-01-01) gets highest mtime
                os.utime(f, (now + (15 - idx) * 100, now + (15 - idx) * 100))

            # Prune to max 12
            prune_old_backups(dir_path, max_keep=12)

            remaining = sorted(dir_path.glob("metadata_backup_*.json.gz"), key=lambda p: p.name)
            self.assertEqual(len(remaining), 12)

            # The 3 oldest filenames (2026-01-01, 2026-01-02, 2026-01-03) must be deleted
            remaining_names = [f.name for f in remaining]
            self.assertNotIn("metadata_backup_2026-01-01_020000Z.json.gz", remaining_names)
            self.assertNotIn("metadata_backup_2026-01-02_020000Z.json.gz", remaining_names)
            self.assertNotIn("metadata_backup_2026-01-03_020000Z.json.gz", remaining_names)
            self.assertIn("metadata_backup_2026-01-04_020000Z.json.gz", remaining_names)
            self.assertIn("metadata_backup_2026-01-15_020000Z.json.gz", remaining_names)

    def test_prune_old_backups_under_limit_retains_all(self):
        """When number of backups is <= max_keep, no files are unlinked."""
        with tempfile.TemporaryDirectory() as td:
            dir_path = Path(td)
            for i in range(1, 6):
                (dir_path / f"metadata_backup_2026-02-{i:02d}_020000Z.json.gz").write_bytes(b"dummy")

            prune_old_backups(dir_path, max_keep=12)
            self.assertEqual(len(list(dir_path.glob("*.json.gz"))), 5)

    @patch("backup_metadata.SupabaseBackupClient.fetch_table_data")
    def test_main_successful_backup_creates_valid_gzip_json(self, mock_fetch):
        """Successful backup execution outputs valid compressed JSON with summary metadata."""
        mock_fetch.return_value = [{"id": "1", "data": "sample"}]

        with tempfile.TemporaryDirectory() as td:
            test_env = {
                "SUPABASE_URL": "https://test.supabase.co",
                "SUPABASE_SERVICE_ROLE_KEY": "test-key"
            }
            with patch.dict(os.environ, test_env, clear=True):
                with patch("sys.argv", ["backup_metadata.py", "--output-dir", td, "--tables", "files", "notes"]):
                    with self.assertRaises(SystemExit) as cm:
                        backup_metadata.main()
                    self.assertEqual(cm.exception.code, 0)

            archives = list(Path(td).glob("metadata_backup_*.json.gz"))
            self.assertEqual(len(archives), 1)

            # Decompress and verify JSON
            with gzip.open(archives[0], "rb") as gz:
                data = json.loads(gz.read().decode("utf-8"))

            self.assertIn("metadata", data)
            self.assertIn("tables", data)
            self.assertIn("summary", data)
            self.assertEqual(data["metadata"]["supabase_project_url"], "https://test.supabase.co")
            self.assertEqual(data["metadata"]["total_records"], 2)
            self.assertEqual(data["summary"]["files"], 1)
            self.assertEqual(data["summary"]["notes"], 1)

    @patch("backup_metadata.SupabaseBackupClient.fetch_table_data")
    def test_main_exits_with_error_code_on_table_failure(self, mock_fetch):
        """If any table export fails, script must exit with status code 1."""
        def side_effect(table_name, *args, **kwargs):
            if table_name == "files":
                raise RuntimeError("Postgres connection dropped")
            return [{"id": "ok"}]

        mock_fetch.side_effect = side_effect

        with tempfile.TemporaryDirectory() as td:
            test_env = {
                "SUPABASE_URL": "https://test.supabase.co",
                "SUPABASE_SERVICE_ROLE_KEY": "test-key"
            }
            with patch.dict(os.environ, test_env, clear=True):
                with patch("sys.argv", ["backup_metadata.py", "--output-dir", td, "--tables", "files", "notes"]):
                    with self.assertRaises(SystemExit) as cm:
                        backup_metadata.main()
                    self.assertEqual(cm.exception.code, 1)

    @patch("backup_metadata.SupabaseBackupClient.fetch_table_data")
    def test_main_defaults_to_all_10_canonical_tables_when_tables_omitted(self, mock_fetch):
        """When --tables is omitted, main() exports all 10 canonical family metadata tables."""
        mock_fetch.return_value = []
        with tempfile.TemporaryDirectory() as td:
            test_env = {
                "SUPABASE_URL": "https://test.supabase.co",
                "SUPABASE_SERVICE_ROLE_KEY": "test-key"
            }
            with patch.dict(os.environ, test_env, clear=True):
                with patch("sys.argv", ["backup_metadata.py", "--output-dir", td]):
                    with self.assertRaises(SystemExit) as cm:
                        backup_metadata.main()
                    self.assertEqual(cm.exception.code, 0)

        called_tables = [c[0][0] for c in mock_fetch.call_args_list]
        expected_tables = [
            "spaces", "members", "invites", "devices", "pairing_codes",
            "folders", "files", "notes", "favorites", "bookmarks"
        ]
        self.assertEqual(called_tables, expected_tables)

    def test_main_exits_error_when_env_vars_missing(self):
        """Script exits with code 1 when required environment variables are absent."""
        with patch.dict(os.environ, {}, clear=True):
            with patch("sys.argv", ["backup_metadata.py"]):
                with self.assertRaises(SystemExit) as cm:
                    backup_metadata.main()
                self.assertEqual(cm.exception.code, 1)


if __name__ == "__main__":
    unittest.main()
