# Android TV Family File Library - Setup & Sideloading Guide

This guide provides end-to-end instructions for deploying, configuring, and operating the complete Android TV Family File Library ecosystem on a **100% Free Tier** infrastructure.

---

## 1. Prerequisites & Free Tier Boundaries

| Component | Free Tier Provider | Limits & Free Tier Invariants |
| :--- | :--- | :--- |
| **Backend & Database** | Supabase Free Tier | 500 MB Postgres database, 1 GB Storage, 50 MB per-file upload limit, 5 GB monthly egress, 7-day inactivity pause. |
| **Auth** | Supabase Auth (Google OAuth 2.0) | Up to 50,000 monthly active users (MAUs). |
| **CI/CD & Conversion** | GitHub Actions | 2,000 free runner minutes/month (runs LibreOffice headless with Indian regional fonts). |
| **Web Uploader PWA** | Cloudflare Pages / Vercel / GitHub Pages | Unlimited static requests, 100% free hosting. |
| **Android TV Client** | Local Sideloading (ADB / Downloader) | Runs on Android 9+ (API 28–34), zero cloud runtime dependencies. |

---

## 2. Supabase Backend Setup

### Step 2.1: Create Supabase Project
1. Go to [database.new](https://database.new) and create a free Supabase organization and project (e.g. `family-file-library`).
2. Choose your nearest region (e.g., `ap-south-1` Mumbai for low latency in India).
3. Save your database password securely.

### Step 2.2: Apply Database Schema Migration
1. In the Supabase Dashboard, navigate to the **SQL Editor**.
2. Open [supabase/migrations/20261111000000_family_file_library_init.sql](file:///d:/UVM/PROJECTS/android%20tv%20file%20app/supabase/migrations/20261111000000_family_file_library_init.sql).
3. Paste and execute the SQL migration. This automatically creates:
   - 10 tables: `profiles`, `spaces`, `space_members`, `space_invites`, `tv_pairing_codes`, `folders`, `files`, `file_bookmarks`, `cache_pins`, `audit_logs`.
   - Complete Row Level Security (RLS) policies enforcing multi-tenant isolation.
   - Atomic Stored Procedures: `request_tv_pairing_code`, `approve_tv_pairing_code`, `claim_tv_pairing_code`, `accept_space_invite`, `cleanup_expired_trash`, `health_check_ping`.
   - Realtime Publication enabling instant notifications when files or pairing codes change.

### Step 2.3: Storage Bucket Configuration
The migration automatically configures the `family_library` storage bucket with:
- `public: false` (secure private storage accessed via authenticated tokens).
- `file_size_limit: 52428800` (50 MB strict upload ceiling).
- Storage RLS policies verifying `has_space_access(auth.uid(), space_id, 'viewer'/'editor')`.

### Step 2.4: Google OAuth 2.0 Configuration
1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
2. Create an **OAuth 2.0 Client ID** (Web application).
3. Set Authorized redirect URIs:
   `https://<your-supabase-project-ref>.supabase.co/auth/v1/callback`
4. In Supabase Dashboard -> **Authentication** -> **Providers** -> **Google**:
   - Enable Google.
   - Enter your Client ID and Client Secret.

---

## 3. GitHub Actions CI/CD & Automation Setup

The repository includes three automated workflows in `.github/workflows/`:
1. `convert-document.yml`: Headless LibreOffice conversion pipeline with Indic fonts (`fonts-smc`, `fonts-lohit-deva`, etc.) and `pdftotext` text extraction.
2. `supabase-keepalive.yml`: Runs every 3 days at 04:00 UTC to ping `health_check_ping` RPC, preventing Supabase free tier inactivity pausing.
3. `supabase-backup.yml`: Runs every Sunday at 02:00 UTC to export paginated table JSON, compress with Gzip, and commit to the repo (pruning backups older than 12 weeks).

### Required GitHub Secrets
In your GitHub repository, navigate to **Settings** -> **Secrets and variables** -> **Actions** and add:
- `SUPABASE_URL`: `https://<your-project-ref>.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY`: Your Supabase `service_role` secret (from Dashboard -> Project Settings -> API).
- `GITHUB_PAT`: A personal access token with `repo` scope (or use default `GITHUB_TOKEN` with write permissions enabled in repository Settings -> Actions -> General -> Workflow permissions -> "Read and write permissions").

---

## 4. Web Uploader PWA Deployment

The Web Uploader PWA (`web-uploader/`) enables phone and desktop browsers to upload files up to 50MB and approve TV pairing requests.

### Option A: Local Run / Preview
```bash
cd web-uploader
npm install
npm run build
npm run preview
```

### Option B: Deploy to Cloudflare Pages (Recommended)
1. Push your repository to GitHub.
2. In Cloudflare Dashboard -> **Pages** -> **Connect to Git**.
3. Set:
   - **Framework preset**: Vite
   - **Build command**: `cd web-uploader && npm install && npm run build`
   - **Build output directory**: `web-uploader/dist`
   - **Environment variables**:
     - `VITE_SUPABASE_URL`: `https://<your-project-ref>.supabase.co`
     - `VITE_SUPABASE_ANON_KEY`: `<your-supabase-anon-key>`
4. Deploy! Your PWA will be live on an HTTPS custom domain or `*.pages.dev`.

### Web Share Target Verification
When installed as a PWA on an Android phone (via Chrome -> "Add to Home screen"):
- Any file shared from WhatsApp, Google Drive, or Gmail can be shared directly to "Family File Library".
- The custom Service Worker (`public/sw.js`) intercepts `POST /share-target`, spools the files into IndexedDB, and redirects to the upload queue.

---

## 5. Android TV App Sideloading

The Android TV client is located at:
`android/tv/build/outputs/apk/debug/tv-debug.apk`

### Prerequisites for the TV:
1. Turn on Developer Options on your Android TV:
   - Go to **Settings** -> **Device Preferences** -> **About**.
   - Click **Android TV OS build** 7 times until it says *"You are now a developer!"*.
2. In **Settings** -> **Device Preferences** -> **Developer options**, enable **USB debugging** (and **Network debugging** if installing wirelessly).

### Method 1: Sideload via ADB (Fastest)
1. Connect your computer to the same Wi-Fi network as the TV.
2. Find the TV's IP address under **Settings** -> **Network & Internet** (e.g. `192.168.1.150`).
3. On your computer terminal:
   ```bash
   adb connect 192.168.1.150:5555
   adb install -r "android/tv/build/outputs/apk/debug/tv-debug.apk"
   ```
4. A prompt will appear on the TV screen asking "Allow USB debugging?". Check "Always allow from this computer" and click **OK**.
5. The TV app `Family TV Library` will now appear in your TV's Apps shelf.

### Method 2: Sideload via Downloader App
1. On your Android TV, open the Google Play Store and install **Downloader by AFTVnews**.
2. Host the APK on a local web server, GitHub Releases, or Cloudflare Pages.
3. Open Downloader, enter the direct URL to the APK, download, and click **Install**.

---

## 6. First-Time TV Pairing Workflow

1. **Launch TV App**: Open `Family TV Library` on Android TV.
2. **Pairing Screen**:
   - The TV displays a 320x320 QR code and a 6-character code (e.g. `AB3X8K`).
   - The TV begins listening for real-time claim approval.
3. **Scan with Phone**:
   - Scan the QR code with any smartphone camera or open the Web Uploader at `/pair`.
   - Sign in with Google (if not already signed in).
   - Enter or confirm the 6-character code and select your Family Space.
   - Click **Approve TV**.
4. **Instant Unlock**:
   - Within 1 second, the TV app claims the code via the atomic RPC `claim_tv_pairing_code`, receives its scoped JWT and space access, stores it defensively in `SecureSessionStore` (`EncryptedSharedPreferences`), and transitions to the Home Screen.

---

## 7. Android Phone Companion App (Optional)

The phone module (`android/phone/build/outputs/apk/debug/phone-debug.apk`) provides native Android Share Sheet integration with offline WorkManager spooling.

### Installation:
```bash
adb install -r "android/phone/build/outputs/apk/debug/phone-debug.apk"
```
- Open WhatsApp or your file manager, tap **Share** on any PDF, image, or document, and choose **Send to TV Library**.
- The `UploadWorker` automatically handles retries with exponential backoff and uploads files directly to Supabase storage.

---

## 8. Verification & Diagnostic Runbook

To verify your deployment at any time:

### Run Full Test Suite:
```bash
# 1. Python Backend & Automation Tests (149 tests)
pytest tests/ -v

# 2. Comprehensive E2E Test Runner (145 tests across F01-F50)
node tests/e2e/runner.js

# 3. Android Multi-Module Unit Tests & APK Assembly
cd android
./gradlew.bat assembleDebug testDebugUnitTest
```
All tests should report 100% passing with 0 failures.
