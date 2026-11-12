# Project: Android TV Family File Library

## Architecture
The system consists of five integrated architectural tiers running within free-tier limits:
1. **Supabase Cloud Backend**: PostgreSQL 15 database (10 tables) with Row Level Security, custom Security Definer functions, pairing RPCs, 30-day trash cleanup, private 50MB storage bucket `family-files`, Realtime replication, and Deno Edge Function webhook dispatcher.
2. **Web Uploader PWA (`web-uploader/`)**: Vite + React 18 + TypeScript + Tailwind CSS application featuring Web Share Target API (Service Worker intercepting POST to IndexedDB), Google OAuth sign-in, mobile TV pairing approval (`/pair`), remote 4-digit PIN management, folder hierarchy tree, and 50MB drag-and-drop file uploader with real-time progress.
3. **Android Multi-Module System (`android/`)**:
   - `:core`: Room Database with SQLite FTS4 virtual table, 500MB local disk LRU cache manager with atomic `.tmp` download renaming and pinned file immunity, `SecureSessionStore` wrapping `EncryptedSharedPreferences` with defensive KeyStore auto-recovery on API 28 OEM firmware, and Supabase-kt client wrapper.
   - `:tv`: 10-foot UI with Jetpack Compose for TV (minSdk 28, targetSdk 34), 5% overscan margins (48dp H, 27dp V), 24sp+ typography, focus scaling (1.06x + 3dp cyan border), D-pad key mappings, low-memory `SafeTvPdfRenderer` (single-page coroutine Mutex, 3-page LRU window, RGB_565 format), Coil image viewer (15% heap cap, pan/zoom/rotate/slideshow), Text/Markdown reader, pre-flight TTS engine check with audio focus ducking, ZXing local QR pairing screen, on-screen 4-digit PIN lock keypad, and Realtime HUD popup toast for new files.
   - `:phone`: Share sheet receiver activity (`ACTION_SEND` / `ACTION_SEND_MULTIPLE`) and WorkManager background upload queue with exponential backoff retry.
4. **GitHub Actions CI/CD & Automation (`.github/workflows/`, `scripts/`)**:
   - `convert-document.yml`: Headless LibreOffice conversion on `ubuntu-latest` with Indian regional fonts (`fonts-smc`, `fonts-lohit-deva`) and `pdftotext` UTF-8 extraction, triggered by Edge Function dispatch or 6-hour cron fallback sweeper.
   - `supabase-keepalive.yml`: Scheduled 3-day cron pinging `health_check_ping()` RPC to prevent free-tier 7-day project pausing and execute 30-day trash cleanup.
   - `supabase-backup.yml`: Weekly Sunday 02:00 UTC metadata backup exporting all 10 tables with PostgREST range pagination to `.json.gz`, committing to git and uploading a 90-day artifact.
5. **E2E Testing & Verification Track**: Comprehensive opaque-box test runner, synthetic test fixtures across all supported file types and edge cases, unit test execution, and deployment/sideloading guides.

---

## Feature Inventory
Every feature from the Survey phase is mapped to its assigned milestone.

| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F01 | Multi-Tenant Space Container | Root container (`spaces` table) isolating family libraries, managing space name, creator, and salted TV PIN hash | M1 | survey |
| F02 | Role-Based Space Membership | Associates Google Auth users (`members` table) with spaces using roles `owner`, `admin`, `member` | M1 | survey |
| F03 | 7-Day Email Invitation System | Cryptographic token-based invitations (`invites` table) to add family Gmail accounts to a space | M1 | survey |
| F04 | Paired TV Device Registry | Hardware registry (`devices` table) tracking paired TVs with SHA-256 hashed bearer tokens and instant revocation | M1 | survey |
| F05 | Ephemeral Pairing Handshake | 10-minute expiring handshake state (`pairing_codes` table) storing 6-character alphanumeric code and hashed secret | M1 | survey |
| F06 | Hierarchical Folder Tree | Nested folder explorer (`folders` table) supporting self-referencing `parent_id`, custom colors, icons, and Trash logic | M1 | survey |
| F07 | File Metadata & Conversion Tracking | Core catalog (`files` table) storing original and converted PDF storage paths, extracted text, status, and FTS index | M1 | survey |
| F08 | Document & Page Annotations | Contextual notes (`notes` table) attached to files or folders, with optional PDF page number markers | M1 | survey |
| F09 | Starred Favorites System | Quick-access starred items (`favorites` table) linked to either a specific family member or a TV device | M1 | survey |
| F10 | Reading Progress & Bookmarks | Reading state (`bookmarks` table) tracking 1-based page number, `0.0–1.0` scroll position, and `is_last_read` flag | M1 | survey |
| F11 | Space Access RLS Definers | Security definer functions (`has_space_access`, `is_space_member_user`, `is_space_admin`, `get_auth_device_id`) | M1 | survey |
| F12 | TV Pairing Code Generation RPC | Database function `request_tv_pairing_code` generating ambiguous-free 6-char code and 32-byte secret | M1 | survey |
| F13 | TV Pairing Approval RPC | Member function `approve_tv_pairing_code` generating 48-byte bearer token and registering device | M1 | survey |
| F14 | TV Pairing Claim RPC | TV function `claim_tv_pairing_code` exchanging device secret for bearer token and scrubbing credentials | M1 | survey |
| F15 | 30-Day Trash Garbage Collection | Automated purge function `cleanup_expired_trash` permanently deleting soft-deleted files/folders older than 30 days | M1 | survey |
| F16 | Keep-Alive Ping RPC | Database function `health_check_ping` returning space count and executing trash garbage collection | M1 | survey |
| F17 | Private Storage Bucket Enforcement | Private `family-files` bucket with 50MB (52,428,800 bytes) file limit and strict MIME whitelist | M1 | survey |
| F18 | Path-Prefixed Storage RLS Policies | Storage policies extracting `<space_id>` from the first path segment to authorize read, upload, and deletion | M1 | survey |
| F19 | Full Logical Replication Publication | Supabase Realtime publication with `replica identity full` on `files`, `folders`, `notes`, and `pairing_codes` | M1 | survey |
| F20 | Web Share Target Ingestion | PWA manifest declaration and Service Worker `POST /share-target` capturing shared files into IndexedDB | M2 | survey |
| F21 | 50MB Drag & Drop Uploader | Client-side uploader enforcing `<= 50MB` size limits, calculating checksums, and streaming progress | M2 | survey |
| F22 | Google OAuth Authentication | Frictionless family sign-in via Supabase Google OAuth with basic profile scopes | M2 | survey |
| F23 | Mobile Pairing Approval Screen (`/pair`) | Web view allowing family members to enter 6-digit code or scan QR code to approve TV access | M2 | survey |
| F24 | Remote TV PIN Management | Security modal on Web Devices page allowing members to set, update, or clear the TV's 4-digit PIN lock | M2 | survey |
| F25 | Trash Management & Recovery | Web Trash view displaying soft-deleted items with remaining-day countdown, Restore, and permanent delete | M2 | survey |
| F26 | Room Database with SQLite FTS4 | Local TV database with `FileEntity`, `FolderEntity`, `CachedFileEntity`, `BookmarkEntity`, and `FileFtsEntity` | M3 | survey |
| F27 | 500MB Local Disk LRU Cache | Deterministic cache manager with 500MB quota, atomic `.tmp` download renaming, and pinned file immunity | M3 | survey |
| F28 | Defensive KeyStore Credential Store | `SecureSessionStore` wrapping `EncryptedSharedPreferences` with auto-recovery for Android 9 OEM KeyStores | M3 | survey |
| F29 | Supabase-kt Client Wrapper | Multiplatform Kotlin client over OkHttp engine supporting PostgREST, Realtime WebSockets, and Storage | M3 | survey |
| F30 | 10-Foot TV Design System | Jetpack Compose for TV theme with `#0F172A` background, 5% overscan margins, and 24sp+ typography | M4 | survey |
| F31 | High-Contrast Focus Indicator | D-pad focus feedback with 1.06x scale expansion, 3dp neon cyan border (`#00E5FF`), and elevation glow | M4 | survey |
| F32 | TV Home Screen Multi-Shelf Layout | Horizontal shelves: Continue Reading, Favorites, Inbox, Folders, plus top-level Search and Settings | M4 | survey |
| F33 | Low-Memory Synchronized `PdfRenderer` | Native `PdfRenderer` wrapped in a coroutine `Mutex` with 3-page LRU bitmap window and `RGB_565` format | M4 | survey |
| F34 | D-Pad Navigation & Control Mapping | Remote key event routing: Left/Right page flips, Up/Down scrolling, OK toolbar toggle, Back exit, Play/Pause TTS | M4 | survey |
| F35 | Memory-Tuned Coil Image Viewer | Image loader restricted to 15% RAM heap and `RGB_565` format, supporting pan, zoom, rotate, and slideshow | M4 | survey |
| F36 | 28sp Text & Markdown Viewer | High-legibility reader for plain text and markdown documents with smooth D-pad vertical scrolling | M4 | survey |
| F37 | TTS Diagnostic & Fallback | Pre-flight probe of `TextToSpeech.engines` preventing crashes on budget TVs, with transient ducking audio focus | M4 | survey |
| F38 | Local ZXing QR Pairing Screen | TV pairing screen rendering a 48sp 6-digit code, 320x320 ZXing QR code, and Realtime + 3s polling listener | M4 | survey |
| F39 | 4-Digit TV PIN Lock Keypad | On-screen D-pad numeric PIN pad comparing SHA-256 hash against space configuration | M4 | survey |
| F40 | Realtime "New file arrived" HUD Toast | Non-intrusive on-screen notification subscribing to Supabase Realtime channel when TV app is active | M4 | survey |
| F41 | Android Phone Share Sheet Receiver | Mobile activity intercepting `ACTION_SEND` and `ACTION_SEND_MULTIPLE` intents from other apps | M3 | survey |
| F42 | WorkManager Background Upload Queue | Resilient background upload worker surviving process death and screen-off events, with exponential retry | M3 | survey |
| F43 | Headless LibreOffice Conversion Pipeline | GitHub Actions workflow converting Office files (`.docx`, `.pptx`, `.xlsx`, etc.) to PDF in isolated profiles | M5 | survey |
| F44 | Indian Regional Font Pack | Automated installation of Malayalam (`fonts-smc`, Rachana, Meera) and Devanagari (`fonts-lohit-deva`) fonts | M5 | survey |
| F45 | Layout-Preserving UTF-8 Text Extraction | `pdftotext -enc UTF-8 -layout` extraction pipeline populating FTS indexes and TTS read-aloud buffers | M5 | survey |
| F46 | 6-Hour Fallback Sweeper | Scheduled cron (`0 */6 * * *`) in `convert-document.yml` scanning for dropped webhooks or stuck processing records | M5 | survey |
| F47 | Supabase Edge Function Dispatcher | Deno Edge Function (`trigger-conversion`) listening to database webhooks on file insert and invoking GitHub API | M5 | survey |
| F48 | 3-Day Supabase Keep-Alive Cron | GitHub Action running every 3 days at 04:00 UTC pinging `health_check_ping` RPC to prevent 7-day project pausing | M5 | survey |
| F49 | Weekly Sunday Metadata Backup & Pruning | GitHub Action running Sundays at 02:00 UTC exporting all 10 tables to `.json.gz`, committing to git | M5 | survey |
| F50 | Synthetic Test Fixture Matrix & Testing | Comprehensive test fixtures (Malayalam docx, 50MB PDF, scanned PDF, 30-slide pptx, wide xlsx, 12MP image, 0-byte, corrupt) | M6 | survey |

