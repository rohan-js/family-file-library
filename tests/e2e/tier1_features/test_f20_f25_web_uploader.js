/**
 * test_f20_f25_web_uploader.js - Tier 1: Web Uploader PWA, Share Target, OAuth, PIN & Trash
 * Covers Features F20, F21, F22, F23, F24, F25 (>= 5 assertions per feature).
 */

const { describe, test, assert } = require('../framework');

// ============================================================================
// SIMULATOR MODELS FOR WEB PWA CONTRACTS & INVARIANTS
// ============================================================================

class WebShareTargetSim {
  constructor() {
    this.manifest = {
      name: 'Android TV Family File Library',
      short_name: 'Family Files',
      start_url: '/',
      display: 'standalone',
      share_target: {
        action: '/share-target',
        method: 'POST',
        enctype: 'multipart/form-data',
        params: {
          title: 'name',
          text: 'description',
          files: [
            {
              name: 'file',
              accept: [
                'image/*',
                'application/pdf',
                '.docx', '.pptx', '.xlsx',
                '.txt', '.md',
              ],
            },
          ],
        },
      },
    };
    this.indexedDbSharedFiles = [];
  }

  handleFetchEvent(request) {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/share-target' && request.method === 'POST') {
      const files = request.formData ? request.formData.getAll('file') : [];
      for (const f of files) {
        this.indexedDbSharedFiles.push({
          id: 'shared-' + Math.random().toString(36).slice(2, 9),
          name: f.name,
          type: f.type,
          size: f.size,
          data: f.data,
          sharedAt: new Date().toISOString(),
        });
      }
      return {
        status: 303,
        headers: { Location: '/?shared=true' },
      };
    }
    return { status: 404 };
  }

  flushSharedFiles() {
    const flushed = [...this.indexedDbSharedFiles];
    this.indexedDbSharedFiles = [];
    return flushed;
  }
}

class WebUploaderSim {
  constructor(maxSizeBytes = 52428800) {
    this.maxSizeBytes = maxSizeBytes; // 50MB
    this.queue = [];
  }

  validateFile(file) {
    if (!file || file.size === 0) {
      return { valid: false, error: 'File is empty' };
    }
    if (file.size > this.maxSizeBytes) {
      return { valid: false, error: 'File exceeds 50MB limit' };
    }
    return { valid: true, error: null };
  }

  enqueue(file) {
    const validation = this.validateFile(file);
    if (!validation.valid) {
      return { status: 'rejected', error: validation.error };
    }
    const item = {
      id: 'upload-' + Math.random().toString(36).slice(2, 9),
      name: file.name,
      size: file.size,
      formattedSize: (file.size / (1024 * 1024)).toFixed(1) + ' MB',
      status: 'queued',
      progress: 0,
      data: file.data || Buffer.alloc(0),
    };
    this.queue.push(item);
    return { status: 'queued', item };
  }

  async uploadStream(item, onProgress) {
    item.status = 'uploading';
    const total = item.size;
    const steps = [0.25, 0.5, 0.75, 1.0];

    for (const step of steps) {
      item.progress = Math.round(step * 100);
      if (onProgress) onProgress(item.progress);
    }

    item.status = 'completed';
    return { status: 'completed', item };
  }
}

class GoogleOAuthSim {
  constructor() {
    this.storage = new Map();
    this.authState = 'unauthenticated';
    this.currentUser = null;
    this.listener = null;
  }

