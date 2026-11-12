# Document Conversion, CI/CD Pipeline & Supabase Automation

Comprehensive architecture, workflow definitions, and operational guide for the **Android TV Family File Library** document processing, keep-alive, and backup pipelines.

---

## 1. Document Conversion & Text Extraction Pipeline (M5)

### Architectural Overview

When family members upload Office files (`.docx`, `.pptx`, `.xlsx`, etc.) or PDFs from the phone app or web uploader:
1. The original binary is uploaded directly to Supabase Storage in the `files` bucket at `{space_id}/{file_id}/{filename}`.
2. A row is inserted into the `files` table with `status = 'processing'`.
3. A Supabase Database Webhook calls the `trigger-conversion` Supabase Edge Function.
4. The Edge Function dispatches a `repository_dispatch` event (`event_type: "convert-document"`) to the private GitHub repository with the `file_id`.
5. GitHub Actions spins up an `ubuntu-latest` runner equipped with headless LibreOffice, Indic/Microsoft fonts, and `poppler-utils`.
6. The runner executes `scripts/convert_document.py`:
   - Downloads the file from Supabase Storage.
   - Converts Office documents to PDF with LibreOffice.
   - Extracts clean UTF-8 text using `pdftotext` with layout preservation.
   - Uploads converted PDF to `{space_id}/converted/{file_id}.pdf`.
   - Uploads extracted UTF-8 text to `{space_id}/extracted/{file_id}.txt`.
   - Updates the Supabase `files` record: `status = 'ready'`, `pdf_path`, `text_path`, `has_text`, `char_count`.
7. The Android TV app receives a Postgres Realtime update and displays the document or enables read-aloud and full-text search.

---

### Font Configuration for Indic & Office Documents

To ensure accurate typography without tofu characters (`□`), missing ligatures, or font substitution artifacts:
- **Malayalam**:
  - `fonts-smc`: Swathanthra Malayalam Computing font suite.
  - `fonts-smc-rachana`: Traditional orthography, standard for formal Malayalam literature and documents.
  - `fonts-smc-meera`: Modern orthography, ideal for UI and legible 10-foot TV reading.
  - `fonts-smc-chilanka`: Handwriting / cursive Malayalam font.
  - `fonts-smc-gayathri`, `fonts-smc-manjari`: Modern sans and curved typefaces.
- **Hindi / Devanagari**:
  - `fonts-deva`: Standard Devanagari typography.
  - `fonts-lohit-deva`: High-quality Lohit Devanagari fonts.
  - `fonts-indic`: Ubuntu Indic metapackage covering Gujarati, Bengali, Tamil, Telugu, Kannada, etc.
- **Microsoft Core Fonts & Noto Fonts**:
  - `ttf-mscorefonts-installer`: Standard Microsoft fonts (Arial, Times New Roman, Calibri fallback). Installed non-interactively using:
    `echo "ttf-mscorefonts-installer msttcorefonts/accepted-mscorefonts-eula select true" | sudo debconf-set-selections`
  - `fonts-noto-core`, `fonts-noto-extra`, `fonts-noto-cjk`: Google Noto universal fallback for missing glyphs.

---

### Edge Cases and Error Handling Strategies

