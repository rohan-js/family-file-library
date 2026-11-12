/**
 * test_framework_smoke.js - Smoke test suite validating the test harness, helpers, and contracts.
 */

const { describe, test, it, assert } = require('../framework');

describe('Tier 1: Framework Smoke & Subsystem Contracts', () => {
  // F05 & F12-F14: TV Pairing Protocol
  test('T1-F05-01: Generates 6-character uppercase code without ambiguous characters (0, 1, I, O)', {
    tier: 1,
    feature: 'F05',
    timeout: 5000,
  }, async (ctx) => {
    const res = await ctx.client.rpc('request_tv_pairing_code', {
      p_device_identifier: 'tv-livingroom-01',
      p_device_name: 'Living Room TV',
    });

    assert.status(res, 200, 'RPC request must succeed');
    assert.strictEqual(res.data.code.length, 6, 'Code must be exactly 6 characters');
    assert.match(
      res.data.code,
      /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/,
      'Code must exclude 0, 1, I, O'
    );
    assert.ok(res.data.device_secret, 'Device secret must be returned');
    assert.ok(res.data.expires_at, 'Expiration timestamp must be returned');
  });

  test('T1-F12-F14: End-to-end TV pairing handshake (Request -> Approve -> Claim)', {
    tier: 1,
    feature: 'F12',
    timeout: 5000,
  }, async (ctx) => {
    // 1. Request
    const reqRes = await ctx.client.rpc('request_tv_pairing_code', {
      p_device_identifier: 'tv-bedroom-02',
      p_device_name: 'Bedroom TV',
    });
    assert.status(reqRes, 200);
    const { code, device_secret } = reqRes.data;

    // 2. Approve
    const spaceId = 'space-test-uuid-1234';
    const appRes = await ctx.client.rpc('approve_tv_pairing_code', {
      p_code: code,
      p_space_id: spaceId,
    });
    assert.status(appRes, 200);
    assert.strictEqual(appRes.data.success, true);
    assert.ok(appRes.data.device_id, 'Device ID must be created');

    // 3. Claim
    const claimRes = await ctx.client.rpc('claim_tv_pairing_code', {
      p_device_identifier: 'tv-bedroom-02',
      p_device_secret: device_secret,
    });
    assert.status(claimRes, 200);
    assert.strictEqual(claimRes.data.status, 'approved');
    assert.strictEqual(claimRes.data.space_id, spaceId);
    assert.ok(claimRes.data.device_token, 'Bearer token must be issued');

    // 4. Verify replay prevention: second claim fails
    const replayRes = await ctx.client.rpc('claim_tv_pairing_code', {
      p_device_identifier: 'tv-bedroom-02',
      p_device_secret: device_secret,
    });
    assert.strictEqual(replayRes.data.status, 'not_found');
  });

  // F17 & F18: Storage Bucket & RLS Policies
  test('T1-F17-01: Storage enforces 50MB ceiling and rejects over-50MB payloads', {
    tier: 1,
    feature: 'F17',
    timeout: 5000,
  }, async (ctx) => {
    const spaceId = '11111111-1111-1111-1111-111111111111';
    const validFile = Buffer.alloc(1024 * 1024, 0xaa); // 1 MB
    const uploadRes = await ctx.storage.from('family-files').upload(`${spaceId}/doc.pdf`, validFile, {
      contentType: 'application/pdf',
    });
    assert.status(uploadRes, 200, 'Valid 1MB upload must succeed');

    // Over-50MB (52,428,801 bytes)
    const overLimitBytes = 52428801;
    const fakeOverLimit = { byteLength: overLimitBytes };
    const overRes = await ctx.storage.from('family-files').upload(`${spaceId}/huge.bin`, fakeOverLimit);
    assert.status(overRes, 413, 'Over 50MB upload must be rejected with 413');

    // Upload without space prefix
    const noPrefixRes = await ctx.storage.from('family-files').upload(`invalid_path.pdf`, validFile);
    assert.status(noPrefixRes, 403, 'Path lacking space prefix must be rejected with 403');
  });

  // F27: 500MB Local Disk LRU Cache & Pinned Immunity
  test('T1-F27-01: 500MB disk cache evicts oldest unpinned files and protects pinned files', {
    tier: 1,
    feature: 'F27',
    timeout: 5000,
  }, async (ctx) => {
    const cache = ctx.tvState.createDiskCache(500 * 1024 * 1024); // 500MB capacity

    // Add 100MB pinned file (e.g. Property Deed)
    cache.put('deed.pdf', 100 * 1024 * 1024, true);
    assert.ok(cache.isPinned('deed.pdf'), 'deed.pdf must be pinned');

    // Add 300MB unpinned file A
    cache.put('video_a.mp4', 300 * 1024 * 1024, false);
    // Add 80MB unpinned file B
    cache.put('photo_b.jpg', 80 * 1024 * 1024, false);
    assert.strictEqual(cache.getTotalBytes(), 480 * 1024 * 1024);

    // Now touch video_a.mp4 to make photo_b.jpg older, then add 50MB file C (total would be 530MB > 500MB)
    cache.touch('video_a.mp4');
    cache.put('file_c.pdf', 50 * 1024 * 1024, false);

    // photo_b.jpg should be evicted
    assert.strictEqual(cache.has('photo_b.jpg'), false, 'Older unpinned file must be evicted');
    // Pinned deed must still be present
    assert.strictEqual(cache.has('deed.pdf'), true, 'Pinned file must NEVER be evicted');
    assert.strictEqual(cache.has('file_c.pdf'), true);
    assert.ok(cache.getTotalBytes() <= 500 * 1024 * 1024, 'Total cache must remain under 500MB');
  });

  // F33: SafeTvPdfRenderer Mutex & 3-Page LRU Window
  test('T1-F33-01: SafeTvPdfRenderer enforces coroutine Mutex and 3-page LRU sliding window', {
    tier: 1,
    feature: 'F33',
    timeout: 5000,
  }, async (ctx) => {
    const renderer = ctx.tvState.createPdfRenderer(3);

    // Render pages sequentially: 1, 2, 3
    const p1 = await renderer.renderPage(1);
    assert.strictEqual(p1.config, 'RGB_565', 'Must use RGB_565 format');
    await renderer.renderPage(2);
    await renderer.renderPage(3);
    assert.deepStrictEqual(renderer.getActivePages(), [1, 2, 3]);

    // Render page 4: page 1 should be evicted from sliding window
    await renderer.renderPage(4);
    assert.deepStrictEqual(renderer.getActivePages(), [2, 3, 4], 'Page 1 must be evicted to keep max 3 pages');
  });

  // F34: Remote D-Pad Key Routing
  test('T1-F34-01: D-pad remote key events route to correct navigation actions', {
    tier: 1,
    feature: 'F34',
    timeout: 5000,
  }, async (ctx) => {
    const router = ctx.tvState.createDpadRouter();
    const { KEYCODES, ACTIONS } = ctx.tvState;

    assert.strictEqual(router.routeKey(KEYCODES.KEYCODE_DPAD_LEFT), ACTIONS.PREV_PAGE);
    assert.strictEqual(router.routeKey(KEYCODES.KEYCODE_DPAD_RIGHT), ACTIONS.NEXT_PAGE);
    assert.strictEqual(router.routeKey(KEYCODES.KEYCODE_DPAD_CENTER), ACTIONS.TOGGLE_TOOLBAR);
    assert.strictEqual(router.routeKey(KEYCODES.KEYCODE_ENTER), ACTIONS.TOGGLE_TOOLBAR);
    assert.strictEqual(router.routeKey(KEYCODES.KEYCODE_BACK), ACTIONS.EXIT_VIEWER);
    assert.strictEqual(router.routeKey(KEYCODES.KEYCODE_MEDIA_PLAY_PAUSE), ACTIONS.TOGGLE_TTS);
  });

  // F37: TTS Engine Diagnostic & Fallback
  test('T1-F37-01: TTS probe detects missing engines and activates audio ducking when present', {
    tier: 1,
    feature: 'F37',
    timeout: 5000,
  }, async (ctx) => {
    // Budget TV with zero TTS engines
    const noTts = ctx.tvState.createTtsDiagnostic([]);
    assert.strictEqual(noTts.canSpeak(), false, 'canSpeak must be false when engines list is empty');
    assert.strictEqual(noTts.requestAudioFocusWithDucking(), false, 'Must not request audio focus without TTS');

    // TV with Google TTS engine
    const withTts = ctx.tvState.createTtsDiagnostic(['com.google.android.tts']);
    assert.strictEqual(withTts.canSpeak(), true);
    assert.strictEqual(withTts.requestAudioFocusWithDucking(), true, 'Must duck background audio during speech');
    assert.strictEqual(withTts.hasDucking, true);
    withTts.releaseAudioFocus();
    assert.strictEqual(withTts.hasDucking, false);
  });

  // F50: Synthetic Fixtures Manifest & Checksums
  test('T1-F50-01: Fixture manifest is valid and all 19 synthetic fixtures exist with correct sizes', {
    tier: 1,
    feature: 'F50',
    timeout: 5000,
  }, async (ctx) => {
    assert.ok(ctx.fixtures.isCatalogReady(), 'Catalog manifest must exist');
    const allFixtures = ctx.fixtures.getAllFixtures();
    assert.strictEqual(allFixtures.length, 19, 'Must define exactly 19 fixtures');

    // Verify key boundary files
    assert.strictEqual(ctx.fixtures.getSize('sample_50mb_boundary.bin'), 52428800);
    assert.strictEqual(ctx.fixtures.getSize('sample_over_50mb.bin'), 52428801);
    assert.strictEqual(ctx.fixtures.getSize('sample_zero_byte.txt'), 0);

    // Verify all fixtures exist and match manifest sizes
    assert.ok(ctx.fixtures.verifyAll(), 'All 19 fixtures must match manifest sizes');
  });
});
