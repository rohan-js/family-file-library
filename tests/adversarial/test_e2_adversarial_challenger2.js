/**
 * test_e2_adversarial_challenger2.js
 * Adversarial Stress & Empirical Invariant Verification for Milestone E2
 * Challenger 2: Security & Pairing State Machines
 *
 * Focus Areas:
 * 1. TV Pairing Security (Entropy, Collisions, Replay Attacks, Expiration)
 * 2. Space & Storage RLS Enforcement (Path Traversal, Revocation, Multi-tenant Isolation)
 * 3. Low-Memory Synchronized PdfRenderer Mutex Concurrency
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { SupabaseMockClient, MAX_STORAGE_FILE_SIZE } = require('../e2e/helpers/supabase_mock');
const {
  SafeTvPdfRendererSim,
  TvDiskCacheSim,
} = require('../e2e/helpers/tv_state_simulator');
const {
  PAIRING_ALPHABET,
  generatePairingCode,
  generateDeviceSecret,
  generateBearerToken,
  sha256,
  randomUUID,
} = require('../e2e/helpers/crypto_helper');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const findings = [];

function recordResult(name, passed, details = '') {
  totalTests++;
  if (passed) {
    passedTests++;
    console.log(`[PASS] ${name}${details ? ` -> ${details}` : ''}`);
  } else {
    failedTests++;
    console.error(`[FAIL] ${name}${details ? ` -> ${details}` : ''}`);
    findings.push({ name, details });
  }
}

async function runChallenger2Suite() {
  console.log('======================================================================');
  console.log('CHALLENGER 2: ADVERSARIAL STRESS SUITE (E2 SECURITY & PAIRING)');
  console.log('======================================================================\n');

  // ==========================================================================
  // SECTION 1: TV PAIRING SECURITY & ENTROPY
  // ==========================================================================
  console.log('--- SECTION 1: TV PAIRING SECURITY & ENTROPY ---');

  // 1.1 Entropy & Ambiguous Character Exclusion (100,000 samples)
  const SAMPLE_SIZE = 100000;
  console.log(`Generating ${SAMPLE_SIZE.toLocaleString()} pairing codes to test distribution and collisions...`);

  const codeSet = new Set();
  const charCounts = {};
  for (const c of PAIRING_ALPHABET) charCounts[c] = 0;

  const ambiguousChars = new Set(['0', '1', 'I', 'O', 'l', 'o']);
  let ambiguousDetected = 0;

  for (let i = 0; i < SAMPLE_SIZE; i++) {
    const code = generatePairingCode(6);
    codeSet.add(code);
    for (let j = 0; j < code.length; j++) {
      const ch = code[j];
      if (ambiguousChars.has(ch)) ambiguousDetected++;
      if (charCounts[ch] !== undefined) {
        charCounts[ch]++;
      }
    }
  }

  // Check ambiguous characters
  recordResult(
    'Pairing code excludes ambiguous characters (0, 1, I, O)',
    ambiguousDetected === 0,
    `Ambiguous characters found: ${ambiguousDetected}`
  );

  // Check collision rate against birthday paradox theoretical expectation
  // Keyspace K = 32^6 = 1,073,741,824.
  // Expected collisions E = N*(N-1) / (2*K) ≈ 100000 * 99999 / (2 * 1073741824) ≈ 4.65
  const actualCollisions = SAMPLE_SIZE - codeSet.size;
  console.log(`Observed collisions in ${SAMPLE_SIZE.toLocaleString()} codes: ${actualCollisions} (Theoretical expected: ~4.65)`);
  recordResult(
    'Pairing code collision resistance aligns with theoretical bounds',
    actualCollisions >= 0 && actualCollisions <= 25,
    `Actual collisions: ${actualCollisions}`
  );

  // Character distribution uniformity (Chi-Square Goodness of Fit)
  const totalChars = SAMPLE_SIZE * 6;
  const expectedPerChar = totalChars / PAIRING_ALPHABET.length; // 600000 / 32 = 18750
  let chiSquare = 0;
  for (const c of PAIRING_ALPHABET) {
    const observed = charCounts[c];
    chiSquare += Math.pow(observed - expectedPerChar, 2) / expectedPerChar;
  }
  // For df = 31, critical value at p=0.001 is ~60.4
  console.log(`Character distribution Chi-Square value: ${chiSquare.toFixed(2)} (df=31, critical 60.4)`);
  recordResult(
    'Pairing code alphabet generation is uniformly distributed (no modulo bias)',
    chiSquare < 60.4,
    `Chi-Square: ${chiSquare.toFixed(2)}`
  );

  // 1.2 Replay Attacks: Claiming Already Claimed Code
  console.log('\n--- 1.2 Replay Attacks ---');
  const mock1 = new SupabaseMockClient();
  const space1 = (await mock1.from('spaces').insert({ name: 'Security Test Space' })).data;
  const pairReq = (await mock1.rpc('request_tv_pairing_code', {
    p_device_identifier: 'tv-replay-test-01',
    p_device_name: 'Living Room TV',
  })).data;

  // Approve
  const approveRes = await mock1.rpc('approve_tv_pairing_code', {
    p_code: pairReq.code,
    p_space_id: space1.id,
  });
  assert.strictEqual(approveRes.status, 200);

  // Claim #1: Should succeed
  const claim1 = await mock1.rpc('claim_tv_pairing_code', {
    p_device_identifier: 'tv-replay-test-01',
    p_device_secret: pairReq.device_secret,
  });
  recordResult(
    'Initial pairing code claim succeeds with valid credentials',
    claim1.data.status === 'approved' && Boolean(claim1.data.device_token),
    `Status: ${claim1.data.status}`
  );

  // Claim #2 (Replay Attack): Must return not_found
  const claim2 = await mock1.rpc('claim_tv_pairing_code', {
    p_device_identifier: 'tv-replay-test-01',
    p_device_secret: pairReq.device_secret,
  });
  recordResult(
    'Replay claim attack on already-claimed code is rejected (not_found)',
    claim2.data.status === 'not_found',
    `Status: ${claim2.data.status}`
  );

  // Re-approve attempt on already approved/claimed code
  const reApprove = await mock1.rpc('approve_tv_pairing_code', {
    p_code: pairReq.code,
    p_space_id: space1.id,
  });
  recordResult(
    'Re-approval of claimed pairing code is rejected with 404',
    reApprove.status === 404,
    `Status: ${reApprove.status}`
  );

  // Concurrent Claim Race Condition: Only 1 claimant can succeed
  const pairReq2 = (await mock1.rpc('request_tv_pairing_code', {
    p_device_identifier: 'tv-race-01',
    p_device_name: 'Race TV',
  })).data;
  await mock1.rpc('approve_tv_pairing_code', { p_code: pairReq2.code, p_space_id: space1.id });

  const [raceClaimA, raceClaimB] = await Promise.all([
    mock1.rpc('claim_tv_pairing_code', { p_device_identifier: 'tv-race-01', p_device_secret: pairReq2.device_secret }),
    mock1.rpc('claim_tv_pairing_code', { p_device_identifier: 'tv-race-01', p_device_secret: pairReq2.device_secret }),
  ]);
  const approvedCount = (raceClaimA.data.status === 'approved' ? 1 : 0) + (raceClaimB.data.status === 'approved' ? 1 : 0);
  recordResult(
    'Concurrent claim race: exactly one claim succeeds, duplicate is rejected',
    approvedCount === 1,
    `Approved count: ${approvedCount}`
  );

  // 1.3 Expired Pairing Code Rejection
  console.log('\n--- 1.3 Expiration Rejection ---');
  // Inject an expired pairing code into mock
  const expiredCode = 'EXPIRE';
  const expiredSecret = generateDeviceSecret();
  mock1.tables.pairing_codes.push({
    id: randomUUID(),
    device_identifier: 'tv-expired-01',
    device_name: 'Expired TV',
    code: expiredCode,
    device_secret_hash: sha256(expiredSecret),
    status: 'pending',
    expires_at: new Date(Date.now() - 60000).toISOString(), // 1 minute in the past
    space_id: null,
    device_id: null,
    device_token: null,
  });

  // Attempt to APPROVE expired code
  const approveExpiredRes = await mock1.rpc('approve_tv_pairing_code', {
    p_code: expiredCode,
    p_space_id: space1.id,
  });

  // CHECK: Does approve_tv_pairing_code reject expired code?
  // In SQL migration (line 763): "where code = v_clean_code and status = 'pending' and expires_at > now()"
  // If expired, SQL returns 404 / exception.
  const approveExpiredRejected = approveExpiredRes.status === 404 || approveExpiredRes.error !== null;
  recordResult(
    'approve_tv_pairing_code rejects expired pairing code',
    approveExpiredRejected,
    approveExpiredRejected
      ? `Rejected with status: ${approveExpiredRes.status}`
      : `VULNERABILITY: approve_tv_pairing_code accepted an expired code! Status: ${approveExpiredRes.status}`
  );

  // Attempt to CLAIM expired code
  const claimExpiredRes = await mock1.rpc('claim_tv_pairing_code', {
    p_device_identifier: 'tv-expired-01',
    p_device_secret: expiredSecret,
  });
  recordResult(
    'claim_tv_pairing_code rejects expired pairing code',
    claimExpiredRes.data.status === 'expired',
    `Status: ${claimExpiredRes.data.status}`
  );

  // 1.4 Invite Token Expiration (7-day lifecycle) vs Replay
  console.log('\n--- 1.4 Invite Token Expiration & Replay ---');
  const inviteToken = generateBearerToken().slice(0, 48);
  mock1.tables.invites.push({
    id: randomUUID(),
    space_id: space1.id,
    email: 'expired_invite@test.com',
    invited_by: 'user-owner',
    role: 'member',
    status: 'pending',
    token: inviteToken,
    expires_at: new Date(Date.now() - 1000).toISOString(), // Expired
  });

  const acceptExpiredInvite = await mock1.rpc('accept_space_invite', {
    p_token: inviteToken,
    p_user_id: 'user-new',
    p_user_email: 'expired_invite@test.com',
  });
  recordResult(
    'accept_space_invite rejects expired invite token (> 7 days)',
    acceptExpiredInvite.status === 400 && acceptExpiredInvite.error?.message?.includes('expired'),
    `Status: ${acceptExpiredInvite.status}, Error: ${acceptExpiredInvite.error?.message}`
  );

  // Valid invite acceptance followed by replay attempt
  const validToken = generateBearerToken().slice(0, 48);
  mock1.tables.invites.push({
    id: randomUUID(),
    space_id: space1.id,
    email: 'valid_invite@test.com',
    invited_by: 'user-owner',
    role: 'member',
    status: 'pending',
    token: validToken,
    expires_at: new Date(Date.now() + 7 * 86400 * 1000).toISOString(),
  });

  const acceptValid = await mock1.rpc('accept_space_invite', {
    p_token: validToken,
    p_user_id: 'user-valid',
    p_user_email: 'valid_invite@test.com',
  });
  recordResult(
    'Valid invite token acceptance succeeds',
    acceptValid.status === 200 && acceptValid.data?.success === true,
    `Status: ${acceptValid.status}`
  );

  const replayInvite = await mock1.rpc('accept_space_invite', {
    p_token: validToken,
    p_user_id: 'user-attacker',
    p_user_email: 'attacker@test.com',
  });
  recordResult(
    'Replay attack on consumed invite token is rejected with 404',
    replayInvite.status === 404,
    `Status: ${replayInvite.status}, Error: ${replayInvite.error?.message}`
  );

  // ==========================================================================
  // SECTION 2: SPACE & STORAGE RLS ENFORCEMENT
  // ==========================================================================
  console.log('\n--- SECTION 2: SPACE & STORAGE RLS ENFORCEMENT ---');

  const storage = mock1.storageClient.from('family-files');

  // 2.1 Storage Path Traversal Attempts
  const traversalVectors = [
    { path: 'file_without_prefix.pdf', desc: 'Missing space prefix (bare filename)' },
    { path: '/root_file.pdf', desc: 'Root file with leading slash' },
    { path: '../parent_dir.pdf', desc: 'Directory traversal escaping prefix (../)' },
    { path: '.../dots.pdf', desc: 'Invalid triple-dot prefix' },
    { path: 'space1/../../etc/passwd', desc: 'Deep directory traversal after space1/' },
    { path: 'not-a-uuid-format/file.pdf', desc: 'Non-UUID prefix (malformed space prefix)' },
    { path: `${space1.id}/../other_space/secret.pdf`, desc: 'Path traversal hopping into another space' },
  ];

  const dummyPayload = Buffer.from('TEST_PAYLOAD');

  for (const vector of traversalVectors) {
    const uploadRes = await storage.upload(vector.path, dummyPayload, { contentType: 'application/pdf' });
    const isRejected = uploadRes.status === 403 || uploadRes.status === 400 || uploadRes.error !== null;
    recordResult(
      `Storage upload rejects path traversal vector: ${vector.desc} (${vector.path})`,
      isRejected,
      `Status: ${uploadRes.status}, Error: ${uploadRes.error?.message || 'None'}`
    );
  }

  // 2.2 Revoked Device Access Query Attempts
  console.log('\n--- 2.2 Revoked Device Access ---');
  const devToken = generateBearerToken();
  const devTokenHash = sha256(devToken);
  const devId = randomUUID();

  mock1.tables.devices.push({
    id: devId,
    space_id: space1.id,
    device_identifier: 'tv-revocation-test',
    device_name: 'Revocation Test TV',
    device_token_hash: devTokenHash,
    token_hash: devTokenHash,
    is_revoked: false,
    revoked_at: null,
  });

  // Verify access granted when not revoked
  const preRevokeAccess = await mock1.rpc('has_space_access', {
    p_space_id: space1.id,
    p_device_token: devToken,
  });
  const preRevokeId = await mock1.rpc('get_auth_device_id', {
    p_device_token: devToken,
  });
  recordResult(
    'Active TV device is granted space access and resolves device_id',
    preRevokeAccess.data === true && preRevokeId.data === devId,
    `Access: ${preRevokeAccess.data}, DeviceID: ${preRevokeId.data}`
  );

  // Revoke device immediately
  const devRecord = mock1.tables.devices.find((d) => d.id === devId);
  devRecord.is_revoked = true;
  devRecord.revoked_at = new Date().toISOString();

  // Test access immediately after revocation
  const postRevokeAccess = await mock1.rpc('has_space_access', {
    p_space_id: space1.id,
    p_device_token: devToken,
  });
  const postRevokeId = await mock1.rpc('get_auth_device_id', {
    p_device_token: devToken,
  });
  recordResult(
    'Revoked TV device is immediately denied space access (has_space_access = false)',
    postRevokeAccess.data === false,
    `has_space_access returned: ${postRevokeAccess.data}`
  );
  recordResult(
    'Revoked TV device token resolves to null in get_auth_device_id',
    postRevokeId.data === null,
    `get_auth_device_id returned: ${postRevokeId.data}`
  );

  // 2.3 Multi-Tenant Space Isolation
  console.log('\n--- 2.3 Multi-Tenant Space Isolation ---');
  const spaceA = (await mock1.from('spaces').insert({ name: 'Space Alpha' })).data;
  const spaceB = (await mock1.from('spaces').insert({ name: 'Space Beta' })).data;

  // User Alice in Space A
  await mock1.from('members').insert({ space_id: spaceA.id, user_id: 'user-alice', role: 'member' });
  // User Bob in Space B
  await mock1.from('members').insert({ space_id: spaceB.id, user_id: 'user-bob', role: 'member' });

  // File A in Space A, File B in Space B
  await mock1.from('files').insert({
    space_id: spaceA.id,
    name: 'Alice_Confidential.pdf',
    file_type: 'application/pdf',
    size_bytes: 1024,
    storage_path: `${spaceA.id}/Alice_Confidential.pdf`,
  });
  await mock1.from('files').insert({
    space_id: spaceB.id,
    name: 'Bob_Secret.pdf',
    file_type: 'application/pdf',
    size_bytes: 2048,
    storage_path: `${spaceB.id}/Bob_Secret.pdf`,
  });

  // Cross-tenant checks
  const aliceAccessB = await mock1.rpc('has_space_access', { p_space_id: spaceB.id, p_user_id: 'user-alice' });
  const bobAccessA = await mock1.rpc('has_space_access', { p_space_id: spaceA.id, p_user_id: 'user-bob' });
  recordResult(
    'Space A user (Alice) cannot access Space B',
    aliceAccessB.data === false,
    `Access: ${aliceAccessB.data}`
  );
  recordResult(
    'Space B user (Bob) cannot access Space A',
    bobAccessA.data === false,
    `Access: ${bobAccessA.data}`
  );

  // TV in Space A cannot access Space B
  const tvTokenA = generateBearerToken();
  mock1.tables.devices.push({
    id: randomUUID(),
    space_id: spaceA.id,
    device_identifier: 'tv-space-a',
    device_name: 'TV Space A',
    device_token_hash: sha256(tvTokenA),
    is_revoked: false,
  });
  const tvAAccessB = await mock1.rpc('has_space_access', { p_space_id: spaceB.id, p_device_token: tvTokenA });
  recordResult(
    'TV device paired to Space A is denied access to Space B',
    tvAAccessB.data === false,
    `Access: ${tvAAccessB.data}`
  );

  // ==========================================================================
  // SECTION 3: LOW-MEMORY SYNCHRONIZED PDFRENDERER MUTEX
  // ==========================================================================
  console.log('\n--- SECTION 3: LOW-MEMORY SYNCHRONIZED PDFRENDERER MUTEX ---');

  // 3.1 Raw Mutex Collision Detection
  // In Android SDK, android.graphics.pdf.PdfRenderer is strictly single-threaded.
  // Simultaneous renderPage calls MUST collide if unprotected.
  const renderer = new SafeTvPdfRendererSim(3);

  let collisionCaught = false;
  try {
    // Launch two renderPage calls concurrently
    await Promise.all([
      renderer.renderPage(1),
      renderer.renderPage(2),
    ]);
  } catch (err) {
    if (err.message.includes('Concurrent render detected')) {
      collisionCaught = true;
    }
  }
  recordResult(
    'Simultaneous concurrent renderPage calls trigger Mutex collision detection',
    collisionCaught,
    collisionCaught ? 'Detected Mutex violation correctly' : 'FAILED: Concurrency was not detected!'
  );

  // 3.2 Coroutine Mutex Queue Serialization Harness (50 rapid requests)
  class CoroutineMutex {
    constructor() {
      this.locked = false;
      this.waitQueue = [];
    }

    async withLock(action) {
      if (this.locked) {
        await new Promise((resolve) => this.waitQueue.push(resolve));
      }
      this.locked = true;
      try {
        return await action();
      } finally {
        this.locked = false;
        if (this.waitQueue.length > 0) {
          const next = this.waitQueue.shift();
          next();
        }
      }
    }
  }

  const synchronizedRenderer = new SafeTvPdfRendererSim(3);
  const mutex = new CoroutineMutex();

  // Rapid 50 page flips dispatched simultaneously across 50 concurrent tasks
  const pageRequests = Array.from({ length: 50 }, (_, i) => i + 1);
  let renderErrors = [];

  const renderPromises = pageRequests.map((pageNum) =>
    mutex.withLock(async () => {
      try {
        return await synchronizedRenderer.renderPage(pageNum);
      } catch (err) {
        renderErrors.push(err.message);
        throw err;
      }
    })
  );

  const renderedResults = await Promise.all(renderPromises);

  recordResult(
    '50 rapid concurrent page flips execute safely through Mutex serialization without collision',
    renderedResults.length === 50 && renderErrors.length === 0,
    `Rendered ${renderedResults.length}/50 pages. Errors: ${renderErrors.length}`
  );

  // 3.3 Low-Memory Invariants: 3-page LRU sliding window & RGB_565 config
  const activePages = synchronizedRenderer.getActivePages();
  const allRGB565 = renderedResults.every((r) => r.config === 'RGB_565');
  const windowUnderCap = activePages.length <= 3;
  // Since pages 1..50 were rendered in order, active window should contain [48, 49, 50]
  const expectedActive = [48, 49, 50];
  const windowMatchesLRU = JSON.stringify(activePages) === JSON.stringify(expectedActive);

  recordResult(
    'All rendered pages use memory-efficient Bitmap.Config.RGB_565 (2 bytes/pixel)',
    allRGB565,
    `Configs: ${renderedResults.map((r) => r.config).slice(0, 3).join(', ')}`
  );
  recordResult(
    '3-page LRU sliding window strictly caps memory consumption to 3 active pages across 50 renders',
    windowUnderCap && windowMatchesLRU,
    `Active window: [${activePages.join(', ')}], Expected: [${expectedActive.join(', ')}]`
  );

  // ==========================================================================
  // SUMMARY
  // ==========================================================================
  console.log('\n======================================================================');
  console.log(`TEST EXECUTION COMPLETED: ${totalTests} total | ${passedTests} passed | ${failedTests} failed`);
  console.log('======================================================================');

  if (findings.length > 0) {
    console.log('\nVULNERABILITIES / ANOMALIES IDENTIFIED:');
    for (const f of findings) {
      console.log(`- [DEFECT] ${f.name}`);
      console.log(`  Details: ${f.details}`);
    }
  }

  return { totalTests, passedTests, failedTests, findings };
}

if (require.main === module) {
  runChallenger2Suite()
    .then((res) => {
      // Exit with 0 to allow caller to inspect results or non-zero if defects
      process.exit(res.failedTests > 0 ? 1 : 0);
    })
    .catch((err) => {
      console.error('Test harness execution failed:', err);
      process.exit(2);
    });
}

module.exports = { runChallenger2Suite };
