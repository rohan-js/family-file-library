# Original User Request

## Initial Request — 2026-11-11T15:01:51Z

Build the Android TV Family File Library system spanning an Android TV app, web uploader PWA, multi-module Android project, Supabase backend, and GitHub Actions CI/CD workflows for family document and media access.

Working directory: D:\UVM\PROJECTS\android tv file app
Integrity mode: development

Reference files:
- Specification file: "Android TV Family File Library Implementation Plan.md"
- Approved implementation plan: "C:\Users\rohan\.gemini\antigravity\brain\e9937b3d-5593-4e2c-87b6-699ea770c930\android_tv_family_file_library_plan.md"
- Architecture documentation: "ARCHITECTURE.md", "SUPABASE_ARCHITECTURE.md", and "docs/DOCUMENT_CONVERSION_AND_CICD.md"

## Requirements

### R1. Supabase Backend
Verify and finalize the database schema migration (10 tables, RLS policies, pairing RPC functions, 30-day trash cleanup, storage bucket policies) in "supabase/migrations/20261111000000_family_file_library_init.sql".

### R2. Web Uploader PWA
Build the complete Vite + React + TypeScript + Tailwind CSS PWA in "web-uploader/" with Web Share Target API (manifest + Service Worker POST /share-target interceptor) for WhatsApp/Android share sheet ingestion, Supabase Auth (Google OAuth), device pairing screen (/pair), remote PIN management, folder hierarchy, and drag-and-drop 50MB uploader with progress.

### R3. Android Multi-Module Project
Implement the Android Gradle multi-module project in "android/":
- ":core" module: Room DB with SQLite FTS4, LRU file cache manager (500MB cap), Supabase-kt client, EncryptedSharedPreferences for device tokens.
- ":tv" module: Kotlin + Jetpack Compose for TV (minSdk 28, targetSdk 34), 10-foot UI with 5% overscan margins and 24sp+ typography, D-pad remote navigation, 3-page low-memory PdfRenderer with RGB_565 and Mutex synchronization, Coil image viewer (pan, zoom, rotate, slideshow), Text/Markdown viewer, TTS engine check & fallback, ZXing QR pairing screen, PIN lock keypad, and Realtime new-file notification popup.
- ":phone" module: Share sheet receiver and background upload with WorkManager.

### R4. GitHub Actions CI/CD & Automation
Verify and finalize ".github/workflows/convert-document.yml" (headless LibreOffice with Indic fonts fonts-smc and Lohit Devanagari, pdftotext), ".github/workflows/supabase-keepalive.yml" (every 3 days ping), and ".github/workflows/supabase-backup.yml" (weekly metadata export).

### R5. Build Verification, Test Matrix Execution, and Documentation
Verify builds across all components, generate synthetic test fixtures and execute unit tests, and provide setup and sideloading documentation.

## Acceptance Criteria

### Supabase Backend
- [ ] Schema migration in "supabase/migrations/20261111000000_family_file_library_init.sql" contains valid SQL covering all 10 tables, RLS policies, pairing RPCs, 30-day trash cleanup, and storage bucket policies.

### Web Uploader PWA
- [ ] Web uploader project in "web-uploader/" compiles cleanly with `npm run build` with zero TypeScript or build errors.
- [ ] PWA manifest and service worker configuration implement Web Share Target POST handling for file uploads.
- [ ] Pairing screen, remote PIN management, folder navigation, and 50MB file upload components are implemented.

### Android Modules
- [ ] Android Gradle multi-module build completes successfully with `./gradlew assembleDebug` (or gradle check/assemble tasks across :core, :tv, and :phone modules) without compilation errors.
- [ ] Room DB schemas, LRU cache logic, and Supabase client bindings in `:core` pass unit tests (`./gradlew test`).
- [ ] TV UI in `:tv` targets minSdk 28, targetSdk 34, uses Compose for TV with remote D-pad focus handling, and implements low-memory PdfRenderer, Coil image viewer, Text/Markdown reader, and pairing QR view.
- [ ] Phone module in `:phone` implements share sheet reception and WorkManager background upload.

### CI/CD and Automation
- [ ] Workflow YAML files in ".github/workflows/" (`convert-document.yml`, `supabase-keepalive.yml`, `supabase-backup.yml`) are valid YAML matching the required schedules and trigger events.
- [ ] Conversion scripts in `scripts/` handle document conversion and metadata backup as specified.

### Documentation
- [ ] Setup and sideloading documentation is provided with clear steps for configuring Supabase environment variables, building/sideloading the TV APK, and deploying the Web PWA.
