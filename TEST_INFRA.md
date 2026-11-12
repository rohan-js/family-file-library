# Test Infrastructure Specification: Android TV Family File Library

## 1. Testing Philosophy & Architecture

### 1.1 Core Methodology: Opaque-Box, Requirement-Driven Verification
The Android TV Family File Library verification harness operates on an **opaque-box (black-box)** testing methodology. The test engine treats each subsystem—Supabase PostgreSQL database, Web Uploader PWA, Android Multi-Module client, and GitHub Actions CI/CD workflows—as a decoupled component defined entirely by its inputs, outputs, protocols, and data contracts.

Rather than coupling tests to fragile internal implementation details (such as Jetpack Compose UI widget trees, Android ViewModel private state, or browser DOM element selectors), tests validate:
- **Protocol Invariants**: HTTP/PostgREST status codes, JSON schema conformity, bearer token authentication headers, and WebSocket replication streams.
- **Data Invariants**: Database column constraints, Foreign Key cascades, 30-day trash lifecycle rules, and SQLite FTS4 tokenization.
- **Boundary Thresholds**: Strict 50MB (52,428,800 bytes) storage ceiling, 500MB local LRU cache quota with pinned file immunity, and 15% RAM heap cap for image decoding.
- **State Machine Transitions**: TV pairing code states (`pending` -> `approved` -> `claimed` / `expired`), document conversion pipelines (`pending` -> `processing` -> `ready` / `failed`), and multi-page LRU sliding windows.

### 1.2 Progressive Testability
The multi-platform architecture spans cloud backends, modern web applications, and embedded Android TV hardware. In typical continuous integration pipelines, spinning up an Android TV emulator (API 28) with hardware graphics acceleration is resource-intensive and prone to flakiness. 

To eliminate this bottleneck, the opaque-box test infrastructure provides **progressive testability**:
1. **Offline Mock Mode (Default)**: Validates 100% of functional contracts, business logic, algorithmic invariants, and boundary checks locally using in-memory state simulators without requiring cloud accounts, external network connectivity, or physical TV displays.
2. **Live Integration Mode (`--live`)**: Directs HTTP and RPC calls against a provisioned Supabase instance using real credentials when environment variables (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) are present.
3. **Early Feedback Loop**: Test suites execute and validate feature boundaries before final UI compilation, preventing late-stage integration surprises.

### 1.3 Architectural Stack Coverage
The test framework comprehensively verifies five architectural layers:
```
┌────────────────────────────────────────────────────────────────────────┐
│                        4-TIER E2E TEST ENGINE                          │
├──────────────────┬─────────────────┬──────────────────┬────────────────┤
│ Backend Layer    │ Web PWA Layer   │ Android Core/TV  │ CI/CD Pipeline │
│ (PostgreSQL,     │ (Vite, React,   │ (Room FTS4, LRU  │ (LibreOffice,  │
│  RPCs, RLS,      │  Share Target,  │  Cache, D-Pad,   │  Keepalive,    │
│  Storage, PubSub)│  PIN modal)     │  PdfRenderer)    │  Backup)       │
└──────────────────┴─────────────────┴──────────────────┴────────────────┘
```

---

## 2. 4-Tier Test Matrix

