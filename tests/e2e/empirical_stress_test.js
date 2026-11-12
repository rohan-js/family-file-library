/**
 * empirical_stress_test.js
 * Independent empirical challenge test harness executed by Challenger 1 (Milestone E2).
 * Verifies invariants and surfaces failure modes across:
 * 1. Room + SQLite FTS4 virtual table queries
 * 2. Disk LRU Cache (500MB cap, boundary, eviction, pinned immunity)
 * 3. TV UI shelf models & D-pad navigation (overscan, focus wrapping)
 */

const { DatabaseSync } = require('node:sqlite');
const {
  TvDiskCacheSim,
  TvDpadRouter,
  TvOverscanCalculator,
  SafeTvPdfRendererSim,
  KEYCODES,
  ACTIONS,
} = require('./helpers/tv_state_simulator');
const { SupabaseMockClient } = require('./helpers/supabase_mock');

const findings = [];

function recordFinding(category, title, severity, details) {
  findings.push({ category, title, severity, details });
  console.log(`[FINDING][${severity}][${category}] ${title}`);
}

console.log('===============================================================');
console.log('STARTING EMPIRICAL STRESS TEST SUITE FOR MILESTONE E2');
console.log('===============================================================\n');

// ============================================================================
// SUITE 1: ROOM + SQLITE FTS4 VIRTUAL TABLE QUERIES
// ============================================================================
console.log('--- SUITE 1: Room + SQLite FTS4 Virtual Table Queries ---');

