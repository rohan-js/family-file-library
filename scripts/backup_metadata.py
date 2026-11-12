#!/usr/bin/env python3
"""
Weekly Metadata Backup Script for Android TV Family File Library.

Exports all PostgreSQL metadata tables from Supabase via PostgREST with pagination,
validates schema counts, compresses the data into a timestamped gzip JSON archive,
and outputs a backup summary.
"""

import argparse
import gzip
import json
import os
import sys
import urllib.parse
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

METADATA_TABLES = [
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

FAMILY_FILE_LIBRARY_TABLES = METADATA_TABLES


class SupabaseBackupClient:
    def __init__(self, base_url: str, service_role_key: str):
        self.base_url = base_url.rstrip("/")
        self.service_role_key = service_role_key
        self.rest_url = f"{self.base_url}/rest/v1"

    def _headers(self, start_range: int = 0, end_range: int = 999) -> Dict[str, str]:
        return {
            "apikey": self.service_role_key,
            "Authorization": f"Bearer {self.service_role_key}",
            "Accept": "application/json",
            "Range": f"{start_range}-{end_range}",
            "Prefer": "count=exact"
        }

    def fetch_table_data(
        self,
        table_name: str,
        batch_size: int = 1000,
        timeout: int = 30,
        order_by: Optional[str] = "id.asc",
        allow_missing: bool = False
    ) -> List[Dict[str, Any]]:
        """Fetch all records from a table with pagination using PostgREST Range headers."""
        all_records: List[Dict[str, Any]] = []
        start = 0

        while True:
            end = start + batch_size - 1
            headers = self._headers(start_range=start, end_range=end)
            order_param = f"&order={order_by}" if order_by else ""
            url = f"{self.rest_url}/{table_name}?select=*{order_param}"

            req = urllib.request.Request(url, headers=headers)
            try:
                with urllib.request.urlopen(req, timeout=timeout) as resp:
                    # PostgREST responds with 200 OK or 206 Partial Content
                    content_range = resp.headers.get("Content-Range", "")
                    raw_data = resp.read().decode("utf-8")
                    data = json.loads(raw_data) if raw_data else []

                    if not data:
                        break

                    all_records.extend(data)

                    # Content-Range format: 0-999/2500 or */0
                    if "/" in content_range:
                        total_str = content_range.split("/")[1].strip()
                        if total_str.isdigit() and len(all_records) >= int(total_str):
                            break

                    if len(data) < batch_size:
                        break

                    start += batch_size

            except urllib.error.HTTPError as e:
                # HTTP 416 Range Not Satisfiable indicates end of table reached
                if e.code == 416:
                    break
                elif e.code == 206:
                    # Handled in case HTTP 206 is raised as HTTPError by custom handlers/mocks
                    content_range = e.headers.get("Content-Range", "") if e.headers else ""
                    raw_data = e.read().decode("utf-8") if hasattr(e, "read") else ""
                    data = json.loads(raw_data) if raw_data else []
                    if not data:
                        break
                    all_records.extend(data)
                    if "/" in content_range:
                        total_str = content_range.split("/")[1].strip()
                        if total_str.isdigit() and len(all_records) >= int(total_str):
                            break
                    if len(data) < batch_size:
                        break
                    start += batch_size
                    continue
                # Handle non-existent tables: fail fast unless allow_missing is explicitly enabled
                elif e.code == 404:
                    if allow_missing:
                        sys.stderr.write(f"Warning: Table '{table_name}' does not exist (404). Skipping.\n")
                        return []
                    sys.stderr.write(f"Error: Required table '{table_name}' does not exist (404 Not Found).\n")
                    raise
                else:
                    sys.stderr.write(f"HTTPError fetching table '{table_name}': {e.code} {e.reason}\n")
                    raise

        return all_records


def prune_old_backups(backup_dir: Path, max_keep: int = 12):
    """Keep only the latest N backup archives to prevent repository or disk bloat.
    Sorts by filename (ISO timestamp in name) for deterministic retention in CI checkouts."""
    backup_files = sorted(backup_dir.glob("metadata_backup_*.json.gz"), key=lambda p: p.name)
    if len(backup_files) > max_keep:
        to_delete = backup_files[:-max_keep]
        for f in to_delete:
            sys.stdout.write(f"Pruning old backup: {f.name}\n")
            f.unlink()


def main():
    parser = argparse.ArgumentParser(description="Export Supabase metadata tables.")
    parser.add_argument("--output-dir", default="backups", help="Directory where backups are saved")
    parser.add_argument("--max-keep", type=int, default=12, help="Number of weekly backups to retain")
    parser.add_argument("--tables", nargs="*", default=None, help="Specific tables to back up (defaults to METADATA_TABLES)")
    parser.add_argument("--allow-missing", action="store_true", default=False, help="Allow non-existent tables (404) without failing backup job")
    args = parser.parse_args()

    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

    if not supabase_url or not supabase_key:
        sys.stderr.write("Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.\n")
        sys.exit(1)

    client = SupabaseBackupClient(supabase_url, supabase_key)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d_%H%M%SZ")
    archive_filename = f"metadata_backup_{timestamp}.json.gz"
    archive_path = output_dir / archive_filename

    sys.stdout.write(f"Starting metadata export at {timestamp}...\n")

    backup_data: Dict[str, Any] = {
        "metadata": {
            "exported_at": datetime.now(timezone.utc).isoformat(),
            "supabase_project_url": supabase_url,
            "version": "1.0"
        },
        "tables": {},
        "summary": {}
    }

    tables_to_export = args.tables if args.tables else METADATA_TABLES
    total_records = 0
    failed_tables: List[str] = []

    for table in tables_to_export:
        sys.stdout.write(f"Exporting table: {table}...")
        try:
            records = client.fetch_table_data(table, allow_missing=args.allow_missing)
            backup_data["tables"][table] = records
            backup_data["summary"][table] = len(records)
            total_records += len(records)
            sys.stdout.write(f" {len(records)} rows\n")
        except Exception as e:
            sys.stderr.write(f"\nFailed to export table '{table}': {e}\n")
            backup_data["summary"][table] = f"ERROR: {str(e)}"
            failed_tables.append(table)

    backup_data["metadata"]["total_records"] = total_records

    # Write compressed JSON file
    raw_json = json.dumps(backup_data, indent=2, ensure_ascii=False).encode("utf-8")
    with gzip.open(archive_path, "wb") as gz:
        gz.write(raw_json)

    size_kb = archive_path.stat().st_size / 1024.0
    sys.stdout.write(f"Archive: {archive_path.as_posix()}\n")
    sys.stdout.write(f"Compressed Size: {size_kb:.2f} KB | Total Rows: {total_records}\n")

    # Prune old archives
    prune_old_backups(output_dir, max_keep=args.max_keep)

    if failed_tables:
        sys.stderr.write(f"\n❌ Backup completed with errors! Failed tables: {', '.join(failed_tables)}\n")
        sys.exit(1)
    else:
        sys.stdout.write(f"\n✅ Backup completed successfully!\n")
        sys.exit(0)


if __name__ == "__main__":
    main()