### 2.1 Tier Overview & Coverage Thresholds
The test suite is structured into four progressive tiers designed to validate every layer from fundamental unit invariants up to complex real-world family workflows:

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Tier 4: Real-World Workload Scenarios (>= 5 Complete Scenarios)         │
├─────────────────────────────────────────────────────────────────────────┤
│ Tier 3: Pairwise Cross-Feature Interactions (>= 8 Interaction Chains)   │
├─────────────────────────────────────────────────────────────────────────┤
│ Tier 2: Boundary & Corner Cases (>= 5 Cases per Feature / Domain)       │
├─────────────────────────────────────────────────────────────────────────┤
│ Tier 1: Feature Happy-Path Coverage (>= 5 Assertions per Feature F01–50)│
└─────────────────────────────────────────────────────────────────────────┘
```

#### Coverage Thresholds
- **Tier 1 (Feature Coverage)**: Happy-path validation for all 50 system features (`F01` to `F50`). Each feature requires at least 5 distinct assertions/sub-tests verifying its primary functional contract (>= 250 test assertions total across 17 functional domains).
- **Tier 2 (Boundary & Corner Cases)**: Edge cases, size ceilings, malformed inputs, timeouts, token invalidations, and resource constraints (>= 5 edge cases per feature/domain).
- **Tier 3 (Cross-Feature Interactions)**: Minimum 8 multi-system interaction chains exercising pairwise permutations across architectural boundaries.
- **Tier 4 (Real-World Scenarios)**: Minimum 5 end-to-end user workflows simulating realistic family scenarios (medical emergencies, photo albums, school presentations, device onboarding, trash recovery).

---

### 2.2 Tier 1: Feature Coverage Matrix (F01–F50)
Every feature from `PROJECT.md` is mapped to its functional domain and happy-path assertions:

| # | Feature | Domain | Happy-Path Assertions (>= 5 / Feature) |
|---|---------|--------|----------------------------------------|
| **F01** | Multi-Tenant Space Container | Spaces | 1. Create space with valid name.<br>2. Generate non-empty UUID primary key.<br>3. Assign `created_by` to authenticated owner.<br>4. Store optional salted TV PIN hash.<br>5. Read space metadata returns correct created timestamp. |
| **F02** | Role-Based Space Membership | Auth & Members | 1. Add member with role `owner`.<br>2. Add member with role `member`.<br>3. Add member with role `admin`.<br>4. Fetch all active members for a space.<br>5. Update member role from `member` to `admin`. |
| **F03** | 7-Day Email Invitation System | Auth & Invites | 1. Generate invitation token for target email.<br>2. Verify `expires_at` is set to 7 days from creation.<br>3. Verify invitation status defaults to `pending`.<br>4. Accept invite joins user to target space.<br>5. Mark invitation status `accepted` and record accepted timestamp. |
| **F04** | Paired TV Device Registry | Devices | 1. Register new TV device record with hardware identifier.<br>2. Store device display name (e.g. "Living Room TV").<br>3. Generate and hash device bearer token.<br>4. Record `last_active_at` timestamp updates.<br>5. Query active paired devices for space returns registered TV. |
| **F05** | Ephemeral Pairing Handshake | Pairing | 1. Create pairing code record with 6-char alphanumeric code.<br>2. Store hashed device secret.<br>3. Set `expires_at` to exactly 10 minutes in the future.<br>4. Store device hardware identifier.<br>5. Query pairing code returns pending handshake state. |
| **F06** | Hierarchical Folder Tree | Folders | 1. Create root folder (`parent_id = null`).<br>2. Create nested subfolder referencing valid `parent_id`.<br>3. Assign custom folder color (hex code).<br>4. Assign custom folder icon identifier.<br>5. Fetch direct children of a folder returns ordered listing. |
| **F07** | File Metadata & Conversion Tracking | File Catalog | 1. Insert file record with MIME type, size, and storage path.<br>2. Associate file with parent folder or root.<br>3. Set conversion status `pending` for convertible formats.<br>4. Update conversion status to `processing` then `ready`.<br>5. Store converted PDF storage path and extracted UTF-8 text. |
| **F08** | Document & Page Annotations | Annotations | 1. Create note attached to file record.<br>2. Create note attached to specific folder.<br>3. Store optional 1-based PDF page number marker.<br>4. Record author user identifier and creation timestamp.<br>5. Retrieve notes for document ordered chronologically. |
| **F09** | Starred Favorites System | Favorites | 1. Star file for authenticated user.<br>2. Star folder for authenticated user.<br>3. Star file for paired TV device identifier.<br>4. Fetch favorites list returns starred items with timestamps.<br>5. Unstar removes item from favorites. |
| **F10** | Reading Progress & Bookmarks | Bookmarks | 1. Insert bookmark with 1-based page number.<br>2. Record vertical scroll position as float between 0.0 and 1.0.<br>3. Set `is_last_read` flag true.<br>4. Update bookmark on subsequent page read with new timestamp.<br>5. Query `view_continue_reading` returns document at top. |
| **F11** | Space Access RLS Definers | Security / RLS | 1. `has_space_access()` returns true for space member.<br>2. `has_space_access()` returns true for paired TV device.<br>3. `is_space_member_user()` validates authenticated user UID.<br>4. `is_space_admin()` validates owner or admin role.<br>5. `get_auth_device_id()` extracts valid device token from header. |
| **F12** | TV Pairing Code Generation RPC | TV RPC | 1. `request_tv_pairing_code` RPC call succeeds with HTTP 200.<br>2. Returns 6-character uppercase code.<br>3. Code uses unambiguous alphabet (no 0/O, 1/I).<br>4. Returns 32-byte hexadecimal device secret.<br>5. Returns `expires_at` timestamp 10 minutes out. |
| **F13** | TV Pairing Approval RPC | TV RPC | 1. `approve_tv_pairing_code` RPC call succeeds with valid code & space.<br>2. Returns JSON payload with `success: true`.<br>3. Returns registered device UUID.<br>4. Updates pairing code record status to approved.<br>5. Links device record to approving member's space. |
| **F14** | TV Pairing Claim RPC | TV RPC | 1. `claim_tv_pairing_code` returns status `approved`.<br>2. Returns space UUID.<br>3. Returns 48-byte high-entropy device bearer token.<br>4. Clears temporary device secret from database.<br>5. Authenticates subsequent requests using claimed device token. |
| **F15** | 30-Day Trash Garbage Collection | Maintenance | 1. `cleanup_expired_trash()` RPC executes successfully.<br>2. Permanently removes files with `deleted_at < now() - 30 days`.<br>3. Permanently removes folders with `deleted_at < now() - 30 days`.<br>4. Returns count of purged files and folders.<br>5. Deletes corresponding storage bucket objects. |
| **F16** | Keep-Alive Ping RPC | Maintenance | 1. `health_check_ping()` returns HTTP 200.<br>2. Returns status string `healthy`.<br>3. Returns current server timestamp.<br>4. Returns active space count >= 0.<br>5. Invokes trash cleanup as side effect. |
| **F17** | Private Storage Bucket Enforcement | Storage | 1. Bucket `family-files` is private (`public = false`).<br>2. Bucket enforces `file_size_limit = 52428800` (50MB).<br>3. Allowed MIME types include images (jpg, png, webp, heic).<br>4. Allowed MIME types include PDFs and Office formats (docx, pptx, xlsx).<br>5. Allowed MIME types include plain text, markdown, and csv. |
| **F18** | Path-Prefixed Storage RLS Policies | Storage RLS | 1. Upload to `<space_id>/<folder>/<file>` succeeds for space member.<br>2. Download via signed URL succeeds for space member.<br>3. Download via authenticated TV session succeeds.<br>4. Admin can delete file from space path.<br>5. Storage object metadata records creator and timestamp. |
| **F19** | Full Logical Replication Publication | Realtime | 1. Realtime publication includes `files` table.<br>2. Realtime publication includes `folders` table.<br>3. Realtime publication includes `notes` table.<br>4. Realtime publication includes `pairing_codes` table.<br>5. Tables configured with `replica identity full` emit complete rows. |
| **F20** | Web Share Target Ingestion | Web PWA | 1. `manifest.json` defines `share_target` object.<br>2. Manifest specifies action `/share-target` with POST method.<br>3. Manifest accepts MIME types `image/*`, `application/pdf`, text.<br>4. Service worker intercepts `POST /share-target` request.<br>5. Service worker stores extracted file in client IndexedDB. |
| **F21** | 50MB Drag & Drop Uploader | Web PWA | 1. Accept files <= 52,428,800 bytes via drop zone.<br>2. Compute SHA-256 checksum during upload.<br>3. Emit progress updates (0% to 100%).<br>4. Upload directly to Supabase storage with correct space prefix.<br>5. Create file catalog record in database upon completion. |
| **F22** | Google OAuth Authentication | Web PWA | 1. Trigger Supabase OAuth sign-in flow with Google provider.<br>2. Request user profile and email scopes.<br>3. Receive session JWT upon redirect.<br>4. Store refresh token in secure browser storage.<br>5. Session restore on page reload preserves authenticated user. |
| **F23** | Mobile Pairing Approval Screen (`/pair`) | Web PWA | 1. Render pairing code input accepting 6 characters.<br>2. Parse QR code query param (`/pair?code=ABC234`).<br>3. Present space selection dropdown.<br>4. Call `approve_tv_pairing_code` on submit.<br>5. Display success confirmation with paired device name. |
| **F24** | Remote TV PIN Management | Web PWA | 1. Open remote PIN modal from Devices settings.<br>2. Accept 4 numeric digits for PIN.<br>3. Compute SHA-256 hash combined with space salt.<br>4. Update `spaces.tv_pin_hash` via API.<br>5. Clear PIN updates `tv_pin_hash = null`. |
| **F25** | Trash Management & Recovery | Web PWA | 1. List soft-deleted files and folders (`deleted_at != null`).<br>2. Compute remaining days countdown (30 days - elapsed).<br>3. Restore action sets `deleted_at = null`.<br>4. Restored items reappear immediately in file tree.<br>5. Permanent delete purges item before 30-day window. |
| **F26** | Room Database with SQLite FTS4 | Android Core | 1. Initialize Room DB with `files`, `folders`, `bookmarks` tables.<br>2. Create virtual table `files_fts` using `fts4`.<br>3. Index `name` and `extracted_text` columns.<br>4. Execute FTS prefix search (`query*`) returns matching rows.<br>5. Triggers sync FTS table on insert, update, and delete. |
| **F27** | 500MB Local Disk LRU Cache | Android Core | 1. Download file to atomic `.tmp` file and rename on complete.<br>2. Track total disk cache consumption.<br>3. Enforce 500MB storage quota.<br>4. Evict least-recently-accessed unpinned file when cap reached.<br>5. Pinned files (`is_pinned = true`) are immune from eviction. |
| **F28** | Defensive KeyStore Credential Store | Android Core | 1. Store TV bearer token in EncryptedSharedPreferences.<br>2. Retrieve stored token across app restarts.<br>3. Detect corrupted KeyStore on API 28 OEM firmware.<br>4. Auto-recover by clearing corrupted credentials.<br>5. Re-initialize clean KeyStore without crashing app. |
| **F29** | Supabase-kt Client Wrapper | Android Core | 1. Initialize client with Supabase URL and anon key.<br>2. Authenticate using TV device bearer token.<br>3. Query PostgREST tables with filter parameters.<br>4. Download files from storage bucket via signed URL.<br>5. Connect to Realtime WebSocket channel. |
| **F30** | 10-Foot TV Design System | Android TV | 1. Dark theme background `#0F172A`.<br>2. Overscan margins enforced at 5% (48dp horizontal, 27dp vertical).<br>3. Base typography scale >= 24sp for body text.<br>4. Header typography scale >= 32sp for shelf titles.<br>5. High contrast color palette compliant with 10-foot viewing. |
| **F31** | High-Contrast Focus Indicator | Android TV | 1. Focused item scales by 1.06x.<br>2. Focused item displays 3dp cyan border (`#00E5FF`).<br>3. Unfocused items return to 1.0x scale.<br>4. Elevation glow applied to focused cards.<br>5. Smooth focus animation transitions. |
| **F32** | TV Home Screen Multi-Shelf Layout | Android TV | 1. Render Continue Reading shelf horizontally.<br>2. Render Favorites shelf horizontally.<br>3. Render Inbox shelf horizontally.<br>4. Render Folders shelf horizontally.<br>5. Top navigation bar provides Search and Settings buttons. |
| **F33** | Low-Memory Synchronized `PdfRenderer` | Android TV | 1. Native `PdfRenderer` wrapped in coroutine `Mutex`.<br>2. Allocate page bitmaps using `Bitmap.Config.RGB_565`.<br>3. Limit memory cache to 3-page sliding LRU window.<br>4. Concurrent page render requests execute sequentially.<br>5. Evicted page bitmaps are promptly recycled. |
| **F34** | D-Pad Navigation & Control Mapping | Android TV | 1. `KEYCODE_DPAD_LEFT` flips to previous page.<br>2. `KEYCODE_DPAD_RIGHT` flips to next page.<br>3. `KEYCODE_DPAD_UP` / `DOWN` scrolls vertical text.<br>4. `KEYCODE_DPAD_CENTER` / `ENTER` toggles viewer toolbar.<br>5. `KEYCODE_BACK` exits viewer to Home screen. |
| **F35** | Memory-Tuned Coil Image Viewer | Android TV | 1. Restrict Coil image cache to 15% of device RAM heap.<br>2. Decode images using `RGB_565` format.<br>3. Support remote D-pad pan and zoom.<br>4. Support 90-degree image rotation.<br>5. Automated slideshow mode advances image on timer. |
| **F36** | 28sp Text & Markdown Viewer | Android TV | 1. High-legibility 28sp typography for text body.<br>2. Parse markdown headings, bold, lists, and quotes.<br>3. Smooth D-pad vertical scrolling with page jumps.<br>4. Auto-wrap text lines within 5% TV margins.<br>5. Preserve scroll offset upon exit. |
| **F37** | TTS Diagnostic & Fallback | Android TV | 1. Probe `TextToSpeech.getEngines()` prior to speech.<br>2. Detect absence of installed TTS engine without crashing.<br>3. Display graceful on-screen message if TTS unavailable.<br>4. Request transient audio focus with ducking during playback.<br>5. Release audio focus immediately on speech completion. |
| **F38** | Local ZXing QR Pairing Screen | Android TV | 1. Generate 320x320 ZXing QR code encoding pair URL.<br>2. Render 48sp 6-character pairing code.<br>3. Display 10-minute countdown timer.<br>4. Listen for Realtime pairing approval event.<br>5. Fallback 3-second polling timer claims code on approval. |
| **F39** | 4-Digit TV PIN Lock Keypad | Android TV | 1. Render on-screen 0-9 numeric keypad.<br>2. D-pad navigation across keypad buttons.<br>3. Hash entered 4 digits with space salt via SHA-256.<br>4. Compare hash against space `tv_pin_hash`.<br>5. Unlock protected space/folder on match; clear on mismatch. |
| **F40** | Realtime "New file arrived" HUD Toast | Android TV | 1. Subscribe to Realtime channel while TV app is active.<br>2. Receive file `INSERT` event.<br>3. Render non-intrusive HUD toast in corner.<br>4. Display filename and sender name.<br>5. Auto-dismiss toast after 5 seconds or on remote action. |
| **F41** | Android Phone Share Sheet Receiver | Android Phone | 1. Register activity for `ACTION_SEND` intent.<br>2. Register activity for `ACTION_SEND_MULTIPLE` intent.<br>3. Extract `Intent.EXTRA_STREAM` content URIs.<br>4. Resolve content URI to stream and MIME type.<br>5. Pass payload to WorkManager upload queue. |
| **F42** | WorkManager Background Upload Queue | Android Phone | 1. Enqueue `UploadWorker` with `Constraints(CONNECTED)`.<br>2. Upload survives application process termination.<br>3. Exponential backoff retry on transient network loss.<br>4. Track upload progress in system notification.<br>5. Mark upload completed and notify database. |
| **F43** | Headless LibreOffice Conversion Pipeline | CI/CD | 1. Workflow `convert-document.yml` triggers on dispatch.<br>2. Convert `.docx` to `.pdf` via headless LibreOffice.<br>3. Convert `.pptx` to `.pdf` via headless LibreOffice.<br>4. Convert `.xlsx` to `.pdf` via headless LibreOffice.<br>5. Upload converted PDF to Supabase storage. |
| **F44** | Indian Regional Font Pack | CI/CD | 1. Install Malayalam fonts (`fonts-smc`, Rachana, Meera).<br>2. Install Devanagari fonts (`fonts-lohit-deva`).<br>3. Render Malayalam text in PDF without missing glyphs.<br>4. Render Devanagari conjunct ligatures accurately.<br>5. Verified by text rendering probe in CI runner. |
| **F45** | Layout-Preserving UTF-8 Text Extraction | CI/CD | 1. Execute `pdftotext -enc UTF-8 -layout` on converted PDF.<br>2. Extract clean UTF-8 text string.<br>3. Preserve columnar layout and paragraph breaks.<br>4. Sanitize embedded null bytes (`\x00`).<br>5. Update `extracted_text` column in `files` table. |
| **F46** | 6-Hour Fallback Sweeper | CI/CD | 1. Workflow scheduled at `0 */6 * * *`.<br>2. Query files stuck in `processing` status > 30 minutes.<br>3. Query files with status `pending` lacking converted PDF.<br>4. Re-dispatch conversion tasks for unprocessed files.<br>5. Mark unrecoverable files `failed` with error reason. |
| **F47** | Supabase Edge Function Dispatcher | CI/CD | 1. Webhook trigger fires on `files` table insert.<br>2. Edge function `trigger-conversion` receives payload.<br>3. Verify bearer secret authorization header.<br>4. Filter convertible file extensions (docx, pptx, xlsx).<br>5. Dispatch `repository_dispatch` to GitHub API. |
| **F48** | 3-Day Supabase Keep-Alive Cron | CI/CD | 1. Workflow scheduled at `0 4 */3 * *`.<br>2. Ping `health_check_ping()` RPC endpoint.<br>3. Prevent free-tier 7-day database inactivity pause.<br>4. Verify HTTP 200 and healthy status response.<br>5. Execute 30-day trash cleanup as part of keepalive. |
| **F49** | Weekly Sunday Metadata Backup & Pruning | CI/CD | 1. Workflow scheduled at `0 2 * * 0`.<br>2. Export all 10 tables with PostgREST range pagination.<br>3. Compress exported JSON dataset to `.json.gz`.<br>4. Commit backup artifact to repository branch.<br>5. Upload 90-day retention workflow artifact. |
| **F50** | Synthetic Test Fixture Matrix & Testing | Test Infra | 1. Generator script synthesizes all 19 synthetic fixtures.<br>2. Verify SHA-256 checksums match `fixtures_manifest.json`.<br>3. Validate file format signatures and structural integrity.<br>4. Execute Tier 1 through Tier 4 test suites.<br>5. Runner reports test results with exit code 0. |

---

### 2.3 Tier 2: Boundary & Corner Cases Matrix
Tier 2 exercises limits, failure modes, malformed structures, and defensive recovery across all domains:

| Domain | Feature Scope | Boundary & Corner Case Tests (>= 5 Cases) |
|---|---|---|
| **Storage & Quotas** | F17, F21 | 1. Exact 50MB file (52,428,800 bytes) is accepted by storage policy.<br>2. Over-50MB file (52,428,801 bytes) rejected with HTTP 413 / storage violation.<br>3. Zero-byte file (0 bytes) rejected during pre-flight validation.<br>4. Disallowed MIME type (e.g. `application/x-msdownload`) rejected by bucket whitelist.<br>5. Storage upload path lacking `<space_id>/` prefix rejected by RLS. |
| **Auth & Security** | F01, F02, F11 | 1. Cross-space query isolation: User in Space A cannot read files from Space B.<br>2. Revoked TV bearer token immediately rejected with HTTP 401.<br>3. Member role cannot self-promote to `admin` without admin authorization.<br>4. Space invitation token older than 7 days rejected with `expired`.<br>5. Replay of already accepted invite token rejected with `already_consumed`. |
| **Pairing Protocol** | F05, F12, F13, F14 | 1. Pairing code expired (> 10 minutes) returns status `expired`.<br>2. Handshake claimed with invalid device secret returns `not_found`.<br>3. Handshake code claimed twice: second attempt returns `not_found`.<br>4. Code containing ambiguous characters (0, O, 1, I) is never generated.<br>5. Rapid pairing code generation requests are throttled. |
| **Document Conversion** | F43, F44, F45 | 1. Malformed/truncated PDF header rejected gracefully with status `failed`.<br>2. Corrupted DOCX (non-ZIP payload) flagged `failed` without crashing pipeline.<br>3. Scanned PDF with zero text operators yields 0 chars; flags `has_text = false`.<br>4. Document with embedded null bytes (`\x00`) sanitized before SQL insert.<br>5. Wide spreadsheet (15+ columns) converted without text truncation. |
| **TV Viewers & Cache** | F27, F33, F35, F37 | 1. 500MB local cache limit: adding file evicts oldest unpinned file.<br>2. Pinned file (`is_pinned = true`) is never evicted even under 100% cache pressure.<br>3. `SafeTvPdfRenderer` Mutex queues 10 rapid page flips without concurrent render collision.<br>4. 3-page LRU sliding window recycles page 0 bitmap when advancing to page 3.<br>5. 12MP high-res image (4000x3000) decodes in `RGB_565` under 15% heap cap without OOM. |
| **Trash & Maintenance** | F15, F16, F25 | 1. Soft-deleted file at 29 days 23 hours is NOT purged by garbage collection.<br>2. Soft-deleted file at 30 days 1 hour IS permanently purged by garbage collection.<br>3. Soft-deleted parent folder cascades soft-deletion state to all child files.<br>4. Restoring soft-deleted parent folder restores all child items.<br>5. Keepalive ping on empty database returns 0 spaces without error. |

---

### 2.4 Tier 3: Pairwise Cross-Feature Interactions
Tier 3 validates cross-cutting interactions between disparate subsystems:

1. **Chain 1: Multi-Tenant Auth ↔ Space Container ↔ TV Pairing Handshake (F01 + F02 + F05 + F12 + F13 + F14 + F23 + F38)**
   - *Sequence*: User creates Space "Sharma Home" -> TV boots and calls `request_tv_pairing_code()` -> TV renders 320x320 QR code and 6-char code `K9M2P4` -> User scans QR on phone, signs in via Google OAuth, and calls `approve_tv_pairing_code()` -> TV claims token via `claim_tv_pairing_code()` -> TV receives bearer token and registers in `devices` table.
   - *Verification*: Handshake state transitions, token hash generation, and space member association.
2. **Chain 2: Web Share Target ↔ 50MB Storage RLS ↔ Edge Function Dispatch (F20 + F21 + F17 + F18 + F47)**
   - *Sequence*: External app shares 12MB PDF to PWA Web Share Target -> Service Worker intercepts `POST /share-target` -> Client streams file to storage under `<space_id>/inbox/` -> Supabase insert trigger invokes Edge Function `trigger-conversion` -> Function verifies bearer authorization and dispatches GitHub Actions `repository_dispatch`.
   - *Verification*: Multipart stream handling, RLS prefix enforcement, and webhook dispatch payload.
3. **Chain 3: Headless Conversion ↔ Indic Font Rendering ↔ UTF-8 FTS4 Indexing (F43 + F44 + F45 + F26)**
   - *Sequence*: GitHub Actions receives dispatch -> LibreOffice converts Malayalam `.docx` to `.pdf` with `fonts-smc-rachana` -> `pdftotext` extracts UTF-8 text -> Database row updated with extracted text -> Android Core syncs row to Room DB -> `files_fts` SQLite FTS4 indexes Malayalam tokens -> TV search query matches Malayalam keywords.
   - *Verification*: Font glyph fidelity, UTF-8 byte integrity, and FTS tokenization.
4. **Chain 4: Realtime Replication ↔ TV HUD Toast ↔ Safe TV Viewer (F19 + F40 + F32 + F33)**
   - *Sequence*: New document row inserted into Supabase -> Realtime WebSocket pushes `INSERT` event to TV -> TV renders HUD toast notification -> User clicks OK -> TV adds item to Inbox shelf -> TV opens `SafeTvPdfRenderer` with `RGB_565` and 3-page LRU window.
   - *Verification*: Event latency, HUD thread safety, Mutex synchronization, and memory footprint.
5. **Chain 5: Reading Progress ↔ Bookmark Sync ↔ Continue Reading Shelf (F10 + F29 + F32)**
   - *Sequence*: User reads PDF on TV to page 7 -> TV debounces bookmark update to Supabase `bookmarks` table -> Database recalculates `view_continue_reading` -> User restarts TV -> Continue Reading shelf places document at index 0 with page 7.
   - *Verification*: Bookmark persistence, monotonic timestamps, and resume position accuracy.
6. **Chain 6: Remote Web PIN Configuration ↔ TV Keypad ↔ Salted Hash Validation (F01 + F24 + F39)**
   - *Sequence*: Parent opens Web Devices settings -> Sets 4-digit PIN "7492" -> Web hashes PIN with space salt and updates `spaces.tv_pin_hash` -> TV syncs space metadata -> TV user navigates to restricted folder -> TV displays on-screen PIN keypad -> User enters "7492" -> Folder unlocks.
   - *Verification*: Salted SHA-256 matching, incorrect PIN rejection, and locked state preservation.
7. **Chain 7: Soft Delete ↔ Realtime Shelf Eviction ↔ 30-Day Trash Purge (F06 + F07 + F19 + F25 + F15 + F16)**
   - *Sequence*: Member moves file to Trash on Web -> `files.deleted_at` set to current timestamp -> Realtime notifies TV -> TV instantly removes card from Home shelves -> Web displays item in `/trash` with remaining days -> 30 days elapse -> 3-day keepalive ping calls `cleanup_expired_trash()` -> Row and storage object permanently deleted.
   - *Verification*: Realtime shelf eviction, days-remaining countdown, and automated garbage collection.
8. **Chain 8: Phone Share Sheet ↔ WorkManager Queue ↔ 500MB LRU Cache Saturation (F41 + F42 + F27 + F35)**
   - *Sequence*: Phone captures 20 high-res photos -> WorkManager uploads in background -> TV views album in Coil slideshow -> Disk cache approaches 500MB -> `TvCacheManager` triggers LRU eviction -> Oldest unpinned files deleted -> Pinned legal deeds survive.
   - *Verification*: WorkManager retry behavior, 500MB ceiling compliance, and pinned file immunity.

---

### 2.5 Tier 4: Real-World Workload Scenarios
Tier 4 simulates realistic, end-to-end family document management workflows:

#### Scenario 1: First-Time Living Room TV Onboarding & Pairing
- **Persona**: Family setting up a new budget Android TV (API 28).
- **Workflow**:
  1. TV app launches unauthenticated; generates hardware ID `tv-living-room-01` and calls `request_tv_pairing_code()`.
  2. TV displays pairing code `J7K3X9` in 48sp text alongside a 320x320 ZXing QR code.
  3. TV opens Realtime WebSocket channel and initiates a 3-second polling timer.
  4. Mother scans QR on phone, signs in via Google OAuth, selects space "Sharma Family", and approves TV.
  5. TV receives Realtime approval, calls `claim_tv_pairing_code()`, stores bearer token in `SecureSessionStore`, and renders Home screen.
- **Pass Criteria**: Handshake completes in < 5 seconds; token saved defensively; zero UI crashes.

#### Scenario 2: Emergency WhatsApp Medical Report Ingestion to TV Reading
- **Persona**: Father at hospital sends a 14-page Malayalam medical report PDF to grandparents at home.
- **Workflow**:
  1. Father shares PDF from WhatsApp -> Selects "Family File Library" (PWA Web Share Target).
  2. PWA Service Worker intercepts upload, validates size (8.4MB <= 50MB), uploads to `family-files`, and creates catalog record.
  3. Supabase Realtime alerts TV; HUD toast appears: "New file: Discharge_Summary.pdf".
  4. Grandparent presses remote OK -> TV downloads file via atomic `.tmp` rename.
  5. `SafeTvPdfRenderer` opens file; page 1 renders in `RGB_565`; D-pad flips pages; TTS ducks background audio and reads Malayalam text.
- **Pass Criteria**: End-to-end transit < 10 seconds; low-memory Mutex prevents OOM; bookmark saved on exit.

#### Scenario 3: School Office Presentation Upload with Indic Fonts & TV Display
- **Persona**: Student uploads a 30-slide `.pptx` containing Hindi notes for family review.
- **Workflow**:
  1. Student drags `Hindi_History_Presentation.pptx` (22MB) onto Web Uploader into `School/` folder.
  2. Database trigger fires Edge Function, sending `repository_dispatch` to GitHub Actions.
  3. CI workflow installs `fonts-lohit-deva`, converts presentation to PDF via headless LibreOffice.
  4. CI extracts UTF-8 text via `pdftotext` and updates database record to `ready`.
  5. TV updates Folders shelf; TV opens converted PDF; Hindi text renders without missing glyphs; FTS search for "इतिहास" finds slide 3.
- **Pass Criteria**: Conversion finishes in <= 90s; Devanagari ligatures render accurately; FTS search succeeds.

#### Scenario 4: High-Volume Vacation Photo Ingestion & Cache Saturation Under Low Heap
- **Persona**: Family uploads 40 high-resolution vacation photos (380MB total) while TV holds existing documents.
- **Workflow**:
  1. Web uploader batches photos to `Vacation_2026/` folder.
  2. TV launches Slideshow mode in Coil image viewer.
  3. Coil limits memory to 15% of device RAM heap (~76MB on 512MB device) using `RGB_565`.
  4. As photos are viewed, `TvCacheManager` writes to disk; cache reaches 490MB (> 500MB cap).
  5. `TvCacheManager.evictIfNeeded()` triggers: unpinned old documents evicted until cache drops below 400MB.
  6. Two pinned property deeds (15MB each, `is_pinned = true`) remain intact in cache.
  7. Network disconnected (offline test): pinned deeds open immediately; evicted files show download badge.
- **Pass Criteria**: Zero OutOfMemoryError; cache never exceeds 500MB; pinned files survive; offline access works.

#### Scenario 5: Accidental Deletion Recovery & Automated Free-Tier Keepalive
- **Persona**: User accidentally deletes important tax document on Web; system recovers it while maintaining cloud tier.
- **Workflow**:
  1. User clicks "Delete" on `Tax_Return_2025.pdf` on Web.
  2. Record flagged `deleted_at = now()`; file disappears from active TV shelves via Realtime.
  3. User navigates to `/trash` on Web 3 days later, sees "27 days remaining", and clicks "Restore".
  4. System clears `deleted_at = null`; document reappears on TV with preserved bookmark.
  5. Another file `Temp_Log.txt` has `deleted_at = now() - 31 days`.
  6. 3-day cron `supabase-keepalive.yml` pings `health_check_ping()`.
  7. RPC resets 7-day inactivity pause counter and executes `cleanup_expired_trash()`, permanently purging `Temp_Log.txt` while keeping `Tax_Return_2025.pdf` safe.
- **Pass Criteria**: Realtime updates reflect soft delete and restore; keepalive ping succeeds; expired files purged.

---

## 3. Black-Box Component Interface Specifications

### 3.1 Supabase Backend & Database RPC Contracts
- **`request_tv_pairing_code` RPC Contract**:
  - Endpoint: `POST /rest/v1/rpc/request_tv_pairing_code`
  - Request Headers: `apikey: <anon_key>`, `Authorization: Bearer <anon_key>`, `Content-Type: application/json`
  - Request Body: `{"p_device_identifier": "tv-device-uuid", "p_device_name": "Living Room TV"}`
  - Response (200 OK): `{"code": "X7K2P9", "device_secret": "<32-byte-hex>", "expires_at": "2026-11-11T16:00:00Z"}`
  - Validation: `code` matches regex `^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$`.
- **`approve_tv_pairing_code` RPC Contract**:
  - Endpoint: `POST /rest/v1/rpc/approve_tv_pairing_code`
  - Request Headers: `apikey: <anon_key>`, `Authorization: Bearer <user_jwt>`, `Content-Type: application/json`
  - Request Body: `{"p_code": "X7K2P9", "p_space_id": "<space_uuid>"}`
  - Response (200 OK): `{"success": true, "device_id": "<device_uuid>", "device_name": "Living Room TV"}`
- **`claim_tv_pairing_code` RPC Contract**:
  - Endpoint: `POST /rest/v1/rpc/claim_tv_pairing_code`
  - Request Headers: `apikey: <anon_key>`, `Authorization: Bearer <anon_key>`, `Content-Type: application/json`
  - Request Body: `{"p_device_identifier": "tv-device-uuid", "p_device_secret": "<32-byte-hex>"}`
  - Response (200 OK): `{"status": "approved", "device_id": "<uuid>", "space_id": "<uuid>", "device_token": "<48-byte-hex>"}`
- **`health_check_ping` RPC Contract**:
  - Endpoint: `POST /rest/v1/rpc/health_check_ping`
  - Request Headers: `apikey: <anon_key>`, `Authorization: Bearer <anon_key>`, `Content-Type: application/json`
  - Request Body: `{}`
  - Response (200 OK): `{"status": "healthy", "timestamp": "...", "active_spaces_count": 1, "trash_files_purged": 0, "trash_folders_purged": 0}`

### 3.2 Web PWA Share Target & Service Worker Contracts
- **Manifest Declaration (`web-uploader/public/manifest.json`)**:
  - Verifies presence of `share_target` object:
    - `action`: `"/share-target"`
    - `method`: `"POST"`
    - `enctype`: `"multipart/form-data"`
    - `params`: `{"files": [{"name": "file", "accept": ["image/*", "application/pdf", ".docx", ".pptx", ".xlsx", ".txt", ".md"]}]}`
- **Service Worker Interceptor (`web-uploader/public/sw.js`)**:
  - Verifies event listener on `fetch` event for `url.pathname === '/share-target'` and `request.method === 'POST'`.
  - Verifies extraction of `formData.getAll('file')` and serialization into IndexedDB store `'shared_files'`.
  - Verifies client redirection to `/?shared=true`.

### 3.3 Room Database & SQLite FTS4 Contracts
- **Schema & FTS4 Virtual Table**:
  - `files` table contains: `id`, `space_id`, `folder_id`, `name`, `file_type`, `size_bytes`, `storage_path`, `status`, `extracted_text`, `deleted_at`.
  - `files_fts` virtual table created with `USING fts4(content="files", name, extracted_text)`.
  - Triggers `files_bu`, `files_bd`, `files_ai`, `files_au` keep FTS index synchronized on modifications.
  - Prefix query: `SELECT docid FROM files_fts WHERE files_fts MATCH 'term*'` returns exact row ids.

### 3.4 Android TV Safe Viewer & Cache Invariants
- **`SafeTvPdfRenderer` Synchronization**:
  - Single-page coroutine `Mutex` wraps all `PdfRenderer.Page.render()` calls.
  - Page bitmap allocations strictly use `Bitmap.Config.RGB_565`.
  - Memory cache maintains at most 3 pages in memory (current, previous, next); page 0 recycled when moving to page 3.
- **`TvCacheManager` Quota & Eviction**:
  - Storage quota: exactly 500MB (524,288,000 bytes).
  - Eviction policy: least-recently-accessed unpinned file evicted first.
  - Pinned immunity: files with `is_pinned = true` are never evicted.
- **Remote D-Pad Routing**:
  - Key codes: `21` (Left/Prev), `22` (Right/Next), `23`/`66` (Center/Enter/Toolbar), `4` (Back/Exit), `85` (PlayPause/TTS).
- **TTS Engine Probe**:
  - Pre-flight check calls `TextToSpeech.getEngines()`; if empty, sets `canSpeak = false` and opens on-screen text modal without crash.

### 3.5 GitHub Actions CI/CD & Automation Contracts
- **`convert-document.yml` Trigger & Pipeline**:
  - Triggers: `repository_dispatch` (types `[convert-document, process-file]`), `workflow_dispatch`, and cron `0 */6 * * *`.
  - Environment: `ubuntu-latest`, installs `fonts-smc`, `fonts-smc-rachana`, `fonts-smc-meera`, `fonts-deva`, `fonts-lohit-deva`, `poppler-utils`.
  - Toolchain: headless LibreOffice conversion to PDF followed by `pdftotext -enc UTF-8 -layout`.
- **`supabase-keepalive.yml` Schedule**:
  - Trigger: cron `0 4 */3 * *` (every 3 days at 04:00 UTC).
  - Target: pings `health_check_ping()` RPC to reset 7-day inactivity pause counter.
- **`supabase-backup.yml` Schedule**:
  - Trigger: cron `0 2 * * 0` (Sundays at 02:00 UTC).
  - Script: `scripts/backup_metadata.py` exports all 10 tables to `.json.gz` with Git commit and 90-day retention artifact.

---

## 4. Synthetic Fixture Inventory Integration

The test harness integrates with the synthetic fixture catalog located at `tests/fixtures/`. The fixtures are generated deterministically by `tests/fixtures/generate_fixtures.py` using pure Python standard library (zero external dependencies):

| # | Fixture Filename | Format / MIME Type | Target Size | Purpose |
|---|---|---|---|---|
| 1 | `sample_document.pdf` | `application/pdf` | ~4 KB | Standard multi-page PDF reading (F33, F50) |
| 2 | `sample_scanned.pdf` | `application/pdf` | ~12 KB | Scanned PDF text extraction failure (F45, F37) |
| 3 | `sample_indic_malayalam.docx` | OpenXML DOCX | ~8 KB | Malayalam conversion & font rendering (F43, F44) |
| 4 | `sample_indic_malayalam.pdf` | `application/pdf` | ~6 KB | Malayalam TV viewer & FTS search (F26, F33, F44) |
| 5 | `sample_indic_devanagari.docx` | OpenXML DOCX | ~8 KB | Hindi / Devanagari conversion (F43, F44) |
| 6 | `sample_indic_devanagari.pdf` | `application/pdf` | ~6 KB | Devanagari TV viewer & FTS search (F26, F33, F44) |
| 7 | `sample_slides.pptx` | OpenXML PPTX | ~15 KB | Presentation conversion pipeline (F43, F50) |
| 8 | `sample_sheet.xlsx` | OpenXML XLSX | ~9 KB | Multi-column spreadsheet conversion (F43, F50) |
| 9 | `sample_text.txt` | `text/plain` | ~2 KB | 28sp TV plain text reader (F36) |
| 10 | `sample_markdown.md` | `text/markdown` | ~3 KB | 28sp TV Markdown viewer (F36) |
| 11 | `sample_photo.jpg` | `image/jpeg` | ~25 KB | TV Coil image viewer standard photo (F35) |
| 12 | `sample_image.png` | `image/png` | ~5 KB | TV Coil PNG viewer with alpha channel (F35) |
| 13 | `sample_photo_12mp.png` | `image/png` | ~45 KB / 48MB raw | 12MP high-res memory stress test (F35, F50) |
| 14 | `sample_50mb_boundary.bin` | `application/octet-stream` | **52,428,800 bytes** | Exact 50MB storage boundary acceptance (F17, F21) |
| 15 | `sample_over_50mb.bin` | `application/octet-stream` | **52,428,801 bytes** | Over-50MB storage reject boundary (F17, F21) |
| 16 | `sample_zero_byte.txt` | `text/plain` | **0 bytes** | Null payload pre-flight validation (F21, F43) |
| 17 | `sample_corrupt.pdf` | `application/pdf` | 128 bytes | PDF renderer error recovery (F33, F43) |
| 18 | `sample_corrupt.docx` | OpenXML DOCX | 256 bytes | Office conversion failure recovery (F43, F50) |
| 19 | `sample_null_bytes.txt` | `text/plain` | 512 bytes | PostgreSQL string sanitization (F07, F45) |

### Fixture Manifest (`fixtures_manifest.json`)
The generator outputs `tests/fixtures/fixtures_manifest.json` containing SHA-256 checksums, byte sizes, and MIME types for automated verification before test execution.

---

## 5. Test Harness & Runner CLI Reference

The test runner is implemented in pure Node.js standard built-ins (`tests/e2e/runner.js`) requiring zero `npm install` packages.

### 5.1 CLI Command Syntax
```text
node tests/e2e/runner.js [options] [test-files...]
```

### 5.2 Command-Line Options
| Option | Short | Type | Default | Description |
|---|---|---|---|---|
| `--tier <tier>` | `-t` | string | `all` | Filter execution by tier: `1`, `2`, `3`, `4`, or `all` |
| `--feature <id>`| `-f` | string | - | Filter execution by Feature ID (e.g. `F01`, `F05`, `F33`) |
| `--grep <regex>`| `-g` | string | - | Filter tests by pattern match on test name |
| `--timeout <ms>`| - | string | `10000` | Global per-test timeout guard in milliseconds |
| `--format <fmt>`| `-F` | string | `console` | Reporter output: `console`, `tap`, `json`, or `all` |
| `--output <path>`| `-o`| string | - | File path to write structured TAP or JSON report |
| `--bail` | `-b` | boolean| `false` | Stop execution immediately upon first test failure |
| `--verbose` | `-v` | boolean| `false` | Enable verbose diagnostic logging and stack traces |
| `--list` | `-l` | boolean| `false` | List discovered matching tests without executing them |
| `--mock` | - | boolean| auto | Force in-memory mock backend mode |
| `--live` | - | boolean| auto | Force live Supabase integration mode (requires env vars) |
| `--no-color` | - | boolean| `false` | Disable ANSI terminal color codes |
| `--help` | `-h` | boolean| `false` | Show CLI help and options summary |

### 5.3 Exit Code Semantics
- `0`: All executed tests passed cleanly (or skipped).
- `1`: One or more tests failed or timed out.
- `2`: Harness configuration error (invalid flags, missing test files, runner exception).

### 5.4 Example Commands
```bash
# 1. Run all tests in console reporter mode
node tests/e2e/runner.js

