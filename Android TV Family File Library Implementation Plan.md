# Android TV Family File Library: Implementation Plan

Implementation plan · November 11, 2026

Where you said "recommend" or "not sure", I made the call and explained why, so you can overrule me.

## What we're building

A **family file library**. Anyone in the family signs in with Google on a web page or phone app, uploads files into an Inbox or folders, and the TV app shows them in near real time. The TV opens everything with its own built-in readers and keeps working offline once files are cached.

## Architecture

| Part | Choice | Why |
| --- | --- | --- |
| Backend | **Supabase free plan** (Auth, Postgres, Storage, Realtime, Edge Functions) | Free, no card, and Google sign-in is built in |
| TV app | Kotlin + Jetpack Compose for TV, targeting Android 9 (API 28) | Native readers, no old WebView problems |
| Web uploader | React PWA on Cloudflare Pages or GitHub Pages | Free, installable, and it can appear in the phone's "Share" menu |
| Phone app | Native Android (Kotlin) | Share-sheet receiver and reliable background uploads |
| Office conversion | GitHub Actions running LibreOffice | Free and high fidelity |
| Code layout | One Gradle project with `core` (shared data layer), `tv` and `phone` modules | The TV and phone apps share one codebase for sync |

**Why Supabase and not Firebase:** Since February 3, 2026, Cloud Storage for Firebase requires the paid Blaze plan, even at tiny usage, which means a card on file. That breaks your "completely free" rule.

**Supabase free limits to design around:** 500 MB database, 1 GB file storage, 5 GB monthly bandwidth, 50,000 monthly active users, and projects pause after one week of inactivity. Our answers:

- Add a scheduled GitHub Action that pings the project every few days, so it never pauses.
- Cache files on the TV so downloads happen once, which keeps you far below the bandwidth cap.
- There are no free backups, so add a weekly metadata export in M9.
- Check the per-file upload cap in your dashboard. I believe it is 50 MB on free plans, and I'd enforce it in the uploader with a clear message.

## Key design decisions

1. **Office files (your "recommend" answer).** On upload, a GitHub Action converts Word, PowerPoint and Excel files to PDF with LibreOffice and saves it beside the original. The TV shows "Preparing…" for about a minute, then opens the PDF. Install Malayalam and Hindi fonts on the runner so Indian-language documents render correctly. Excel pages may split awkwardly, which is a known limit of converting spreadsheets. Use a **private** repo, since files pass through it.
2. **TV login via pairing code.** Google sign-in is painful on a TV. The TV shows a code and QR, a signed-in family member approves it on the phone or web, and the TV gets its own long-lived device session. Reading and writing is protected by Postgres Row Level Security on every table.
3. **Family model.** One shared "space" with an invite list of Gmail addresses. Anyone in it can upload and delete.
4. **Trash (my addition).** Because everyone can delete, deletes go to Trash for 30 days. It's one table column and it saves you from a lot of accidents.
5. **TV permissions (my default).** The TV can view, favorite, bookmark, add notes, and delete to Trash. Uploads happen on phone and web. Change this if you like.
6. **PIN lock.** It is stored as a salted hash on the TV, and a family member can reset it remotely from the web. Treat it as a convenience lock, not strong security.
7. **PDF reading.** Android's built-in `PdfRenderer` draws pages, but it can't extract text. The GitHub Action also runs `pdftotext` and stores the text, which feeds read-aloud and search. **Scanned or handwritten PDFs have no text, so read-aloud won't work on them.**

## TV experience

- **Home:** rows for Continue reading, Favorites, Inbox and Folders, plus Search and Settings.
- **Remote keys:** OK shows or hides the toolbar, Left/Right changes page, Up/Down scrolls, and Back goes up one level.
- **Readers:** images (zoom, pan, rotate, fit, slideshow), PDF (pages, zoom, bookmarks), text and Markdown (large type), notes overlay, and read-aloud.
- **10-foot UI:** dark theme, body text of 24sp or more, a clear focus ring, and a 5% screen margin for overscan.
- **Live popup:** "New file arrived" appears only while the app is open, since there is no background push without Firebase Cloud Messaging.
- **Read-aloud risk:** Android TV may not include a text-to-speech engine. Test this on your TV in M0.

## Data model (Postgres)

`spaces`, `members`, `invites`, `devices`, `pairing_codes`, `folders` (with parent), `files` (name, type, size, storage path, PDF path, text path, status, uploader, deleted\_at), `notes`, `favorites`, `bookmarks`. On the TV, a Room database mirrors the metadata plus a full-text search index, and files live in app storage with a size cap and least-recently-used eviction.

## Milestones

| # | Build | Done when |
| --- | --- | --- |
| M0 | Accounts, Android Studio, TV emulator, ADB to your real TV, Google OAuth setup | A hello-world app runs on your TV, and you've tested text-to-speech |
| M1 | Schema, security rules, storage bucket, invites, keep-alive | A test proves family A can never see family B's data |
| M2 | Web uploader: sign-in, folders, progress, Inbox, Trash, Share target | A file shared from WhatsApp lands in the Inbox |
| M3 | TV shell: pairing, home rows, folders, live popup, PIN | Upload on the phone, and the TV shows it within seconds |
| M4 | Viewers: images, then text/Markdown, then PDF | Each opens smoothly with only the remote |
| M5 | Conversion and text extraction pipeline | A `.docx` becomes viewable on the TV with no manual step |
| M6 | Resume, bookmarks, notes, favorites, search, read-aloud | Close the app mid-PDF, reopen, and you're back on the same page |
| M7 | Offline cache and storage settings | Turn off Wi-Fi and cached files still open |
| M8 | Native phone app: share sheet, background upload | Upload keeps going with the screen off |
| M9 | Hardening, backups, signing, install guide | The test matrix passes |

If you ever need to cut scope, cut M8 first. The PWA with the Share target covers most of what the phone app does.

## Working with AI on Windows

- Install Android Studio, create a **private GitHub repo**, and keep `SPEC.md` (this plan), `ARCHITECTURE.md` and a task list in it. Give your AI coding tool one milestone at a time and commit after each one.
- Run the TV emulator on an Android 9 image, then always confirm on your real TV, because old hardware behaves differently.
- **Back up your signing keystore.** Without it you can't update the installed APK, and you'd have to uninstall and lose the TV's cache.
- For the phone app's Google sign-in, register the SHA-1 fingerprints of both your debug and release keys.
- Install on the TV by sideloading: enable "Install unknown apps" for a file manager or the Downloader app, or use `adb install`.

## Test matrix for M9

Use a scanned multi-page PDF, a 50 MB PDF, a `.docx` with Malayalam text, a 30-slide `.pptx`, a wide `.xlsx`, a 12 MP photo, a `.md` file, a UTF-8 `.txt`, a corrupt file, and a zero-byte file. Also test offline mode, slow Wi-Fi, and killing the app mid-read. The TV's low memory is the main risk, so downscale images and keep only about 3 PDF pages in memory.

## What I assumed, so you can correct me

- TV can delete to Trash (default above).
- Google consent screen uses basic scopes only (name, email, profile), so no Google verification is needed.
- English-only UI, per your answer.
- Everything stays free, which means no push notifications when the TV app is closed.