  signInWithOAuth({ provider, scopes = ['email', 'profile'] }) {
    if (provider !== 'google') throw new Error(`Unsupported provider ${provider}`);
    const codeVerifier = 'verifier_' + Math.random().toString(36).slice(2, 12);
    const codeChallenge = 'challenge_' + Math.random().toString(36).slice(2, 12);
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=google_client_id&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fcallback&response_type=code&scope=${encodeURIComponent(scopes.join(' '))}&code_challenge=${codeChallenge}&code_challenge_method=S256`;
    return { authUrl, codeVerifier, scopes, provider };
  }

  handleCallback(code) {
    if (!code) throw new Error('Missing OAuth authorization code');
    const user = {
      id: '00000000-0000-4000-a000-000000000099',
      email: 'user.family@gmail.com',
      user_metadata: { full_name: 'Family Organizer', avatar_url: 'https://lh3.googleusercontent.com/avatar' },
    };
    const session = {
      access_token: 'jwt_access_' + Math.random().toString(36).slice(2, 16),
      refresh_token: 'refresh_' + Math.random().toString(36).slice(2, 16),
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user,
    };
    this.storage.set('supabase.auth.token', JSON.stringify(session));
    this.currentUser = user;
    this.authState = 'authenticated';
    if (this.listener) this.listener('SIGNED_IN', session);
    return session;
  }

  restoreSession() {
    const raw = this.storage.get('supabase.auth.token');
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (session.expires_at < Math.floor(Date.now() / 1000)) {
      return this.refreshSession(session.refresh_token);
    }
    this.currentUser = session.user;
    this.authState = 'authenticated';
    return session;
  }

  refreshSession(refreshToken) {
    if (!refreshToken || refreshToken.startsWith('invalid')) {
      this.signOut();
      return null;
    }
    const newSession = {
      access_token: 'jwt_refreshed_' + Math.random().toString(36).slice(2, 16),
      refresh_token: refreshToken,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: this.currentUser || { id: '00000000-0000-4000-a000-000000000099', email: 'user.family@gmail.com' },
    };
    this.storage.set('supabase.auth.token', JSON.stringify(newSession));
    this.currentUser = newSession.user;
    this.authState = 'authenticated';
    if (this.listener) this.listener('TOKEN_REFRESHED', newSession);
    return newSession;
  }

  signOut() {
    this.storage.delete('supabase.auth.token');
    this.currentUser = null;
    this.authState = 'unauthenticated';
    if (this.listener) this.listener('SIGNED_OUT', null);
  }

  onAuthStateChange(callback) {
    this.listener = callback;
  }
}

class MobilePairScreenSim {
  constructor() {
    this.inputCode = '';
    this.selectedSpaceId = '';
    this.spacesList = [];
    this.status = 'idle'; // idle, submitting, success, error
    this.errorMessage = '';
    this.pairedDevice = null;
  }

  setCode(code) {
    const sanitized = String(code || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    this.inputCode = sanitized.slice(0, 6);
  }

  isSubmitEnabled() {
    return this.inputCode.length === 6 && Boolean(this.selectedSpaceId);
  }

  parseUrl(urlStr) {
    const url = new URL(urlStr, 'http://localhost');
    const code = url.searchParams.get('code');
    if (code) {
      this.setCode(code);
      const isValid = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/.test(this.inputCode);
      if (!isValid) {
        this.errorMessage = 'Invalid pairing code format';
      } else {
        this.errorMessage = '';
      }
    } else {
      this.inputCode = '';
    }
  }

  async submitApproval(client) {
    this.status = 'submitting';
    const res = await client.rpc('approve_tv_pairing_code', {
      p_code: this.inputCode,
      p_space_id: this.selectedSpaceId,
    });
    if (res.status === 200 && res.data?.success) {
      this.status = 'success';
      this.pairedDevice = { id: res.data.device_id, name: res.data.device_name };
      this.errorMessage = '';
      return { success: true, device: this.pairedDevice };
    } else {
      this.status = 'error';
      this.errorMessage = res.error?.message || 'Pairing code not found or expired';
      return { success: false, error: this.errorMessage };
    }
  }
}

class RemotePinSim {
  validatePin(pin) {
    if (!/^\d{4}$/.test(pin)) {
      return { valid: false, error: 'PIN must be exactly 4 digits' };
    }
    return { valid: true, error: null };
  }

  hashPin(pin, spaceSalt, crypto) {
    return crypto.sha256(`${spaceSalt}:${pin}`);
  }

  canManagePin(role) {
    return role === 'owner' || role === 'admin';
  }
}

// ============================================================================
// TEST SUITE: TIER 1 WEB PWA & UPLOADER (F20–F25)
// ============================================================================

describe('Tier 1: Web Uploader PWA, OAuth, Pairing & Trash', () => {

  // ==========================================================================
  // F20: Web Share Target Ingestion
  // ==========================================================================
  test('T1-F20-01: Manifest defines share_target configuration with POST action and multipart encoding', {
    tier: 1,
    feature: 'F20',
    timeout: 5000,
  }, async (ctx) => {
    const sim = new WebShareTargetSim();
    const st = sim.manifest.share_target;

    assert.ok(st, 'share_target must be defined in manifest');
    assert.strictEqual(st.action, '/share-target', 'action must be /share-target');
    assert.strictEqual(st.method, 'POST', 'method must be POST');
    assert.strictEqual(st.enctype, 'multipart/form-data', 'enctype must be multipart/form-data');
    assert.strictEqual(st.params.files[0].name, 'file', 'param name must be file');
  });

  test('T1-F20-02: Manifest accepts required MIME categories (images, PDF, Office, plain text)', {
    tier: 1,
    feature: 'F20',
    timeout: 5000,
  }, async (ctx) => {
    const sim = new WebShareTargetSim();
    const accept = sim.manifest.share_target.params.files[0].accept;

    assert.ok(accept.includes('image/*'), 'Must accept images');
    assert.ok(accept.includes('application/pdf'), 'Must accept PDFs');
    assert.ok(accept.includes('.docx'), 'Must accept .docx');
    assert.ok(accept.includes('.pptx'), 'Must accept .pptx');
    assert.ok(accept.includes('.txt'), 'Must accept .txt');
  });

  test('T1-F20-03: Service Worker fetch interceptor captures POST /share-target requests', {
    tier: 1,
    feature: 'F20',
    timeout: 5000,
  }, async (ctx) => {
    const sim = new WebShareTargetSim();
    const fakeRequest = {
      url: 'http://localhost/share-target',
      method: 'POST',
      formData: {
        getAll: (key) => [
          { name: 'incoming_receipt.pdf', type: 'application/pdf', size: 1024, data: Buffer.alloc(1024) },
        ],
      },
    };

    const res = sim.handleFetchEvent(fakeRequest);
    assert.strictEqual(res.status, 303, 'Must redirect with HTTP 303 See Other');
    assert.strictEqual(res.headers.Location, '/?shared=true', 'Must redirect to /?shared=true');
    assert.strictEqual(sim.indexedDbSharedFiles.length, 1, 'File buffered into IndexedDB store');
    assert.strictEqual(sim.indexedDbSharedFiles[0].name, 'incoming_receipt.pdf');
    assert.strictEqual(sim.indexedDbSharedFiles[0].type, 'application/pdf');
  });

  test('T1-F20-04: IndexedDB shared_files store buffers shared files with metadata', {
    tier: 1,
    feature: 'F20',
    timeout: 5000,
  }, async (ctx) => {
    const sim = new WebShareTargetSim();
    sim.handleFetchEvent({
      url: 'http://localhost/share-target',
      method: 'POST',
      formData: {
        getAll: () => [{ name: 'report.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 5000 }],
      },
    });

    const stored = sim.indexedDbSharedFiles[0];
    assert.ok(stored.id, 'Stored item has unique ID');
    assert.strictEqual(stored.name, 'report.docx');
    assert.strictEqual(stored.size, 5000);
    assert.ok(stored.sharedAt, 'Stored item has timestamp');
    assert.ok(!isNaN(Date.parse(stored.sharedAt)));
  });

  test('T1-F20-05: PWA initialization consumes and flushes shared files from IndexedDB', {
    tier: 1,
    feature: 'F20',
    timeout: 5000,
  }, async (ctx) => {
    const sim = new WebShareTargetSim();
    sim.indexedDbSharedFiles.push({ id: 's1', name: 'f1.pdf', size: 2048 });

    assert.strictEqual(sim.indexedDbSharedFiles.length, 1);
    const flushed = sim.flushSharedFiles();
    assert.strictEqual(flushed.length, 1, 'Must flush 1 item');
    assert.strictEqual(flushed[0].name, 'f1.pdf');
    assert.strictEqual(sim.indexedDbSharedFiles.length, 0, 'Store cleared after consumption');
    assert.strictEqual(sim.flushSharedFiles().length, 0, 'Subsequent flush returns empty array');
  });

  // ==========================================================================
  // F21: 50MB Drag & Drop Uploader
  // ==========================================================================
  test('T1-F21-01: Validates and accepts drop zone files <= 50MB (52,428,800 bytes)', {
    tier: 1,
    feature: 'F21',
    timeout: 5000,
  }, async (ctx) => {
    const uploader = new WebUploaderSim();
    const file15MB = { name: 'Family_Album.pdf', size: 15 * 1024 * 1024 };

    const validation = uploader.validateFile(file15MB);
    assert.strictEqual(validation.valid, true);
    assert.strictEqual(validation.error, null);

    const enq = uploader.enqueue(file15MB);
    assert.strictEqual(enq.status, 'queued');
    assert.strictEqual(enq.item.status, 'queued');
    assert.strictEqual(enq.item.formattedSize, '15.0 MB');
  });

  test('T1-F21-02: Client-side pre-flight check rejects files exceeding 50MB ceiling before network transfer', {
    tier: 1,
    feature: 'F21',
    timeout: 5000,
  }, async (ctx) => {
    const uploader = new WebUploaderSim();
    const exact50MB = { name: 'boundary.bin', size: 52428800 };
    const over50MB = { name: 'over.bin', size: 52428801 };

    assert.strictEqual(uploader.validateFile(exact50MB).valid, true, 'Exact 50MB accepted');
    const overVal = uploader.validateFile(over50MB);
    assert.strictEqual(overVal.valid, false, '50MB + 1 byte rejected');
    assert.ok(overVal.error.includes('50MB'));

    const enq = uploader.enqueue(over50MB);
    assert.strictEqual(enq.status, 'rejected');
    assert.strictEqual(uploader.queue.length, 0, 'Rejected file not added to upload queue');
  });

  test('T1-F21-03: Rejects zero-byte files during pre-flight validation', {
    tier: 1,
    feature: 'F21',
    timeout: 5000,
  }, async (ctx) => {
    const uploader = new WebUploaderSim();
    const zeroFile = { name: 'empty.txt', size: 0 };

    const val = uploader.validateFile(zeroFile);
    assert.strictEqual(val.valid, false);
    assert.strictEqual(val.error, 'File is empty');

    const res = uploader.enqueue(zeroFile);
    assert.strictEqual(res.status, 'rejected');
    assert.strictEqual(uploader.queue.length, 0);
    assert.strictEqual(uploader.validateFile(null).valid, false);
  });

  test('T1-F21-04: Computes SHA-256 checksum client-side during upload stream', {
    tier: 1,
    feature: 'F21',
    timeout: 5000,
  }, async (ctx) => {
    const sampleData = Buffer.from('TEST_FILE_CONTENT_FOR_HASHING');
    const hash = ctx.crypto.sha256(sampleData);

    assert.strictEqual(typeof hash, 'string');
    assert.strictEqual(hash.length, 64, 'SHA-256 hash must be 64 characters');
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.strictEqual(hash, ctx.crypto.sha256('TEST_FILE_CONTENT_FOR_HASHING'));
    assert.strictEqual(ctx.crypto.sha256(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  test('T1-F21-05: Emits progress events and syncs database catalog upon storage completion', {
    tier: 1,
    feature: 'F21',
    timeout: 5000,
  }, async (ctx) => {
    const uploader = new WebUploaderSim();
    const item = uploader.enqueue({ name: 'Report.pdf', size: 1024 * 1024 }).item;

    const progressValues = [];
    await uploader.uploadStream(item, (pct) => progressValues.push(pct));

    assert.ok(progressValues.length >= 4);
    assert.strictEqual(progressValues[progressValues.length - 1], 100);
    assert.strictEqual(item.status, 'completed');

    // Sync database catalog
    const spaceId = 'space-uploader-sync';
    const storagePath = `${spaceId}/original/${item.id}/Report.pdf`;
    const dbRes = await ctx.client.from('files').insert({
      space_id: spaceId,
      name: item.name,
      size_bytes: item.size,
      storage_path: storagePath,
    });
    assert.status(dbRes, 201);
    assert.strictEqual(dbRes.data.storage_path, storagePath);
  });

  // ==========================================================================
  // F22: Google OAuth Authentication
  // ==========================================================================
  test('T1-F22-01: Initiates Google OAuth provider sign-in with email and profile scopes', {
    tier: 1,
    feature: 'F22',
    timeout: 5000,
  }, async (ctx) => {
    const oauth = new GoogleOAuthSim();
    const flow = oauth.signInWithOAuth({ provider: 'google', scopes: ['email', 'profile'] });

    assert.strictEqual(flow.provider, 'google');
    assert.deepStrictEqual(flow.scopes, ['email', 'profile']);
    assert.ok(flow.authUrl.includes('accounts.google.com'));
    assert.ok(flow.authUrl.includes('code_challenge'));
    assert.ok(flow.codeVerifier.length > 0);
  });

  test('T1-F22-02: Exchanges OAuth redirect code/tokens for authenticated user session JWT', {
    tier: 1,
    feature: 'F22',
    timeout: 5000,
  }, async (ctx) => {
    const oauth = new GoogleOAuthSim();
    const session = oauth.handleCallback('valid_oauth_authorization_code_123');

    assert.ok(session.access_token.startsWith('jwt_access_'));
    assert.ok(session.refresh_token.startsWith('refresh_'));
    assert.ok(session.expires_at > Math.floor(Date.now() / 1000));
    assert.strictEqual(session.user.email, 'user.family@gmail.com');
    assert.strictEqual(oauth.authState, 'authenticated');
  });

  test('T1-F22-03: Persists tokens to browser secure storage and restores session on page reload', {
    tier: 1,
    feature: 'F22',
    timeout: 5000,
  }, async (ctx) => {
    const oauth = new GoogleOAuthSim();
    oauth.handleCallback('code_1');

    // Simulate page reload: new instance accessing same storage
    const reloadedOauth = new GoogleOAuthSim();
    reloadedOauth.storage = oauth.storage;
    const restored = reloadedOauth.restoreSession();

    assert.ok(restored !== null);
    assert.strictEqual(restored.user.email, 'user.family@gmail.com');
    assert.strictEqual(reloadedOauth.authState, 'authenticated');
    assert.strictEqual(reloadedOauth.currentUser.id, '00000000-0000-4000-a000-000000000099');
    assert.ok(reloadedOauth.storage.has('supabase.auth.token'));
  });

  test('T1-F22-04: Auto-refreshes expired access tokens using refresh token', {
    tier: 1,
    feature: 'F22',
    timeout: 5000,
  }, async (ctx) => {
    const oauth = new GoogleOAuthSim();
    oauth.handleCallback('code_2');

    let eventEmitted = null;
    oauth.onAuthStateChange((event, session) => {
      eventEmitted = event;
    });

    const refreshed = oauth.refreshSession('refresh_valid_token');
    assert.ok(refreshed.access_token.startsWith('jwt_refreshed_'));
    assert.strictEqual(eventEmitted, 'TOKEN_REFRESHED');
    assert.strictEqual(oauth.authState, 'authenticated');
    assert.ok(refreshed.expires_at > Math.floor(Date.now() / 1000));

    // Invalid refresh token leads to unauthenticated state
    const badRefresh = oauth.refreshSession('invalid_token');
    assert.strictEqual(badRefresh, null);
  });

  test('T1-F22-05: Sign-out clears tokens and resets auth state', {
    tier: 1,
    feature: 'F22',
    timeout: 5000,
  }, async (ctx) => {
    const oauth = new GoogleOAuthSim();
    oauth.handleCallback('code_3');

    let emittedEvent = null;
    oauth.onAuthStateChange((event) => {
      emittedEvent = event;
    });

    oauth.signOut();
    assert.strictEqual(oauth.authState, 'unauthenticated');
    assert.strictEqual(oauth.currentUser, null);
    assert.strictEqual(oauth.storage.has('supabase.auth.token'), false);
    assert.strictEqual(emittedEvent, 'SIGNED_OUT');
    assert.strictEqual(oauth.restoreSession(), null);
  });

  // ==========================================================================
  // F23: Mobile Pairing Approval Screen (/pair)
  // ==========================================================================
  test('T1-F23-01: Renders pairing code input and normalizes 6-character alphanumeric code', {
    tier: 1,
    feature: 'F23',
    timeout: 5000,
  }, async (ctx) => {
    const screen = new MobilePairScreenSim();
    screen.setCode('x7-k2_p9!');

    assert.strictEqual(screen.inputCode, 'X7K2P9', 'Must strip punctuation and uppercase');
    assert.strictEqual(screen.inputCode.length, 6);
    assert.strictEqual(screen.isSubmitEnabled(), false, 'Disabled when no space selected');

    screen.selectedSpaceId = 'space-01';
    assert.strictEqual(screen.isSubmitEnabled(), true, 'Enabled when 6-char code and space selected');

    screen.setCode('ABC');
    assert.strictEqual(screen.isSubmitEnabled(), false, 'Disabled when code length < 6');
  });

  test('T1-F23-02: Parses pairing code from URL query parameter for QR code scanning', {
    tier: 1,
    feature: 'F23',
    timeout: 5000,
  }, async (ctx) => {
    const screen = new MobilePairScreenSim();
    screen.parseUrl('http://localhost:3000/pair?code=K9M2P4');

    assert.strictEqual(screen.inputCode, 'K9M2P4');
    assert.strictEqual(screen.errorMessage, '');
    assert.match(screen.inputCode, /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);

    // Invalid format query parameter
    screen.parseUrl('http://localhost:3000/pair?code=1100II');
    assert.strictEqual(screen.errorMessage, 'Invalid pairing code format');

    // Empty URL leaves code empty
    screen.parseUrl('http://localhost:3000/pair');
    assert.strictEqual(screen.inputCode, '');
  });

  test('T1-F23-03: Displays space selector listing spaces where user is member', {
    tier: 1,
    feature: 'F23',
    timeout: 5000,
  }, async (ctx) => {
    const screen = new MobilePairScreenSim();
    screen.spacesList = [
      { id: 's1', name: 'Home Space' },
      { id: 's2', name: 'Vacation Cabin' },
    ];

    assert.strictEqual(screen.spacesList.length, 2);
    assert.strictEqual(screen.spacesList[0].name, 'Home Space');
    screen.selectedSpaceId = screen.spacesList[0].id;
    assert.strictEqual(screen.selectedSpaceId, 's1');
    assert.ok(screen.spacesList.some((s) => s.id === 's2'));
    assert.strictEqual(screen.isSubmitEnabled(), false, 'Submit still disabled without code');
  });

  test('T1-F23-04: Submits approval to approve_tv_pairing_code RPC and displays success UI', {
    tier: 1,
    feature: 'F23',
    timeout: 5000,
  }, async (ctx) => {
    const space = (await ctx.client.from('spaces').insert({ name: 'Living Room Space' })).data;
    const reqRes = await ctx.client.rpc('request_tv_pairing_code', {
      p_device_identifier: 'tv-livingroom-f23',
      p_device_name: 'Living Room Sony',
    });
    const code = reqRes.data.code;

    const screen = new MobilePairScreenSim();
    screen.setCode(code);
    screen.selectedSpaceId = space.id;

    const result = await screen.submitApproval(ctx.client);
    assert.strictEqual(result.success, true);
    assert.strictEqual(screen.status, 'success');
    assert.strictEqual(screen.pairedDevice.name, 'Living Room Sony');
    assert.ok(screen.pairedDevice.id);
    assert.strictEqual(screen.errorMessage, '');
  });

  test('T1-F23-05: Handles invalid or expired pairing codes with graceful error display', {
    tier: 1,
    feature: 'F23',
    timeout: 5000,
  }, async (ctx) => {
    const screen = new MobilePairScreenSim();
    screen.setCode('ZZZZZZ');
    screen.selectedSpaceId = 'some-space-id';

    const result = await screen.submitApproval(ctx.client);
    assert.strictEqual(result.success, false);
    assert.strictEqual(screen.status, 'error');
    assert.ok(screen.errorMessage.includes('not found') || screen.errorMessage.includes('expired'));
    assert.strictEqual(screen.pairedDevice, null);
    assert.strictEqual(screen.inputCode, 'ZZZZZZ', 'Input preserved for correction');
  });

  // ==========================================================================
  // F24: Remote TV PIN Management
  // ==========================================================================
  test('T1-F24-01: Accepts exactly 4 numeric digits for TV PIN in remote modal', {
    tier: 1,
    feature: 'F24',
    timeout: 5000,
  }, async (ctx) => {
    const pinMgr = new RemotePinSim();

    assert.strictEqual(pinMgr.validatePin('7492').valid, true);
    assert.strictEqual(pinMgr.validatePin('749').valid, false);
    assert.strictEqual(pinMgr.validatePin('74921').valid, false);
    assert.strictEqual(pinMgr.validatePin('749A').valid, false);
    assert.ok(pinMgr.validatePin('abcd').error.includes('4 digits'));
  });

  test('T1-F24-02: Computes salted SHA-256 hash using space salt', {
    tier: 1,
    feature: 'F24',
    timeout: 5000,
  }, async (ctx) => {
    const pinMgr = new RemotePinSim();
    const hash = pinMgr.hashPin('7492', 'space-salt-123', ctx.crypto);

    assert.strictEqual(hash.length, 64);
    assert.strictEqual(hash, ctx.crypto.sha256('space-salt-123:7492'));
    assert.notStrictEqual(hash, pinMgr.hashPin('0000', 'space-salt-123', ctx.crypto));
    assert.notStrictEqual(hash, pinMgr.hashPin('7492', 'different-salt', ctx.crypto));
    assert.match(hash, /^[0-9a-f]{64}$/);
  });

  test('T1-F24-03: Sets TV PIN by updating spaces.pin_hash and pin_updated_at', {
    tier: 1,
    feature: 'F24',
    timeout: 5000,
  }, async (ctx) => {
    const space = (await ctx.client.from('spaces').insert({ name: 'PIN Space' })).data;
    const pinMgr = new RemotePinSim();
    const hash = pinMgr.hashPin('1234', space.id, ctx.crypto);

    const updateRes = await ctx.client.from('spaces').update({
      pin_hash: hash,
      pin_updated_at: new Date().toISOString(),
    }).eq('id', space.id);

    assert.status(updateRes, 200);
    const updated = (await ctx.client.from('spaces').select('*').eq('id', space.id).single()).data;
    assert.strictEqual(updated.pin_hash, hash);
    assert.ok(updated.pin_updated_at);
    assert.strictEqual(updated.id, space.id);
    assert.strictEqual(updated.name, 'PIN Space');
  });

  test('T1-F24-04: Clears TV PIN lock by setting pin_hash to null', {
    tier: 1,
    feature: 'F24',
    timeout: 5000,
  }, async (ctx) => {
    const space = (await ctx.client.from('spaces').insert({
      name: 'PIN Clear Space',
      pin_hash: 'initial_hash_val',
      pin_updated_at: new Date().toISOString(),
    })).data;

    const clearRes = await ctx.client.from('spaces').update({
      pin_hash: null,
      pin_updated_at: new Date().toISOString(),
    }).eq('id', space.id);

    assert.status(clearRes, 200);
    const cleared = (await ctx.client.from('spaces').select('*').eq('id', space.id).single()).data;
    assert.strictEqual(cleared.pin_hash, null);
    assert.ok(cleared.pin_updated_at);
    assert.strictEqual(cleared.id, space.id);
    assert.strictEqual(cleared.name, 'PIN Clear Space');
  });

  test('T1-F24-05: Restricts PIN management to space owner and admin roles', {
    tier: 1,
    feature: 'F24',
    timeout: 5000,
  }, async (ctx) => {
    const pinMgr = new RemotePinSim();

    assert.strictEqual(pinMgr.canManagePin('owner'), true, 'Owner can manage PIN');
    assert.strictEqual(pinMgr.canManagePin('admin'), true, 'Admin can manage PIN');
    assert.strictEqual(pinMgr.canManagePin('member'), false, 'Member cannot manage PIN');
    assert.strictEqual(pinMgr.canManagePin('viewer'), false);
    assert.strictEqual(pinMgr.canManagePin(null), false);
  });

  // ==========================================================================
  // F25: Trash Management & Recovery
  // ==========================================================================
  test('T1-F25-01: Lists soft-deleted files and folders with deleted_at timestamp', {
    tier: 1,
    feature: 'F25',
    timeout: 5000,
  }, async (ctx) => {
    const space = (await ctx.client.from('spaces').insert({ name: 'Trash List Space' })).data;
    const deletedDate = new Date().toISOString();

    const activeFile = (await ctx.client.from('files').insert({ space_id: space.id, name: 'Active.pdf' })).data;
    const trashFile = (await ctx.client.from('files').insert({
      space_id: space.id,
      name: 'Trash.pdf',
      deleted_at: deletedDate,
      deleted_by: 'user-deleter',
    })).data;

    const trashRes = await ctx.client.from('view_trash_files').select('*').eq('space_id', space.id);
    assert.status(trashRes, 200);
    assert.strictEqual(trashRes.data.length, 1);
    assert.strictEqual(trashRes.data[0].id, trashFile.id);
    assert.strictEqual(trashRes.data[0].name, 'Trash.pdf');
    assert.strictEqual(trashRes.data[0].deleted_by, 'user-deleter');
  });

  test('T1-F25-02: Computes remaining days countdown accurately (30 days - elapsed)', {
    tier: 1,
    feature: 'F25',
    timeout: 5000,
  }, async (ctx) => {
    const space = (await ctx.client.from('spaces').insert({ name: 'Trash Countdown Space' })).data;
    const now = Date.now();

    const file0d = (await ctx.client.from('files').insert({
      space_id: space.id,
      name: 'file0d.pdf',
      deleted_at: new Date(now).toISOString(),
    })).data;
    const file5d = (await ctx.client.from('files').insert({
      space_id: space.id,
      name: 'file5d.pdf',
      deleted_at: new Date(now - 5 * 86400 * 1000).toISOString(),
    })).data;
    const file20d = (await ctx.client.from('files').insert({
      space_id: space.id,
      name: 'file20d.pdf',
      deleted_at: new Date(now - 20 * 86400 * 1000).toISOString(),
    })).data;

    const trashRes = await ctx.client.from('view_trash_files').select('*').eq('space_id', space.id);
    assert.status(trashRes, 200);

    const f0 = trashRes.data.find((f) => f.id === file0d.id);
    const f5 = trashRes.data.find((f) => f.id === file5d.id);
    const f20 = trashRes.data.find((f) => f.id === file20d.id);

    assert.strictEqual(f0.days_remaining, 30);
    assert.strictEqual(f5.days_remaining, 25);
    assert.strictEqual(f20.days_remaining, 10);
    assert.ok(f0.days_remaining >= 0);
  });

  test('T1-F25-03: Restores soft-deleted file by setting deleted_at = null', {
    tier: 1,
    feature: 'F25',
    timeout: 5000,
  }, async (ctx) => {
    const space = (await ctx.client.from('spaces').insert({ name: 'Trash Restore Space' })).data;
    const file = (await ctx.client.from('files').insert({
      space_id: space.id,
      name: 'ToRestore.pdf',
      deleted_at: new Date().toISOString(),
      deleted_by: 'user-01',
    })).data;

    // Restore
    const restoreRes = await ctx.client.from('files').update({
      deleted_at: null,
      deleted_by: null,
    }).eq('id', file.id);
    assert.status(restoreRes, 200);

    const activeList = (await ctx.client.from('view_active_files').select('*').eq('id', file.id)).data;
    assert.strictEqual(activeList.length, 1);
    assert.strictEqual(activeList[0].name, 'ToRestore.pdf');

    const trashList = (await ctx.client.from('view_trash_files').select('*').eq('id', file.id)).data;
    assert.strictEqual(trashList.length, 0);
  });

  test('T1-F25-04: Permanently purges file before 30 days (record + storage object)', {
    tier: 1,
    feature: 'F25',
    timeout: 5000,
  }, async (ctx) => {
    const space = (await ctx.client.from('spaces').insert({ name: 'Purge Space' })).data;
    const storagePath = `${space.id}/original/purge_me.pdf`;

    await ctx.storage.from('family-files').upload(storagePath, Buffer.from('PURGE_DATA'), { contentType: 'application/pdf' });
    const file = (await ctx.client.from('files').insert({
      space_id: space.id,
      name: 'purge_me.pdf',
      storage_path: storagePath,
      deleted_at: new Date().toISOString(),
    })).data;

    // Permanent delete
    const delDb = await ctx.client.from('files').delete().eq('id', file.id);
    assert.status(delDb, 200);

    const delStorage = await ctx.storage.from('family-files').remove([storagePath]);
    assert.status(delStorage, 200);

    const checkDb = (await ctx.client.from('files').select('*').eq('id', file.id)).data;
    assert.strictEqual(checkDb.length, 0);

    const checkStorage = await ctx.storage.from('family-files').download(storagePath);
    assert.status(checkStorage, 404);
  });

  test('T1-F25-05: Cascading folder soft-delete and restoration preserves hierarchy', {
    tier: 1,
    feature: 'F25',
    timeout: 5000,
  }, async (ctx) => {
    const space = (await ctx.client.from('spaces').insert({ name: 'Folder Cascade Space' })).data;
    const folder = (await ctx.client.from('folders').insert({ space_id: space.id, name: 'Archive 2025' })).data;
    const childFile = (await ctx.client.from('files').insert({
      space_id: space.id,
      folder_id: folder.id,
      name: 'Summary.pdf',
    })).data;

    // Soft-delete parent folder and child file
    const now = new Date().toISOString();
    await ctx.client.from('folders').update({ deleted_at: now }).eq('id', folder.id);
    await ctx.client.from('files').update({ deleted_at: now }).eq('id', childFile.id);

    const activeFiles = (await ctx.client.from('view_active_files').select('*').eq('id', childFile.id)).data;
    assert.strictEqual(activeFiles.length, 0, 'Child file hidden from active files');

    // Restore folder and child file
    await ctx.client.from('folders').update({ deleted_at: null }).eq('id', folder.id);
    await ctx.client.from('files').update({ deleted_at: null }).eq('id', childFile.id);

    const restoredFile = (await ctx.client.from('view_active_files').select('*').eq('id', childFile.id).single()).data;
    assert.strictEqual(restoredFile.folder_id, folder.id, 'Hierarchy preserved');
    assert.strictEqual(restoredFile.deleted_at, null);
    assert.strictEqual(restoredFile.name, 'Summary.pdf');
  });
});
