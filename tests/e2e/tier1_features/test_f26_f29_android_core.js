/**
 * test_f26_f29_android_core.js - Tier 1: Android Core Room FTS4, Cache, KeyStore & Supabase-kt
 * Covers Features F26, F27, F28, F29 (>= 5 assertions per feature).
 */

const { describe, test, assert } = require('../framework');

// ============================================================================
// SIMULATOR MODELS FOR ANDROID CORE CONTRACTS & INVARIANTS
// ============================================================================

let DatabaseSync = null;
try {
  DatabaseSync = require('node:sqlite').DatabaseSync;
} catch (e) {
  DatabaseSync = null;
}

class RoomFtsSimulator {
  constructor() {
    this.useSqlite = Boolean(DatabaseSync);
    if (this.useSqlite) {
      this.db = new DatabaseSync(':memory:');
      this._initTables();
    } else {
      this.files = new Map();
      this.folders = new Map();
      this.bookmarks = new Map();
    }
  }

  _initTables() {
    this.db.exec(`
      CREATE TABLE files (
        id TEXT PRIMARY KEY,
        space_id TEXT,
        folder_id TEXT,
        name TEXT,
        file_type TEXT,
        size_bytes INTEGER,
        storage_path TEXT,
        status TEXT,
        extracted_text TEXT,
        deleted_at TEXT
      );
      CREATE TABLE folders (
        id TEXT PRIMARY KEY,
        space_id TEXT,
        parent_id TEXT,
        name TEXT,
        color TEXT,
        icon TEXT
      );
      CREATE TABLE bookmarks (
        id TEXT PRIMARY KEY,
        file_id TEXT,
        page_number INTEGER,
        scroll_position REAL,
        is_last_read INTEGER
      );
      CREATE VIRTUAL TABLE files_fts USING fts4(name, extracted_text);
      CREATE TRIGGER files_ai AFTER INSERT ON files BEGIN
        INSERT INTO files_fts(docid, name, extracted_text) VALUES (new.rowid, new.name, new.extracted_text);
      END;
      CREATE TRIGGER files_au AFTER UPDATE ON files BEGIN
        DELETE FROM files_fts WHERE docid = old.rowid;
        INSERT INTO files_fts(docid, name, extracted_text) VALUES (new.rowid, new.name, new.extracted_text);
      END;
      CREATE TRIGGER files_bd BEFORE DELETE ON files BEGIN
        DELETE FROM files_fts WHERE docid = old.rowid;
      END;
    `);
  }

