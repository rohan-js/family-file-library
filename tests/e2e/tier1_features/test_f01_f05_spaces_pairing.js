/**
 * test_f01_f05_spaces_pairing.js - Tier 1 Feature Coverage: Spaces, Members, Invites, Devices & Pairing Handshake
 * Features covered: F01, F02, F03, F04, F05 (>= 5 assertions per feature)
 */

const { describe, test, assert } = require('../framework');

describe('Tier 1: Backend & Security - Spaces, Members & Pairing', () => {

  // ==========================================================================
  // F01: Multi-Tenant Space Container
  // ==========================================================================
  test('T1-F01-01: Space creation generates UUID, assigns creator, and stores timestamps', {
    tier: 1,
    feature: 'F01',
    timeout: 5000,
  }, async (ctx) => {
    const creatorId = '00000000-0000-4000-a000-000000000001';
    const res = await ctx.client.from('spaces').insert({
      name: 'Sharma Family Library',
      created_by: creatorId,
    });

    assert.status(res, 201, 'Space creation must return status 201');
    assert.ok(res.data.id, 'Space must be assigned a non-empty primary key');
    assert.match(
      res.data.id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      'Space ID must be a valid UUID'
    );
    assert.strictEqual(res.data.name, 'Sharma Family Library', 'Space name must match input');
    assert.strictEqual(res.data.created_by, creatorId, 'Creator ID must match authenticated owner');
    assert.ok(!isNaN(Date.parse(res.data.created_at)), 'created_at must be a valid ISO date');
    assert.strictEqual(res.data.pin_hash || null, null, 'pin_hash must be null by default');
  });

  test('T1-F01-02: Space supports salted TV PIN hash configuration and clearing', {
    tier: 1,
    feature: 'F01',
    timeout: 5000,
  }, async (ctx) => {
    const spaceRes = await ctx.client.from('spaces').insert({ name: 'PIN Protected Space' });
    const spaceId = spaceRes.data.id;

    // Set 4-digit PIN '7492' with space-specific salt
    const salt = spaceId;
    const pinHash = ctx.crypto.sha256(`${salt}:7492`);
    const updateRes = await ctx.client.from('spaces').update({
      pin_hash: pinHash,
      pin_updated_at: new Date().toISOString(),
    }).eq('id', spaceId);

    assert.status(updateRes, 200, 'PIN update must succeed');

    // Fetch updated record
    const fetchRes = await ctx.client.from('spaces').select('*').eq('id', spaceId).single();
    assert.status(fetchRes, 200);
    assert.strictEqual(fetchRes.data.pin_hash, pinHash, 'Stored pin_hash must match computed SHA-256');
    assert.strictEqual(fetchRes.data.pin_hash.length, 64, 'SHA-256 hash must be 64 hex characters');
    assert.ok(fetchRes.data.pin_updated_at, 'pin_updated_at must be recorded');

    // Clear PIN
    await ctx.client.from('spaces').update({ pin_hash: null, pin_updated_at: null }).eq('id', spaceId);
    const clearedRes = await ctx.client.from('spaces').select('*').eq('id', spaceId).single();
    assert.strictEqual(clearedRes.data.pin_hash, null, 'Cleared pin_hash must be null');
  });

  test('T1-F01-03: Multi-tenant space isolation guarantees distinct containers', {
    tier: 1,
    feature: 'F01',
    timeout: 5000,
  }, async (ctx) => {
    const s1 = await ctx.client.from('spaces').insert({ name: 'Space Alpha' });
    const s2 = await ctx.client.from('spaces').insert({ name: 'Space Beta' });

    assert.notStrictEqual(s1.data.id, s2.data.id, 'Distinct spaces must have unique UUIDs');
    const allSpaces = await ctx.client.from('spaces').select('*');
    assert.ok(allSpaces.data.length >= 2, 'Must contain multiple space containers');

    const alpha = allSpaces.data.find((s) => s.id === s1.data.id);
    const beta = allSpaces.data.find((s) => s.id === s2.data.id);
    assert.strictEqual(alpha.name, 'Space Alpha');
    assert.strictEqual(beta.name, 'Space Beta');
    assert.notStrictEqual(alpha.name, beta.name);
  });

  // ==========================================================================
  // F02: Role-Based Space Membership
  // ==========================================================================
  test('T1-F02-01: Space membership assigns owner, admin, and member roles', {
    tier: 1,
    feature: 'F02',
    timeout: 5000,
  }, async (ctx) => {
    const space = (await ctx.client.from('spaces').insert({ name: 'Membership Test Space' })).data;

    const ownerRes = await ctx.client.from('members').insert({
      space_id: space.id,
      user_id: 'user-001',
      role: 'owner',
      display_name: 'Father',
    });
    const adminRes = await ctx.client.from('members').insert({
      space_id: space.id,
      user_id: 'user-002',
      role: 'admin',
      display_name: 'Mother',
    });
    const memberRes = await ctx.client.from('members').insert({
      space_id: space.id,
      user_id: 'user-003',
      role: 'member',
      display_name: 'Child',
    });

    assert.status(ownerRes, 201);
    assert.status(adminRes, 201);
    assert.status(memberRes, 201);
    assert.strictEqual(ownerRes.data.role, 'owner');
    assert.strictEqual(adminRes.data.role, 'admin');
    assert.strictEqual(memberRes.data.role, 'member');
  });

  test('T1-F02-02: Query active members for space with role filtering', {
    tier: 1,
    feature: 'F02',
    timeout: 5000,
  }, async (ctx) => {
    const space = (await ctx.client.from('spaces').insert({ name: 'Query Members Space' })).data;
    await ctx.client.from('members').insert([
      { space_id: space.id, user_id: 'u-1', role: 'owner', display_name: 'Owner' },
      { space_id: space.id, user_id: 'u-2', role: 'member', display_name: 'Member 1' },
      { space_id: space.id, user_id: 'u-3', role: 'member', display_name: 'Member 2' },
    ]);

    const membersRes = await ctx.client.from('members').select('*').eq('space_id', space.id);
    assert.status(membersRes, 200);
    assert.strictEqual(membersRes.data.length, 3, 'Must return all 3 members');

    const regularMembers = membersRes.data.filter((m) => m.role === 'member');
    assert.strictEqual(regularMembers.length, 2, 'Must filter 2 regular members');
    const owner = membersRes.data.find((m) => m.role === 'owner');
    assert.strictEqual(owner.user_id, 'u-1');
    assert.strictEqual(owner.display_name, 'Owner');
  });

  test('T1-F02-03: Member role updates from member to admin', {
    tier: 1,
    feature: 'F02',
    timeout: 5000,
  }, async (ctx) => {
    const space = (await ctx.client.from('spaces').insert({ name: 'Role Promotion Space' })).data;
    const member = (await ctx.client.from('members').insert({
      space_id: space.id,
      user_id: 'u-promote',
      role: 'member',
    })).data;

    const updateRes = await ctx.client.from('members').update({ role: 'admin' }).eq('id', member.id);
    assert.status(updateRes, 200);

    const promoted = (await ctx.client.from('members').select('*').eq('id', member.id).single()).data;
    assert.strictEqual(promoted.role, 'admin', 'Role must be updated to admin');
    assert.strictEqual(promoted.space_id, space.id);
    assert.strictEqual(promoted.user_id, 'u-promote');
    assert.ok(promoted.updated_at, 'updated_at timestamp must be recorded');
  });

  // ==========================================================================
  // F03: 7-Day Email Invitation System
  // ==========================================================================
  test('T1-F03-01: Create invitation with 48-character token and 7-day expiration', {
    tier: 1,
    feature: 'F03',
    timeout: 5000,
  }, async (ctx) => {
    const space = (await ctx.client.from('spaces').insert({ name: 'Invite Space' })).data;
    const token = ctx.crypto.generateBearerToken().slice(0, 48); // 48-char hex token
    const now = Date.now();
    const expiresAt = new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString();

    const inviteRes = await ctx.client.from('invites').insert({
      space_id: space.id,
      email: 'grandma@gmail.com',
      invited_by: 'user-inviter-01',
      role: 'member',
      status: 'pending',
      token,
      expires_at: expiresAt,
    });

    assert.status(inviteRes, 201);
    assert.strictEqual(inviteRes.data.status, 'pending');
    assert.strictEqual(inviteRes.data.token.length, 48, 'Token must be 48 hex characters');
    const expiryDiffDays = (new Date(inviteRes.data.expires_at) - now) / (1000 * 60 * 60 * 24);
    assert.ok(expiryDiffDays >= 6.9 && expiryDiffDays <= 7.1, 'Expiry must be approximately 7 days');
    assert.strictEqual(inviteRes.data.invited_by, 'user-inviter-01');
    assert.strictEqual(inviteRes.data.email.toLowerCase(), 'grandma@gmail.com');
  });

  test('T1-F03-02: Accept invitation transitions status to accepted and creates membership', {
    tier: 1,
    feature: 'F03',
    timeout: 5000,
  }, async (ctx) => {
    const space = (await ctx.client.from('spaces').insert({ name: 'Invite Accept Space' })).data;
    const token = ctx.crypto.generateBearerToken().slice(0, 48);
    await ctx.client.from('invites').insert({
      space_id: space.id,
      email: 'sister@gmail.com',
      invited_by: 'user-inviter-01',
      role: 'member',
      status: 'pending',
      token,
      expires_at: new Date(Date.now() + 7 * 86400 * 1000).toISOString(),
    });

    const acceptRes = await ctx.client.rpc('accept_space_invite', {
      p_token: token,
      p_user_id: 'user-sister-uuid',
      p_user_email: 'sister@gmail.com',
      p_display_name: 'Sister',
    });

    assert.status(acceptRes, 200);
    assert.strictEqual(acceptRes.data.success, true);
    assert.strictEqual(acceptRes.data.space_id, space.id);
    assert.strictEqual(acceptRes.data.role, 'member');

    // Verify invite status transitioned
    const invite = (await ctx.client.from('invites').select('*').eq('token', token).single()).data;
    assert.strictEqual(invite.status, 'accepted');

    // Verify member record was created
    const member = (await ctx.client.from('members').select('*')
      .eq('space_id', space.id)
      .eq('user_id', 'user-sister-uuid')
      .single()).data;
    assert.strictEqual(member.role, 'member');
  });

  // ==========================================================================
  // F04: Paired TV Device Registry
  // ==========================================================================
  test('T1-F04-01: Register paired Android TV device with SHA-256 hashed bearer token', {
    tier: 1,
    feature: 'F04',
    timeout: 5000,
  }, async (ctx) => {
    const space = (await ctx.client.from('spaces').insert({ name: 'Device Space' })).data;
    const rawToken = ctx.crypto.generateBearerToken();
    const tokenHash = ctx.crypto.sha256(rawToken);

    const devRes = await ctx.client.from('devices').insert({
      space_id: space.id,
      device_identifier: 'tv-bravia-101',
      device_name: 'Living Room Sony Bravia',
      device_type: 'android_tv',
      device_token_hash: tokenHash,
      paired_by: 'user-dad-01',
      is_revoked: false,
    });

    assert.status(devRes, 201);
    assert.ok(devRes.data.id, 'Device ID must be created');
    assert.strictEqual(devRes.data.device_name, 'Living Room Sony Bravia');
    assert.strictEqual(devRes.data.device_type, 'android_tv');
    assert.strictEqual(devRes.data.device_token_hash, tokenHash);
    assert.strictEqual(devRes.data.is_revoked, false);
  });

  test('T1-F04-02: Device heartbeat updates last_seen_at and queries active devices', {
    tier: 1,
    feature: 'F04',
    timeout: 5000,
  }, async (ctx) => {
    const space = (await ctx.client.from('spaces').insert({ name: 'Heartbeat Space' })).data;
    const dev = (await ctx.client.from('devices').insert({
      space_id: space.id,
      device_identifier: 'tv-heartbeat-01',
      device_name: 'Bedroom TV',
      device_token_hash: 'hash-abc',
      is_revoked: false,
    })).data;

    const newTimestamp = new Date().toISOString();
    const updateRes = await ctx.client.from('devices').update({ last_seen_at: newTimestamp }).eq('id', dev.id);
    assert.status(updateRes, 200);

    const activeDevices = await ctx.client.from('devices').select('*')
      .eq('space_id', space.id)
      .eq('is_revoked', false);
    assert.strictEqual(activeDevices.data.length, 1);
    assert.strictEqual(activeDevices.data[0].last_seen_at, newTimestamp);
    assert.strictEqual(activeDevices.data[0].device_identifier, 'tv-heartbeat-01');
    assert.strictEqual(activeDevices.data[0].space_id, space.id);
  });

  test('T1-F04-03: Instant device revocation marks is_revoked and prevents active queries', {
    tier: 1,
    feature: 'F04',
    timeout: 5000,
  }, async (ctx) => {
    const space = (await ctx.client.from('spaces').insert({ name: 'Revoke Space' })).data;
    const dev = (await ctx.client.from('devices').insert({
      space_id: space.id,
      device_identifier: 'tv-old-model',
      device_name: 'Guest Room TV',
      device_token_hash: 'hash-xyz',
      is_revoked: false,
    })).data;

    // Revoke device
    const revokeRes = await ctx.client.from('devices').update({ is_revoked: true }).eq('id', dev.id);
    assert.status(revokeRes, 200);

    const queried = (await ctx.client.from('devices').select('*').eq('id', dev.id).single()).data;
    assert.strictEqual(queried.is_revoked, true, 'is_revoked must be true');

    // Query active non-revoked devices
    const active = await ctx.client.from('devices').select('*')
      .eq('space_id', space.id)
      .eq('is_revoked', false);
    assert.strictEqual(active.data.length, 0, 'Revoked device must not appear in active queries');
    assert.strictEqual(queried.device_identifier, 'tv-old-model');
  });

  // ==========================================================================
  // F05: Ephemeral Pairing Handshake
  // ==========================================================================
  test('T1-F05-01: Generates 6-character uppercase code without ambiguous characters (0, 1, I, O)', {
    tier: 1,
    feature: 'F05',
    timeout: 5000,
  }, async (ctx) => {
    const res = await ctx.client.rpc('request_tv_pairing_code', {
      p_device_identifier: 'tv-livingroom-f05',
      p_device_name: 'Living Room TV',
    });

    assert.status(res, 200);
    assert.strictEqual(res.data.code.length, 6, 'Code must be exactly 6 characters');
    assert.match(
      res.data.code,
      /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/,
      'Code must exclude confusing characters 0, 1, I, O'
    );
    assert.strictEqual(res.data.device_secret.length, 64, 'Device secret must be 64 hex characters (32 bytes)');
    const expiryDiffMinutes = (new Date(res.data.expires_at) - Date.now()) / (1000 * 60);
    assert.ok(expiryDiffMinutes >= 9.5 && expiryDiffMinutes <= 10.5, 'Expires at must be ~10 minutes out');
    assert.ok(res.data.expires_at, 'Expiration timestamp must be returned');
  });

  test('T1-F05-02: Handshake state stores hashed secret and device hardware identifier', {
    tier: 1,
    feature: 'F05',
    timeout: 5000,
  }, async (ctx) => {
    const reqRes = await ctx.client.rpc('request_tv_pairing_code', {
      p_device_identifier: 'tv-kitchen-f05',
      p_device_name: 'Kitchen TV',
    });
    const { code, device_secret } = reqRes.data;

    const record = (await ctx.client.from('pairing_codes').select('*').eq('code', code).single()).data;
    assert.strictEqual(record.status, 'pending');
    assert.strictEqual(record.device_identifier, 'tv-kitchen-f05');
    assert.strictEqual(record.device_secret_hash, ctx.crypto.sha256(device_secret));
    assert.strictEqual(record.space_id, null, 'space_id must be null while pending');
    assert.strictEqual(record.device_name, 'Kitchen TV');
  });
});
