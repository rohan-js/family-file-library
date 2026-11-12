/**
 * test_f30_f40_android_tv_ui.js - Tier 1 Feature Coverage: Android TV UI & Viewers (F30–F40)
 */

const crypto = require('node:crypto');
const { describe, test, it, assert } = require('../framework');
const {
  TvDesignSystemSim,
  TvFocusIndicatorSim,
  TvMultiShelfLayoutSim,
  TvCoilImageViewerSim,
  TvTextMarkdownViewerSim,
  TvZxingQrPairingSim,
  TvPinKeypadSim,
  TvHudToastSim,
} = require('../helpers');

// ============================================================================
// TEST SUITE: TIER 1 ANDROID TV UI (F30–F40)
// ============================================================================

describe('Tier 1: Android TV UI & Viewers', () => {
  // F30: 10-Foot TV Design System
  test('T1-F30-01: 10-foot TV design system enforces 5% safe overscan padding, typography hierarchy, and dark theme', {
    tier: 1,
    feature: 'F30',
    timeout: 5000,
  }, async (ctx) => {
    const ds = new TvDesignSystemSim(1920, 1080);
    const margins = ds.getSafeMargins();
    const bounds = ds.getSafeBounds();

    assert.strictEqual(ds.themeBackground, '#0F172A', 'Theme background must be #0F172A');
    assert.strictEqual(margins.horizontalMarginPx, 96, 'Horizontal margin must be 5% (96px on 1080p)');
    assert.strictEqual(margins.verticalMarginPx, 54, 'Vertical margin must be 5% (54px on 1080p)');
    assert.strictEqual(margins.horizontalMarginDp, 48, 'Safe horizontal padding must be 48dp');
    assert.strictEqual(margins.verticalMarginDp, 27, 'Safe vertical padding must be 27dp');
    assert.ok(ds.bodyTypographySp >= 24, 'Base body typography must be >= 24sp');
    assert.ok(ds.headerTypographySp >= 32, 'Header typography must be >= 32sp');
    assert.strictEqual(bounds.safeWidth, 1920 - 192, 'Safe width must exclude both horizontal margins');
  });

  // F31: High-Contrast Focus Indicator
  test('T1-F31-01: Focused items apply 1.06x scale expansion, 3dp neon cyan border, and elevation glow', {
    tier: 1,
    feature: 'F31',
    timeout: 5000,
  }, async (ctx) => {
    const focusInd = new TvFocusIndicatorSim();

    // Default unfocused state
    assert.strictEqual(focusInd.getCurrentScale(), 1.0, 'Unfocused scale must be 1.0x');
    assert.strictEqual(focusInd.getCurrentBorder().widthDp, 0, 'Unfocused item has no border stroke');
    assert.strictEqual(focusInd.getCurrentGlow().elevationDp, 0, 'Unfocused item has no elevation glow');

    // Gain focus
    focusInd.setFocus(true);
    assert.strictEqual(focusInd.getCurrentScale(), 1.06, 'Focused scale must be 1.06x');
    assert.strictEqual(focusInd.getCurrentBorder().widthDp, 3, 'Focused border stroke must be 3dp');
    assert.strictEqual(focusInd.getCurrentBorder().color, '#00E5FF', 'Focused border must be Neon Cyan (#00E5FF)');
    assert.strictEqual(focusInd.getCurrentGlow().elevationDp, 16, 'Focused glow elevation must be 16dp');
    assert.strictEqual(focusInd.getCurrentGlow().color, '#6600E5FF', 'Focused glow color must match alpha cyan');
  });

  // F32: TV Home Screen Multi-Shelf Layout
  test('T1-F32-01: Multi-shelf home layout organizes Continue Reading, Favorites, Inbox, and Folders horizontally', {
    tier: 1,
    feature: 'F32',
    timeout: 5000,
  }, async (ctx) => {
    const layout = new TvMultiShelfLayoutSim();

    assert.deepStrictEqual(layout.getShelfKeys(), ['continue_reading', 'favorites', 'inbox', 'folders']);
    assert.strictEqual(layout.orientation, 'horizontal', 'Shelves must use horizontal TvLazyRow scrolling');
    assert.ok(layout.topActions.has('search'), 'Top navigation must include Search action');
    assert.ok(layout.topActions.has('settings'), 'Top navigation must include Settings action');

    // Default focus falls to inbox when continue reading is empty
    assert.strictEqual(layout.getInitialFocusShelf(), 'inbox');

    // When continue reading has an item, focus defaults to continue reading
    layout.addItem('continue_reading', { id: 'file-doc-1', name: 'Tax_Return.pdf' });
    assert.strictEqual(layout.getInitialFocusShelf(), 'continue_reading');
  });

  // F32: Horizontal Shelf Boundary Clamping
  test('T1-F32-02: Horizontal shelf D-pad navigation enforces boundary clamping without circular wrapping', {
    tier: 1,
    feature: 'F32',
    timeout: 5000,
  }, async (ctx) => {
    const layout = new TvMultiShelfLayoutSim();

    // Populate shelf with 3 items (indices 0, 1, 2)
    layout.addItem('inbox', { id: 'file-0', name: 'Deed_1985.pdf' });
    layout.addItem('inbox', { id: 'file-1', name: 'Will_2012.pdf' });
    layout.addItem('inbox', { id: 'file-2', name: 'Tax_Receipt_2025.pdf' });
    layout.setActiveShelf('inbox');

    // 1. Initial focused item index must be 0
    assert.strictEqual(layout.getFocusedItemIndex('inbox'), 0, 'Initial focused item index must be 0');
    assert.strictEqual(layout.getFocusedItem('inbox').id, 'file-0');

    // 2. D-pad Left at index 0 must CLAMP at 0 (never wrap to N-1 / 2)
    const leftAtZero = layout.navigateLeft('inbox');
    assert.strictEqual(leftAtZero.action, 'BOUNDARY_CLAMPED', 'Left at index 0 triggers BOUNDARY_CLAMPED');
    assert.strictEqual(leftAtZero.clamped, true, 'Left at index 0 marks clamped = true');
    assert.strictEqual(leftAtZero.wrapped, false, 'Left at index 0 strictly disallows wrapping');
    assert.strictEqual(layout.getFocusedItemIndex('inbox'), 0, 'Index remains 0 after D-pad Left');
    assert.strictEqual(layout.getFocusedItem('inbox').id, 'file-0');

    // Repeated Left inputs remain clamped at 0
    layout.navigateLeft('inbox');
    layout.navigateLeft('inbox');
    assert.strictEqual(layout.getFocusedItemIndex('inbox'), 0, 'Repeated Left inputs remain clamped at 0');

    // 3. Sequential D-pad Right navigation across shelf items
    const rightTo1 = layout.navigateRight('inbox');
    assert.strictEqual(rightTo1.action, 'NAVIGATE_RIGHT', 'Moves to index 1');
    assert.strictEqual(rightTo1.clamped, false);
    assert.strictEqual(layout.getFocusedItemIndex('inbox'), 1);
    assert.strictEqual(layout.getFocusedItem('inbox').id, 'file-1');

    const rightTo2 = layout.navigateRight('inbox');
    assert.strictEqual(rightTo2.action, 'NAVIGATE_RIGHT', 'Moves to index 2');
    assert.strictEqual(rightTo2.clamped, false);
    assert.strictEqual(layout.getFocusedItemIndex('inbox'), 2);
    assert.strictEqual(layout.getFocusedItem('inbox').id, 'file-2');

    // 4. D-pad Right at right boundary (N-1) must CLAMP at 2 (never wrap to 0)
    const rightAtEnd = layout.navigateRight('inbox');
    assert.strictEqual(rightAtEnd.action, 'BOUNDARY_CLAMPED', 'Right at N-1 triggers BOUNDARY_CLAMPED');
    assert.strictEqual(rightAtEnd.clamped, true, 'Right at N-1 marks clamped = true');
    assert.strictEqual(rightAtEnd.wrapped, false, 'Right at N-1 strictly disallows wrapping');
    assert.strictEqual(layout.getFocusedItemIndex('inbox'), 2, 'Index remains N-1 after D-pad Right');
    assert.strictEqual(layout.getFocusedItem('inbox').id, 'file-2');

    // Repeated Right inputs remain clamped at 2
    layout.navigateRight('inbox');
    layout.navigateRight('inbox');
    assert.strictEqual(layout.getFocusedItemIndex('inbox'), 2, 'Repeated Right inputs remain clamped at 2');

    // 5. Test navigation via D-pad keycodes (KEYCODES.KEYCODE_DPAD_LEFT / RIGHT)
    const { KEYCODES } = ctx.tvState;
    layout.handleDpad(KEYCODES.KEYCODE_DPAD_LEFT);
    assert.strictEqual(layout.getFocusedItemIndex('inbox'), 1, 'KEYCODE_DPAD_LEFT moves focus from 2 to 1');
    layout.handleDpad(KEYCODES.KEYCODE_DPAD_LEFT);
    assert.strictEqual(layout.getFocusedItemIndex('inbox'), 0, 'KEYCODE_DPAD_LEFT moves focus from 1 to 0');
    const clampedKeyRes = layout.handleDpad(KEYCODES.KEYCODE_DPAD_LEFT);
    assert.strictEqual(clampedKeyRes.action, 'BOUNDARY_CLAMPED', 'Keycode Left at index 0 clamps');
    assert.strictEqual(layout.getFocusedItemIndex('inbox'), 0, 'Keycode Left at index 0 preserves index 0');
  });

  // F33: Low-Memory Synchronized SafeTvPdfRenderer
  test('T1-F33-01: SafeTvPdfRenderer enforces coroutine Mutex serialization, RGB_565 format, and 3-page LRU window', {
    tier: 1,
    feature: 'F33',
    timeout: 5000,
  }, async (ctx) => {
    const renderer = ctx.tvState.createPdfRenderer(3);

    // 1. Render first 3 pages sequentially
    const p1 = await renderer.renderPage(1);
    assert.strictEqual(p1.config, 'RGB_565', 'Bitmaps must be allocated as RGB_565');
    await renderer.renderPage(2);
    await renderer.renderPage(3);
    assert.deepStrictEqual(renderer.getActivePages(), [1, 2, 3], 'Window holds pages 1, 2, 3');

    // 2. Render 4th page -> page 1 is evicted
    await renderer.renderPage(4);
    assert.deepStrictEqual(renderer.getActivePages(), [2, 3, 4], 'Page 1 must be evicted to honor 3-page LRU cap');
    assert.strictEqual(renderer.getActivePages().length, 3, 'Active pages count never exceeds 3');

    // 3. Mutex collision guard: simultaneous rendering throws
    renderer.isRendering = true;
    await assert.rejects(async () => {
      await renderer.renderPage(5);
    }, /Concurrent render detected/, 'Concurrent page rendering must throw Mutex violation');
    renderer.isRendering = false;
  });

  // F34: D-Pad Navigation & Control Mapping
  test('T1-F34-01: D-pad remote key events map to required viewer and navigation actions', {
    tier: 1,
    feature: 'F34',
    timeout: 5000,
  }, async (ctx) => {
    const router = ctx.tvState.createDpadRouter();
    const { KEYCODES, ACTIONS } = ctx.tvState;

    assert.strictEqual(router.routeKey(KEYCODES.KEYCODE_DPAD_LEFT), ACTIONS.PREV_PAGE, 'DPAD_LEFT -> PREV_PAGE');
    assert.strictEqual(router.routeKey(KEYCODES.KEYCODE_DPAD_RIGHT), ACTIONS.NEXT_PAGE, 'DPAD_RIGHT -> NEXT_PAGE');
    assert.strictEqual(router.routeKey(KEYCODES.KEYCODE_DPAD_UP), ACTIONS.SCROLL_UP, 'DPAD_UP -> SCROLL_UP');
    assert.strictEqual(router.routeKey(KEYCODES.KEYCODE_DPAD_DOWN), ACTIONS.SCROLL_DOWN, 'DPAD_DOWN -> SCROLL_DOWN');
    assert.strictEqual(router.routeKey(KEYCODES.KEYCODE_DPAD_CENTER), ACTIONS.TOGGLE_TOOLBAR, 'DPAD_CENTER -> TOGGLE_TOOLBAR');
    assert.strictEqual(router.routeKey(KEYCODES.KEYCODE_ENTER), ACTIONS.TOGGLE_TOOLBAR, 'ENTER -> TOGGLE_TOOLBAR');
    assert.strictEqual(router.routeKey(KEYCODES.KEYCODE_BACK), ACTIONS.EXIT_VIEWER, 'BACK -> EXIT_VIEWER');
    assert.strictEqual(router.routeKey(KEYCODES.KEYCODE_MEDIA_PLAY_PAUSE), ACTIONS.TOGGLE_TTS, 'PLAY_PAUSE -> TOGGLE_TTS');
  });

  // F35: Memory-Tuned Coil Image Viewer
  test('T1-F35-01: Coil image viewer restricts memory to 15% heap, decodes RGB_565, and supports pan/zoom/rotate/slideshow', {
    tier: 1,
    feature: 'F35',
    timeout: 5000,
  }, async (ctx) => {
    const viewer = new TvCoilImageViewerSim(512); // 512MB RAM budget TV

    assert.strictEqual(viewer.maxHeapPercent, 0.15, 'Memory cache strictly capped at 15% heap');
    assert.strictEqual(viewer.getMemoryLimitMb(), 76.8, 'Memory cache cap must calculate to 76.8MB on 512MB heap');
    assert.strictEqual(viewer.bitmapConfig, 'RGB_565', 'Bitmap config must use RGB_565');

    // Pan & Zoom
    viewer.zoomIn();
    assert.strictEqual(viewer.zoomLevel, 1.5, 'Zoom in increments level');
    viewer.zoomIn(); viewer.zoomIn(); viewer.zoomIn(); viewer.zoomIn();
    assert.strictEqual(viewer.zoomLevel, 3.0, 'Zoom level must clamp at maximum 3.0x');

    // Rotate
    viewer.rotateClockwise();
    assert.strictEqual(viewer.rotationDegrees, 90, 'Rotate advances in 90 degree increments');

    // Slideshow
    viewer.toggleSlideshow();
    assert.strictEqual(viewer.isSlideshowRunning, true, 'Slideshow becomes active');
    viewer.advanceSlideshow(10);
    assert.strictEqual(viewer.currentImageIndex, 1, 'Slideshow advances photo index on tick');
  });

  // F36: 28sp Text & Markdown Viewer
  test('T1-F36-01: 28sp Text & Markdown viewer renders structured text and preserves scroll offset', {
    tier: 1,
    feature: 'F36',
    timeout: 5000,
  }, async (ctx) => {
    const viewer = new TvTextMarkdownViewerSim();

    assert.strictEqual(viewer.baseFontSizeSp, 28, 'Base font size must be 28sp for 10-foot readability');

    const mdContent = '# Title\n- Bullet 1\n> Important Note\nStandard paragraph text.';
    const elements = viewer.parseMarkdown(mdContent);

    assert.strictEqual(elements.length, 4, 'Must parse 4 Markdown nodes');
    assert.strictEqual(elements[0].type, 'header');
    assert.strictEqual(elements[1].type, 'list_item');
    assert.strictEqual(elements[2].type, 'quote');

    // Scroll offset & persistence
    viewer.scrollBy(150);
    assert.strictEqual(viewer.scrollOffset, 150, 'Scroll offset tracks position');
    viewer.saveOffset('doc-101');
    assert.strictEqual(viewer.restoreOffset('doc-101'), 150, 'Saved scroll offset restored accurately');
  });

  // F37: TTS Diagnostic & Fallback
  test('T1-F37-01: Pre-flight TTS engine check detects missing engines and manages transient audio ducking', {
    tier: 1,
    feature: 'F37',
    timeout: 5000,
  }, async (ctx) => {
    // 1. Budget TV lacking TTS engine
    const noTts = ctx.tvState.createTtsDiagnostic([]);
    assert.strictEqual(noTts.canSpeak(), false, 'canSpeak returns false when no engine installed');
    assert.strictEqual(noTts.requestAudioFocusWithDucking(), false, 'Audio focus rejected when TTS engine missing');

    // 2. TV with Google TTS engine
    const withTts = ctx.tvState.createTtsDiagnostic(['com.google.android.tts']);
    assert.strictEqual(withTts.canSpeak(), true, 'canSpeak returns true when engine present');
    assert.strictEqual(withTts.requestAudioFocusWithDucking(), true, 'Transient audio ducking granted');
    assert.strictEqual(withTts.hasDucking, true, 'Ducking state active during playback');

    withTts.releaseAudioFocus();
    assert.strictEqual(withTts.hasDucking, false, 'Audio ducking released on utterance completion');
  });

  // F38: Local ZXing QR Pairing Screen
  test('T1-F38-01: Local ZXing QR pairing screen generates 320x320 QR, 6-digit code, and polls every 3s', {
    tier: 1,
    feature: 'F38',
    timeout: 5000,
  }, async (ctx) => {
    const pairing = new TvZxingQrPairingSim('749-382');
    pairing.start();

    assert.strictEqual(pairing.code, '749-382', 'Formats 6-digit code');
    assert.strictEqual(pairing.qrWidth, 320, 'QR bitmap width is 320px');
    assert.strictEqual(pairing.qrHeight, 320, 'QR bitmap height is 320px');
    assert.strictEqual(pairing.expiresInSeconds, 600, 'Expiration initialized to 600 seconds (10 min)');
    assert.strictEqual(pairing.pollingIntervalMs, 3000, 'Fallback poll runs every 3000ms');

    // Countdown and Approval
    pairing.tick(10);
    assert.strictEqual(pairing.expiresInSeconds, 590, 'Countdown decrements');
    pairing.approve();
    assert.strictEqual(pairing.state, 'SUCCESS', 'Approval transitions state to SUCCESS');
  });

  // F39: 4-Digit TV PIN Lock Keypad
  test('T1-F39-01: 4-digit PIN lock keypad validates salted SHA-256 hash and unlocks protected space', {
    tier: 1,
    feature: 'F39',
    timeout: 5000,
  }, async (ctx) => {
    const salt = 'sharma_space_salt_99';
    const keypad = new TvPinKeypadSim(salt);
    const correctPin = '7492';
    const expectedHash = crypto.createHash('sha256').update(correctPin + salt).digest('hex');

    // Type 4 digits
    keypad.pressKey('7');
    keypad.pressKey('4');
    keypad.pressKey('9');
    keypad.pressKey('2');
    assert.strictEqual(keypad.enteredDigits.length, 4, 'Entered PIN has 4 digits');

    // Test fifth digit rejection
    keypad.pressKey('5');
    assert.strictEqual(keypad.enteredDigits.length, 4, 'Buffer strictly capped at 4 digits');

    // Verify correct submission
    const unlockOk = keypad.submit(expectedHash);
    assert.strictEqual(unlockOk, true, 'Correct PIN must unlock keypad');
    assert.strictEqual(keypad.isUnlocked, true, 'Keypad state is unlocked');

    // Verify incorrect PIN clears buffer
    keypad.pressKey('1'); keypad.pressKey('2'); keypad.pressKey('3'); keypad.pressKey('4');
    const wrongOk = keypad.submit(expectedHash);
    assert.strictEqual(wrongOk, false, 'Incorrect PIN rejected');
    assert.strictEqual(keypad.enteredDigits, '', 'Buffer cleared on failed attempt');
  });

  // F40: Realtime "New file arrived" HUD Toast
  test('T1-F40-01: Realtime HUD toast notification appears on file insert, shows sender, and auto-dismisses in 5s', {
    tier: 1,
    feature: 'F40',
    timeout: 5000,
  }, async (ctx) => {
    const hud = new TvHudToastSim();
    hud.subscribe();
    assert.strictEqual(hud.subscribed, true, 'Subscribed to Realtime channel');

    // Ingest new file event
    hud.onInsert({ id: 'file-doc-99', name: 'Discharge_Summary.pdf', sender_name: 'Dr. Ramesh' });
    assert.strictEqual(hud.visible, true, 'HUD toast becomes visible');
    assert.strictEqual(hud.currentToast.message, 'New file: Discharge_Summary.pdf from Dr. Ramesh');
    assert.strictEqual(hud.dismissTimeoutMs, 5000, 'Auto-dismiss timeout configured to 5000ms');

    // Tick 3 seconds -> still visible
    hud.tick(3000);
    assert.strictEqual(hud.visible, true, 'Still visible after 3s');

    // Tick 2 more seconds -> auto-dismisses
    hud.tick(2000);
    assert.strictEqual(hud.visible, false, 'Auto-dismisses after 5000ms total');
  });
});
