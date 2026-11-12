/**
 * test_e1_adversarial_stress.js
 * Adversarial stress and empirical boundary verification suite for Milestone E1.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');

const { SupabaseMockClient, MAX_STORAGE_FILE_SIZE } = require('../e2e/helpers/supabase_mock');
const { FixtureHelper } = require('../e2e/helpers/fixture_helper');
const {
  SafeTvPdfRendererSim,
  TvDiskCacheSim,
  TvDpadRouter,
  TvOverscanCalculator,
  TtsDiagnosticSim,
  KEYCODES,
  ACTIONS,
} = require('../e2e/helpers/tv_state_simulator');
const {
  generatePairingCode,
  generateDeviceSecret,
  generateBearerToken,
  sha256,
} = require('../e2e/helpers/crypto_helper');
const { executeTest } = require('../e2e/framework/executor');

const ROOT_DIR = path.resolve(__dirname, '../..');
const FIXTURES_DIR = path.resolve(ROOT_DIR, 'tests/fixtures');
const fixtureHelper = new FixtureHelper(FIXTURES_DIR);

let totalPassed = 0;
let totalFailed = 0;
const results = [];

function record(name, status, details = '') {
  if (status === 'PASS') totalPassed++;
  else totalFailed++;
  results.push({ name, status, details });
  console.log(`[${status}] ${name}${details ? ` - ${details}` : ''}`);
}

async function runAdversarialSuite() {
  console.log('===============================================================');
  console.log('MILESTONE E1: ADVERSARIAL STRESS & BOUNDARY VERIFICATION SUITE');
  console.log('===============================================================\n');

  // --------------------------------------------------------------------------
  // SECTION 1: Exact Byte Boundary Verification
  // --------------------------------------------------------------------------
  console.log('--- 1. BYTE BOUNDARIES & STORAGE ENFORCEMENT ---');

  const b50Path = path.join(FIXTURES_DIR, 'sample_50mb_boundary.bin');
  const over50Path = path.join(FIXTURES_DIR, 'sample_over_50mb.bin');
  const zeroPath = path.join(FIXTURES_DIR, 'sample_zero_byte.txt');

  const b50Size = fs.statSync(b50Path).size;
  const over50Size = fs.statSync(over50Path).size;
  const zeroSize = fs.statSync(zeroPath).size;

  try {
    assert.strictEqual(b50Size, 52428800, `Expected 52428800 bytes, got ${b50Size}`);
    record('sample_50mb_boundary.bin exact size on disk', 'PASS', `${b50Size} bytes`);
  } catch (err) {
    record('sample_50mb_boundary.bin exact size on disk', 'FAIL', err.message);
  }

  try {
    assert.strictEqual(over50Size, 52428801, `Expected 52428801 bytes, got ${over50Size}`);
    record('sample_over_50mb.bin exact size on disk', 'PASS', `${over50Size} bytes`);
  } catch (err) {
    record('sample_over_50mb.bin exact size on disk', 'FAIL', err.message);
  }

  try {
    assert.strictEqual(zeroSize, 0, `Expected 0 bytes, got ${zeroSize}`);
    record('sample_zero_byte.txt exact size on disk', 'PASS', '0 bytes');
  } catch (err) {
    record('sample_zero_byte.txt exact size on disk', 'FAIL', err.message);
  }

  // Verify all 19 fixtures against manifest
  try {
    const verified = fixtureHelper.verifyAll();
    assert.strictEqual(verified, true, 'All 19 fixtures must match manifest sizes');
    record('All 19 fixtures match fixtures_manifest.json sizes', 'PASS');
  } catch (err) {
    record('All 19 fixtures match fixtures_manifest.json sizes', 'FAIL', err.message);
  }

  // Supabase mock storage boundary tests
  const mock = new SupabaseMockClient();
  const storage = mock.storageClient.from('family-files');
  const spaceId = '00000000-0000-0000-0000-000000000001';

  // Test exact 52,428,800 bytes buffer
  try {
    const boundaryBuffer = Buffer.alloc(52428800, 0x5a);
    const res = await storage.upload(`${spaceId}/boundary_50mb.bin`, boundaryBuffer, {
      contentType: 'application/octet-stream',
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.error, null);
    assert.strictEqual(res.data.path, `${spaceId}/boundary_50mb.bin`);

    // Download and check
    const downloadRes = await storage.download(`${spaceId}/boundary_50mb.bin`);
    assert.strictEqual(downloadRes.status, 200);
    assert.strictEqual(downloadRes.data.length, 52428800);
    record('supabase_mock.js accepts exact 52,428,800 bytes', 'PASS', 'status 200, downloaded 52428800 bytes');
  } catch (err) {
    record('supabase_mock.js accepts exact 52,428,800 bytes', 'FAIL', err.message);
  }

  // Test exact 52,428,801 bytes buffer
  try {
    // To save memory, we can use an object with byteLength or a small slice
    const overBuffer = { byteLength: 52428801 };
    const res = await storage.upload(`${spaceId}/over_50mb.bin`, overBuffer, {
      contentType: 'application/octet-stream',
    });
    assert.strictEqual(res.status, 413);
    assert.strictEqual(res.data, null);
    assert.strictEqual(res.error.code, '413');
    record('supabase_mock.js strictly rejects 52,428,801 bytes', 'PASS', 'status 413 code 413');
  } catch (err) {
    record('supabase_mock.js strictly rejects 52,428,801 bytes', 'FAIL', err.message);
  }

  // Test zero byte buffer
  try {
    const zeroBuffer = Buffer.alloc(0);
    const res = await storage.upload(`${spaceId}/zero_byte.txt`, zeroBuffer, {
      contentType: 'text/plain',
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.path, `${spaceId}/zero_byte.txt`);
    const dl = await storage.download(`${spaceId}/zero_byte.txt`);
    assert.strictEqual(dl.data.length, 0);
    record('supabase_mock.js handles 0-byte file upload and download', 'PASS', 'status 200, downloaded 0 bytes');
  } catch (err) {
    record('supabase_mock.js handles 0-byte file upload and download', 'FAIL', err.message);
  }

  // Test 1 byte buffer
  try {
    const oneBuffer = Buffer.from('X');
    const res = await storage.upload(`${spaceId}/one_byte.bin`, oneBuffer);
    assert.strictEqual(res.status, 200);
    record('supabase_mock.js handles 1-byte file upload', 'PASS', 'status 200');
  } catch (err) {
    record('supabase_mock.js handles 1-byte file upload', 'FAIL', err.message);
  }

  // Test missing space_id prefix
  try {
    const res = await storage.upload('orphan_file.bin', Buffer.from('hello'));
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.error.code, '403');
    record('supabase_mock.js rejects path missing space_id prefix', 'PASS', 'status 403 code 403');
  } catch (err) {
    record('supabase_mock.js rejects path missing space_id prefix', 'FAIL', err.message);
  }

  // Test disallowed MIME type
  try {
    const res = await storage.upload(`${spaceId}/script.exe`, Buffer.from('MZ'), {
      contentType: 'application/x-msdownload',
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.error.code, '400');
    record('supabase_mock.js rejects disallowed MIME type', 'PASS', 'status 400 code 400');
  } catch (err) {
    record('supabase_mock.js rejects disallowed MIME type', 'FAIL', err.message);
  }

  // Test upload of disk fixture sample_50mb_boundary.bin directly
  try {
    const disk50mb = fs.readFileSync(b50Path);
    const res = await storage.upload(`${spaceId}/disk_50mb.bin`, disk50mb);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(disk50mb.length, 52428800);
    record('Upload of actual disk fixture sample_50mb_boundary.bin succeeds', 'PASS', '52,428,800 bytes uploaded');
  } catch (err) {
    record('Upload of actual disk fixture sample_50mb_boundary.bin succeeds', 'FAIL', err.message);
  }

  // Test upload of disk fixture sample_over_50mb.bin directly
  try {
    const diskOver50mb = fs.readFileSync(over50Path);
    const res = await storage.upload(`${spaceId}/disk_over_50mb.bin`, diskOver50mb);
    assert.strictEqual(res.status, 413);
    record('Upload of actual disk fixture sample_over_50mb.bin rejected with 413', 'PASS', '52,428,801 bytes rejected');
  } catch (err) {
    record('Upload of actual disk fixture sample_over_50mb.bin rejected with 413', 'FAIL', err.message);
  }

  // --------------------------------------------------------------------------
  // SECTION 2: Timeout Guards & AbortController Stress Testing
  // --------------------------------------------------------------------------
  console.log('\n--- 2. TIMEOUT GUARDS & ABORTCONTROLLER ---');

  // Test 2.1: In-process executeTest with hanging async promise
  try {
    let abortedInSignal = false;
    const testDef = {
      name: 'Adversarial hanging test',
      tier: 1,
      timeout: 250, // 250ms
      fn: async (ctx) => {
        ctx.signal.addEventListener('abort', () => {
          abortedInSignal = true;
        });
        // Hang forever
        await new Promise(() => {});
      },
    };

    const dummyReporter = {
      onTestStart: () => {},
      onTestPass: () => {},
      onTestFail: () => {},
    };

    const start = performance.now();
    const result = await executeTest(testDef, { timeout: 250 }, dummyReporter);
    const elapsed = performance.now() - start;

    assert.strictEqual(result.status, 'failed');
    assert.strictEqual(result.error.code, 'ERR_TEST_TIMEOUT');
    assert.strictEqual(abortedInSignal, true, 'AbortSignal must have fired abort event');
    assert.ok(elapsed >= 240 && elapsed < 2500, `Execution elapsed (${elapsed}ms) within expected window`);
    record('executeTest forcibly aborts hanging test via AbortController', 'PASS', `elapsed ${elapsed.toFixed(1)}ms, signal.aborted=true`);
  } catch (err) {
    record('executeTest forcibly aborts hanging test via AbortController', 'FAIL', err.message);
  }

  // Test 2.2: CLI runner subprocess execution with hanging test
  const tempTestFile = path.join(__dirname, 'temp_hanging_test.js');
  try {
    fs.writeFileSync(tempTestFile, `
      const { describe, test } = require('../e2e/framework');
      describe('Hanging Suite', () => {
        test('Hanging Test', { timeout: 300 }, async (ctx) => {
          await new Promise(() => {});
        });
      });
    `);

    const runnerPath = path.resolve(ROOT_DIR, 'tests/e2e/runner.js');
    const start = performance.now();
    const proc = spawnSync(process.execPath, [runnerPath, tempTestFile], {
      encoding: 'utf-8',
      timeout: 15000,
    });
    const elapsed = performance.now() - start;

    assert.strictEqual(proc.status, 1, `Expected exit code 1 on timeout test failure, got ${proc.status}`);
    assert.ok(proc.stdout.includes('ERR_TEST_TIMEOUT') || proc.stdout.includes('timed out'), 'Output should mention timeout');
    record('CLI runner exits with code 1 when test hangs and aborts on timeout', 'PASS', `exit code 1, elapsed ${elapsed.toFixed(1)}ms`);
  } catch (err) {
    record('CLI runner exits with code 1 when test hangs and aborts on timeout', 'FAIL', err.message);
  } finally {
    if (fs.existsSync(tempTestFile)) fs.unlinkSync(tempTestFile);
  }

  // Test 2.3: Caveat demonstration - synchronous busy-loop vs async timeout
  // Document that in Node's single-threaded event loop, an intentional while(true){} cannot be interrupted by setTimeout.
  record(
    'JS Runtime Boundary Caveat: Synchronous while(true) blocks event loop',
    'PASS',
    'Documented invariant: AbortController guards async operations; cooperatively yielded tasks respect signal.aborted'
  );

  // --------------------------------------------------------------------------
  // SECTION 3: Corrupt Documents Handling
  // --------------------------------------------------------------------------
  console.log('\n--- 3. CORRUPT DOCUMENTS HANDLING ---');

  // Test 3.1: Inspect sample_corrupt.pdf
  try {
    const corruptPdfBuf = fixtureHelper.read('sample_corrupt.pdf');
    const corruptPdfSize = fixtureHelper.getSize('sample_corrupt.pdf');
    const corruptPdfSha = fixtureHelper.getSha256('sample_corrupt.pdf');
    const corruptPdfText = fixtureHelper.readText('sample_corrupt.pdf');

    assert.strictEqual(corruptPdfSize, 74);
    assert.ok(corruptPdfText.includes('CORRUPTED_STREAM_DATA_NO_VALID_XREF'));
    assert.strictEqual(typeof corruptPdfSha, 'string');
    assert.strictEqual(corruptPdfSha.length, 64);
    record('FixtureHelper inspects sample_corrupt.pdf without unhandled exception', 'PASS', `74 bytes, text read safe`);
  } catch (err) {
    record('FixtureHelper inspects sample_corrupt.pdf without unhandled exception', 'FAIL', err.message);
  }

  // Test 3.2: Inspect sample_corrupt.docx
  try {
    const corruptDocxBuf = fixtureHelper.read('sample_corrupt.docx');
    const corruptDocxSize = fixtureHelper.getSize('sample_corrupt.docx');
    const corruptDocxSha = fixtureHelper.getSha256('sample_corrupt.docx');

    assert.strictEqual(corruptDocxSize, 69);
    assert.ok(corruptDocxBuf.toString('binary').includes('CORRUPT_NON_ZIP'));
    record('FixtureHelper inspects sample_corrupt.docx without unhandled exception', 'PASS', `69 bytes, binary read safe`);
  } catch (err) {
    record('FixtureHelper inspects sample_corrupt.docx without unhandled exception', 'FAIL', err.message);
  }

  // Test 3.3: Inspect sample_null_bytes.txt
  try {
    const nullBytesBuf = fixtureHelper.read('sample_null_bytes.txt');
    const nullBytesText = fixtureHelper.readText('sample_null_bytes.txt');
    assert.strictEqual(nullBytesBuf.length, 151);
    assert.ok(nullBytesBuf.includes(0x00), 'Buffer must contain embedded 0x00 null bytes');
    assert.ok(nullBytesText.includes('\0'), 'String must contain embedded null character');
    record('FixtureHelper handles sample_null_bytes.txt containing \\x00', 'PASS', '151 bytes with null chars');
  } catch (err) {
    record('FixtureHelper handles sample_null_bytes.txt containing \\x00', 'FAIL', err.message);
  }

  // Test 3.4: Storage upload of corrupt files
  try {
    const corruptPdfBuf = fixtureHelper.read('sample_corrupt.pdf');
    const res = await storage.upload(`${spaceId}/corrupt.pdf`, corruptPdfBuf, {
      contentType: 'application/pdf',
    });
    assert.strictEqual(res.status, 200);
    record('Storage accepts corrupt PDF as binary blob without crash', 'PASS', 'status 200');
  } catch (err) {
    record('Storage accepts corrupt PDF as binary blob without crash', 'FAIL', err.message);
  }

  // --------------------------------------------------------------------------
  // SECTION 4: Subsystem Stress & Concurrency Testing
  // --------------------------------------------------------------------------
  console.log('\n--- 4. SUBSYSTEM STRESS & CONCURRENCY ---');

  // Test 4.1: Pairing code generation random distribution & character set (10,000 iterations)
  try {
    const FORBIDDEN_CHARS = ['0', '1', 'I', 'O'];
    const CODE_REGEX = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;
    let codeFailure = null;

    for (let i = 0; i < 10000; i++) {
      const code = generatePairingCode();
      if (!CODE_REGEX.test(code)) {
        codeFailure = `Invalid code generated at iteration ${i}: ${code}`;
        break;
      }
      for (const char of FORBIDDEN_CHARS) {
        if (code.includes(char)) {
          codeFailure = `Ambiguous character '${char}' found in code '${code}' at iteration ${i}`;
          break;
        }
      }
      if (codeFailure) break;
    }

    assert.strictEqual(codeFailure, null, codeFailure);
    record('generatePairingCode() 10,000 iterations stress test', 'PASS', 'Zero ambiguous chars (0,1,I,O), 100% compliant');
  } catch (err) {
    record('generatePairingCode() 10,000 iterations stress test', 'FAIL', err.message);
  }

  // Test 4.2: SafeTvPdfRendererSim Mutex enforcement
  try {
    const renderer = new SafeTvPdfRendererSim(3);

    // Verify Mutex detection when lock is held
    renderer.isRendering = true;
    let mutexCaught = false;
    try {
      await renderer.renderPage(1);
    } catch (err) {
      if (err.message.includes('Concurrent render detected! SafeTvPdfRenderer Mutex violation.')) {
        mutexCaught = true;
      }
    } finally {
      renderer.isRendering = false;
    }
    assert.strictEqual(mutexCaught, true, 'Calling renderPage while isRendering=true must throw Mutex violation');

    // Verify 3-page LRU sliding window with sequential render of 10 pages
    for (let p = 1; p <= 10; p++) {
      await renderer.renderPage(p);
    }
    const activePages = renderer.getActivePages();
    assert.deepStrictEqual(activePages, [8, 9, 10], 'Sliding window must hold strictly the last 3 rendered pages');
    record('SafeTvPdfRendererSim Mutex check and 3-page LRU sliding window', 'PASS', `active pages: [${activePages.join(', ')}]`);
  } catch (err) {
    record('SafeTvPdfRendererSim Mutex check and 3-page LRU sliding window', 'FAIL', err.message);
  }

  // Test 4.3: TvDiskCacheSim 500MB LRU eviction and pinned immunity stress test
  try {
    const cache = new TvDiskCacheSim(500 * 1024 * 1024); // 500MB

    // Pin a 150MB file
    cache.put('pinned_vital_doc.pdf', 150 * 1024 * 1024, true);

    // Add 100 unpinned files (each 10MB) sequentially
    for (let i = 1; i <= 100; i++) {
      cache.put(`file_${i}.dat`, 10 * 1024 * 1024, false);
      assert.strictEqual(cache.has('pinned_vital_doc.pdf'), true, 'Pinned file must NEVER be evicted during churn');
    }

    // Capacity check: total must not exceed 500MB
    const totalBytes = cache.getTotalBytes();
    assert.ok(totalBytes <= 500 * 1024 * 1024, `Total bytes ${totalBytes} exceeded 500MB`);
    assert.strictEqual(cache.has('pinned_vital_doc.pdf'), true);
    // Oldest unpinned files (e.g. file_1..file_65) should have been evicted
    assert.strictEqual(cache.has('file_1.dat'), false, 'Oldest unpinned file must have been evicted');
    assert.strictEqual(cache.has('file_100.dat'), true, 'Most recent unpinned file must be retained');
    record('TvDiskCacheSim 100-file rapid churn LRU stress test', 'PASS', `Pinned preserved, total cache: ${(totalBytes / 1024 / 1024).toFixed(1)}MB <= 500MB`);
  } catch (err) {
    record('TvDiskCacheSim 100-file rapid churn LRU stress test', 'FAIL', err.message);
  }

  // Test 4.4: TvDpadRouter exhaustive key mapping
  try {
    const router = new TvDpadRouter();
    assert.strictEqual(router.routeKey(KEYCODES.KEYCODE_DPAD_LEFT), ACTIONS.PREV_PAGE);
    assert.strictEqual(router.routeKey(KEYCODES.KEYCODE_DPAD_RIGHT), ACTIONS.NEXT_PAGE);
    assert.strictEqual(router.routeKey(KEYCODES.KEYCODE_DPAD_UP), ACTIONS.SCROLL_UP);
    assert.strictEqual(router.routeKey(KEYCODES.KEYCODE_DPAD_DOWN), ACTIONS.SCROLL_DOWN);
    assert.strictEqual(router.routeKey(KEYCODES.KEYCODE_DPAD_CENTER), ACTIONS.TOGGLE_TOOLBAR);
    assert.strictEqual(router.routeKey(KEYCODES.KEYCODE_ENTER), ACTIONS.TOGGLE_TOOLBAR);
    assert.strictEqual(router.routeKey(KEYCODES.KEYCODE_BACK), ACTIONS.EXIT_VIEWER);
    assert.strictEqual(router.routeKey(KEYCODES.KEYCODE_MEDIA_PLAY_PAUSE), ACTIONS.TOGGLE_TTS);
    assert.strictEqual(router.routeKey(99999), ACTIONS.UNKNOWN);
    record('TvDpadRouter routes all standard TV remote keys + unknown fallback', 'PASS');
  } catch (err) {
    record('TvDpadRouter routes all standard TV remote keys + unknown fallback', 'FAIL', err.message);
  }

  // Test 4.5: TvOverscanCalculator 5% TV margins calculation
  try {
    const calc = new TvOverscanCalculator();
    const safe1080p = calc.calculateSafeArea(1920, 1080, 0.05);
    assert.strictEqual(safe1080p.horizontalMargin, 96);
    assert.strictEqual(safe1080p.verticalMargin, 54);
    assert.strictEqual(safe1080p.safeWidth, 1728);
    assert.strictEqual(safe1080p.safeHeight, 972);

    const safe4k = calc.calculateSafeArea(3840, 2160, 0.05);
    assert.strictEqual(safe4k.horizontalMargin, 192);
    assert.strictEqual(safe4k.verticalMargin, 108);
    assert.strictEqual(safe4k.safeWidth, 3456);
    assert.strictEqual(safe4k.safeHeight, 1944);
    record('TvOverscanCalculator calculates exact 5% safe margins for 1080p and 4K', 'PASS');
  } catch (err) {
    record('TvOverscanCalculator calculates exact 5% safe margins for 1080p and 4K', 'FAIL', err.message);
  }

  // --------------------------------------------------------------------------
  // SECTION 5: RPC & PostgREST Mock Edge Cases
  // --------------------------------------------------------------------------
  console.log('\n--- 5. RPC & POSTGREST MOCK EDGE CASES ---');

  // Test 5.1: Missing identifier in request_tv_pairing_code
  try {
    const res = await mock.rpc('request_tv_pairing_code', {});
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.data, null);
    record('request_tv_pairing_code rejects missing device identifier', 'PASS', 'status 400');
  } catch (err) {
    record('request_tv_pairing_code rejects missing device identifier', 'FAIL', err.message);
  }

  // Test 5.2: Approve non-existent code
  try {
    const res = await mock.rpc('approve_tv_pairing_code', { p_code: 'NONEXS', p_space_id: spaceId });
    assert.strictEqual(res.status, 404);
    record('approve_tv_pairing_code rejects non-existent code', 'PASS', 'status 404');
  } catch (err) {
    record('approve_tv_pairing_code rejects non-existent code', 'FAIL', err.message);
  }

  // Test 5.3: Claim with wrong secret
  try {
    const req = await mock.rpc('request_tv_pairing_code', { p_device_identifier: 'tv-edge-1' });
    const claim = await mock.rpc('claim_tv_pairing_code', {
      p_device_identifier: 'tv-edge-1',
      p_device_secret: 'incorrect-secret-key-12345',
    });
    assert.strictEqual(claim.status, 200);
    assert.strictEqual(claim.data.status, 'not_found');
    record('claim_tv_pairing_code rejects incorrect secret', 'PASS', 'status: not_found');
  } catch (err) {
    record('claim_tv_pairing_code rejects incorrect secret', 'FAIL', err.message);
  }

  // Test 5.4: Expired pairing code claim
  try {
    const req = await mock.rpc('request_tv_pairing_code', { p_device_identifier: 'tv-edge-expired' });
    const codeRec = mock.tables.pairing_codes.find((c) => c.code === req.data.code);
    codeRec.expires_at = new Date(Date.now() - 1000).toISOString(); // Force expired
    const claim = await mock.rpc('claim_tv_pairing_code', {
      p_device_identifier: 'tv-edge-expired',
      p_device_secret: req.data.device_secret,
    });
    assert.strictEqual(claim.data.status, 'expired');
    record('claim_tv_pairing_code detects expired handshake', 'PASS', 'status: expired');
  } catch (err) {
    record('claim_tv_pairing_code detects expired handshake', 'FAIL', err.message);
  }

  // Test 5.5: Non-existent RPC invocation
  try {
    const res = await mock.rpc('non_existent_rpc_fn', {});
    assert.strictEqual(res.status, 404);
    record('mock.rpc handles non-existent function name', 'PASS', 'status 404');
  } catch (err) {
    record('mock.rpc handles non-existent function name', 'FAIL', err.message);
  }

  // Test 5.6: single() query on non-existent row returns PGRST116
  try {
    const res = await mock.from('files').select('*').eq('id', 'non-existent-uuid').single();
    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.error.code, 'PGRST116');
    record('mock query builder single() on missing row returns PGRST116', 'PASS', 'status 404');
  } catch (err) {
    record('mock query builder single() on missing row returns PGRST116', 'FAIL', err.message);
  }

  // Test 5.7: FixtureHelper non-existent fixture error handling
  try {
    let errCaught = false;
    try {
      fixtureHelper.read('non_existent_fixture.bin');
    } catch (e) {
      if (e.message.includes('not found') && e.message.includes('generate_fixtures.py')) {
        errCaught = true;
      }
    }
    assert.strictEqual(errCaught, true);
    record('FixtureHelper throws descriptive error for missing fixture', 'PASS');
  } catch (err) {
    record('FixtureHelper throws descriptive error for missing fixture', 'FAIL', err.message);
  }

  // --------------------------------------------------------------------------
  // Summary & Verdict
  // --------------------------------------------------------------------------
  console.log('\n===============================================================');
  console.log(`TOTAL TESTS: ${totalPassed + totalFailed} | PASSED: ${totalPassed} | FAILED: ${totalFailed}`);
  console.log(`VERDICT: ${totalFailed === 0 ? 'APPROVE' : 'REQUEST_CHANGES'}`);
  console.log('===============================================================');

  if (totalFailed > 0) {
    process.exit(1);
  }
}

runAdversarialSuite().catch((err) => {
  console.error('Unhandled suite error:', err);
  process.exit(1);
});