| Edge Case | Strategy |
|---|---|
| **Scanned / Handwritten PDF** | `pdftotext` extracts 0 characters. The pipeline detects `char_count == 0`, sets `has_text = false`, and marks `status = 'ready'` so the PDF is still viewable on the TV, while the TV reader gracefully disables the "Read Aloud" button. |
| **Corrupt or Password-Protected File** | LibreOffice or `pdftotext` exits with a non-zero code or hangs. Handled via a 180s subprocess timeout and try-catch block. The script marks `status = 'failed'` and logs a sanitized error message to `error_message` in Postgres. |
| **Zero-Byte File Uploaded** | Immediate validation check before LibreOffice execution. Flags `status = 'failed'` with `"Input file is 0 bytes"`. |
| **Wide Excel Spreadsheets (`.xlsx`)** | Handled natively by LibreOffice Calc headless export to PDF. Documents retain layout and pagination without crashing the runner. |
| **LibreOffice Multi-Instance Locking** | Handled by generating a temporary isolated user profile directory: `-env:UserInstallation=file:///tmp/...`. Prevents "Another instance is running" locks. |
| **Dropped Webhooks / Interrupted Runs** | Handled by a 6-hour cron sweep (`scripts/convert_document.py --all-pending`) that picks up any files stuck in `processing` or `pending`. |
| **Postgres Null Byte Exception** | Some PDFs contain invalid `\x00` null characters in embedded metadata. The script strips null bytes before database storage. |

---

## 2. Supabase Free Tier Keep-Alive Workflow

### Purpose & Behavior
- **Problem**: Supabase Free Tier automatically pauses projects after 7 consecutive days of inactivity.
- **Solution**: A scheduled GitHub Actions workflow runs every 3 days (`0 4 */3 * *`).
- **Mechanism**:
  - Hits the Supabase PostgREST endpoint: `${SUPABASE_URL}/rest/v1/spaces?select=id&limit=1`.
  - Performs an actual database query on PostgreSQL, actively resetting the Supabase inactivity inactivity timer.
  - Implements an exponential backoff retry loop (up to 3 attempts).
  - Emits HTTP status and response latency in workflow logs.

---

## 3. Weekly Metadata Backup Workflow

### Purpose & Behavior
- **Problem**: Supabase Free Tier does not include automated daily backups or point-in-time recovery.
- **Solution**: A scheduled GitHub Actions workflow runs every Sunday at 02:00 UTC (`0 2 * * 0`).
- **Mechanism**:
  - Queries all metadata tables (`spaces`, `members`, `invites`, `devices`, `pairing_codes`, `folders`, `files`, `notes`, `favorites`, `bookmarks`) via PostgREST with pagination headers (`Range: 0-999`).
  - Serializes and gzip-compresses the data into `backups/metadata_backup_YYYY-MM-DD_HHMMSSZ.json.gz`.
  - Uploads the archive as a GitHub Actions Artifact (retained for 90 days).
  - Commits the backup directly to the private repository with `[skip ci]`.
  - Automatically prunes backups older than 12 weeks to keep repository size lean.

---

## 4. Setup & Configuration Checklist

### Required GitHub Secrets
Configure these in GitHub Repository -> **Settings** -> **Secrets and variables** -> **Actions**:
- `SUPABASE_URL`: e.g. `https://your-project.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase secret service role key (bypasses RLS).
- `SUPABASE_ANON_KEY`: Supabase public anon key (used for keep-alive ping).
- `SUPABASE_STORAGE_BUCKET`: (Optional, defaults to `files`).

### Required Supabase Edge Function Secrets
Set in Supabase Dashboard -> **Settings** -> **Edge Functions** (or via Supabase CLI `supabase secrets set`):
- `GITHUB_REPO_OWNER`: GitHub username or organization name.
- `GITHUB_REPO_NAME`: GitHub repository name.
- `GITHUB_PAT`: GitHub Personal Access Token (classic `repo` scope or fine-grained with `Actions: Read and write`).
- `CONVERSION_WEBHOOK_SECRET`: Optional shared secret string for authenticating database webhooks.

### Setting Up the Supabase Database Webhook
In the Supabase Dashboard:
1. Navigate to **Database** -> **Webhooks** -> **Create a new hook**.
2. **Name**: `trigger_file_conversion`
3. **Table**: `files`
4. **Events**: `INSERT`, `UPDATE`
5. **Type of webhook**: `Supabase Edge Function`
6. **Edge Function**: Select `trigger-conversion`
7. **HTTP Headers**: `Authorization: Bearer <CONVERSION_WEBHOOK_SECRET>`
