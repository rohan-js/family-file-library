#!/usr/bin/env python3
"""
Office Document Conversion & PDF Text Extraction Pipeline for Android TV Family File Library.

Converts office documents (.docx, .doc, .pptx, .ppt, .xlsx, .xls, .odt, .ods, .odp) to PDF
using headless LibreOffice with Indic language fonts, extracts full UTF-8 text via pdftotext
for TV read-aloud and FTS indexing, uploads artifacts to Supabase Storage, and updates file metadata.
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
import urllib.parse
import urllib.request
import urllib.error

# Supported office formats mapped to conversion flag
OFFICE_EXTENSIONS = {
    ".docx", ".doc", ".pptx", ".ppt", ".xlsx", ".xls",
    ".odt", ".ods", ".odp", ".rtf", ".csv"
}

PDF_EXTENSIONS = {".pdf"}


class SupabaseClient:
    """Lightweight Supabase client using standard library urllib to avoid heavy dependencies."""

    def __init__(self, base_url: str, service_role_key: str, storage_bucket: Optional[str] = None):
        self.base_url = base_url.rstrip("/")
        self.service_role_key = service_role_key
        self.storage_bucket = storage_bucket or os.getenv("STORAGE_BUCKET") or "family-files"
        self.rest_url = f"{self.base_url}/rest/v1"
        self.storage_url = f"{self.base_url}/storage/v1"

    def _headers(self, extra: Optional[Dict[str, str]] = None) -> Dict[str, str]:
        headers = {
            "apikey": self.service_role_key,
            "Authorization": f"Bearer {self.service_role_key}",
        }
        if extra:
            headers.update(extra)
        return headers

    def get_file_record(self, file_id: str, timeout: int = 30) -> Optional[Dict[str, Any]]:
        """Fetch file metadata by UUID."""
        url = f"{self.rest_url}/files?id=eq.{file_id}&select=*"
        req = urllib.request.Request(url, headers=self._headers({"Accept": "application/json"}))
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                return data[0] if data else None
        except urllib.error.HTTPError as e:
            sys.stderr.write(f"HTTPError fetching file record: {e.code} {e.reason}\n")
            return None

    def get_pending_files(self, limit: int = 20, timeout: int = 30) -> List[Dict[str, Any]]:
        """Fetch pending/stuck processing files needing conversion."""
        # Try conversion_status first, fallback to status
        for status_col in ("conversion_status", "status"):
            url = f"{self.rest_url}/files?{status_col}=in.(pending,processing)&deleted_at=is.null&order=created_at.asc&limit={limit}&select=*"
            req = urllib.request.Request(url, headers=self._headers({"Accept": "application/json"}))
            try:
                with urllib.request.urlopen(req, timeout=timeout) as resp:
                    return json.loads(resp.read().decode("utf-8"))
            except urllib.error.HTTPError as e:
                if e.code == 400:
                    continue # Column might not exist, try next
                sys.stderr.write(f"HTTPError fetching pending files via {status_col}: {e.code} {e.reason}\n")
        return []

    def update_file_status(self, file_id: str, updates: Dict[str, Any], timeout: int = 30) -> bool:
        """Update file metadata record via PostgREST PATCH."""
        url = f"{self.rest_url}/files?id=eq.{file_id}"
        data = json.dumps(updates).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=data,
            headers=self._headers({
                "Content-Type": "application/json",
                "Prefer": "return=minimal"
            }),
            method="PATCH"
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.status in (200, 204)
        except urllib.error.HTTPError as e:
            sys.stderr.write(f"HTTPError updating file status {file_id}: {e.code} {e.reason}\n")
            try:
                err_body = e.read().decode("utf-8")
                sys.stderr.write(f"Error details: {err_body}\n")
            except Exception:
                pass
            return False
        except Exception as e:
            sys.stderr.write(f"Error updating file status {file_id}: {e}\n")
            return False

    def set_file_status(
        self,
        file_record: Dict[str, Any],
        status_value: str,
        error_value: Optional[str] = None,
        extra: Optional[Dict[str, Any]] = None
    ) -> bool:
        """Update file row matching columns that exist in the schema."""
        file_id = file_record["id"]
        updates: Dict[str, Any] = {}

        # Defensive status column mapping
        if "status" in file_record:
            updates["status"] = status_value
        if "conversion_status" in file_record or ("status" not in file_record and "conversion_status" not in file_record):
            updates["conversion_status"] = status_value

        if error_value is not None:
            clean_error = error_value.replace("\x00", "")[:1000]
            if "conversion_error" in file_record:
                updates["conversion_error"] = clean_error
            if "error_message" in file_record:
                updates["error_message"] = clean_error
            if "conversion_error" not in file_record and "error_message" not in file_record:
                updates["conversion_error"] = clean_error
        else:
            if "conversion_error" in file_record:
                updates["conversion_error"] = None
            if "error_message" in file_record:
                updates["error_message"] = None
            if "conversion_error" not in file_record and "error_message" not in file_record:
                updates["conversion_error"] = None

        if "updated_at" in file_record:
            updates["updated_at"] = datetime.now(timezone.utc).isoformat()

        if extra:
            for k, v in extra.items():
                # Filter null bytes from text content
                if k == "text_content" and isinstance(v, str):
                    v = v.replace("\x00", "")
                if k in file_record:
                    updates[k] = v
                elif k == "pdf_path" and "converted_pdf_path" in file_record:
                    updates["converted_pdf_path"] = v
                elif k == "text_path" and "extracted_text_path" in file_record:
                    updates["extracted_text_path"] = v
                elif k in ("pdf_path", "text_path", "text_content", "char_count", "has_text", "ocr_needed"):
                    # Support canonical schema columns even if file_record had partial keys
                    if k in ("pdf_path", "text_content"):
                        updates[k] = v

        return self.update_file_status(file_id, updates)

    def download_storage_file(self, storage_path: str, dest_path: Path, timeout: int = 60) -> bool:
        """Download file from Supabase Storage."""
        # Path encoding handling
        encoded_path = urllib.parse.quote(storage_path.lstrip("/"), safe="/")
        url = f"{self.storage_url}/object/authenticated/{self.storage_bucket}/{encoded_path}"
        req = urllib.request.Request(url, headers=self._headers())
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp, open(dest_path, "wb") as f:
                shutil.copyfileobj(resp, f)
            return True
        except urllib.error.HTTPError as e:
            # Try unauthenticated if public bucket
            alt_url = f"{self.storage_url}/object/{self.storage_bucket}/{encoded_path}"
            req_alt = urllib.request.Request(alt_url, headers=self._headers())
            try:
                with urllib.request.urlopen(req_alt, timeout=timeout) as resp, open(dest_path, "wb") as f:
                    shutil.copyfileobj(resp, f)
                return True
            except Exception as e2:
                sys.stderr.write(f"Failed to download storage file {storage_path}: {e2}\n")
                return False

    def upload_storage_file(self, target_path: str, src_path: Path, content_type: str, timeout: int = 60) -> bool:
        """Upload file to Supabase Storage with upsert."""
        encoded_path = urllib.parse.quote(target_path.lstrip("/"), safe="/")
        url = f"{self.storage_url}/object/{self.storage_bucket}/{encoded_path}"
        headers = self._headers({
            "Content-Type": content_type,
            "x-upsert": "true"
        })

        with open(src_path, "rb") as f:
            data = f.read()

        req = urllib.request.Request(url, data=data, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.status in (200, 201)
        except urllib.error.HTTPError as e:
            sys.stderr.write(f"Failed to upload {target_path}: {e.code} {e.reason}\n")
            try:
                err_body = e.read().decode("utf-8")
                sys.stderr.write(f"Error details: {err_body}\n")
            except Exception:
                pass
            return False


def run_command(cmd: List[str], timeout: int = 180) -> subprocess.CompletedProcess:
    """Execute command with timeout and capture output."""
    sys.stdout.write(f"Executing: {' '.join(cmd)}\n")
    sys.stdout.flush()
    return subprocess.run(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout,
        check=True,
        text=True
    )


def convert_office_to_pdf(input_path: Path, output_dir: Path, timeout: int = 180) -> Path:
    """
    Convert an office document to PDF using headless LibreOffice.
    Uses an isolated user profile directory to avoid instance locking.
    """
    profile_dir = output_dir / "lo_profile"
    profile_dir.mkdir(parents=True, exist_ok=True)
    user_install_arg = f"-env:UserInstallation={profile_dir.resolve().as_uri()}"

    lo_bin = "soffice" if not shutil.which("libreoffice") and shutil.which("soffice") else "libreoffice"

    cmd = [
        lo_bin,
        "--headless",
        "--nologo",
        "--nofirststartwizard",
        user_install_arg,
        "--convert-to", "pdf",
        "--outdir", str(output_dir),
        str(input_path)
    ]

    try:
        run_command(cmd, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise RuntimeError(f"LibreOffice conversion timed out after {timeout} seconds.")
    except subprocess.CalledProcessError as e:
        raise RuntimeError(f"LibreOffice failed (code {e.returncode}): {e.stderr.strip()}")

    # Expected output filename is base name with .pdf
    expected_pdf = output_dir / f"{input_path.stem}.pdf"
    if not expected_pdf.exists() or expected_pdf.stat().st_size == 0:
        # Fallback check for case-sensitive or altered names
        generated_pdfs = list(output_dir.glob("*.pdf"))
        if generated_pdfs:
            expected_pdf = generated_pdfs[0]
        else:
            raise RuntimeError("LibreOffice completed but no output PDF file was generated.")

    return expected_pdf


def extract_text_from_pdf(pdf_path: Path, output_txt_path: Path, timeout: int = 60) -> int:
    """
    Extract UTF-8 text from PDF using pdftotext (poppler-utils) with -layout preservation.
    Returns character count of extracted text.
    """
    cmd = [
        "pdftotext",
        "-enc", "UTF-8",
        "-layout",
        str(pdf_path),
        str(output_txt_path)
    ]

    try:
        run_command(cmd, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise RuntimeError(f"pdftotext timed out after {timeout} seconds.")
    except subprocess.CalledProcessError as e:
        raise RuntimeError(f"pdftotext failed (code {e.returncode}): {e.stderr.strip()}")

    if not output_txt_path.exists():
        return 0

    # Sanitize and count non-whitespace characters
    with open(output_txt_path, "r", encoding="utf-8", errors="replace") as f:
        content = f.read()

    # Filter null bytes which PostgreSQL cannot store in text fields
    cleaned_content = content.replace("\x00", "")
    if len(cleaned_content) != len(content):
        with open(output_txt_path, "w", encoding="utf-8") as f:
            f.write(cleaned_content)

    return len(cleaned_content.strip())


def process_single_file(client: SupabaseClient, file_record: Dict[str, Any]) -> bool:
    """Process a single file record: download, convert/extract, upload, update status."""
    file_id = file_record["id"]
    file_name = file_record.get("name", "document")
    storage_path = file_record.get("storage_path")
    space_id = file_record.get("space_id", "default")
    ext = Path(file_name).suffix.lower()

    sys.stdout.write(f"\n==================================================\n")
    sys.stdout.write(f"Processing File ID: {file_id}\n")
    sys.stdout.write(f"File Name: {file_name} (extension: {ext})\n")
    sys.stdout.write(f"Storage Path: {storage_path}\n")
    sys.stdout.write(f"==================================================\n")

    if not storage_path:
        error_msg = "File record has no storage_path"
        client.set_file_status(file_record, "failed", error_value=error_msg)
        sys.stderr.write(f"Error: {error_msg}\n")
        return False

    # Mark as processing
    client.set_file_status(file_record, "processing")

    with tempfile.TemporaryDirectory(prefix="file_proc_") as tmp_dir:
        tmp_path = Path(tmp_dir)
        downloaded_file = tmp_path / f"input{ext}"

        # 1. Download file from Supabase Storage
        sys.stdout.write("Downloading source file from storage...\n")
        if not client.download_storage_file(storage_path, downloaded_file):
            error_msg = f"Failed to download storage file: {storage_path}"
            client.set_file_status(file_record, "failed", error_value=error_msg)
            return False

        file_size = downloaded_file.stat().st_size
        sys.stdout.write(f"Downloaded {file_size} bytes successfully.\n")

        # Zero-byte file handling
        if file_size == 0:
            error_msg = "Input file is 0 bytes (empty file)."
            client.set_file_status(file_record, "failed", error_value=error_msg)
            return False

        converted_pdf_path: Optional[Path] = None
        pdf_storage_path: Optional[str] = None
        txt_storage_path: Optional[str] = None
        char_count = 0
        extracted_text_preview: Optional[str] = None

        try:
            # 2. Document conversion
            if ext in PDF_EXTENSIONS:
                sys.stdout.write("File is already PDF. Skipping LibreOffice conversion.\n")
                converted_pdf_path = downloaded_file
                pdf_storage_path = storage_path  # Original is the PDF
            elif ext in OFFICE_EXTENSIONS:
                sys.stdout.write(f"Converting office document ({ext}) to PDF via LibreOffice...\n")
                out_dir = tmp_path / "lo_out"
                out_dir.mkdir(exist_ok=True)
                converted_pdf_path = convert_office_to_pdf(downloaded_file, out_dir)
                sys.stdout.write(f"Conversion succeeded. PDF size: {converted_pdf_path.stat().st_size} bytes.\n")

                # Upload converted PDF to Supabase Storage
                pdf_storage_path = f"{space_id}/converted/{file_id}.pdf"
                sys.stdout.write(f"Uploading converted PDF to {pdf_storage_path}...\n")
                if not client.upload_storage_file(pdf_storage_path, converted_pdf_path, "application/pdf"):
                    raise RuntimeError(f"Failed to upload converted PDF to {pdf_storage_path}")
            else:
                sys.stdout.write(f"File type {ext} does not require PDF conversion.\n")
                # Mark ready directly if it's an image or text file
                client.set_file_status(file_record, "ready", extra={
                    "pdf_path": None,
                    "text_path": None,
                    "text_content": None,
                    "has_text": False
                })
                return True

            # 3. Extract text for Read-Aloud and FTS indexing
            if converted_pdf_path and converted_pdf_path.exists():
                sys.stdout.write("Extracting UTF-8 text from PDF using pdftotext...\n")
                txt_output = tmp_path / f"{file_id}.txt"
                char_count = extract_text_from_pdf(converted_pdf_path, txt_output)
                sys.stdout.write(f"Extracted {char_count} characters.\n")

                if txt_output.exists() and char_count > 0:
                    with open(txt_output, "r", encoding="utf-8", errors="replace") as f:
                        # Keep up to 64KB for direct text_content column in DB for FTS / quick view
                        extracted_text_preview = f.read(65536)

                # Upload text file even if 0 chars (marks that extraction was attempted)
                if txt_output.exists():
                    txt_storage_path = f"{space_id}/extracted/{file_id}.txt"
                    sys.stdout.write(f"Uploading extracted text to {txt_storage_path}...\n")
                    if not client.upload_storage_file(txt_storage_path, txt_output, "text/plain"):
                        sys.stderr.write(f"Warning: Failed to upload extracted text to {txt_storage_path}\n")
                        txt_storage_path = None

            # 4. Update file record to 'ready'
            extra_payload: Dict[str, Any] = {
                "pdf_path": pdf_storage_path,
                "text_path": txt_storage_path,
                "text_content": extracted_text_preview,
                "has_text": char_count > 0,
                "char_count": char_count,
                "ocr_needed": (char_count == 0)
            }
            client.set_file_status(file_record, "ready", extra=extra_payload)
            sys.stdout.write(f"Successfully finalized file {file_id} to status 'ready'.\n")
            return True

        except Exception as e:
            error_msg = str(e)
            sys.stderr.write(f"Error processing file {file_id}: {error_msg}\n")
            client.set_file_status(file_record, "failed", error_value=error_msg[:500])
            return False


def main():
    parser = argparse.ArgumentParser(description="Process and convert documents for Supabase File Library.")
    parser.add_argument("--file-id", help="UUID of a specific file to convert")
    parser.add_argument("--all-pending", action="store_true", help="Process all pending or stuck processing files")
    parser.add_argument("--storage-bucket", default=os.getenv("STORAGE_BUCKET") or "family-files", help="Supabase storage bucket name")
    args = parser.parse_args()

    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

    if not supabase_url or not supabase_key:
        sys.stderr.write("Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables must be set.\n")
        sys.exit(1)

    client = SupabaseClient(supabase_url, supabase_key, storage_bucket=args.storage_bucket)

    if args.file_id:
        record = client.get_file_record(args.file_id)
        if not record:
            sys.stderr.write(f"File record not found for ID: {args.file_id}\n")
            sys.exit(1)
        success = process_single_file(client, record)
        sys.exit(0 if success else 1)

    elif args.all_pending:
        records = client.get_pending_files()
        sys.stdout.write(f"Found {len(records)} pending or stuck files.\n")
        all_ok = True
        for rec in records:
            if not process_single_file(client, rec):
                all_ok = False
        sys.exit(0 if all_ok else 1)

    else:
        sys.stderr.write("Error: Either --file-id or --all-pending must be provided.\n")
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