---

## Milestones

| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Supabase Backend & Schema | Finalize schema migration, 10 tables, RLS security definers, pairing RPCs, 30-day trash cleanup, storage bucket policies, Edge Function | none | DONE |
| M2 | Web Uploader PWA | Greenfield Vite + React 18 + TS + Tailwind PWA: Web Share Target (SW + manifest), Supabase Auth, /pair screen, remote PIN, folder navigation, 50MB drag & drop uploader | M1 | DONE |
| M3 | Android Multi-Module Core & Phone | Multi-module Gradle build setup, `:core` (Room FTS4 DB, 500MB LRU Cache, SecureSessionStore, Supabase-kt), `:phone` (Share sheet receiver, WorkManager upload), unit tests | M1 | IN_PROGRESS |
| M4 | Android TV UI & Viewers | `:tv` module: Compose for TV (minSdk 28, targetSdk 34), 10-foot UI, D-pad navigation, low-memory PdfRenderer, Coil image viewer, Text viewer, TTS check, ZXing QR pairing, PIN lock | M3 | PLANNED |
| M5 | CI/CD Workflows & Scripts | Finalize & verify GitHub Actions workflows (convert-document, keepalive, backup), Python conversion & backup scripts, font packages | M1 | IN_PROGRESS |
| M6 | System Verification, E2E Testing & Documentation | Dual-Track E2E test execution, synthetic test fixtures, full build checks across all modules, setup and sideloading documentation | M2, M4, M5 | PLANNED |