# 2. Run Tier 1 feature coverage tests only
node tests/e2e/runner.js --tier=1

# 3. Run tests for a specific feature (e.g. F05 Ephemeral Pairing Handshake)
node tests/e2e/runner.js --feature=F05

# 4. Run with TAP v13 reporting saved to file
node tests/e2e/runner.js --format=tap --output=tests/reports/results.tap

# 5. Run with JSON reporting saved to file
node tests/e2e/runner.js --format=json --output=tests/reports/results.json

# 6. List all registered tests matching a pattern
node tests/e2e/runner.js --grep="Malayalam" --list
```

---

## 6. Directory Layout Specification

The test infrastructure follows this directory layout:

```text
android tv file app/
├── TEST_INFRA.md                    # This document (Architecture & Matrix Specification)
├── TEST_READY.md                    # Verification readiness declaration (Milestone E5)
├── tests/
│   ├── e2e/
│   │   ├── runner.js                # CLI executable runner entrypoint (zero dependencies)
│   │   ├── framework/               # Core test engine
│   │   │   ├── index.js             # Public API: exports { describe, test, assert }
│   │   │   ├── cli_parser.js        # CLI parser using node:util.parseArgs
│   │   │   ├── test_registry.js     # Suite, test, and filter registry
│   │   │   ├── executor.js          # Async executor with Promise.race timeout guards
│   │   │   ├── assert.js            # Assertions & domain matchers
│   │   │   ├── context.js           # Test context builder (mock client, signal, fixtures)
│   │   │   └── reporters/           # Multi-format reporters
│   │   │       ├── console_reporter.js # ANSI colored hierarchy, progress, summary
│   │   │       ├── tap_reporter.js     # TAP v13 stream generator
│   │   │       └── json_reporter.js    # Machine-readable JSON reporter
│   │   ├── helpers/                 # In-memory simulators and helpers
│   │   │   ├── index.js             # Helper exports
│   │   │   ├── fixture_helper.js    # Resolves and validates tests/fixtures/
│   │   │   ├── http_client.js       # WHATWG fetch wrapper with retry & timeout
│   │   │   ├── supabase_mock.js     # In-memory PostgREST + RPC + Storage mock
│   │   │   ├── tv_state_simulator.js# TV state machine (D-pad, LRU window, cache quota)
│   │   │   └── crypto_helper.js     # SHA-256 tokens, pairing codes, salt hashing
│   │   ├── tier1_features/          # Tier 1: Feature Coverage (F01–F50)
│   │   ├── tier2_boundaries/        # Tier 2: Boundary & Corner Cases
│   │   ├── tier3_interactions/      # Tier 3: Cross-Feature Interactions
│   │   └── tier4_scenarios/         # Tier 4: Real-World Workload Scenarios
│   ├── fixtures/                    # Synthetic Fixture Catalog
│   │   ├── generate_fixtures.py     # Pure Python stdlib fixture generator
│   │   ├── fixtures_manifest.json   # Catalog manifest with sha256 checksums
│   │   └── ...                      # 19 synthetic fixture files
│   └── reports/                     # Output test artifacts (tap, json)
```
