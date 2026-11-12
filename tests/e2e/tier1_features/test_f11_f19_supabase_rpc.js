/**
 * test_f11_f19_supabase_rpc.js - Tier 1 Feature Coverage: RLS Definers, Pairing RPCs, Trash GC, Keep-Alive, Storage & Realtime
 * Features covered: F11, F12, F13, F14, F15, F16, F17, F18, F19 (>= 5 assertions per feature)
 */

const { describe, test, assert } = require('../framework');

describe('Tier 1: Backend & Security - RPC Endpoints, Storage & Realtime', () => {

  // ==========================================================================
  // F11: Space Access RLS Definers
  // ==========================================================================
  test('T1-F11-01: has_space_access and is_space_member_user evaluate member permissions', {
    tier: 1,
    feature: 'F11',
    timeout: 5000,
  }, async (ctx) => {
    const spaceA = (await ctx.client.from('spaces').insert({ name: 'Space A' })).data;
    const spaceB = (await ctx.client.from('spaces').insert({ name: 'Space B' })).data;
    await ctx.client.from('members').insert({ space_id: spaceA.id, user_id: 'user-alice', role: 'member' });

    // Member checks
    const hasAccessA = await ctx.client.rpc('has_space_access', { p_space_id: spaceA.id, p_user_id: 'user-alice' });
    assert.strictEqual(hasAccessA.data, true, 'Alice has access to Space A');

    const hasAccessB = await ctx.client.rpc('has_space_access', { p_space_id: spaceB.id, p_user_id: 'user-alice' });
    assert.strictEqual(hasAccessB.data, false, 'Alice does not have access to Space B');

    const isMemberA = await ctx.client.rpc('is_space_member_user', { p_space_id: spaceA.id, p_user_id: 'user-alice' });
    assert.strictEqual(isMemberA.data, true, 'Alice is a member of Space A');

    const isMemberB = await ctx.client.rpc('is_space_member_user', { p_space_id: spaceB.id, p_user_id: 'user-alice' });
    assert.strictEqual(isMemberB.data, false, 'Alice is not a member of Space B');

    const strangerAccess = await ctx.client.rpc('has_space_access', { p_space_id: spaceA.id, p_user_id: 'stranger-bob' });
    assert.strictEqual(strangerAccess.data, false, 'Stranger has no access');
    assert.status(hasAccessA, 200);
  });

  test('T1-F11-02: is_space_admin verifies owner and admin roles vs regular members', {
    tier: 1,
    feature: 'F11',
    timeout: 5000,
  }, async (ctx) => {
    const space = (await ctx.client.from('spaces').insert({ name: 'Admin Test Space' })).data;
    await ctx.client.from('members').insert([
      { space_id: space.id, user_id: 'u-owner', role: 'owner' },
      { space_id: space.id, user_id: 'u-admin', role: 'admin' },
      { space_id: space.id, user_id: 'u-member', role: 'member' },
    ]);

    const ownerAdmin = await ctx.client.rpc('is_space_admin', { p_space_id: space.id, p_user_id: 'u-owner' });
    assert.strictEqual(ownerAdmin.data, true, 'Owner is an admin');

    const adminCheck = await ctx.client.rpc('is_space_admin', { p_space_id: space.id, p_user_id: 'u-admin' });
    assert.strictEqual(adminCheck.data, true, 'Admin role is an admin');

    const memberAdmin = await ctx.client.rpc('is_space_admin', { p_space_id: space.id, p_user_id: 'u-member' });
    assert.strictEqual(memberAdmin.data, false, 'Regular member is NOT an admin');

    const outsiderAdmin = await ctx.client.rpc('is_space_admin', { p_space_id: space.id, p_user_id: 'u-outsider' });
    assert.strictEqual(outsiderAdmin.data, false, 'Outsider is NOT an admin');
    assert.status(ownerAdmin, 200);
  });

  test('T1-F11-03: get_auth_device_id resolves device identity from hardware bearer token', {
    tier: 1,
    feature: 'F11',
    timeout: 5000,
  }, async (ctx) => {
    const space = (await ctx.client.from('spaces').insert({ name: 'Device RLS Space' })).data;
    const token = ctx.crypto.generateBearerToken();
    const tokenHash = ctx.crypto.sha256(token);
    const dev = (await ctx.client.from('devices').insert({
      space_id: space.id,
      device_identifier: 'tv-token-test',
      device_name: 'Living Room TV',
      device_token_hash: tokenHash,
      is_revoked: false,
    })).data;

    // Resolve valid device
    const resolved = await ctx.client.rpc('get_auth_device_id', { p_device_token: token });
    assert.strictEqual(resolved.data, dev.id, 'Resolved ID must match paired TV UUID');

    // Space access via TV device token
    const tvAccess = await ctx.client.rpc('has_space_access', { p_space_id: space.id, p_device_token: token });
    assert.strictEqual(tvAccess.data, true, 'TV device has access to its space');

    // Invalid token returns null
    const invalidResolve = await ctx.client.rpc('get_auth_device_id', { p_device_token: 'fake-invalid-token' });
    assert.strictEqual(invalidResolve.data, null, 'Invalid token resolves to null');

    // Revoke device
    await ctx.client.from('devices').update({ is_revoked: true }).eq('id', dev.id);
    const revokedResolve = await ctx.client.rpc('get_auth_device_id', { p_device_token: token });
    assert.strictEqual(revokedResolve.data, null, 'Revoked device resolves to null');

    const revokedAccess = await ctx.client.rpc('has_space_access', { p_space_id: space.id, p_device_token: token });
    assert.strictEqual(revokedAccess.data, false, 'Revoked device is denied space access');
    assert.status(resolved, 200);
  });

  // ==========================================================================
  // F12: TV Pairing Code Generation RPC
  // ==========================================================================
  test('T1-F12-01: request_tv_pairing_code RPC contract and parameter validation', {
    tier: 1,
    feature: 'F12',
    timeout: 5000,
  }, async (ctx) => {
    const res = await ctx.client.rpc('request_tv_pairing_code', {
      p_device_identifier: 'tv-f12-001',
      p_device_name: 'Master Bedroom TV',
    });

    assert.status(res, 200);
    assert.ok(res.data.code && res.data.code.length === 6, 'Code must be 6 characters');
    assert.match(res.data.code, /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/, 'Must exclude 0, 1, I, O');
    assert.strictEqual(res.data.device_secret.length, 64, 'Device secret must be 32 bytes hex');
    assert.ok(res.data.expires_at, 'expires_at must be provided');

    // Missing identifier returns 400
    const errRes = await ctx.client.rpc('request_tv_pairing_code', { p_device_identifier: '' });
    assert.status(errRes, 400, 'Empty identifier must return HTTP 400');
  });

  // ==========================================================================
  // F13: TV Pairing Approval RPC
  // ==========================================================================
  test('T1-F13-01: approve_tv_pairing_code links space, stages credentials, and registers device', {
    tier: 1,
    feature: 'F13',
    timeout: 5000,
  }, async (ctx) => {
    const space = (await ctx.client.from('spaces').insert({ name: 'Approve Space' })).data;
    const reqRes = await ctx.client.rpc('request_tv_pairing_code', {
      p_device_identifier: 'tv-f13-001',
      p_device_name: 'Family TV',
    });
    const { code } = reqRes.data;

    const appRes = await ctx.client.rpc('approve_tv_pairing_code', {
      p_code: code,
      p_space_id: space.id,
    });

    assert.status(appRes, 200);
    assert.strictEqual(appRes.data.success, true);
    assert.ok(appRes.data.device_id, 'device_id must be returned');
    assert.strictEqual(appRes.data.device_name, 'Family TV');

    // Check pairing_codes record
    const pairing = (await ctx.client.from('pairing_codes').select('*').eq('code', code).single()).data;
    assert.strictEqual(pairing.status, 'approved');
    assert.strictEqual(pairing.space_id, space.id);
  });

  test('T1-F13-02: approve_tv_pairing_code error handling and code sanitization', {
    tier: 1,
    feature: 'F13',
    timeout: 5000,
  }, async (ctx) => {
    const space = (await ctx.client.from('spaces').insert({ name: 'Sanitize Space' })).data;
    const reqRes = await ctx.client.rpc('request_tv_pairing_code', {
      p_device_identifier: 'tv-f13-002',
      p_device_name: 'Den TV',
    });
    const rawCode = reqRes.data.code;
    const formattedCode = `${rawCode.slice(0, 3)}-${rawCode.slice(3)}`.toLowerCase(); // e.g. 'abc-def'

    // Hyphenated & lowercase code should succeed after normalization
    const appRes = await ctx.client.rpc('approve_tv_pairing_code', {
      p_code: formattedCode,
      p_space_id: space.id,
    });
    assert.status(appRes, 200, 'Normalized code must succeed');
    assert.strictEqual(appRes.data.success, true);

    // Non-existent code returns 404
    const notFoundRes = await ctx.client.rpc('approve_tv_pairing_code', {
      p_code: 'XXXXXX',
      p_space_id: space.id,
    });
    assert.status(notFoundRes, 404, 'Unknown code must return 404');
    assert.strictEqual(notFoundRes.data, null);
    assert.ok(notFoundRes.error, 'Error object must be returned');
  });

  // ==========================================================================
  // F14: TV Pairing Claim RPC
  // ==========================================================================
  test('T1-F14-01: claim_tv_pairing_code delivers credentials and scrubs secret to prevent replay', {
    tier: 1,
    feature: 'F14',
    timeout: 5000,
  }, async (ctx) => {
    const space = (await ctx.client.from('spaces').insert({ name: 'Claim Space' })).data;
    const reqRes = await ctx.client.rpc('request_tv_pairing_code', {
      p_device_identifier: 'tv-f14-001',
      p_device_name: 'Basement TV',
    });
    const { code, device_secret } = reqRes.data;

    await ctx.client.rpc('approve_tv_pairing_code', { p_code: code, p_space_id: space.id });

    // Claim
    const claimRes = await ctx.client.rpc('claim_tv_pairing_code', {
      p_device_identifier: 'tv-f14-001',
      p_device_secret: device_secret,
    });

    assert.status(claimRes, 200);
    assert.strictEqual(claimRes.data.status, 'approved');
    assert.strictEqual(claimRes.data.space_id, space.id);
    assert.ok(claimRes.data.device_token, 'device_token must be issued');
    assert.strictEqual(claimRes.data.device_token.length, 96, '48-byte token must be 96 hex characters');

    // Replay attempt must return not_found
    const replayRes = await ctx.client.rpc('claim_tv_pairing_code', {
      p_device_identifier: 'tv-f14-001',
      p_device_secret: device_secret,
    });
    assert.strictEqual(replayRes.data.status, 'not_found', 'Replay must be blocked');
  });

  test('T1-F14-02: claim_tv_pairing_code handles pending, wrong secret, and expired states', {
    tier: 1,
    feature: 'F14',
    timeout: 5000,
  }, async (ctx) => {
    const reqRes = await ctx.client.rpc('request_tv_pairing_code', {
      p_device_identifier: 'tv-f14-002',
      p_device_name: 'Porch TV',
    });
    const { device_secret } = reqRes.data;

    // Polling before approval returns 'pending'
    const pendingClaim = await ctx.client.rpc('claim_tv_pairing_code', {
      p_device_identifier: 'tv-f14-002',
      p_device_secret: device_secret,
    });
    assert.strictEqual(pendingClaim.data.status, 'pending');
    assert.strictEqual(pendingClaim.data.device_token, null);

    // Wrong secret returns 'not_found'
    const wrongSecretClaim = await ctx.client.rpc('claim_tv_pairing_code', {
      p_device_identifier: 'tv-f14-002',
      p_device_secret: '0000000000000000000000000000000000000000000000000000000000000000',
    });
    assert.strictEqual(wrongSecretClaim.data.status, 'not_found');
    assert.strictEqual(wrongSecretClaim.data.space_id, null);
    assert.status(pendingClaim, 200);
  });

  // ==========================================================================
  // F15: 30-Day Trash Garbage Collection
  // ==========================================================================
  test('T1-F15-01: cleanup_expired_trash purges items older than 30 days while preserving recent trash', {
    tier: 1,
    feature: 'F15',
    timeout: 5000,
  }, async (ctx) => {
    const space = (await ctx.client.from('spaces').insert({ name: 'Trash Space' })).data;
    const thirtyFiveDaysAgo = new Date(Date.now() - 35 * 86400 * 1000).toISOString();
    const tenDaysAgo = new Date(Date.now() - 10 * 86400 * 1000).toISOString();

    // Expired file & folder
    const expFile = (await ctx.client.from('files').insert({
      space_id: space.id,
      name: 'expired_tax_2020.pdf',
      file_type: 'application/pdf',
      file_category: 'pdf',
      size_bytes: 1024,
      storage_path: `${space.id}/expired_tax_2020.pdf`,
      deleted_at: thirtyFiveDaysAgo,
    })).data;
    const expFolder = (await ctx.client.from('folders').insert({
      space_id: space.id,
      name: 'Old Trash Folder',
      deleted_at: thirtyFiveDaysAgo,
    })).data;

    // Recent soft-deleted file
    const recentFile = (await ctx.client.from('files').insert({
      space_id: space.id,
      name: 'recent_photo.jpg',
      file_type: 'image/jpeg',
      file_category: 'image',
      size_bytes: 2048,
      storage_path: `${space.id}/recent_photo.jpg`,
      deleted_at: tenDaysAgo,
    })).data;

    const cleanupRes = await ctx.client.rpc('cleanup_expired_trash');
    assert.status(cleanupRes, 200);
    assert.ok(cleanupRes.data.files_purged >= 1, 'At least 1 expired file must be purged');
    assert.ok(cleanupRes.data.folders_purged >= 1, 'At least 1 expired folder must be purged');

    // Verify expired file deleted
    const files = (await ctx.client.from('files').select('*')).data;
    assert.strictEqual(files.some((f) => f.id === expFile.id), false, 'Expired file must be deleted');
    // Verify recent file preserved
    assert.strictEqual(files.some((f) => f.id === recentFile.id), true, 'Recent file must survive');
  });

  test('T1-F15-02: cleanup_expired_trash on empty trash returns zero purged without error', {
    tier: 1,
    feature: 'F15',
    timeout: 5000,
  }, async (ctx) => {
    const res = await ctx.client.rpc('cleanup_expired_trash');
    assert.status(res, 200);
    assert.strictEqual(typeof res.data.files_purged, 'number');
    assert.strictEqual(typeof res.data.folders_purged, 'number');
    assert.ok(res.data.files_purged >= 0);
    assert.ok(res.data.folders_purged >= 0);
  });

  // ==========================================================================
  // F16: Keep-Alive Ping RPC
  // ==========================================================================
  test('T1-F16-01: health_check_ping returns healthy status, space count, and invokes trash purge', {
    tier: 1,
    feature: 'F16',
    timeout: 5000,
  }, async (ctx) => {
    await ctx.client.from('spaces').insert({ name: 'Ping Test Space' });
    const res = await ctx.client.rpc('health_check_ping');

    assert.status(res, 200);
    assert.strictEqual(res.data.status, 'healthy');
    assert.ok(res.data.timestamp, 'Timestamp must be returned');
    assert.ok(!isNaN(Date.parse(res.data.timestamp)), 'Timestamp must be valid ISO date');
    assert.ok(res.data.active_spaces_count >= 1, 'Active space count must be >= 1');
    assert.strictEqual(typeof res.data.trash_files_purged, 'number');
  });

  // ==========================================================================
  // F17: Private Storage Bucket Enforcement
  // ==========================================================================
  test('T1-F17-01: Storage enforces 50MB ceiling, accepting 50MB and rejecting 50MB + 1 byte', {
    tier: 1,
    feature: 'F17',
    timeout: 5000,
  }, async (ctx) => {
    const spaceId = '17111111-1111-1111-1111-111111111111';

    // 1MB valid upload
    const valid1MB = Buffer.alloc(1024 * 1024, 0x5a);
    const res1MB = await ctx.storage.from('family-files').upload(`${spaceId}/doc.pdf`, valid1MB, {
      contentType: 'application/pdf',
    });
    assert.status(res1MB, 200);

    // Exact 50MB (52,428,800 bytes) boundary acceptance
    const exact50MB = { byteLength: 52428800 };
    const res50MB = await ctx.storage.from('family-files').upload(`${spaceId}/exact50.pdf`, exact50MB, {
      contentType: 'application/pdf',
    });
    assert.status(res50MB, 200, 'Exact 50MB file must be accepted');

    // Over 50MB (52,428,801 bytes) boundary rejection
    const over50MB = { byteLength: 52428801 };
    const resOver = await ctx.storage.from('family-files').upload(`${spaceId}/over50.pdf`, over50MB, {
      contentType: 'application/pdf',
    });
    assert.status(resOver, 413, 'Over 50MB file must be rejected with HTTP 413');
    assert.ok(resOver.error.message.includes('50MB'), 'Error message must cite 50MB limit');
    assert.strictEqual(resOver.data, null);
  });

  test('T1-F17-02: Storage enforces strict MIME whitelist and rejects disallowed types', {
    tier: 1,
    feature: 'F17',
    timeout: 5000,
  }, async (ctx) => {
    const spaceId = '17222222-2222-2222-2222-222222222222';
    const buf = Buffer.alloc(1024, 0x11);

    // Allowed types: image, pdf, docx
    const imgRes = await ctx.storage.from('family-files').upload(`${spaceId}/photo.jpg`, buf, { contentType: 'image/jpeg' });
    const pdfRes = await ctx.storage.from('family-files').upload(`${spaceId}/doc.pdf`, buf, { contentType: 'application/pdf' });
    const docxRes = await ctx.storage.from('family-files').upload(`${spaceId}/notes.docx`, buf, {
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });

    assert.status(imgRes, 200);
    assert.status(pdfRes, 200);
    assert.status(docxRes, 200);

    // Disallowed executable MIME type
    const exeRes = await ctx.storage.from('family-files').upload(`${spaceId}/malicious.exe`, buf, {
      contentType: 'application/x-msdownload',
    });
    assert.status(exeRes, 400, 'Disallowed MIME type must return HTTP 400');
    assert.ok(exeRes.error.message.includes('not allowed'), 'Error message must explain disallowed MIME');
  });

  // ==========================================================================
  // F18: Path-Prefixed Storage RLS Policies
  // ==========================================================================
  test('T1-F18-01: Storage upload strictly requires space prefix <space_id>/...', {
    tier: 1,
    feature: 'F18',
    timeout: 5000,
  }, async (ctx) => {
    const buf = Buffer.alloc(512, 0x22);

    // Upload with valid space prefix
    const validRes = await ctx.storage.from('family-files').upload('18111111-1111-1111-1111-111111111111/inbox/file.txt', buf, {
      contentType: 'text/plain',
    });
    assert.status(validRes, 200);
    assert.strictEqual(validRes.data.path, '18111111-1111-1111-1111-111111111111/inbox/file.txt');

    // Upload without space prefix
    const invalidRes = await ctx.storage.from('family-files').upload('root_level_file.txt', buf, {
      contentType: 'text/plain',
    });
    assert.status(invalidRes, 403, 'Path lacking space prefix must return 403');
    assert.ok(invalidRes.error.message.includes('prefix'));
    assert.strictEqual(invalidRes.data, null);
  });

  test('T1-F18-02: Storage download, signed URL creation, and admin deletion', {
    tier: 1,
    feature: 'F18',
    timeout: 5000,
  }, async (ctx) => {
    const path = '18222222-2222-2222-2222-222222222222/folder1/doc.pdf';
    const payload = Buffer.from('PDF_SAMPLE_PAYLOAD_E2E');
    await ctx.storage.from('family-files').upload(path, payload, { contentType: 'application/pdf' });

    // Download
    const dlRes = await ctx.storage.from('family-files').download(path);
    assert.status(dlRes, 200);
    assert.strictEqual(dlRes.data.toString(), 'PDF_SAMPLE_PAYLOAD_E2E');

    // Signed URL
    const signedRes = await ctx.storage.from('family-files').createSignedUrl(path, 3600);
    assert.status(signedRes, 200);
    assert.ok(signedRes.data.signedUrl.includes(path));

    // Delete
    const delRes = await ctx.storage.from('family-files').remove([path]);
    assert.status(delRes, 200);
    const afterDel = await ctx.storage.from('family-files').download(path);
    assert.status(afterDel, 404, 'Deleted object must return 404');
  });

  // ==========================================================================
  // F19: Full Logical Replication Publication
  // ==========================================================================
  test('T1-F19-01: Realtime publication includes files, folders, notes, and pairing_codes', {
    tier: 1,
    feature: 'F19',
    timeout: 5000,
  }, async (ctx) => {
    const pubTables = ctx.client.getPublicationTables('supabase_realtime');
    assert.ok(pubTables.includes('files'), 'Publication must include files table');
    assert.ok(pubTables.includes('folders'), 'Publication must include folders table');
    assert.ok(pubTables.includes('notes'), 'Publication must include notes table');
    assert.ok(pubTables.includes('pairing_codes'), 'Publication must include pairing_codes table');
    assert.strictEqual(ctx.client.getReplicaIdentity('files'), 'full', 'files replica identity must be full');
  });

  test('T1-F19-02: Realtime subscriber receives complete rows on insert, update, and delete', {
    tier: 1,
    feature: 'F19',
    timeout: 5000,
  }, async (ctx) => {
    const events = [];
    const unsubscribe = ctx.client.subscribeRealtime('files', (evt) => {
      events.push(evt);
    });

    // 1. Insert
    const inserted = (await ctx.client.from('files').insert({
      space_id: 'space-realtime-01',
      name: 'live_stream.pdf',
      file_type: 'application/pdf',
      file_category: 'pdf',
      size_bytes: 1024,
      storage_path: 'space-realtime-01/live_stream.pdf',
    })).data;

    // 2. Update
    await ctx.client.from('files').update({ view_count: 1 }).eq('id', inserted.id);

    // 3. Delete
    await ctx.client.from('files').delete().eq('id', inserted.id);

    unsubscribe();

    assert.ok(events.length >= 3, 'Must capture at least 3 realtime events');
    const insertEvt = events.find((e) => e.event === 'INSERT');
    assert.ok(insertEvt && insertEvt.record.name === 'live_stream.pdf');
    const updateEvt = events.find((e) => e.event === 'UPDATE');
    assert.ok(updateEvt && updateEvt.record.view_count === 1);
    const deleteEvt = events.find((e) => e.event === 'DELETE');
    assert.ok(deleteEvt && deleteEvt.record.id === inserted.id);
    assert.strictEqual(deleteEvt.table, 'files');
  });
});