---

## Interface Contracts

### 1. Web Uploader / TV Device ↔ Supabase Backend
- **Pairing Protocol RPCs**:
  - `request_tv_pairing_code(p_device_identifier text, p_device_name text)` -> `json { code: text, device_secret: text, expires_at: timestamptz }`
  - `approve_tv_pairing_code(p_code text, p_space_id uuid)` -> `json { success: boolean, device_id: uuid, device_name: text }`
  - `claim_tv_pairing_code(p_device_identifier text, p_device_secret text)` -> `json { status: 'pending'|'approved'|'expired'|'not_found', device_id: uuid, space_id: uuid, device_token: text }`
- **Invitation RPC**:
  - `accept_space_invite(p_token text)` -> `json { success: boolean, space_id: uuid, role: text }`
- **Keepalive & Cleanup RPC**:
  - `health_check_ping()` -> `json { status: 'healthy', timestamp: timestamptz, active_spaces_count: int, trash_files_purged: int, trash_folders_purged: int }`
- **Storage Contract**:
  - Bucket: `family-files`
  - Upload Path: `<space_id>/<folder_id_or_root>/<file_id>.<ext>`
  - Max Size: `52428800` bytes (50MB)

### 2. Android `:core` ↔ Android `:tv` / `:phone`
- **Cache Manager Contract**:
  - `TvCacheManager`: `suspend fun getOrDownload(fileId: String, storagePath: String, signedUrl: String): File`
  - `suspend fun evictIfNeeded(incomingSizeBytes: Long): Boolean`
  - `suspend fun pinFile(fileId: String, isPinned: Boolean)`
- **Database Contract**:
  - `FileDao`: `fun getFilesForFolder(spaceId: String, folderId: String?): Flow<List<FileEntity>>`
  - `fun searchFilesFts(query: String): Flow<List<FileEntity>>`
  - `fun getContinueReading(spaceId: String): Flow<List<FileWithBookmark>>`
  - `fun getFavorites(spaceId: String): Flow<List<FileEntity>>`
- **Session Store Contract**:
  - `SecureSessionStore`: `fun saveSession(deviceId: String, spaceId: String, token: String)`
  - `fun getSession(): SessionCredentials?`
  - `fun clearSession()`

### 3. Edge Function ↔ GitHub Actions Workflow
- **Webhook Payload (`trigger-conversion`)**:
  - Event: `repository_dispatch`
  - Event Type: `convert-document`
  - Client Payload: `{ file_id: string, space_id: string, storage_path: string, file_type: string, file_name: string }`