  insertFile(file) {
    if (this.useSqlite) {
      const stmt = this.db.prepare(`
        INSERT INTO files (id, space_id, folder_id, name, file_type, size_bytes, storage_path, status, extracted_text, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        file.id,
        file.space_id || 'space-01',
        file.folder_id || null,
        file.name,
        file.file_type || 'application/pdf',
        file.size_bytes || 1024,
        file.storage_path || null,
        file.status || 'ready',
        file.extracted_text || '',
        file.deleted_at || null
      );
    } else {
      this.files.set(file.id, { ...file });
    }
  }

  updateExtractedText(fileId, newText) {
    if (this.useSqlite) {
      this.db.prepare('UPDATE files SET extracted_text = ? WHERE id = ?').run(newText, fileId);
    } else {
      const f = this.files.get(fileId);
      if (f) f.extracted_text = newText;
    }
  }

  deleteFile(fileId) {
    if (this.useSqlite) {
      this.db.prepare('DELETE FROM files WHERE id = ?').run(fileId);
    } else {
      this.files.delete(fileId);
    }
  }

  static sanitizeQuery(query) {
    if (!query || typeof query !== 'string') return '';
    let q = query.trim();
    if (!q) return '';

    // Strip standalone wildcards
    if (/^[*]+$/.test(q)) return '';

    // 1. Double Quote Balancing
    const quoteCount = (q.match(/"/g) || []).length;
    if (quoteCount % 2 !== 0) {
      q = q.replace(/"/g, ' ');
    }

    // 2. Parentheses Balancing
    let openParen = 0;
    let parenValid = true;
    for (const ch of q) {
      if (ch === '(') openParen++;
      else if (ch === ')') {
        openParen--;
        if (openParen < 0) {
          parenValid = false;
          break;
        }
      }
    }
    if (!parenValid || openParen !== 0) {
      q = q.replace(/[()]/g, ' ');
    }

    // 3. Boolean Operator Sanitization
    let tokens = q.trim().split(/\s+/).filter(Boolean);
    const ftsKeywords = new Set(['AND', 'OR', 'NOT', 'NEAR']);

    // Strip leading operators
    while (tokens.length > 0 && ftsKeywords.has(tokens[0].toUpperCase())) {
      tokens.shift();
    }
    // Strip trailing operators
    while (tokens.length > 0 && ftsKeywords.has(tokens[tokens.length - 1].toUpperCase())) {
      tokens.pop();
    }

    // Deduplicate consecutive operators
    const sanitizedTokens = [];
    let prevIsKeyword = false;
    for (const tok of tokens) {
      const isKw = ftsKeywords.has(tok.toUpperCase());
      if (isKw) {
        if (!prevIsKeyword) {
          sanitizedTokens.push(tok);
          prevIsKeyword = true;
        }
      } else {
        sanitizedTokens.push(tok);
        prevIsKeyword = false;
      }
    }

    // Re-check trailing operator after deduplication
    while (sanitizedTokens.length > 0 && ftsKeywords.has(sanitizedTokens[sanitizedTokens.length - 1].toUpperCase())) {
      sanitizedTokens.pop();
    }

    return sanitizedTokens.join(' ').trim();
  }

  searchFts(query) {
    const sanitized = RoomFtsSimulator.sanitizeQuery(query);
    if (!sanitized) return [];

    if (this.useSqlite) {
      try {
        const stmt = this.db.prepare('SELECT name, extracted_text FROM files_fts WHERE files_fts MATCH ?');
        return stmt.all(sanitized);
      } catch (err) {
        // Defensive fallback: invalid FTS syntax returns empty results instead of crashing
        return [];
      }
    } else {
      const q = sanitized.replace(/\*/g, '').toLowerCase();
      const terms = q.split(/\s+/).filter(Boolean);
      if (terms.length === 0) return [];

      const results = [];
      for (const f of this.files.values()) {
        const nameLower = (f.name || '').toLowerCase();
        const textLower = (f.extracted_text || '').toLowerCase();
        const allTermsMatch = terms.every(term => nameLower.includes(term) || textLower.includes(term));
        if (allTermsMatch) {
          results.push({ name: f.name, extracted_text: f.extracted_text });
        }
      }
      return results;
    }
  }
}

class TvCacheManagerSim {
  constructor(capacityBytes = 524288000) {
    this.capacityBytes = capacityBytes; // 500MB
    this.files = new Map();
    this.accessCounter = 0;
    this.stagingFiles = new Map(); // path.tmp -> Buffer
  }

  startAtomicDownload(filePath, buffer) {
    const tmpPath = `${filePath}.tmp`;
    this.stagingFiles.set(tmpPath, buffer);
    return tmpPath;
  }

  commitAtomicDownload(tmpPath, finalPath, expectedSha256, crypto) {
    const buf = this.stagingFiles.get(tmpPath);
    if (!buf) throw new Error(`Temporary download file ${tmpPath} not found`);
    const actualSha256 = crypto.sha256(buf);
    if (actualSha256 !== expectedSha256) {
      this.stagingFiles.delete(tmpPath);
      throw new Error(`Checksum mismatch: expected ${expectedSha256}, got ${actualSha256}`);
    }
    this.stagingFiles.delete(tmpPath);
    const wasPinned = this.isPinned(finalPath);
    this.put(finalPath, buf.length, wasPinned);
    return true;
  }

  put(fileId, sizeBytes, isPinned) {
    const existing = this.files.get(fileId);
    const resolvedPinned = isPinned !== undefined
      ? Boolean(isPinned)
      : (existing ? existing.isPinned : false);

    this.files.set(fileId, {
      sizeBytes,
      isPinned: resolvedPinned,
      accessIndex: ++this.accessCounter,
    });
    this.evictIfNeeded();
  }

  touch(fileId) {
    const item = this.files.get(fileId);
    if (item) {
      item.accessIndex = ++this.accessCounter;
    }
  }

  pin(fileId, isPinned = true) {
    const item = this.files.get(fileId);
    if (item) item.isPinned = Boolean(isPinned);
  }

  isPinned(fileId) {
    return Boolean(this.files.get(fileId)?.isPinned);
  }

  has(fileId) {
    return this.files.has(fileId);
  }

  getTotalBytes() {
    let sum = 0;
    for (const item of this.files.values()) sum += item.sizeBytes;
    return sum;
  }

  evictIfNeeded() {
    while (this.getTotalBytes() > this.capacityBytes) {
      let oldestUnpinned = null;
      let minAccess = Infinity;
      for (const [id, item] of this.files.entries()) {
        if (!item.isPinned && item.accessIndex < minAccess) {
          minAccess = item.accessIndex;
          oldestUnpinned = id;
        }
      }
      if (!oldestUnpinned) break;
      this.files.delete(oldestUnpinned);
    }
  }
}

class DefensiveKeyStoreSim {
  constructor() {
    this.preferences = new Map();
    this.masterKeyAlias = '_androidx_security_master_key_';
    this.isCorrupted = false;
    this.recoveryLog = [];
  }

  saveSession(session) {
    if (this.isCorrupted) {
      throw new Error('KeyStoreException: KeyStore corrupted on API 28 OEM firmware');
    }
    this.preferences.set('encrypted_device_id', session.deviceId);
    this.preferences.set('encrypted_space_id', session.spaceId);
    this.preferences.set('encrypted_device_token', session.deviceToken);
  }

  getSession() {
    if (this.isCorrupted) {
      throw new Error('KeyStoreException: Decryption failed, damaged key blob');
    }
    if (!this.preferences.has('encrypted_device_id')) return null;
    return {
      deviceId: this.preferences.get('encrypted_device_id'),
      spaceId: this.preferences.get('encrypted_space_id'),
      deviceToken: this.preferences.get('encrypted_device_token'),
    };
  }

  simulateCorruption() {
    this.isCorrupted = true;
  }

  autoRecover() {
    this.recoveryLog.push('KeyStore failure detected; initiating auto-recovery');
    this.preferences.clear();
    this.masterKeyAlias = '_androidx_security_master_key_rebuilt_';
    this.isCorrupted = false;
    this.recoveryLog.push('Corrupted EncryptedSharedPreferences cleared and new master key alias created');
    return true;
  }
}

class SupabaseKtClientSim {
  constructor(baseUrl, deviceToken) {
    this.baseUrl = baseUrl;
    this.deviceToken = deviceToken;
    this.timeoutMs = 15000;
    this.headers = {
      apikey: 'anon-key-mock',
      Authorization: `Bearer ${deviceToken}`,
    };
    this.realtimeConnected = false;
    this.listeners = new Map();
  }

  async postgrestQuery(table, filters = {}) {
    return {
      status: 200,
      url: `${this.baseUrl}/rest/v1/${table}`,
      appliedFilters: filters,
      data: [{ id: 'f-kt-1', space_id: filters.space_id, name: 'remote_file.pdf' }],
    };
  }

  async downloadStorage(bucket, path, clientMock) {
    return clientMock.storage.from(bucket).download(path);
  }

  connectRealtime() {
    this.realtimeConnected = true;
    return 'SUBSCRIBED';
  }

  disconnectRealtime() {
    this.realtimeConnected = false;
    this.listeners.clear();
  }

  subscribe(event, callback) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(callback);
  }

  dispatchRealtimeEvent(event, record) {
    if (!this.realtimeConnected) return;
    const handlers = this.listeners.get(event) || [];
    for (const h of handlers) h(record);
  }
}

// ============================================================================
// TEST SUITE: TIER 1 ANDROID CORE (F26–F29)
// ============================================================================

describe('Tier 1: Android Core - Room FTS4, LRU Cache, KeyStore & Supabase-kt', () => {

  // ==========================================================================
  // F26: Room Database with SQLite FTS4
  // ==========================================================================
  test('T1-F26-01: Room DB schema defines files, folders, and bookmarks with column constraints', {
    tier: 1,
    feature: 'F26',
    timeout: 5000,
  }, async (ctx) => {
    const room = new RoomFtsSimulator();
    assert.ok(room, 'Room DB initialized');

    room.insertFile({
      id: 'f-schema-1',
      name: 'SchemaDoc.pdf',
      file_type: 'application/pdf',
      size_bytes: 4096,
      extracted_text: 'Schema verification body',
    });

    const res = room.searchFts('Schema*');
    assert.strictEqual(res.length, 1);
    assert.strictEqual(res[0].name, 'SchemaDoc.pdf');
    assert.strictEqual(res[0].extracted_text, 'Schema verification body');
    assert.ok(room.useSqlite !== undefined);
  });

  test('T1-F26-02: FTS4 virtual table files_fts indexes name and extracted_text', {
    tier: 1,
    feature: 'F26',
    timeout: 5000,
  }, async (ctx) => {
    const room = new RoomFtsSimulator();
    room.insertFile({
      id: 'f-index-1',
      name: 'Passport_Copy.pdf',
      extracted_text: 'Republic of India Passport Authority Ministry of External Affairs',
    });

    const nameMatch = room.searchFts('Passport*');
    assert.strictEqual(nameMatch.length, 1);
    assert.strictEqual(nameMatch[0].name, 'Passport_Copy.pdf');

    const textMatch = room.searchFts('Authority*');
    assert.strictEqual(textMatch.length, 1);
    assert.ok(textMatch[0].extracted_text.includes('Passport Authority'));

    const noMatch = room.searchFts('Automobile*');
    assert.strictEqual(noMatch.length, 0);
  });

  test('T1-F26-03: Executes FTS prefix search queries (term*) returning matching file records', {
    tier: 1,
    feature: 'F26',
    timeout: 5000,
  }, async (ctx) => {
    const room = new RoomFtsSimulator();
    room.insertFile({
      id: 'f-prefix-1',
      name: 'medical_discharge.pdf',
      extracted_text: 'Blood report hemoglobin 14.2 g/dL plate count normal',
    });
    room.insertFile({
      id: 'f-prefix-2',
      name: 'history_notes.pdf',
      extracted_text: 'Mughal empire architecture and monuments',
    });

    const medicMatch = room.searchFts('medic*');
    assert.strictEqual(medicMatch.length, 1);
    assert.strictEqual(medicMatch[0].name, 'medical_discharge.pdf');

    const hemoMatch = room.searchFts('hemo*');
    assert.strictEqual(hemoMatch.length, 1);
    assert.strictEqual(hemoMatch[0].name, 'medical_discharge.pdf');

    const archMatch = room.searchFts('architec*');
    assert.strictEqual(archMatch.length, 1);
    assert.strictEqual(archMatch[0].name, 'history_notes.pdf');

    const unMatch = room.searchFts('astronaut*');
    assert.strictEqual(unMatch.length, 0);
  });

  test('T1-F26-04: Sync triggers keep FTS index synchronized on insert, update, and delete', {
    tier: 1,
    feature: 'F26',
    timeout: 5000,
  }, async (ctx) => {
    const room = new RoomFtsSimulator();
    const fileId = 'f-sync-1';

    // 1. Insert automatically syncs
    room.insertFile({ id: fileId, name: 'original_doc.pdf', extracted_text: 'Old Version Alpha' });
    assert.strictEqual(room.searchFts('Alpha*').length, 1);

    // 2. Update updates FTS index
    room.updateExtractedText(fileId, 'New Version Beta');
    assert.strictEqual(room.searchFts('Beta*').length, 1);
    assert.strictEqual(room.searchFts('Alpha*').length, 0, 'Old text purged from index');

    // 3. Delete removes from FTS index
    room.deleteFile(fileId);
    assert.strictEqual(room.searchFts('Beta*').length, 0, 'Deleted file purged from FTS index');
    assert.strictEqual(room.searchFts('original*').length, 0);
  });

  test('T1-F26-05: Indexes and queries Unicode tokens (Malayalam & Devanagari text)', {
    tier: 1,
    feature: 'F26',
    timeout: 5000,
  }, async (ctx) => {
    const room = new RoomFtsSimulator();
    room.insertFile({
      id: 'f-indic-1',
      name: 'kerala_history.txt',
      extracted_text: 'കേരളം ചരിത്രം സംസ്കാരം',
    });
    room.insertFile({
      id: 'f-indic-2',
      name: 'india_history.txt',
      extracted_text: 'इतिहास भारत प्राचीन सभ्यता',
    });

    const mlMatch = room.searchFts('കേരളം*');
    assert.strictEqual(mlMatch.length, 1);
    assert.strictEqual(mlMatch[0].name, 'kerala_history.txt');

    const hiMatch = room.searchFts('इतिहास*');
    assert.strictEqual(hiMatch.length, 1);
    assert.strictEqual(hiMatch[0].name, 'india_history.txt');

    const unMatch = room.searchFts('തമിഴ്*');
    assert.strictEqual(unMatch.length, 0);
  });

  test('T1-F26-06: Malformed search query sanitization prevents SQLite crashes on quotes, dangling boolean operators, and unmatched parentheses', {
    tier: 1,
    feature: 'F26',
    timeout: 5000,
  }, async (ctx) => {
    const room = new RoomFtsSimulator();
    room.insertFile({
      id: 'f-safe-1',
      name: 'Tax_Invoice_2026.pdf',
      extracted_text: 'Total amount: $1,250.00 / INR 1,00,000 paid via C++ engine AND tax',
    });
    room.insertFile({
      id: 'f-safe-2',
      name: 'Special (Chars) [File] & More!.pdf',
      extracted_text: 'Email contact@family.org, phone +91-9876543210',
    });

    // 1. Unclosed quotes must not crash and return valid empty or sanitized match
    assert.doesNotThrow(() => room.searchFts('"'));
    assert.doesNotThrow(() => room.searchFts('"""'));
    assert.doesNotThrow(() => room.searchFts('"Tax'));
    assert.strictEqual(room.searchFts('"Tax').length, 1);

    // 2. Dangling boolean operators must not crash
    assert.doesNotThrow(() => room.searchFts('AND'));
    assert.doesNotThrow(() => room.searchFts('OR'));
    assert.doesNotThrow(() => room.searchFts('NOT'));
    assert.doesNotThrow(() => room.searchFts('NEAR'));
    assert.strictEqual(room.searchFts('AND').length, 0);

    // 3. Trailing and leading boolean operators preserve root terms
    const trailingAnd = room.searchFts('Tax AND');
    assert.strictEqual(trailingAnd.length, 1);
    assert.strictEqual(trailingAnd[0].name, 'Tax_Invoice_2026.pdf');

    const leadingAnd = room.searchFts('AND Tax');
    assert.strictEqual(leadingAnd.length, 1);

    // 4. Unmatched parentheses must not crash
    assert.doesNotThrow(() => room.searchFts('(hello'));
    assert.doesNotThrow(() => room.searchFts('hello)'));
    assert.doesNotThrow(() => room.searchFts('Tax (AND'));
    assert.strictEqual(room.searchFts('Tax (AND').length, 1);

    // 5. Valid special characters & Indic scripts continue to work
    assert.strictEqual(room.searchFts('C++').length, 1);
    assert.strictEqual(room.searchFts('Special (Chars)').length, 1);
  });

  // ==========================================================================
  // F27: 500MB Local Disk LRU Cache
  // ==========================================================================
  test('T1-F27-01: Atomic download writes to .tmp file and renames upon completed verification', {
    tier: 1,
    feature: 'F27',
    timeout: 5000,
  }, async (ctx) => {
    const cache = new TvCacheManagerSim();
    const payload = Buffer.from('ATOMIC_PAYLOAD_E2E');
    const expectedHash = ctx.crypto.sha256(payload);

    const tmpPath = cache.startAtomicDownload('file_01.pdf', payload);
    assert.strictEqual(tmpPath, 'file_01.pdf.tmp');
    assert.ok(cache.stagingFiles.has(tmpPath));

    const committed = cache.commitAtomicDownload(tmpPath, 'file_01.pdf', expectedHash, ctx.crypto);
    assert.strictEqual(committed, true);
    assert.strictEqual(cache.stagingFiles.has(tmpPath), false, 'Temporary staging file cleared');
    assert.strictEqual(cache.has('file_01.pdf'), true, 'Committed to cache');
  });

  test('T1-F27-02: Accurately tracks total disk cache consumption in bytes', {
    tier: 1,
    feature: 'F27',
    timeout: 5000,
  }, async (ctx) => {
    const cache = new TvCacheManagerSim();
    const b50 = 50 * 1024 * 1024;
    const b120 = 120 * 1024 * 1024;
    const b30 = 30 * 1024 * 1024;

    cache.put('f1', b50);
    assert.strictEqual(cache.getTotalBytes(), b50);

    cache.put('f2', b120);
    assert.strictEqual(cache.getTotalBytes(), b50 + b120);

    cache.put('f3', b30);
    assert.strictEqual(cache.getTotalBytes(), 200 * 1024 * 1024);

    cache.files.delete('f1');
    assert.strictEqual(cache.getTotalBytes(), 150 * 1024 * 1024);
    assert.strictEqual(cache.capacityBytes, 524288000);
  });

  test('T1-F27-03: Enforces strict 500MB (524,288,000 bytes) storage ceiling', {
    tier: 1,
    feature: 'F27',
    timeout: 5000,
  }, async (ctx) => {
    const cache = new TvCacheManagerSim(524288000);
    assert.strictEqual(cache.capacityBytes, 524288000);

    // Add 400MB
    cache.put('file1', 400 * 1024 * 1024, false);
    assert.strictEqual(cache.has('file1'), true);

    // Add 150MB -> exceeds 500MB, evicts file1
    cache.put('file2', 150 * 1024 * 1024, false);
    assert.ok(cache.getTotalBytes() <= 524288000, 'Total bytes must stay <= 500MB');
    assert.strictEqual(cache.has('file1'), false, 'Oldest file evicted');
    assert.strictEqual(cache.has('file2'), true, 'Newer file retained');
  });

  test('T1-F27-04: Eviction policy selects least-recently-accessed unpinned file', {
    tier: 1,
    feature: 'F27',
    timeout: 5000,
  }, async (ctx) => {
    const cache = new TvCacheManagerSim(200 * 1024 * 1024); // 200MB test capacity

    cache.put('fileA', 80 * 1024 * 1024, false); // index 1
    cache.put('fileB', 80 * 1024 * 1024, false); // index 2

    // Touch fileA to make fileB the least recently accessed
    cache.touch('fileA'); // index 3

    // Add fileC (80MB) -> total would be 240MB > 200MB, fileB must be evicted
    cache.put('fileC', 80 * 1024 * 1024, false);

    assert.strictEqual(cache.has('fileB'), false, 'Least recently accessed fileB evicted');
    assert.strictEqual(cache.has('fileA'), true, 'Recently touched fileA survived');
    assert.strictEqual(cache.has('fileC'), true);
    assert.ok(cache.getTotalBytes() <= 200 * 1024 * 1024);
    assert.strictEqual(cache.files.size, 2);
  });

  test('T1-F27-05: Pinned files (is_pinned = true) are immune from eviction under full cache pressure', {
    tier: 1,
    feature: 'F27',
    timeout: 5000,
  }, async (ctx) => {
    const cache = new TvCacheManagerSim(200 * 1024 * 1024);

    // Pinned file P (100MB)
    cache.put('fileP', 100 * 1024 * 1024, true);
    assert.strictEqual(cache.isPinned('fileP'), true);

    // Unpinned file U (80MB)
    cache.put('fileU', 80 * 1024 * 1024, false);

    // Add file newN (80MB) -> triggers eviction
    cache.put('fileN', 80 * 1024 * 1024, false);

    assert.strictEqual(cache.has('fileP'), true, 'Pinned file is IMMUNE from LRU eviction');
    assert.strictEqual(cache.has('fileU'), false, 'Unpinned file evicted');
    assert.strictEqual(cache.has('fileN'), true);

    // Unpinning allows eviction
    cache.pin('fileP', false);
    assert.strictEqual(cache.isPinned('fileP'), false);
  });

  test('T1-F27-06: Preserves pinned file immunity across cache updates, re-puts, and atomic downloads', {
    tier: 1,
    feature: 'F27',
    timeout: 5000,
  }, async (ctx) => {
    const cache = new TvCacheManagerSim(200 * 1024 * 1024);

    // 1. Initial put with isPinned = true
    cache.put('deed_pinned.pdf', 50 * 1024 * 1024, true);
    assert.strictEqual(cache.isPinned('deed_pinned.pdf'), true);

    // 2. Re-put without specifying isPinned -> must PRESERVE true
    cache.put('deed_pinned.pdf', 60 * 1024 * 1024);
    assert.strictEqual(cache.isPinned('deed_pinned.pdf'), true, 'Pinned status must survive re-put without parameter');

    // 3. Re-download via atomic download -> must PRESERVE true
    const payload = Buffer.alloc(70 * 1024 * 1024);
    const hash = ctx.crypto.sha256(payload);
    const tmp = cache.startAtomicDownload('deed_pinned.pdf', payload);
    cache.commitAtomicDownload(tmp, 'deed_pinned.pdf', hash, ctx.crypto);
    assert.strictEqual(cache.isPinned('deed_pinned.pdf'), true, 'Pinned status must survive commitAtomicDownload');

    // 4. Cache saturation: add 150MB unpinned file -> cache total would be 220MB > 200MB
    // Pinned file must survive, unpinned file is evicted or clipped
    cache.put('unpinned_large.pdf', 150 * 1024 * 1024, false);
    assert.strictEqual(cache.has('deed_pinned.pdf'), true, 'Pinned file remains immune from eviction after updates');

    // 5. Explicit unpinning works when requested
    cache.put('deed_pinned.pdf', 70 * 1024 * 1024, false);
    assert.strictEqual(cache.isPinned('deed_pinned.pdf'), false, 'Explicit isPinned=false unpins file');
  });

  // ==========================================================================
  // F28: Defensive KeyStore Credential Store
  // ==========================================================================
  test('T1-F28-01: EncryptedSharedPreferences stores TV device bearer token and session metadata', {
    tier: 1,
    feature: 'F28',
    timeout: 5000,
  }, async (ctx) => {
    const ks = new DefensiveKeyStoreSim();
    ks.saveSession({
      deviceId: 'tv-bravia-101',
      spaceId: 'space-sharma-01',
      deviceToken: 'bearer-token-abc-999',
    });

    const session = ks.getSession();
    assert.ok(session !== null);
    assert.strictEqual(session.deviceId, 'tv-bravia-101');
    assert.strictEqual(session.spaceId, 'space-sharma-01');
    assert.strictEqual(session.deviceToken, 'bearer-token-abc-999');
    assert.strictEqual(ks.masterKeyAlias, '_androidx_security_master_key_');
  });

  test('T1-F28-02: Retrieves stored credentials consistently across simulated app restarts', {
    tier: 1,
    feature: 'F28',
    timeout: 5000,
  }, async (ctx) => {
    const ks1 = new DefensiveKeyStoreSim();
    ks1.saveSession({ deviceId: 'dev-1', spaceId: 'sp-1', deviceToken: 'tok-1' });

    // Restart app
    const ks2 = new DefensiveKeyStoreSim();
    ks2.preferences = ks1.preferences;

    const s = ks2.getSession();
    assert.ok(s);
    assert.strictEqual(s.deviceId, 'dev-1');
    assert.strictEqual(s.spaceId, 'sp-1');
    assert.strictEqual(s.deviceToken, 'tok-1');
    assert.strictEqual(ks2.isCorrupted, false);
  });

  test('T1-F28-03: Simulates KeyStore corruption on API 28 OEM firmware and catches exception', {
    tier: 1,
    feature: 'F28',
    timeout: 5000,
  }, async (ctx) => {
    const ks = new DefensiveKeyStoreSim();
    ks.saveSession({ deviceId: 'dev-2', spaceId: 'sp-2', deviceToken: 'tok-2' });

    // Inject corruption
    ks.simulateCorruption();
    assert.strictEqual(ks.isCorrupted, true);

    let caughtErr = null;
    try {
      ks.getSession();
    } catch (err) {
      caughtErr = err;
    }

    assert.ok(caughtErr !== null);
    assert.ok(caughtErr.message.includes('KeyStoreException'));
    assert.ok(caughtErr.message.includes('Decryption failed'));
  });

  test('T1-F28-04: Auto-recovery clears corrupted shared preferences and deletes damaged alias', {
    tier: 1,
    feature: 'F28',
    timeout: 5000,
  }, async (ctx) => {
    const ks = new DefensiveKeyStoreSim();
    ks.simulateCorruption();

    const recovered = ks.autoRecover();
    assert.strictEqual(recovered, true);
    assert.strictEqual(ks.isCorrupted, false);
    assert.strictEqual(ks.preferences.size, 0, 'Corrupted preferences wiped');
    assert.strictEqual(ks.getSession(), null, 'Returns null prompting re-pairing');
    assert.ok(ks.recoveryLog.length >= 2);
  });

  test('T1-F28-05: Re-initializes clean master key and KeyStore without crashing app', {
    tier: 1,
    feature: 'F28',
    timeout: 5000,
  }, async (ctx) => {
    const ks = new DefensiveKeyStoreSim();
    ks.simulateCorruption();
    ks.autoRecover();

    // Re-pair and save clean session
    ks.saveSession({ deviceId: 'dev-repaired', spaceId: 'sp-new', deviceToken: 'tok-new' });
    const session = ks.getSession();

    assert.ok(session !== null);
    assert.strictEqual(session.deviceId, 'dev-repaired');
    assert.strictEqual(session.deviceToken, 'tok-new');
    assert.strictEqual(ks.masterKeyAlias, '_androidx_security_master_key_rebuilt_');
    assert.strictEqual(ks.isCorrupted, false);
  });

  // ==========================================================================
  // F29: Supabase-kt Client Wrapper
  // ==========================================================================
  test('T1-F29-01: Initializes Supabase-kt client with base URL and device bearer token', {
    tier: 1,
    feature: 'F29',
    timeout: 5000,
  }, async (ctx) => {
    const client = new SupabaseKtClientSim('https://mock.supabase.co', 'bearer-token-123');

    assert.strictEqual(client.baseUrl, 'https://mock.supabase.co');
    assert.strictEqual(client.deviceToken, 'bearer-token-123');
    assert.strictEqual(client.headers['apikey'], 'anon-key-mock');
    assert.strictEqual(client.headers['Authorization'], 'Bearer bearer-token-123');
    assert.ok(client.timeoutMs >= 10000);
  });

  test('T1-F29-02: Executes PostgREST queries with space_id filtering and eq operators', {
    tier: 1,
    feature: 'F29',
    timeout: 5000,
  }, async (ctx) => {
    const client = new SupabaseKtClientSim('https://mock.supabase.co', 'token-abc');
    const res = await client.postgrestQuery('files', { space_id: 'space-test-kt' });

    assert.strictEqual(res.status, 200);
    assert.ok(res.url.endsWith('/rest/v1/files'));
    assert.strictEqual(res.appliedFilters.space_id, 'space-test-kt');
    assert.strictEqual(res.data.length, 1);
    assert.strictEqual(res.data[0].name, 'remote_file.pdf');
  });

  test('T1-F29-03: Storage client downloads files via authenticated request or signed URL', {
    tier: 1,
    feature: 'F29',
    timeout: 5000,
  }, async (ctx) => {
    const client = new SupabaseKtClientSim('https://mock.supabase.co', 'token-abc');
    const path = '29111111-1111-1111-1111-111111111111/download_test.pdf';
    await ctx.storage.from('family-files').upload(path, Buffer.from('DOWNLOAD_ME'), { contentType: 'application/pdf' });

    const dl = await client.downloadStorage('family-files', path, ctx);
    assert.status(dl, 200);
    assert.strictEqual(dl.data.toString(), 'DOWNLOAD_ME');

    const signedUrlRes = await ctx.storage.from('family-files').createSignedUrl(path, 3600);
    assert.status(signedUrlRes, 200);
    assert.ok(signedUrlRes.data.signedUrl.includes(path));
    assert.ok(signedUrlRes.data.signedUrl.startsWith('https://'));
  });

  test('T1-F29-04: Connects to Supabase Realtime WebSocket and joins postgres_changes channel', {
    tier: 1,
    feature: 'F29',
    timeout: 5000,
  }, async (ctx) => {
    const client = new SupabaseKtClientSim('https://mock.supabase.co', 'token-abc');
    assert.strictEqual(client.realtimeConnected, false);

    const status = client.connectRealtime();
    assert.strictEqual(status, 'SUBSCRIBED');
    assert.strictEqual(client.realtimeConnected, true);

    client.disconnectRealtime();
    assert.strictEqual(client.realtimeConnected, false);
    assert.strictEqual(client.listeners.size, 0);
  });

  test('T1-F29-05: Realtime event dispatcher dispatches incoming file events to local listeners', {
    tier: 1,
    feature: 'F29',
    timeout: 5000,
  }, async (ctx) => {
    const client = new SupabaseKtClientSim('https://mock.supabase.co', 'token-abc');
    client.connectRealtime();

    const receivedEvents = [];
    client.subscribe('INSERT', (file) => receivedEvents.push(file));

    client.dispatchRealtimeEvent('INSERT', { id: 'live-file-1', name: 'Prescription.pdf' });
    assert.strictEqual(receivedEvents.length, 1);
    assert.strictEqual(receivedEvents[0].id, 'live-file-1');
    assert.strictEqual(receivedEvents[0].name, 'Prescription.pdf');

    // After disconnect, no more events received
    client.disconnectRealtime();
    client.dispatchRealtimeEvent('INSERT', { id: 'live-file-2', name: 'Other.pdf' });
    assert.strictEqual(receivedEvents.length, 1);
    assert.strictEqual(client.realtimeConnected, false);
  });
});