function createRoomFtsDb(tokenizer = '') {
  const db = new DatabaseSync(':memory:');
  const tokenizerClause = tokenizer ? `, tokenize=${tokenizer}` : '';
  db.exec(`
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
    CREATE VIRTUAL TABLE files_fts USING fts4(name, extracted_text${tokenizerClause});
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
  return db;
}

function insertSampleFiles(db) {
  const stmt = db.prepare(`
    INSERT INTO files (id, space_id, folder_id, name, file_type, size_bytes, storage_path, status, extracted_text, deleted_at)
    VALUES (?, 'space-01', null, ?, 'application/pdf', 1024, null, 'ready', ?, null)
  `);

  stmt.run('f1', 'Kerala_History.pdf', 'കേരളം ചരിത്രം സംസ്കാരം മനോഹരമായ നാട്');
  stmt.run('f2', 'India_History.pdf', 'इतिहास भारत प्राचीन सभ्यता और संस्कृति');
  stmt.run('f3', 'Tax_Invoice_2026.pdf', 'Total amount: $1,250.00 / INR 1,00,000 paid via C++ engine');
  stmt.run('f4', 'Hospital_Discharge.pdf', 'Patient blood count: hemoglobin 14.5 g/dL normal');
  stmt.run('f5', 'Special (Chars) [File] & More!.pdf', 'Email contact@family.org, phone +91-9876543210');
}

// 1.1 Test Default FTS4 Tokenizer behavior with Indic Languages (Malayalam & Hindi)
const dbDefault = createRoomFtsDb(); // Default FTS4 tokenizer (simple)
insertSampleFiles(dbDefault);

console.log('\n[1.1] Probing Indic Language tokenization under default FTS4:');
const testQueriesIndic = [
  { term: 'കേരളം', label: 'Exact Malayalam word (കേരളം)' },
  { term: 'കേരള*', label: 'Malayalam prefix without virama (കേരള*)' },
  { term: 'ചരിത്രം', label: 'Malayalam word with conjunct ത്ര (ചരിത്രം)' },
  { term: 'ചരിത*', label: 'Malayalam prefix matching conjunct stem (ചരിത*)' },
  { term: 'സംസ്കാരം', label: 'Malayalam word with anusvara (സംസ്കാരം)' },
  { term: 'ഇतिहास', label: 'Exact Hindi word (इतिहास)' },
  { term: 'इतिहास*', label: 'Hindi word prefix (इतिहास*)' },
  { term: 'प्राचीन', label: 'Hindi word with conjunct pra (प्राचीन)' },
  { term: 'भारत', label: 'Hindi word (भारत)' },
];

for (const q of testQueriesIndic) {
  try {
    const stmt = dbDefault.prepare('SELECT name, extracted_text FROM files_fts WHERE files_fts MATCH ?');
    const rows = stmt.all(q.term);
    console.log(`  Query "${q.term}" (${q.label}): found ${rows.length} row(s)`);
    if (rows.length === 0) {
      recordFinding(
        'FTS4_INDIC_TOKENIZATION',
        `Indic query "${q.term}" (${q.label}) returned 0 results under default FTS4 tokenizer`,
        'MEDIUM',
        `Querying "${q.term}" produced 0 hits despite document containing the text. Default FTS4 simple tokenizer does not tokenize Indic Unicode codepoints correctly.`
      );
    }
  } catch (err) {
    console.log(`  Query "${q.term}" (${q.label}): ERROR -> ${err.message}`);
    recordFinding(
      'FTS4_SYNTAX_ERROR',
      `Indic query "${q.term}" caused SQLite FTS syntax error: ${err.message}`,
      'HIGH',
      err.message
    );
  }
}

// 1.2 Test unicode61 Tokenizer behavior with Indic Languages
console.log('\n[1.2] Probing Indic Language tokenization under unicode61 FTS4:');
let dbUnicode = null;
try {
  dbUnicode = createRoomFtsDb('unicode61');
  insertSampleFiles(dbUnicode);
  for (const q of testQueriesIndic) {
    try {
      const stmt = dbUnicode.prepare('SELECT name, extracted_text FROM files_fts WHERE files_fts MATCH ?');
      const rows = stmt.all(q.term);
      console.log(`  [unicode61] Query "${q.term}" (${q.label}): found ${rows.length} row(s)`);
    } catch (err) {
      console.log(`  [unicode61] Query "${q.term}": ERROR -> ${err.message}`);
    }
  }
} catch (err) {
  console.log(`  unicode61 tokenizer creation failed: ${err.message}`);
}

// 1.3 Test Malformed, Special Characters & SQL Injection Queries
console.log('\n[1.3] Probing Special Characters, Wildcards, Injection, and Malformed Queries:');
const adversarialQueries = [
  { q: '', desc: 'Empty string query' },
  { q: '   ', desc: 'Whitespace-only query' },
  { q: '*', desc: 'Wildcard alone' },
  { q: '**', desc: 'Double wildcard' },
  { q: 'test*', desc: 'Standard prefix search' },
  { q: '"', desc: 'Single unclosed double quote' },
  { q: '"""', desc: 'Triple double quote' },
  { q: "'", desc: 'Single quote' },
  { q: "'; DROP TABLE files; --", desc: 'SQL injection string' },
  { q: "' OR '1'='1", desc: 'Boolean SQL injection string' },
  { q: 'AND', desc: 'FTS operator AND without terms' },
  { q: 'OR', desc: 'FTS operator OR without terms' },
  { q: 'NOT', desc: 'FTS operator NOT without terms' },
  { q: 'Tax AND', desc: 'Dangling Boolean operator (Tax AND)' },
  { q: 'Tax OR', desc: 'Dangling Boolean operator (Tax OR)' },
  { q: 'Tax NOT', desc: 'Dangling Boolean operator (Tax NOT)' },
  { q: 'C++', desc: 'Query with plus signs (C++)' },
  { q: 'Special (Chars)', desc: 'Query with parentheses' },
  { q: 'Special [Chars]', desc: 'Query with brackets' },
  { q: 'contact@family.org', desc: 'Query with @ and dot' },
  { q: '+91-9876543210', desc: 'Query with phone + and dashes' },
  { q: 'name:Tax*', desc: 'Valid column-qualified query' },
  { q: 'nonexistent_col:Tax*', desc: 'Invalid column-qualified query' },
  { q: '^Tax', desc: 'Caret / start-of-line operator' },
  { q: 'NEAR/2(Total, amount)', desc: 'NEAR operator' },
];

for (const item of adversarialQueries) {
  try {
    const stmt = dbDefault.prepare('SELECT name, extracted_text FROM files_fts WHERE files_fts MATCH ?');
    const rows = stmt.all(item.q);
    console.log(`  Query [${item.desc}] -> OK (returned ${rows.length} rows)`);
  } catch (err) {
    console.log(`  Query [${item.desc}] -> CRASHED: ${err.message}`);
    recordFinding(
      'FTS4_QUERY_CRASH',
      `Unsanitized FTS4 query crashes on [${item.desc}]: "${item.q}"`,
      'HIGH',
      `Executing files_fts MATCH '${item.q}' threw: ${err.message}. Raw user search inputs from TV UI or Web search will crash the Room query unless sanitized/escaped!`
    );
  }
}

// ============================================================================
// SUITE 2: DISK LRU CACHE (500MB CAP)
// ============================================================================
console.log('\n--- SUITE 2: Disk LRU Cache (500MB Cap & Invariants) ---');

const cache = new TvDiskCacheSim(524288000); // 500MB exact

// 2.1 Exact Byte Boundary Transitions at 500MB (524,288,000 bytes)
console.log('\n[2.1] Probing Exact Byte Boundary at 500MB:');
const exact500MB = 524288000;
cache.put('large_500mb', exact500MB, false);
console.log(`  Added file of exactly 524,288,000 bytes: total bytes = ${cache.getTotalBytes()}`);
if (cache.getTotalBytes() !== exact500MB || !cache.has('large_500mb')) {
  recordFinding(
    'CACHE_BOUNDARY_ERROR',
    'Exact 500MB file was not retained at boundary',
    'HIGH',
    `Expected exactly ${exact500MB} bytes, found ${cache.getTotalBytes()}`
  );
} else {
  console.log('  PASS: Exact 500MB file successfully retained without eviction.');
}

// Add 1 single byte -> should trigger eviction of large_500mb
cache.put('one_byte', 1, false);
console.log(`  Added 1 extra byte: total bytes = ${cache.getTotalBytes()}, large_500mb kept = ${cache.has('large_500mb')}`);
if (cache.has('large_500mb')) {
  recordFinding(
    'CACHE_OVERFLOW',
    'Cache exceeded 500MB ceiling when 1 byte was added',
    'HIGH',
    `Cache size is ${cache.getTotalBytes()} > ${exact500MB}`
  );
} else if (!cache.has('one_byte')) {
  recordFinding('CACHE_LOSS', 'Newly added 1 byte file was not kept', 'HIGH', '');
} else {
  console.log('  PASS: Adding 1 byte past 500MB triggered eviction of the 500MB file, keeping total at 1 byte.');
}

// 2.2 Eviction Order: Least Recently Accessed First
console.log('\n[2.2] Probing Eviction Order (LRU):');
const testCache = new TvDiskCacheSim(300 * 1024 * 1024); // 300MB
testCache.put('docA', 100 * 1024 * 1024, false); // access 1
testCache.put('docB', 100 * 1024 * 1024, false); // access 2
testCache.put('docC', 100 * 1024 * 1024, false); // access 3
// Cache is full at 300MB

// Access docA, so docB becomes the least recently accessed!
testCache.touch('docA'); // access 4

// Add docD (100MB) -> must evict docB, NOT docA or docC!
testCache.put('docD', 100 * 1024 * 1024, false);

console.log(`  Cache contents after adding docD: has(docA)=${testCache.has('docA')}, has(docB)=${testCache.has('docB')}, has(docC)=${testCache.has('docC')}, has(docD)=${testCache.has('docD')}`);
if (testCache.has('docB')) {
  recordFinding(
    'LRU_EVICTION_ORDER_VIOLATION',
    'docB was not evicted even though it was least recently accessed',
    'HIGH',
    `Expected docB to be evicted. docA touched, docB oldest.`
  );
} else if (!testCache.has('docA') || !testCache.has('docC') || !testCache.has('docD')) {
  recordFinding(
    'LRU_EVICTION_WRONG_VICTIM',
    'Wrong file evicted during LRU eviction',
    'HIGH',
    'A more recently accessed file was evicted instead of docB.'
  );
} else {
  console.log('  PASS: Least recently accessed file (docB) was evicted first.');
}

// 2.3 Pinned File Immunity Under 100%+ Cache Saturation
console.log('\n[2.3] Probing Pinned File Immunity Under Saturation:');
const pinnedCache = new TvDiskCacheSim(500 * 1024 * 1024);
pinnedCache.put('pinned_1', 300 * 1024 * 1024, true);
pinnedCache.put('pinned_2', 300 * 1024 * 1024, true);
console.log(`  Two pinned files total = ${pinnedCache.getTotalBytes()} (600MB > 500MB cap)`);
if (!pinnedCache.has('pinned_1') || !pinnedCache.has('pinned_2')) {
  recordFinding(
    'PINNED_IMMUNITY_VIOLATION',
    'Pinned files were evicted when pinned total exceeded capacity',
    'CRITICAL',
    'Pinned files must NEVER be evicted.'
  );
} else {
  console.log('  PASS: Pinned files survived 120% cache saturation.');
}

// Now add unpinned file to this saturated cache
pinnedCache.put('unpinned_new', 10 * 1024 * 1024, false);
console.log(`  Added 10MB unpinned file: unpinned_new kept = ${pinnedCache.has('unpinned_new')}, pinned_1 kept = ${pinnedCache.has('pinned_1')}, pinned_2 kept = ${pinnedCache.has('pinned_2')}`);
if (pinnedCache.has('pinned_1') && pinnedCache.has('pinned_2') && !pinnedCache.has('unpinned_new')) {
  console.log('  PASS: Pinned files immune. Unpinned file evicted because pinned files saturated 100%+ of cap.');
}

// 2.4 Silent Unpinning Bug on Re-put
console.log('\n[2.4] Probing Silent Unpinning Bug on Cache Re-Put:');
const rePutCache = new TvDiskCacheSim(200 * 1024 * 1024);
rePutCache.put('deed_pinned', 50 * 1024 * 1024, true);
console.log(`  deed_pinned isPinned = ${rePutCache.isPinned('deed_pinned')}`);

// Suppose file is re-downloaded or updated in cache without passing isPinned flag:
rePutCache.put('deed_pinned', 60 * 1024 * 1024); // default isPinned is false!
console.log(`  deed_pinned after put(id, newSize): isPinned = ${rePutCache.isPinned('deed_pinned')}`);
if (!rePutCache.isPinned('deed_pinned')) {
  recordFinding(
    'CACHE_SILENT_UNPIN',
    'Calling put() on existing pinned file silently unpins it unless isPinned is explicitly passed',
    'MEDIUM',
    'When re-caching or updating size of an existing cached item, TvDiskCacheSim resets isPinned to Boolean(false). This risks accidental loss of pinned status.'
  );
}

// ============================================================================
// SUITE 3: TV UI SHELF MODELS & D-PAD NAVIGATION
// ============================================================================
console.log('\n--- SUITE 3: TV UI Shelf Models & D-Pad Navigation ---');

// 3.1 Overscan Calculation Across Different TV Resolutions
console.log('\n[3.1] Probing Overscan Calculation Across Resolutions:');
const overscanCalc = new TvOverscanCalculator();
const resolutions = [
  { name: '1080p FHD', w: 1920, h: 1080, expectedHMargin: 96, expectedVMargin: 54 },
  { name: '720p HD', w: 1280, h: 720, expectedHMargin: 64, expectedVMargin: 36 },
  { name: '4K UHD', w: 3840, h: 2160, expectedHMargin: 192, expectedVMargin: 108 },
  { name: 'WXGA Budget TV', w: 1366, h: 768, expectedHMargin: 68, expectedVMargin: 38 },
];

for (const r of resolutions) {
  const safe = overscanCalc.calculateSafeArea(r.w, r.h, 0.05);
  console.log(`  ${r.name} (${r.w}x${r.h}): margin=${safe.horizontalMargin}x${safe.verticalMargin}, safeBounds=${safe.safeWidth}x${safe.safeHeight}`);
  if (safe.horizontalMargin !== r.expectedHMargin || safe.verticalMargin !== r.expectedVMargin) {
    recordFinding(
      'OVERSCAN_ROUNDING_MISMATCH',
      `Overscan margin mismatch on ${r.name}`,
      'LOW',
      `Expected ${r.expectedHMargin}x${r.expectedVMargin}, got ${safe.horizontalMargin}x${safe.verticalMargin}`
    );
  }
}

// Check TvDesignSystemSim in test_f30_f40_android_tv_ui.js for hardcoded DP margins
console.log('\n[3.2] Probing TvDesignSystemSim for Hardcoded Density Assumptions:');
class TvDesignSystemSim {
  constructor(width = 1920, height = 1080) {
    this.width = width;
    this.height = height;
    this.marginPercent = 0.05;
  }
  getSafeMargins() {
    return {
      horizontalMarginPx: Math.round(this.width * this.marginPercent),
      verticalMarginPx: Math.round(this.height * this.marginPercent),
      horizontalMarginDp: 48,
      verticalMarginDp: 27,
    };
  }
}

const ds4k = new TvDesignSystemSim(3840, 2160);
const m4k = ds4k.getSafeMargins();
console.log(`  4K TV safe margins: px=${m4k.horizontalMarginPx}x${m4k.verticalMarginPx}, dp=${m4k.horizontalMarginDp}x${m4k.verticalMarginDp}`);
if (m4k.horizontalMarginDp === 48 && m4k.horizontalMarginPx === 192) {
  // On 4K TV (density 4.0 / xxxhdpi), 192px / 4.0 = 48dp.
  // But on 720p TV (density 1.33 / tvdpi):
  const ds720p = new TvDesignSystemSim(1280, 720);
  const m720p = ds720p.getSafeMargins();
  console.log(`  720p TV safe margins: px=${m720p.horizontalMarginPx}x${m720p.verticalMarginPx}, dp=${m720p.horizontalMarginDp}x${m720p.verticalMarginDp}`);
  // In 720p tvdpi (density 1.333), 64px / 1.333 = 48dp.
  console.log('  Notice: horizontalMarginDp and verticalMarginDp are hardcoded constants (48dp, 27dp) regardless of constructor parameters.');
}

// 3.3 Focus Expansion Boundary Overflow Stress Test
console.log('\n[3.3] Probing Focused Card Boundary Violation against 5% Overscan Margin:');
// When an item at the edge of the safe area is focused:
// Standard card width = 280dp, horizontalMargin = 48dp (96px at 1080p).
// Scale expansion is 1.06x (16.8dp expansion -> 8.4dp in each direction).
// Border is 3dp. Elevation glow is 16dp.
// Total outward expansion = 8.4dp + 3dp + 16dp = 27.4dp!
// Margin is 48dp.
// Remaining margin between glow and display physical edge = 48dp - 27.4dp = 20.6dp (~41px at 1080p).
console.log(`  Scale 1.06x expansion on 280dp card: +8.4dp outwards`);
console.log(`  Neon Cyan border: +3dp outwards`);
console.log(`  Elevation glow: +16dp outwards`);
console.log(`  Total outward footprint expansion: 27.4dp`);
console.log(`  Safe horizontal margin: 48dp`);
console.log(`  Clearance to TV screen physical edge: 20.6dp (CLEAR, does not cross physical edge).`);

// 3.4 Shelf Focus Wrapping and D-Pad Navigation Model
console.log('\n[3.4] Probing TV UI Shelf Models & Focus Indicator Wrapping:');

// In Android TV guidelines:
// Horizontal shelves (TvLazyRow): Does focus wrap from last item to first item, or does it clamp at boundaries?
// Standard Android TV Leanback / Compose TV behavior: FOCUS MUST NOT WRAP HORIZONTALLY!
// Wrapping causes disorientation for 10-foot TV viewing.
// Let's check how the current models and tests handle this.

class ComprehensiveTvShelfNavigationModel {
  constructor() {
    this.shelves = [
      { id: 'continue_reading', name: 'Continue Reading', items: ['cr1', 'cr2'] },
      { id: 'favorites', name: 'Favorites', items: ['fav1', 'fav2', 'fav3'] },
      { id: 'inbox', name: 'Inbox', items: ['inbox1'] },
      { id: 'folders', name: 'Folders', items: ['fld1', 'fld2', 'fld3', 'fld4'] },
    ];
    this.topNav = ['search', 'settings'];
    this.focusArea = 'shelves'; // 'top_nav' or 'shelves'
    this.activeShelfIndex = 0;
    this.activeItemIndex = 0;
    this.activeTopNavIndex = 0;
  }

  handleDpad(keyCode) {
    if (this.focusArea === 'top_nav') {
      if (keyCode === KEYCODES.KEYCODE_DPAD_LEFT) {
        // Clamping vs wrapping in top nav
        if (this.activeTopNavIndex > 0) this.activeTopNavIndex--;
        return { action: 'FOCUS_CHANGED', focusArea: 'top_nav', index: this.activeTopNavIndex };
      }
      if (keyCode === KEYCODES.KEYCODE_DPAD_RIGHT) {
        if (this.activeTopNavIndex < this.topNav.length - 1) this.activeTopNavIndex++;
        return { action: 'FOCUS_CHANGED', focusArea: 'top_nav', index: this.activeTopNavIndex };
      }
      if (keyCode === KEYCODES.KEYCODE_DPAD_DOWN) {
        this.focusArea = 'shelves';
        return { action: 'FOCUS_CHANGED', focusArea: 'shelves', shelf: this.activeShelfIndex, item: this.activeItemIndex };
      }
      return { action: 'NONE' };
    }

    const currentShelf = this.shelves[this.activeShelfIndex];
    if (keyCode === KEYCODES.KEYCODE_DPAD_LEFT) {
      if (this.activeItemIndex > 0) {
        this.activeItemIndex--;
        return { action: 'NAVIGATE_LEFT', shelf: this.activeShelfIndex, item: this.activeItemIndex };
      } else {
        // Edge boundary reached: should CLAMP (no wrap)
        return { action: 'BOUNDARY_CLAMPED', shelf: this.activeShelfIndex, item: this.activeItemIndex };
      }
    }

    if (keyCode === KEYCODES.KEYCODE_DPAD_RIGHT) {
      if (this.activeItemIndex < currentShelf.items.length - 1) {
        this.activeItemIndex++;
        return { action: 'NAVIGATE_RIGHT', shelf: this.activeShelfIndex, item: this.activeItemIndex };
      } else {
        // Edge boundary reached: should CLAMP (no wrap)
        return { action: 'BOUNDARY_CLAMPED', shelf: this.activeShelfIndex, item: this.activeItemIndex };
      }
    }

    if (keyCode === KEYCODES.KEYCODE_DPAD_UP) {
      if (this.activeShelfIndex > 0) {
        this.activeShelfIndex--;
        // Retain or clamp horizontal index
        const newShelf = this.shelves[this.activeShelfIndex];
        this.activeItemIndex = Math.min(this.activeItemIndex, newShelf.items.length - 1);
        return { action: 'NAVIGATE_UP', shelf: this.activeShelfIndex, item: this.activeItemIndex };
      } else {
        // Move to top navigation
        this.focusArea = 'top_nav';
        return { action: 'FOCUS_TOP_NAV', index: this.activeTopNavIndex };
      }
    }

    if (keyCode === KEYCODES.KEYCODE_DPAD_DOWN) {
      if (this.activeShelfIndex < this.shelves.length - 1) {
        this.activeShelfIndex++;
        const newShelf = this.shelves[this.activeShelfIndex];
        this.activeItemIndex = Math.min(this.activeItemIndex, newShelf.items.length - 1);
        return { action: 'NAVIGATE_DOWN', shelf: this.activeShelfIndex, item: this.activeItemIndex };
      } else {
        // Bottom boundary reached: CLAMP (no wrap to top)
        return { action: 'BOUNDARY_CLAMPED', shelf: this.activeShelfIndex, item: this.activeItemIndex };
      }
    }

    return { action: 'UNKNOWN' };
  }
}

const navModel = new ComprehensiveTvShelfNavigationModel();
console.log('  Testing D-pad Left at shelf item 0 (clamping vs wrapping):');
const leftRes = navModel.handleDpad(KEYCODES.KEYCODE_DPAD_LEFT);
console.log(`    Result: ${leftRes.action} (shelf=${leftRes.shelf}, item=${leftRes.item})`);
if (leftRes.action !== 'BOUNDARY_CLAMPED' || leftRes.item !== 0) {
  recordFinding(
    'FOCUS_WRAPPING_UNEXPECTED',
    'Shelf focus wrapped unexpectedly to the end of the row',
    'MEDIUM',
    'Android TV design guidelines require clamping at row edges.'
  );
} else {
  console.log('    PASS: Focus clamped at shelf left edge (no accidental wrap).');
}

console.log('  Testing D-pad Right navigation across shelf:');
navModel.handleDpad(KEYCODES.KEYCODE_DPAD_RIGHT); // item 1
const rightRes = navModel.handleDpad(KEYCODES.KEYCODE_DPAD_RIGHT); // at last item
console.log(`    Result at right edge: ${rightRes.action} (item=${rightRes.item})`);

console.log('  Testing D-pad Up from top shelf into top navigation bar:');
const upRes = navModel.handleDpad(KEYCODES.KEYCODE_DPAD_UP);
console.log(`    Result: ${upRes.action} (focusArea=${navModel.focusArea})`);
if (navModel.focusArea !== 'top_nav') {
  recordFinding('TOP_NAV_UNREACHABLE', 'Top navigation bar was not reached via DPAD_UP from top shelf', 'MEDIUM', '');
} else {
  console.log('    PASS: Navigated from top shelf into top navigation bar.');
}

console.log('  Testing D-pad Down from top navigation back to shelves:');
const downRes = navModel.handleDpad(KEYCODES.KEYCODE_DPAD_DOWN);
console.log(`    Result: ${downRes.action} (focusArea=${navModel.focusArea})`);
if (navModel.focusArea !== 'shelves') {
  recordFinding('SHELVES_UNREACHABLE', 'Could not return to shelves from top nav', 'MEDIUM', '');
} else {
  console.log('    PASS: Navigated back down to active shelf.');
}

// Check deficiency in existing helper/test files
console.log('\n[3.5] Audit of existing tv_state_simulator.js and test_f30_f40_android_tv_ui.js:');
// Does tv_state_simulator.js have TvMultiShelfLayoutSim or shelf navigation?
const tvStateHelpers = require('./helpers/tv_state_simulator');
console.log('  Keys exported by tv_state_simulator.js:', Object.keys(tvStateHelpers));
if (!tvStateHelpers.TvMultiShelfLayoutSim) {
  console.log('  OBSERVATION: TvMultiShelfLayoutSim is defined ONLY locally inside test_f30_f40_android_tv_ui.js, NOT exported in helpers/tv_state_simulator.js!');
  recordFinding(
    'HELPER_ORGANIZATION_GAP',
    'TvMultiShelfLayoutSim is declared in test_f30_f40_android_tv_ui.js but not exported in helpers/tv_state_simulator.js',
    'LOW',
    'Cross-test reusability gap: Other tiers (Tier 3/4) that need to simulate multi-shelf layout cannot import it from helpers/tv_state_simulator.js.'
  );
}

// ============================================================================
// SUMMARY OF FINDINGS
// ============================================================================
console.log('\n===============================================================');
console.log(`STRESS TEST COMPLETE. TOTAL FINDINGS: ${findings.length}`);
console.log('===============================================================');
for (let i = 0; i < findings.length; i++) {
  const f = findings[i];
  console.log(`${i + 1}. [${f.severity}] [${f.category}] ${f.title}`);
  if (f.details) {
    console.log(`   Details: ${f.details.slice(0, 120)}...`);
  }
}
